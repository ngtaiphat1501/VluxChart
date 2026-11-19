//! Presentation Data Transfer Objects (DTO) for Tauri IPC Bridge
//! Strictly maps integer domain values to clean JSON serializable formats.

use data_contract::{FootprintCell, OHLCVBar, PriceTicks};
use serde::{Deserialize, Serialize};
use volume_engine::{
    compute_poc, compute_stacked_imbalances, compute_value_area, detect_order_flow_signals,
    ImbalanceSide, SpeedMetrics,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FootprintCellDTO {
    pub price_ticks: i64,
    pub buy_units: u64,
    pub sell_units: u64,
    pub unknown_units: u64,
    pub total_units: u64,
    pub delta_units: i64,
    pub trade_count: u32,
}

impl From<(&PriceTicks, &FootprintCell)> for FootprintCellDTO {
    fn from((price, cell): (&PriceTicks, &FootprintCell)) -> Self {
        Self {
            price_ticks: price.0,
            buy_units: cell.buy_units.0,
            sell_units: cell.sell_units.0,
            unknown_units: cell.unknown_units.0,
            total_units: cell.total_units.0,
            delta_units: cell.delta_units(),
            trade_count: cell.trade_count,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValueAreaDTO {
    pub poc_ticks: i64,
    pub vah_ticks: i64,
    pub val_ticks: i64,
    pub volume_covered: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StackedImbalanceDTO {
    pub side: String,
    pub start_price_ticks: i64,
    pub end_price_ticks: i64,
    pub levels_count: usize,
    pub total_imbalance_volume: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderFlowSignalDTO {
    pub signal_type: String,
    pub price_ticks: i64,
    pub volume_units: u64,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BarDTO {
    pub bar_start_us: i64,
    pub timeframe_us: i64,
    pub open_ticks: i64,
    pub high_ticks: i64,
    pub low_ticks: i64,
    pub close_ticks: i64,
    pub buy_units: u64,
    pub sell_units: u64,
    pub unknown_units: u64,
    pub total_units: u64,
    pub delta_units: i64,
    pub trade_count: u64,
    pub poc_ticks: Option<i64>,
    pub value_area: Option<ValueAreaDTO>,
    pub footprint: Vec<FootprintCellDTO>,
    pub stacked_imbalances: Vec<StackedImbalanceDTO>,
    pub signals: Vec<OrderFlowSignalDTO>,
    pub finality: String,
    pub completeness: String,
}

impl From<&OHLCVBar> for BarDTO {
    fn from(bar: &OHLCVBar) -> Self {
        let poc = compute_poc(bar);
        let va = compute_value_area(bar, 0.70);
        let stacked = compute_stacked_imbalances(bar, 3.0, 3, 50);
        let signals = detect_order_flow_signals(bar);

        let footprint_dto: Vec<FootprintCellDTO> = bar
            .footprint
            .iter()
            .map(|(p, c)| FootprintCellDTO::from((p, c)))
            .collect();

        let stacked_dto = stacked
            .into_iter()
            .map(|s| StackedImbalanceDTO {
                side: match s.side {
                    ImbalanceSide::Buy => "Buy".into(),
                    ImbalanceSide::Sell => "Sell".into(),
                },
                start_price_ticks: s.start_price_ticks.0,
                end_price_ticks: s.end_price_ticks.0,
                levels_count: s.levels_count,
                total_imbalance_volume: s.total_imbalance_volume.0,
            })
            .collect();

        let signals_dto = signals
            .into_iter()
            .map(|sig| OrderFlowSignalDTO {
                signal_type: format!("{:?}", sig.signal_type),
                price_ticks: sig.price_ticks.0,
                volume_units: sig.volume_units.0,
                description: sig.description,
            })
            .collect();

        Self {
            bar_start_us: bar.bar_start_us,
            timeframe_us: bar.timeframe_us,
            open_ticks: bar.open_ticks.0,
            high_ticks: bar.high_ticks.0,
            low_ticks: bar.low_ticks.0,
            close_ticks: bar.close_ticks.0,
            buy_units: bar.buy_units.0,
            sell_units: bar.sell_units.0,
            unknown_units: bar.unknown_units.0,
            total_units: bar.total_units.0,
            delta_units: bar.delta_units(),
            trade_count: bar.trade_count,
            poc_ticks: poc.map(|p| p.price_ticks.0),
            value_area: va.map(|v| ValueAreaDTO {
                poc_ticks: v.poc_ticks.0,
                vah_ticks: v.vah_ticks.0,
                val_ticks: v.val_ticks.0,
                volume_covered: v.volume_covered.0,
            }),
            footprint: footprint_dto,
            stacked_imbalances: stacked_dto,
            signals: signals_dto,
            finality: format!("{:?}", bar.finality),
            completeness: format!("{:?}", bar.completeness),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpeedMetricsDTO {
    pub window_ms: u32,
    pub trade_count: u32,
    pub buy_units: u64,
    pub sell_units: u64,
    pub total_units: u64,
    pub delta_units: i64,
}

impl From<SpeedMetrics> for SpeedMetricsDTO {
    fn from(s: SpeedMetrics) -> Self {
        Self {
            window_ms: s.window_ms,
            trade_count: s.trade_count,
            buy_units: s.buy_units.0,
            sell_units: s.sell_units.0,
            total_units: s.total_units.0,
            delta_units: s.delta_units,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataQualityStatusDTO {
    pub feed_status: String,
    pub latency_ms: u64,
    pub total_gaps_detected: u64,
    pub completeness: String,
    pub volume_invariant_ok: bool,
    pub last_event_id: String,
    pub last_updated_us: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderBookLevelDTO {
    pub price_ticks: i64,
    pub quantity_units: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderBookSnapshotDTO {
    pub bids: Vec<OrderBookLevelDTO>,
    pub asks: Vec<OrderBookLevelDTO>,
    pub spread_ticks: Option<i64>,
    pub mid_price_ticks: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeatmapSliceDTO {
    pub timestamp_us: i64,
    pub bids: Vec<(i64, u64)>,
    pub asks: Vec<(i64, u64)>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StrikeGreeksDTO {
    pub strike_ticks: i64,
    pub call_delta: f64,
    pub call_gamma: f64,
    pub call_theta: f64,
    pub call_vega: f64,
    pub put_delta: f64,
    pub put_gamma: f64,
    pub put_theta: f64,
    pub put_vega: f64,
    pub iv_smile: f64,
    pub call_oi: u64,
    pub put_oi: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptionsSummaryDTO {
    pub underlying_asset: String,
    pub total_call_oi: u64,
    pub total_put_oi: u64,
    pub put_call_ratio: f64,
    pub call_wall_ticks: i64,
    pub put_wall_ticks: i64,
    pub max_pain_ticks: i64,
    pub atm_iv: f64,
    pub net_delta: f64,
    pub net_gamma: f64,
    pub strikes: Vec<StrikeGreeksDTO>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketNarrativeDTO {
    pub sentiment: String,
    pub headline: String,
    pub order_flow_summary: String,
    pub options_confluence: String,
    pub institutional_bias: String,
    pub risk_alert: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IcebergOrderDTO {
    pub price_ticks: i64,
    pub side: String,
    pub peak_displayed_units: u64,
    pub total_executed_units: u64,
    pub hidden_volume_units: u64,
    pub refill_count: u32,
    pub detected_at_us: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaybackStatusDTO {
    pub is_replay_mode: bool,
    pub state: String,
    pub speed_multiplier: u32,
    pub progress_pct: f64,
    pub current_ts_us: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VwapBandDTO {
    pub vwap_ticks: i64,
    pub upper_1sigma_ticks: i64,
    pub lower_1sigma_ticks: i64,
    pub upper_2sigma_ticks: i64,
    pub lower_2sigma_ticks: i64,
    pub total_volume: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeltaDivergenceDTO {
    pub bar_start_us: i64,
    pub divergence_type: String,
    pub price_ticks: i64,
    pub cvd_delta: i64,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VolumeProfileBinDTO {
    pub price_ticks: i64,
    pub buy_units: u64,
    pub sell_units: u64,
    pub total_units: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionVolumeProfileDTO {
    pub bins: Vec<VolumeProfileBinDTO>,
    pub poc_ticks: i64,
    pub vah_ticks: i64,
    pub val_ticks: i64,
    pub total_volume: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VenueShareDTO {
    pub venue: String,
    pub buy_units: u64,
    pub sell_units: u64,
    pub total_units: u64,
    pub delta_units: i64,
    pub trade_count: u32,
    pub share_pct: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MultiVenueSummaryDTO {
    pub symbol: String,
    pub total_aggregated_units: u64,
    pub total_aggregated_delta: i64,
    pub venue_shares: Vec<VenueShareDTO>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BacktestConfigDTO {
    pub strategy_name: String,
    pub trade_size_units: u64,
    pub stop_loss_ticks: i64,
    pub take_profit_ticks: i64,
    pub slippage_ticks: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BacktestTradeDTO {
    pub trade_id: u64,
    pub side: String,
    pub entry_price_ticks: i64,
    pub exit_price_ticks: i64,
    pub entry_time_us: i64,
    pub exit_time_us: i64,
    pub quantity_units: u64,
    pub pnl_ticks: i64,
    pub pnl_pct: f64,
    pub exit_reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BacktestReportDTO {
    pub strategy_name: String,
    pub total_trades: usize,
    pub winning_trades: usize,
    pub losing_trades: usize,
    pub win_rate_pct: f64,
    pub gross_profit_ticks: i64,
    pub gross_loss_ticks: i64,
    pub net_pnl_ticks: i64,
    pub profit_factor: f64,
    pub max_drawdown_ticks: i64,
    pub max_drawdown_pct: f64,
    pub avg_trade_pnl_ticks: f64,
    pub trades: Vec<BacktestTradeDTO>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptimizationSweepConfigDTO {
    pub strategy_name: String,
    pub stop_loss_range: Vec<i64>,
    pub take_profit_range: Vec<i64>,
    pub trade_size_units: u64,
    pub slippage_ticks: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptimizationResultItemDTO {
    pub stop_loss_ticks: i64,
    pub take_profit_ticks: i64,
    pub total_trades: usize,
    pub winning_trades: usize,
    pub win_rate_pct: f64,
    pub net_pnl_ticks: i64,
    pub profit_factor: f64,
    pub max_drawdown_pct: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptimizationReportDTO {
    pub strategy_name: String,
    pub best_stop_loss_ticks: i64,
    pub best_take_profit_ticks: i64,
    pub best_profit_factor: f64,
    pub best_net_pnl_ticks: i64,
    pub total_combinations: usize,
    pub matrix: Vec<OptimizationResultItemDTO>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaperPositionDTO {
    pub side: String,
    pub quantity_units: u64,
    pub entry_price_ticks: i64,
    pub current_price_ticks: i64,
    pub unrealized_pnl_ticks: i64,
    pub unrealized_pnl_usd: f64,
    pub stop_loss_ticks: i64,
    pub take_profit_ticks: i64,
    pub open_time_us: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TradeEventDTO {
    pub event_id: String,
    pub exchange_ts_us: i64,
    pub price_ticks: i64,
    pub quantity_units: u64,
    pub aggressor: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FeedStatusDTO {
    pub connection_state: String,
    pub endpoint: String,
    pub total_messages: u64,
    pub messages_per_sec: f64,
    pub reconnect_count: u32,
    pub last_latency_ms: f64,
    pub is_live: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChartSnapshotDTO {
    pub instrument_id: String,
    pub venue: String,
    pub timeframe_us: i64,
    pub bars: Vec<BarDTO>,
    pub active_bar: Option<BarDTO>,
    pub speed_1s: SpeedMetricsDTO,
    pub speed_5s: SpeedMetricsDTO,
    pub speed_10s: SpeedMetricsDTO,
    pub cvd_units: i64,
    pub data_quality: DataQualityStatusDTO,
    pub order_book: OrderBookSnapshotDTO,
    pub heatmap_slices: Vec<HeatmapSliceDTO>,
    pub options_summary: Option<OptionsSummaryDTO>,
    pub playback: Option<PlaybackStatusDTO>,
    pub vwap: Option<VwapBandDTO>,
    pub divergences: Vec<DeltaDivergenceDTO>,
    pub volume_profile: Option<SessionVolumeProfileDTO>,
    pub multi_venue: Option<MultiVenueSummaryDTO>,
    pub market_narrative: Option<MarketNarrativeDTO>,
    pub icebergs: Vec<IcebergOrderDTO>,
    pub recent_trades: Vec<TradeEventDTO>,
    pub paper_position: Option<PaperPositionDTO>,
    pub feed_status: Option<FeedStatusDTO>,
}
