//! Order Flow Strategy Backtester Engine (Phase P5)
//! Simulates order flow strategies with realistic execution fills, stop-loss/take-profit,
//! and comprehensive institutional performance analytics.

use crate::execution_simulator::SimOrderSide;
use crate::indicators::ImbalanceSide;
use crate::vwap::DivergenceType;
use data_contract::OHLCVBar;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StrategyType {
    StackedImbalancePullback,
    AbsorptionReversal,
    DeltaDivergence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestConfig {
    pub strategy_type: StrategyType,
    pub initial_capital_ticks: i64,
    pub trade_size_units: u64,
    pub stop_loss_ticks: i64,
    pub take_profit_ticks: i64,
    pub slippage_ticks: i64,
}

impl Default for BacktestConfig {
    fn default() -> Self {
        Self {
            strategy_type: StrategyType::StackedImbalancePullback,
            initial_capital_ticks: 10_000_000, // 100,000 USD @ 100 ticks/$
            trade_size_units: 1,
            stop_loss_ticks: 1500, // 15 USD
            take_profit_ticks: 3000, // 30 USD (2:1 R:R)
            slippage_ticks: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestTrade {
    pub trade_id: u64,
    pub side: SimOrderSide,
    pub entry_price_ticks: i64,
    pub exit_price_ticks: i64,
    pub entry_time_us: i64,
    pub exit_time_us: i64,
    pub quantity_units: u64,
    pub pnl_ticks: i64,
    pub pnl_pct: f64,
    pub exit_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizationSweepConfig {
    pub strategy_type: StrategyType,
    pub stop_loss_range: Vec<i64>,
    pub take_profit_range: Vec<i64>,
    pub trade_size_units: u64,
    pub slippage_ticks: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizationResultItem {
    pub stop_loss_ticks: i64,
    pub take_profit_ticks: i64,
    pub total_trades: usize,
    pub winning_trades: usize,
    pub win_rate_pct: f64,
    pub net_pnl_ticks: i64,
    pub profit_factor: f64,
    pub max_drawdown_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizationReport {
    pub strategy_name: String,
    pub best_stop_loss_ticks: i64,
    pub best_take_profit_ticks: i64,
    pub best_profit_factor: f64,
    pub best_net_pnl_ticks: i64,
    pub total_combinations: usize,
    pub matrix: Vec<OptimizationResultItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestReport {
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
    pub trades: Vec<BacktestTrade>,
}

pub struct OrderFlowBacktester {
    config: BacktestConfig,
}

impl OrderFlowBacktester {
    pub fn new(config: BacktestConfig) -> Self {
        Self { config }
    }

    /// Run the backtest across a sequence of historical bars with order flow features
    pub fn run(&self, bars: &[OHLCVBar]) -> BacktestReport {
        let mut trades = Vec::new();
        let mut next_trade_id = 1;

        let mut active_position: Option<(SimOrderSide, i64, i64, i64, i64)> = None; 
        // (Side, entry_price_ticks, entry_time_us, sl_ticks, tp_ticks)

        for bar in bars {
            // 1. Check exit conditions for active position on current bar's extremes
            if let Some((side, entry_price, entry_time, sl, tp)) = active_position {
                let mut closed = false;
                let mut exit_price = 0;
                let mut reason = "";

                match side {
                    SimOrderSide::Buy => {
                        // Stop loss triggered
                        if bar.low_ticks.0 <= sl {
                            exit_price = sl - self.config.slippage_ticks;
                            reason = "StopLoss";
                            closed = true;
                        } else if bar.high_ticks.0 >= tp {
                            exit_price = tp;
                            reason = "TakeProfit";
                            closed = true;
                        }
                    }
                    SimOrderSide::Sell => {
                        // Stop loss triggered
                        if bar.high_ticks.0 >= sl {
                            exit_price = sl + self.config.slippage_ticks;
                            reason = "StopLoss";
                            closed = true;
                        } else if bar.low_ticks.0 <= tp {
                            exit_price = tp;
                            reason = "TakeProfit";
                            closed = true;
                        }
                    }
                }

                if closed {
                    let pnl_ticks = match side {
                        SimOrderSide::Buy => (exit_price - entry_price) * self.config.trade_size_units as i64,
                        SimOrderSide::Sell => (entry_price - exit_price) * self.config.trade_size_units as i64,
                    };
                    let pnl_pct = (pnl_ticks as f64 / entry_price as f64) * 100.0;

                    trades.push(BacktestTrade {
                        trade_id: next_trade_id,
                        side,
                        entry_price_ticks: entry_price,
                        exit_price_ticks: exit_price,
                        entry_time_us: entry_time,
                        exit_time_us: bar.bar_start_us + bar.timeframe_us,
                        quantity_units: self.config.trade_size_units,
                        pnl_ticks,
                        pnl_pct,
                        exit_reason: reason.to_string(),
                    });
                    next_trade_id += 1;
                    active_position = None;
                }
            }

            // 2. If no position is open, evaluate strategy entry signals
            if active_position.is_none() {
                match self.config.strategy_type {
                    StrategyType::StackedImbalancePullback => {
                        // Check stacked imbalances
                        let imbalances = crate::indicators::compute_stacked_imbalances(bar, 3.0, 3, 300);
                        if let Some(stack) = imbalances.first() {
                            let entry_price = match stack.side {
                                ImbalanceSide::Buy => stack.start_price_ticks.0 + self.config.slippage_ticks,
                                ImbalanceSide::Sell => stack.start_price_ticks.0 - self.config.slippage_ticks,
                            };
                            let (side, sl, tp) = match stack.side {
                                ImbalanceSide::Buy => (
                                    SimOrderSide::Buy,
                                    entry_price - self.config.stop_loss_ticks,
                                    entry_price + self.config.take_profit_ticks,
                                ),
                                ImbalanceSide::Sell => (
                                    SimOrderSide::Sell,
                                    entry_price + self.config.stop_loss_ticks,
                                    entry_price - self.config.take_profit_ticks,
                                ),
                            };
                            active_position = Some((side, entry_price, bar.bar_start_us, sl, tp));
                        }
                    }
                    StrategyType::AbsorptionReversal => {
                        let signals = crate::indicators::detect_order_flow_signals(bar);
                        for sig in signals {
                            if sig.signal_type == crate::indicators::OrderFlowSignalType::BullishAbsorption {
                                let entry_price = bar.close_ticks.0 + self.config.slippage_ticks;
                                let sl = bar.low_ticks.0 - self.config.stop_loss_ticks;
                                let tp = entry_price + self.config.take_profit_ticks;
                                active_position = Some((SimOrderSide::Buy, entry_price, bar.bar_start_us, sl, tp));
                                break;
                            } else if sig.signal_type == crate::indicators::OrderFlowSignalType::BearishAbsorption {
                                let entry_price = bar.close_ticks.0 - self.config.slippage_ticks;
                                let sl = bar.high_ticks.0 + self.config.stop_loss_ticks;
                                let tp = entry_price - self.config.take_profit_ticks;
                                active_position = Some((SimOrderSide::Sell, entry_price, bar.bar_start_us, sl, tp));
                                break;
                            }
                        }
                    }
                    StrategyType::DeltaDivergence => {
                        let mut cvd = 0i64;
                        let cvd_at_bars: Vec<i64> = bars
                            .iter()
                            .map(|b| {
                                cvd += b.delta_units();
                                cvd
                            })
                            .collect();
                        let divergences = crate::vwap::detect_delta_divergence(bars, &cvd_at_bars, 5);
                        for div in divergences {
                            if div.bar_start_us == bar.bar_start_us {
                                match div.divergence_type {
                                    DivergenceType::BullishDivergence => {
                                        let entry_price = bar.close_ticks.0 + self.config.slippage_ticks;
                                        let sl = bar.low_ticks.0 - self.config.stop_loss_ticks;
                                        let tp = entry_price + self.config.take_profit_ticks;
                                        active_position = Some((SimOrderSide::Buy, entry_price, bar.bar_start_us, sl, tp));
                                        break;
                                    }
                                    DivergenceType::BearishDivergence => {
                                        let entry_price = bar.close_ticks.0 - self.config.slippage_ticks;
                                        let sl = bar.high_ticks.0 + self.config.stop_loss_ticks;
                                        let tp = entry_price - self.config.take_profit_ticks;
                                        active_position = Some((SimOrderSide::Sell, entry_price, bar.bar_start_us, sl, tp));
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Close any remaining position on the final bar at close price
        if let Some((side, entry_price, entry_time, _, _)) = active_position {
            if let Some(last_bar) = bars.last() {
                let exit_price = last_bar.close_ticks.0;
                let pnl_ticks = match side {
                    SimOrderSide::Buy => (exit_price - entry_price) * self.config.trade_size_units as i64,
                    SimOrderSide::Sell => (entry_price - exit_price) * self.config.trade_size_units as i64,
                };
                let pnl_pct = (pnl_ticks as f64 / entry_price as f64) * 100.0;

                trades.push(BacktestTrade {
                    trade_id: next_trade_id,
                    side,
                    entry_price_ticks: entry_price,
                    exit_price_ticks: exit_price,
                    entry_time_us: entry_time,
                    exit_time_us: last_bar.bar_start_us + last_bar.timeframe_us,
                    quantity_units: self.config.trade_size_units,
                    pnl_ticks,
                    pnl_pct,
                    exit_reason: "SessionClose".to_string(),
                });
            }
        }

        // Compute performance metrics
        let total_trades = trades.len();
        let winning_trades = trades.iter().filter(|t| t.pnl_ticks > 0).count();
        let losing_trades = trades.iter().filter(|t| t.pnl_ticks < 0).count();

        let win_rate_pct = if total_trades > 0 {
            (winning_trades as f64 / total_trades as f64) * 100.0
        } else {
            0.0
        };

        let gross_profit_ticks: i64 = trades.iter().filter(|t| t.pnl_ticks > 0).map(|t| t.pnl_ticks).sum();
        let gross_loss_ticks: i64 = trades.iter().filter(|t| t.pnl_ticks < 0).map(|t| t.pnl_ticks.abs()).sum();
        let net_pnl_ticks = gross_profit_ticks - gross_loss_ticks;

        let profit_factor = if gross_loss_ticks > 0 {
            gross_profit_ticks as f64 / gross_loss_ticks as f64
        } else if gross_profit_ticks > 0 {
            99.99
        } else {
            0.0
        };

        // Compute Maximum Drawdown
        let mut peak_pnl = 0i64;
        let mut running_pnl = 0i64;
        let mut max_drawdown_ticks = 0i64;

        for t in &trades {
            running_pnl += t.pnl_ticks;
            if running_pnl > peak_pnl {
                peak_pnl = running_pnl;
            }
            let dd = peak_pnl - running_pnl;
            if dd > max_drawdown_ticks {
                max_drawdown_ticks = dd;
            }
        }

        let max_drawdown_pct = if self.config.initial_capital_ticks > 0 {
            (max_drawdown_ticks as f64 / self.config.initial_capital_ticks as f64) * 100.0
        } else {
            0.0
        };

        let avg_trade_pnl_ticks = if total_trades > 0 {
            net_pnl_ticks as f64 / total_trades as f64
        } else {
            0.0
        };

        let strategy_name = match self.config.strategy_type {
            StrategyType::StackedImbalancePullback => "Stacked Imbalances Pullback (Institutional)",
            StrategyType::AbsorptionReversal => "Absorption & Exhaustion Reversal",
            StrategyType::DeltaDivergence => "Cumulative Delta Divergence",
        }
        .to_string();

        BacktestReport {
            strategy_name,
            total_trades,
            winning_trades,
            losing_trades,
            win_rate_pct,
            gross_profit_ticks,
            gross_loss_ticks,
            net_pnl_ticks,
            profit_factor,
            max_drawdown_ticks,
            max_drawdown_pct,
            avg_trade_pnl_ticks,
            trades,
        }
    }

    /// Run automated grid search parameter sweep across SL and TP combinations
    pub fn optimize(bars: &[OHLCVBar], sweep_config: &OptimizationSweepConfig) -> OptimizationReport {
        let mut matrix = Vec::new();
        let mut best_pf = -1.0;
        let mut best_sl = 0;
        let mut best_tp = 0;
        let mut best_pnl = i64::MIN;

        for &sl in &sweep_config.stop_loss_range {
            for &tp in &sweep_config.take_profit_range {
                let config = BacktestConfig {
                    strategy_type: sweep_config.strategy_type,
                    initial_capital_ticks: 10_000_000,
                    trade_size_units: sweep_config.trade_size_units,
                    stop_loss_ticks: sl,
                    take_profit_ticks: tp,
                    slippage_ticks: sweep_config.slippage_ticks,
                };
                let backtester = OrderFlowBacktester::new(config);
                let report = backtester.run(bars);

                if report.profit_factor > best_pf || (report.profit_factor == best_pf && report.net_pnl_ticks > best_pnl) {
                    best_pf = report.profit_factor;
                    best_sl = sl;
                    best_tp = tp;
                    best_pnl = report.net_pnl_ticks;
                }

                matrix.push(OptimizationResultItem {
                    stop_loss_ticks: sl,
                    take_profit_ticks: tp,
                    total_trades: report.total_trades,
                    winning_trades: report.winning_trades,
                    win_rate_pct: report.win_rate_pct,
                    net_pnl_ticks: report.net_pnl_ticks,
                    profit_factor: report.profit_factor,
                    max_drawdown_pct: report.max_drawdown_pct,
                });
            }
        }

        let strategy_name = match sweep_config.strategy_type {
            StrategyType::StackedImbalancePullback => "Stacked Imbalances Pullback (Institutional)",
            StrategyType::AbsorptionReversal => "Absorption & Exhaustion Reversal",
            StrategyType::DeltaDivergence => "Cumulative Delta Divergence",
        }
        .to_string();

        OptimizationReport {
            strategy_name,
            best_stop_loss_ticks: best_sl,
            best_take_profit_ticks: best_tp,
            best_profit_factor: best_pf.max(0.0),
            best_net_pnl_ticks: if best_pnl == i64::MIN { 0 } else { best_pnl },
            total_combinations: matrix.len(),
            matrix,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use data_contract::{
        Aggressor, AggressorOrigin, FootprintCell, NormalizedTradeEvent, PriceTicks, ScaledQuantity,
    };

    fn make_test_trade(price: i64, qty: u64, ts: i64) -> NormalizedTradeEvent {
        NormalizedTradeEvent::new(
            "BTCUSDT",
            "BINANCE",
            "aggTrade",
            "t-1",
            ts,
            ts + 1000,
            PriceTicks(price),
            ScaledQuantity(qty),
            100,
            "USDT",
            Aggressor::Buy,
            AggressorOrigin::ExchangeDirect,
        )
    }

    #[test]
    fn test_backtester_execution() {
        let t1 = make_test_trade(9500000, 10, 1700000000000000);
        let mut bar1 = OHLCVBar::new(1700000000000000, 60_000_000, &t1);

        // Populate stacked buy imbalances in bar1
        bar1.footprint.insert(
            PriceTicks(9501000),
            FootprintCell {
                buy_units: ScaledQuantity(400),
                sell_units: ScaledQuantity(50),
                unknown_units: ScaledQuantity(0),
                total_units: ScaledQuantity(450),
                trade_count: 5,
            },
        );
        bar1.footprint.insert(
            PriceTicks(9502000),
            FootprintCell {
                buy_units: ScaledQuantity(500),
                sell_units: ScaledQuantity(60),
                unknown_units: ScaledQuantity(0),
                total_units: ScaledQuantity(560),
                trade_count: 5,
            },
        );
        bar1.footprint.insert(
            PriceTicks(9503000),
            FootprintCell {
                buy_units: ScaledQuantity(600),
                sell_units: ScaledQuantity(70),
                unknown_units: ScaledQuantity(0),
                total_units: ScaledQuantity(670),
                trade_count: 6,
            },
        );
        bar1.high_ticks = PriceTicks(9503000);
        bar1.close_ticks = PriceTicks(9503000);

        // Bar 2 rallies to take profit
        let t2 = make_test_trade(9503000, 10, 1700000060000000);
        let mut bar2 = OHLCVBar::new(1700000060000000, 60_000_000, &t2);
        bar2.high_ticks = PriceTicks(9506000); // Exceeds TP (+3000 ticks)
        bar2.low_ticks = PriceTicks(9501000);
        bar2.close_ticks = PriceTicks(9505500);

        let bars = vec![bar1, bar2];
        let backtester = OrderFlowBacktester::new(BacktestConfig::default());
        let report = backtester.run(&bars);

        assert_eq!(report.total_trades, 1);
        assert_eq!(report.winning_trades, 1);
        assert_eq!(report.win_rate_pct, 100.0);
        assert!(report.net_pnl_ticks > 0);
        assert_eq!(report.trades[0].exit_reason, "TakeProfit");

        // Test grid search parameter sweep
        let sweep = OptimizationSweepConfig {
            strategy_type: StrategyType::StackedImbalancePullback,
            stop_loss_range: vec![1000, 1500],
            take_profit_range: vec![2000, 3000],
            trade_size_units: 1,
            slippage_ticks: 10,
        };
        let opt_report = OrderFlowBacktester::optimize(&bars, &sweep);
        assert_eq!(opt_report.total_combinations, 4);
        assert_eq!(opt_report.matrix.len(), 4);
        assert!(opt_report.best_profit_factor > 0.0);
    }
}
