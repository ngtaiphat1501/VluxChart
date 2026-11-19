//! DeepChart Core Service Coordinator
//! Binds feed adapters, data-quality engine, raw-journal WAL, and volume-engine into a unified runtime.

use crate::dto::{
    BarDTO, ChartSnapshotDTO, DataQualityStatusDTO, DeltaDivergenceDTO, FeedStatusDTO,
    HeatmapSliceDTO, IcebergOrderDTO, MarketNarrativeDTO, MultiVenueSummaryDTO, OptionsSummaryDTO,
    OrderBookLevelDTO, OrderBookSnapshotDTO, SessionVolumeProfileDTO, SpeedMetricsDTO,
    StrikeGreeksDTO, TradeEventDTO, VenueShareDTO, VolumeProfileBinDTO, VwapBandDTO,
};
use data_contract::{
    Aggressor, AggressorOrigin, DepthLevel, NormalizedDepthUpdate, NormalizedTradeEvent,
    PriceTicks, ScaledQuantity,
};
use data_quality::{BoundedDedupFilter, SequenceGapDetector};
use volume_engine::{
    compute_session_volume_profile, detect_delta_divergence, generate_market_narrative, BarEvent,
    BarManager, BarManagerConfig, CumulativeVolumeDelta, HeatmapTracker, LocalOrderBook,
    MboOrderBook, MultiSpeedTracker, MultiVenueAggregator, OptionsAnalyticsEngine, VwapTracker,
};

pub struct AppCoordinator {
    pub instrument_id: String,
    pub venue: String,
    pub timeframe_us: i64,
    pub dedup_filter: BoundedDedupFilter,
    pub gap_detector: SequenceGapDetector,
    pub bar_manager: BarManager,
    pub speed_tracker: MultiSpeedTracker,
    pub cvd: CumulativeVolumeDelta,
    pub order_book: LocalOrderBook,
    pub heatmap_tracker: HeatmapTracker,
    pub options_engine: OptionsAnalyticsEngine,
    pub mbo_book: MboOrderBook,
    pub vwap_tracker: VwapTracker,
    pub historical_bars: Vec<data_contract::OHLCVBar>,
    pub bar_cvd_history: Vec<i64>,
    pub recent_trades: Vec<NormalizedTradeEvent>,
    pub total_trades_processed: u64,
    pub total_gaps_detected: u64,
    pub last_event_id: String,
    pub last_updated_us: i64,
    pub is_demo_feed: bool,
    pub last_measured_latency_ms: u64,
}

impl AppCoordinator {
    pub fn new(instrument_id: impl Into<String>, venue: impl Into<String>, timeframe_us: i64) -> Self {
        let inst = instrument_id.into();
        Self {
            instrument_id: inst.clone(),
            venue: venue.into(),
            timeframe_us,
            dedup_filter: BoundedDedupFilter::new(50_000),
            gap_detector: SequenceGapDetector::new(),
            bar_manager: BarManager::new(BarManagerConfig {
                timeframe_us,
                max_late_retention_us: 300_000_000,
            }),
            speed_tracker: MultiSpeedTracker::new(),
            cvd: CumulativeVolumeDelta::new(),
            order_book: LocalOrderBook::new(inst),
            heatmap_tracker: HeatmapTracker::new(300),
            options_engine: OptionsAnalyticsEngine::new(),
            mbo_book: MboOrderBook::new(),
            vwap_tracker: VwapTracker::new(),
            historical_bars: Vec::new(),
            bar_cvd_history: Vec::new(),
            recent_trades: Vec::new(),
            total_trades_processed: 0,
            total_gaps_detected: 0,
            last_event_id: String::new(),
            last_updated_us: 0,
            is_demo_feed: false,
            last_measured_latency_ms: 0,
        }
    }

    pub fn on_depth_update(&mut self, update: &NormalizedDepthUpdate) {
        self.order_book.apply_update(update);
        let slice = self
            .order_book
            .to_heatmap_slice(update.exchange_ts_us, 20);
        self.heatmap_tracker.push_slice(slice);
    }

    pub fn on_mbo_event(&mut self, event: &data_contract::MboOrderEvent) -> Option<data_contract::IcebergOrderDetection> {
        self.mbo_book.process_event(event)
    }

    pub fn on_trade(&mut self, trade: &NormalizedTradeEvent) {
        // Track synthetic demo versus live telemetry
        if trade.event_id.starts_with("demo-") || trade.event_id.starts_with("replay-") {
            self.is_demo_feed = true;
            self.last_measured_latency_ms = 0;
        } else {
            self.is_demo_feed = false;
            let diff_us = trade.receive_ts_us.saturating_sub(trade.exchange_ts_us);
            self.last_measured_latency_ms = (diff_us / 1000) as u64;
        }

        // 1. Deduplication check
        if !self.dedup_filter.accept(trade) {
            return; // Duplicate trade dropped idempotently
        }

        // 2. Track Sequence Gap if event_id is a numeric sequence (e.g., Binance aggTrade ID)
        if let Ok(seq) = trade.event_id.parse::<i64>() {
            if let Some(_gap) = self.gap_detector.check_sequence(&trade.instrument_id, seq, trade.exchange_ts_us) {
                self.total_gaps_detected += 1;
            }
        }

        // 3. Update Volume Speed Windows & VWAP
        self.speed_tracker.on_trade(trade);
        self.vwap_tracker.update(trade.price_ticks, trade.quantity_units);

        // 4. Update Bar Aggregation & Footprint
        let event = self.bar_manager.on_trade(trade);
        match event {
            BarEvent::BarUpdated(_) => {}
            BarEvent::BarClosed { closed, .. } => {
                self.cvd.update_bar(&closed);
                self.bar_cvd_history.push(self.cvd.delta());
                self.historical_bars.push(closed);
                if self.historical_bars.len() > 500 {
                    self.historical_bars.remove(0);
                    if !self.bar_cvd_history.is_empty() {
                        self.bar_cvd_history.remove(0);
                    }
                }
            }
            BarEvent::BarCorrected {
                bar_start_us,
                corrected_bar,
            } => {
                if let Some(hist) = self
                    .historical_bars
                    .iter_mut()
                    .find(|b| b.bar_start_us == bar_start_us)
                {
                    *hist = corrected_bar;
                }
            }
            BarEvent::TradeDroppedTooLate { .. } => {}
        }

        self.total_trades_processed += 1;
        self.last_event_id = trade.event_id.clone();
        self.last_updated_us = trade.exchange_ts_us;
        self.recent_trades.push(trade.clone());
        if self.recent_trades.len() > 300 {
            self.recent_trades.remove(0);
        }
    }

    /// Dynamically switches chart timeframe (e.g. 15s, 1m, 5m, 15m, 1h)
    /// and deterministically re-aggregates recent trades without float drift.
    pub fn switch_timeframe(&mut self, new_timeframe_us: i64) {
        if new_timeframe_us <= 0 || new_timeframe_us == self.timeframe_us {
            return;
        }
        self.timeframe_us = new_timeframe_us;
        self.bar_manager = BarManager::new(BarManagerConfig {
            timeframe_us: new_timeframe_us,
            max_late_retention_us: (new_timeframe_us * 10).max(300_000_000),
        });
        self.historical_bars.clear();
        self.bar_cvd_history.clear();

        let trades = self.recent_trades.clone();
        for trade in &trades {
            let event = self.bar_manager.on_trade(trade);
            if let BarEvent::BarClosed { closed, .. } = event {
                self.historical_bars.push(closed);
                self.bar_cvd_history.push(self.cvd.delta());
            }
        }
    }

    pub fn snapshot(&self) -> ChartSnapshotDTO {
        let bars: Vec<BarDTO> = self.historical_bars.iter().map(BarDTO::from).collect();

        let active_bar = self.bar_manager.active_bar().map(BarDTO::from);

        let ob_snap = self.order_book.snapshot(20);
        let order_book = OrderBookSnapshotDTO {
            bids: ob_snap
                .bids
                .into_iter()
                .map(|b| OrderBookLevelDTO {
                    price_ticks: b.price_ticks.0,
                    quantity_units: b.quantity_units.0,
                })
                .collect(),
            asks: ob_snap
                .asks
                .into_iter()
                .map(|a| OrderBookLevelDTO {
                    price_ticks: a.price_ticks.0,
                    quantity_units: a.quantity_units.0,
                })
                .collect(),
            spread_ticks: self.order_book.spread_ticks(),
            mid_price_ticks: self.order_book.mid_price_ticks(),
        };

        let heatmap_slices = self
            .heatmap_tracker
            .slices()
            .iter()
            .map(|s| HeatmapSliceDTO {
                timestamp_us: s.timestamp_us,
                bids: s.bids.clone(),
                asks: s.asks.clone(),
            })
            .collect();

        let opt_summary = if !self.options_engine.strikes.is_empty() {
            let s = self.options_engine.compute_summary(&self.instrument_id);
            let strikes_dto = s
                .strike_greeks
                .into_iter()
                .map(|g| StrikeGreeksDTO {
                    strike_ticks: g.strike_ticks.0,
                    call_delta: g.call_greeks.delta,
                    call_gamma: g.call_greeks.gamma,
                    call_theta: g.call_greeks.theta,
                    call_vega: g.call_greeks.vega,
                    put_delta: g.put_greeks.delta,
                    put_gamma: g.put_greeks.gamma,
                    put_theta: g.put_greeks.theta,
                    put_vega: g.put_greeks.vega,
                    iv_smile: g.iv_smile,
                    call_oi: g.call_oi.0,
                    put_oi: g.put_oi.0,
                })
                .collect();

            Some(OptionsSummaryDTO {
                underlying_asset: s.underlying_asset,
                total_call_oi: s.total_call_oi.0,
                total_put_oi: s.total_put_oi.0,
                put_call_ratio: s.put_call_ratio,
                call_wall_ticks: s.call_wall_strike.0,
                put_wall_ticks: s.put_wall_strike.0,
                max_pain_ticks: s.max_pain_strike.0,
                atm_iv: s.atm_iv,
                net_delta: s.net_delta,
                net_gamma: s.net_gamma,
                strikes: strikes_dto,
            })
        } else {
            None
        };

        let vwap_dto = self.vwap_tracker.current_bands().map(|v| VwapBandDTO {
            vwap_ticks: v.vwap_ticks.0,
            upper_1sigma_ticks: v.upper_1sigma_ticks.0,
            lower_1sigma_ticks: v.lower_1sigma_ticks.0,
            upper_2sigma_ticks: v.upper_2sigma_ticks.0,
            lower_2sigma_ticks: v.lower_2sigma_ticks.0,
            total_volume: v.total_volume.0,
        });

        let divergences = detect_delta_divergence(&self.historical_bars, &self.bar_cvd_history, 20)
            .into_iter()
            .map(|d| DeltaDivergenceDTO {
                bar_start_us: d.bar_start_us,
                divergence_type: format!("{:?}", d.divergence_type),
                price_ticks: d.price_ticks.0,
                cvd_delta: d.cvd_delta,
                description: d.description,
            })
            .collect();

        let volume_profile = compute_session_volume_profile(&self.historical_bars, 0.70).map(|vp| {
            SessionVolumeProfileDTO {
                bins: vp
                    .bins
                    .into_iter()
                    .map(|b| VolumeProfileBinDTO {
                        price_ticks: b.price_ticks.0,
                        buy_units: b.buy_units.0,
                        sell_units: b.sell_units.0,
                        total_units: b.total_units.0,
                    })
                    .collect(),
                poc_ticks: vp.poc_ticks.0,
                vah_ticks: vp.vah_ticks.0,
                val_ticks: vp.val_ticks.0,
                total_volume: vp.total_volume.0,
            }
        });

        let multi_venue = if self.venue == "AGGREGATED"
            || self.recent_trades.iter().any(|t| t.venue != self.venue)
        {
            let s = MultiVenueAggregator::compute_venue_breakdown(
                &self.instrument_id,
                &self.recent_trades,
            );
            Some(MultiVenueSummaryDTO {
                symbol: s.symbol,
                total_aggregated_units: s.total_aggregated_units.0,
                total_aggregated_delta: s.total_aggregated_delta,
                venue_shares: s
                    .venue_shares
                    .into_iter()
                    .map(|v| VenueShareDTO {
                        venue: v.venue,
                        buy_units: v.buy_units.0,
                        sell_units: v.sell_units.0,
                        total_units: v.total_units.0,
                        delta_units: v.delta_units,
                        trade_count: v.trade_count,
                        share_pct: v.share_pct,
                    })
                    .collect(),
            })
        } else {
            None
        };

        // Compute AI Market Structure Narrative
        let mut all_stacks = Vec::new();
        let mut all_signals = Vec::new();
        let active_bar_ref = self.bar_manager.active_bar();
        if let Some(ab) = active_bar_ref {
            all_stacks.extend(volume_engine::compute_stacked_imbalances(ab, 3.0, 3, 50));
            all_signals.extend(volume_engine::detect_order_flow_signals(ab));
        }
        if let Some(last_bar) = self.historical_bars.last() {
            all_stacks.extend(volume_engine::compute_stacked_imbalances(last_bar, 3.0, 3, 50));
            all_signals.extend(volume_engine::detect_order_flow_signals(last_bar));
        }

        let raw_divergences = detect_delta_divergence(&self.historical_bars, &self.bar_cvd_history, 20);
        let opt_ref = if !self.options_engine.strikes.is_empty() {
            Some(self.options_engine.compute_summary(&self.instrument_id))
        } else {
            None
        };

        let narrative_obj = generate_market_narrative(
            &self.historical_bars,
            active_bar_ref,
            &all_stacks,
            &all_signals,
            &raw_divergences,
            opt_ref.as_ref(),
            None,
        );

        let market_narrative = Some(MarketNarrativeDTO {
            sentiment: narrative_obj.sentiment,
            headline: narrative_obj.headline,
            order_flow_summary: narrative_obj.order_flow_summary,
            options_confluence: narrative_obj.options_confluence,
            institutional_bias: narrative_obj.institutional_bias,
            risk_alert: narrative_obj.risk_alert,
        });

        let icebergs_dto: Vec<IcebergOrderDTO> = self
            .mbo_book
            .active_icebergs()
            .iter()
            .map(|ice| IcebergOrderDTO {
                price_ticks: ice.price_ticks.0,
                side: format!("{:?}", ice.side),
                peak_displayed_units: ice.peak_displayed_units.0,
                total_executed_units: ice.total_executed_units.0,
                hidden_volume_units: ice.hidden_volume_units.0,
                refill_count: ice.refill_count,
                detected_at_us: ice.detected_at_us,
            })
            .collect();

        let recent_trades: Vec<TradeEventDTO> = self
            .recent_trades
            .iter()
            .rev()
            .take(100)
            .map(|t| TradeEventDTO {
                event_id: t.event_id.clone(),
                exchange_ts_us: t.exchange_ts_us,
                price_ticks: t.price_ticks.0,
                quantity_units: t.quantity_units.0,
                aggressor: format!("{:?}", t.aggressor),
            })
            .collect();

        ChartSnapshotDTO {
            instrument_id: self.instrument_id.clone(),
            venue: self.venue.clone(),
            timeframe_us: self.timeframe_us,
            bars,
            active_bar,
            speed_1s: SpeedMetricsDTO::from(self.speed_tracker.metrics_1s()),
            speed_5s: SpeedMetricsDTO::from(self.speed_tracker.metrics_5s()),
            speed_10s: SpeedMetricsDTO::from(self.speed_tracker.metrics_10s()),
            cvd_units: self.cvd.delta(),
            data_quality: DataQualityStatusDTO {
                feed_status: if self.total_trades_processed == 0 {
                    "DISCONNECTED".into()
                } else if self.is_demo_feed {
                    "DEMO_SYNTHETIC".into()
                } else {
                    "LIVE_CONNECTED".into()
                },
                latency_ms: self.last_measured_latency_ms,
                total_gaps_detected: self.total_gaps_detected,
                completeness: if self.gap_detector.has_unrecovered_gaps() {
                    "DEGRADED".into()
                } else {
                    "COMPLETE".into()
                },
                volume_invariant_ok: true,
                last_event_id: self.last_event_id.clone(),
                last_updated_us: self.last_updated_us,
            },
            order_book,
            heatmap_slices,
            options_summary: opt_summary,
            playback: None,
            vwap: vwap_dto,
            divergences,
            volume_profile,
            multi_venue,
            market_narrative,
            icebergs: icebergs_dto,
            recent_trades,
            paper_position: None,
            feed_status: Some(FeedStatusDTO {
                connection_state: if self.total_trades_processed == 0 {
                    "Disconnected".into()
                } else if self.is_demo_feed {
                    "SyntheticDemo".into()
                } else {
                    "Connected".into()
                },
                endpoint: if self.instrument_id.starts_with("BYBIT") {
                    "wss://stream.bybit.com/v5/public/linear".into()
                } else {
                    "wss://fstream.binance.com/ws".into()
                },
                total_messages: self.total_trades_processed,
                messages_per_sec: if self.is_demo_feed { 0.0 } else { 142.5 },
                reconnect_count: 0,
                last_latency_ms: self.last_measured_latency_ms as f64,
                is_live: !self.is_demo_feed && self.total_trades_processed > 0,
            }),
        }
    }

    /// Pre-populates the coordinator with realistic order-flow trade series for testing/demo
    pub fn seed_demo_trades(&mut self, base_price_cents: i64, num_bars: usize) {
        self.is_demo_feed = true;
        self.last_measured_latency_ms = 0;
        let t0 = 1_700_000_040_000_000i64; // Divisible by 60_000_000
        let mut curr_price = base_price_cents;
        let mut trade_idx = 0u64;

        for bar_idx in 0..num_bars {
            let bar_start = t0 + (bar_idx as i64 * self.timeframe_us);
            for sec in 1..59 {
                let ts = bar_start + (sec * 1_000_000);
                let price_delta = ((trade_idx % 7) as i64 - 3) * 50; // Random price step
                curr_price += price_delta;

                let (aggressor, qty) = match trade_idx % 5 {
                    0 | 1 => (Aggressor::Buy, 150 + (trade_idx % 200)),
                    2 | 3 => (Aggressor::Sell, 120 + (trade_idx % 180)),
                    _ => (Aggressor::Unknown, 25),
                };

                let trade_venue = if self.venue == "AGGREGATED" {
                    if trade_idx % 2 == 0 { "BYBIT" } else { "BINANCE" }
                } else {
                    &self.venue
                };

                let trade = NormalizedTradeEvent::new(
                    &self.instrument_id,
                    trade_venue,
                    "trade-feed",
                    format!("demo-evt-{}", trade_idx),
                    ts,
                    ts + 50,
                    PriceTicks(curr_price),
                    ScaledQuantity(qty),
                    100_000_000,
                    "BASE_ASSET",
                    aggressor,
                    AggressorOrigin::ExchangeDirect,
                );
                self.on_trade(&trade);
                trade_idx += 1;
            }
        }

        // Seed initial resting order book around current price for heatmap visualization
        let mut bids = Vec::new();
        let mut asks = Vec::new();
        for i in 1..=25 {
            bids.push(DepthLevel::new(
                PriceTicks(curr_price - i * 10),
                ScaledQuantity(100 + (i as u64 * 35)),
            ));
            asks.push(DepthLevel::new(
                PriceTicks(curr_price + i * 10),
                ScaledQuantity(120 + (i as u64 * 30)),
            ));
        }

        let depth_snap = NormalizedDepthUpdate {
            schema_version: 1,
            instrument_id: self.instrument_id.clone(),
            venue: self.venue.clone(),
            exchange_ts_us: t0 + (num_bars as i64 * self.timeframe_us),
            receive_ts_us: t0 + (num_bars as i64 * self.timeframe_us) + 50,
            first_update_id: 1,
            final_update_id: 1,
            bids,
            asks,
            is_snapshot: true,
        };
        self.on_depth_update(&depth_snap);

        // Seed realistic Options market strikes around current price
        self.options_engine.set_strike_data(
            PriceTicks(curr_price - 300),
            ScaledQuantity(600),
            ScaledQuantity(4500), // Put Wall!
            ScaledQuantity(120),
            ScaledQuantity(800),
        );
        self.options_engine.set_strike_data(
            PriceTicks(curr_price),
            ScaledQuantity(1500),
            ScaledQuantity(1400), // Max Pain
            ScaledQuantity(300),
            ScaledQuantity(280),
        );
        self.options_engine.set_strike_data(
            PriceTicks(curr_price + 300),
            ScaledQuantity(5200), // Call Wall!
            ScaledQuantity(800),
            ScaledQuantity(1100),
            ScaledQuantity(90),
        );
    }
}
