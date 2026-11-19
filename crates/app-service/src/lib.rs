//! DeepChart App Service & IPC Bridge Coordinator
//! Manages engine state, instruments, and prepares throttled presentation snapshots for Tauri UI.

pub mod coordinator;
pub mod dto;
pub mod exporter;
pub mod replayer;

pub use coordinator::AppCoordinator;
pub use dto::*;
pub use exporter::DataExporter;
pub use replayer::{HistoricalReplayer, PlaybackSpeed, PlaybackState};

pub use data_contract::*;
pub use data_quality::*;
pub use feed_adapters::*;
pub use raw_journal::*;
pub use volume_engine::*;

use std::sync::Mutex;

pub struct AppServiceState {
    pub coordinator: Mutex<AppCoordinator>,
    pub registry: InstrumentRegistry,
    pub replayer: Mutex<Option<HistoricalReplayer>>,
}

impl Default for AppServiceState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppServiceState {
    pub fn new() -> Self {
        let mut coord = AppCoordinator::new(
            "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
            "BYBIT",
            60_000_000, // 1m
        );
        // Pre-seed demo trades anchored strictly to real market price (~$67,260.00)
        coord.seed_demo_trades(6726000, 10);

        let yaml_str = include_str!("../../../instruments.yaml");
        let registry = InstrumentRegistry::load_from_yaml_str(yaml_str)
            .expect("Valid instruments.yaml must be bundled");

        Self {
            coordinator: Mutex::new(coord),
            registry,
            replayer: Mutex::new(None),
        }
    }

    pub fn switch_instrument(&self, instrument_id: &str) -> Result<(), String> {
        let def = self
            .registry
            .get(instrument_id)
            .ok_or_else(|| format!("Unknown instrument: {}", instrument_id))?;

        let mut coord = self.coordinator.lock().map_err(|e| e.to_string())?;
        let base_price = match def.symbol.as_str() {
            "BTCUSDT" => 6726000,
            "ETHUSDT" => 190800,
            "XAUUSDT" => 388600,
            _ => 6726000,
        };

        *coord = AppCoordinator::new(&def.instrument_id, &def.venue, 60_000_000);
        coord.seed_demo_trades(base_price, 10);
        *self.replayer.lock().map_err(|e| e.to_string())? = None;
        Ok(())
    }

    pub fn switch_timeframe(&self, timeframe_us: i64) -> Result<ChartSnapshotDTO, String> {
        let mut coord = self.coordinator.lock().map_err(|e| e.to_string())?;
        coord.switch_timeframe(timeframe_us);
        let rep = self.replayer.lock().map_err(|e| e.to_string())?;
        self.snapshot_internal(&coord, &rep)
    }

    pub fn toggle_replay(&self, enable: bool) -> Result<ChartSnapshotDTO, String> {
        let mut replayer_guard = self.replayer.lock().map_err(|e| e.to_string())?;
        let mut coord = self.coordinator.lock().map_err(|e| e.to_string())?;

        if enable {
            let inst = coord.instrument_id.clone();
            let venue = coord.venue.clone();
            *coord = AppCoordinator::new(&inst, &venue, 60_000_000);

            // Generate deterministic replay trades
            let mut trades = Vec::new();
            let t0 = 1_700_000_040_000_000i64;
            let base_price = coord
                .recent_trades
                .last()
                .map(|t| t.price_ticks.0)
                .unwrap_or(6726000);
            let mut p = base_price;
            for i in 0..120 {
                let ts = t0 + (i as i64 * 1_000_000);
                p += ((i % 5) as i64 - 2) * 50;
                let agg = if i % 2 == 0 { Aggressor::Buy } else { Aggressor::Sell };
                trades.push(NormalizedTradeEvent::new(
                    &inst,
                    &venue,
                    "replayer",
                    format!("replay-{}", i),
                    ts,
                    ts + 10,
                    PriceTicks(p),
                    ScaledQuantity(100 + (i as u64 * 10)),
                    100_000_000,
                    "BASE",
                    agg,
                    AggressorOrigin::ExchangeDirect,
                ));
            }
            let mut rep = HistoricalReplayer::new(trades);
            rep.play();
            // Process initial 20 trades
            for _ in 0..20 {
                rep.step_single_trade(&mut coord);
            }
            *replayer_guard = Some(rep);
        } else {
            *replayer_guard = None;
            let base_price = coord
                .recent_trades
                .last()
                .map(|t| t.price_ticks.0)
                .unwrap_or(6726000);
            coord.seed_demo_trades(base_price, 10);
        }

        self.snapshot_internal(&coord, &replayer_guard)
    }

    pub fn play_replay(&self) -> Result<(), String> {
        let mut rep_guard = self.replayer.lock().map_err(|e| e.to_string())?;
        if let Some(rep) = rep_guard.as_mut() {
            rep.play();
        }
        Ok(())
    }

    pub fn pause_replay(&self) -> Result<(), String> {
        let mut rep_guard = self.replayer.lock().map_err(|e| e.to_string())?;
        if let Some(rep) = rep_guard.as_mut() {
            rep.pause();
        }
        Ok(())
    }

    pub fn step_replay(&self) -> Result<ChartSnapshotDTO, String> {
        let mut rep_guard = self.replayer.lock().map_err(|e| e.to_string())?;
        let mut coord = self.coordinator.lock().map_err(|e| e.to_string())?;
        if let Some(rep) = rep_guard.as_mut() {
            rep.step_single_trade(&mut coord);
        }
        self.snapshot_internal(&coord, &rep_guard)
    }

    pub fn set_replay_speed(&self, speed: u32) -> Result<(), String> {
        let mut rep_guard = self.replayer.lock().map_err(|e| e.to_string())?;
        if let Some(rep) = rep_guard.as_mut() {
            let s = match speed {
                5 => PlaybackSpeed::Fast5x,
                10 => PlaybackSpeed::Fast10x,
                50 => PlaybackSpeed::Fast50x,
                _ => PlaybackSpeed::Normal,
            };
            rep.set_speed(s);
        }
        Ok(())
    }

    pub fn reset_replay(&self) -> Result<ChartSnapshotDTO, String> {
        let mut rep_guard = self.replayer.lock().map_err(|e| e.to_string())?;
        let mut coord = self.coordinator.lock().map_err(|e| e.to_string())?;
        if let Some(rep) = rep_guard.as_mut() {
            rep.reset();
            let inst = coord.instrument_id.clone();
            let venue = coord.venue.clone();
            *coord = AppCoordinator::new(&inst, &venue, 60_000_000);
        }
        self.snapshot_internal(&coord, &rep_guard)
    }

    fn snapshot_internal(
        &self,
        coord: &AppCoordinator,
        replayer_guard: &Option<HistoricalReplayer>,
    ) -> Result<ChartSnapshotDTO, String> {
        let mut snap = coord.snapshot();
        if let Some(rep) = replayer_guard.as_ref() {
            snap.playback = Some(PlaybackStatusDTO {
                is_replay_mode: true,
                state: format!("{:?}", rep.state),
                speed_multiplier: rep.speed as u32,
                progress_pct: rep.progress_pct(),
                current_ts_us: rep.current_ts_us,
            });
        }
        Ok(snap)
    }

    pub fn run_backtest(&self, config: crate::dto::BacktestConfigDTO) -> Result<crate::dto::BacktestReportDTO, String> {
        let mut coord = self.coordinator.lock().map_err(|e| e.to_string())?;
        if coord.historical_bars.is_empty() {
            let base_price = coord
                .recent_trades
                .last()
                .map(|t| t.price_ticks.0)
                .unwrap_or(6726000);
            coord.seed_demo_trades(base_price, 25);
        }

        let strat = match config.strategy_name.as_str() {
            "AbsorptionReversal" => volume_engine::StrategyType::AbsorptionReversal,
            "DeltaDivergence" => volume_engine::StrategyType::DeltaDivergence,
            _ => volume_engine::StrategyType::StackedImbalancePullback,
        };

        let engine_config = volume_engine::BacktestConfig {
            strategy_type: strat,
            initial_capital_ticks: 10_000_000,
            trade_size_units: config.trade_size_units.max(1),
            stop_loss_ticks: config.stop_loss_ticks.max(10),
            take_profit_ticks: config.take_profit_ticks.max(10),
            slippage_ticks: config.slippage_ticks.max(0),
        };

        let backtester = volume_engine::OrderFlowBacktester::new(engine_config);
        let report = backtester.run(&coord.historical_bars);

        let trades_dto = report
            .trades
            .into_iter()
            .map(|t| crate::dto::BacktestTradeDTO {
                trade_id: t.trade_id,
                side: format!("{:?}", t.side),
                entry_price_ticks: t.entry_price_ticks,
                exit_price_ticks: t.exit_price_ticks,
                entry_time_us: t.entry_time_us,
                exit_time_us: t.exit_time_us,
                quantity_units: t.quantity_units,
                pnl_ticks: t.pnl_ticks,
                pnl_pct: t.pnl_pct,
                exit_reason: t.exit_reason,
            })
            .collect();

        Ok(crate::dto::BacktestReportDTO {
            strategy_name: report.strategy_name,
            total_trades: report.total_trades,
            winning_trades: report.winning_trades,
            losing_trades: report.losing_trades,
            win_rate_pct: report.win_rate_pct,
            gross_profit_ticks: report.gross_profit_ticks,
            gross_loss_ticks: report.gross_loss_ticks,
            net_pnl_ticks: report.net_pnl_ticks,
            profit_factor: report.profit_factor,
            max_drawdown_ticks: report.max_drawdown_ticks,
            max_drawdown_pct: report.max_drawdown_pct,
            avg_trade_pnl_ticks: report.avg_trade_pnl_ticks,
            trades: trades_dto,
        })
    }

    pub fn run_optimization(
        &self,
        config: crate::dto::OptimizationSweepConfigDTO,
    ) -> Result<crate::dto::OptimizationReportDTO, String> {
        let mut coord = self.coordinator.lock().map_err(|e| e.to_string())?;
        if coord.historical_bars.is_empty() {
            let base_price = coord
                .recent_trades
                .last()
                .map(|t| t.price_ticks.0)
                .unwrap_or(6726000);
            coord.seed_demo_trades(base_price, 25);
        }

        let strat = match config.strategy_name.as_str() {
            "AbsorptionReversal" => volume_engine::StrategyType::AbsorptionReversal,
            "DeltaDivergence" => volume_engine::StrategyType::DeltaDivergence,
            _ => volume_engine::StrategyType::StackedImbalancePullback,
        };

        let sweep_config = volume_engine::OptimizationSweepConfig {
            strategy_type: strat,
            stop_loss_range: if config.stop_loss_range.is_empty() {
                vec![500, 1000, 1500, 2000, 2500, 3000]
            } else {
                config.stop_loss_range
            },
            take_profit_range: if config.take_profit_range.is_empty() {
                vec![1000, 2000, 3000, 4000, 5000, 6000]
            } else {
                config.take_profit_range
            },
            trade_size_units: config.trade_size_units.max(1),
            slippage_ticks: config.slippage_ticks.max(0),
        };

        let report = volume_engine::OrderFlowBacktester::optimize(&coord.historical_bars, &sweep_config);

        let matrix_dto = report
            .matrix
            .into_iter()
            .map(|item| crate::dto::OptimizationResultItemDTO {
                stop_loss_ticks: item.stop_loss_ticks,
                take_profit_ticks: item.take_profit_ticks,
                total_trades: item.total_trades,
                winning_trades: item.winning_trades,
                win_rate_pct: item.win_rate_pct,
                net_pnl_ticks: item.net_pnl_ticks,
                profit_factor: item.profit_factor,
                max_drawdown_pct: item.max_drawdown_pct,
            })
            .collect();

        Ok(crate::dto::OptimizationReportDTO {
            strategy_name: report.strategy_name,
            best_stop_loss_ticks: report.best_stop_loss_ticks,
            best_take_profit_ticks: report.best_take_profit_ticks,
            best_profit_factor: report.best_profit_factor,
            best_net_pnl_ticks: report.best_net_pnl_ticks,
            total_combinations: report.total_combinations,
            matrix: matrix_dto,
        })
    }

    pub fn snapshot(&self) -> Result<ChartSnapshotDTO, String> {
        let coord = self.coordinator.lock().map_err(|e| e.to_string())?;
        let rep = self.replayer.lock().map_err(|e| e.to_string())?;
        self.snapshot_internal(&coord, &rep)
    }
}
