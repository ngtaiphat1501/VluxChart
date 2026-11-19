//! DeepChart Realtime Bar Manager & Late-Trade Correction Engine

use data_contract::{FinalityStatus, NormalizedTradeEvent, OHLCVBar};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum BarEvent {
    /// Trade applied to the live bar in progress
    BarUpdated(OHLCVBar),
    /// Current bar completed and a new bar was opened
    BarClosed {
        closed: OHLCVBar,
        new_bar: OHLCVBar,
    },
    /// A historical trade arrived with a timestamp in a closed bar window
    BarCorrected {
        bar_start_us: i64,
        corrected_bar: OHLCVBar,
    },
    /// Trade is older than the max allowable retention window
    TradeDroppedTooLate {
        trade_ts_us: i64,
        cutoff_us: i64,
    },
}

#[derive(Debug, Clone)]
pub struct BarManagerConfig {
    pub timeframe_us: i64,
    pub max_late_retention_us: i64,
}

impl Default for BarManagerConfig {
    fn default() -> Self {
        Self {
            timeframe_us: 60_000_000,           // 1 minute
            max_late_retention_us: 300_000_000, // 5 minutes retention for late trades
        }
    }
}

pub struct BarManager {
    config: BarManagerConfig,
    active_bar: Option<OHLCVBar>,
    historical_bars: BTreeMap<i64, OHLCVBar>,
}

impl BarManager {
    pub fn new(config: BarManagerConfig) -> Self {
        Self {
            config,
            active_bar: None,
            historical_bars: BTreeMap::new(),
        }
    }

    pub fn timeframe_us(&self) -> i64 {
        self.config.timeframe_us
    }

    pub fn active_bar(&self) -> Option<&OHLCVBar> {
        self.active_bar.as_ref()
    }

    pub fn get_historical_bar(&self, bar_start_us: i64) -> Option<&OHLCVBar> {
        self.historical_bars.get(&bar_start_us)
    }

    pub fn historical_bars_count(&self) -> usize {
        self.historical_bars.len()
    }

    /// Primary entry point: process a normalized trade into the appropriate bar.
    pub fn on_trade(&mut self, trade: &NormalizedTradeEvent) -> BarEvent {
        let ts = trade.exchange_ts_us;
        let timeframe = self.config.timeframe_us;
        let bar_start = (ts / timeframe) * timeframe;

        match &mut self.active_bar {
            None => {
                // First trade ever
                let bar = OHLCVBar::new(bar_start, timeframe, trade);
                self.active_bar = Some(bar.clone());
                BarEvent::BarUpdated(bar)
            }
            Some(curr) if bar_start == curr.bar_start_us => {
                // Trade falls within current live bar
                curr.apply_trade(trade);
                assert!(curr.assert_invariant(), "Bar volume invariant violated!");
                BarEvent::BarUpdated(curr.clone())
            }
            Some(curr) if bar_start > curr.bar_start_us => {
                // New bar window reached; close active bar and open new one
                let mut closed_bar = curr.clone();
                closed_bar.finality = FinalityStatus::Closed;

                // Archive closed bar
                self.historical_bars.insert(closed_bar.bar_start_us, closed_bar.clone());
                self.prune_old_history(bar_start);

                // Create new bar
                let new_bar = OHLCVBar::new(bar_start, timeframe, trade);
                self.active_bar = Some(new_bar.clone());

                BarEvent::BarClosed {
                    closed: closed_bar,
                    new_bar,
                }
            }
            Some(curr) => {
                // Late trade: bar_start < curr.bar_start_us
                let cutoff = curr.bar_start_us - self.config.max_late_retention_us;
                if bar_start < cutoff {
                    BarEvent::TradeDroppedTooLate {
                        trade_ts_us: ts,
                        cutoff_us: cutoff,
                    }
                } else if let Some(hist_bar) = self.historical_bars.get_mut(&bar_start) {
                    hist_bar.apply_trade(trade);
                    hist_bar.finality = FinalityStatus::Corrected;
                    assert!(hist_bar.assert_invariant(), "Corrected bar volume invariant violated!");
                    BarEvent::BarCorrected {
                        bar_start_us: bar_start,
                        corrected_bar: hist_bar.clone(),
                    }
                } else {
                    // Closed bar already pruned or not present
                    BarEvent::TradeDroppedTooLate {
                        trade_ts_us: ts,
                        cutoff_us: cutoff,
                    }
                }
            }
        }
    }

    fn prune_old_history(&mut self, current_bar_start_us: i64) {
        let cutoff = current_bar_start_us - self.config.max_late_retention_us;
        self.historical_bars.retain(|&start, _| start >= cutoff);
    }
}
