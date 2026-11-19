//! DeepChart Rolling Multi-Window Volume Speed Engine

use data_contract::{Aggressor, NormalizedTradeEvent, ScaledQuantity};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpeedMetrics {
    pub window_ms: u32,
    pub trade_count: u32,
    pub buy_units: ScaledQuantity,
    pub sell_units: ScaledQuantity,
    pub total_units: ScaledQuantity,
    pub delta_units: i64,
}

#[derive(Debug, Clone)]
pub struct SingleWindowTracker {
    window_duration_us: i64,
    trades: VecDeque<(i64, ScaledQuantity, Aggressor)>,
    current_buy_units: u64,
    current_sell_units: u64,
    current_unknown_units: u64,
}

impl SingleWindowTracker {
    pub fn new(window_duration_us: i64) -> Self {
        Self {
            window_duration_us,
            trades: VecDeque::new(),
            current_buy_units: 0,
            current_sell_units: 0,
            current_unknown_units: 0,
        }
    }

    pub fn on_trade(&mut self, trade: &NormalizedTradeEvent) {
        let ts = trade.exchange_ts_us;
        match trade.aggressor {
            Aggressor::Buy => self.current_buy_units += trade.quantity_units.0,
            Aggressor::Sell => self.current_sell_units += trade.quantity_units.0,
            Aggressor::Unknown => self.current_unknown_units += trade.quantity_units.0,
        }
        self.trades
            .push_back((ts, trade.quantity_units, trade.aggressor));
        self.evict_expired(ts);
    }

    pub fn evict_expired(&mut self, current_exchange_ts_us: i64) {
        let cutoff = current_exchange_ts_us - self.window_duration_us;
        while let Some(&(ts, qty, side)) = self.trades.front() {
            if ts <= cutoff {
                match side {
                    Aggressor::Buy => self.current_buy_units -= qty.0,
                    Aggressor::Sell => self.current_sell_units -= qty.0,
                    Aggressor::Unknown => self.current_unknown_units -= qty.0,
                }
                self.trades.pop_front();
            } else {
                break;
            }
        }
    }

    pub fn metrics(&self) -> SpeedMetrics {
        let total = self.current_buy_units + self.current_sell_units + self.current_unknown_units;
        SpeedMetrics {
            window_ms: (self.window_duration_us / 1000) as u32,
            trade_count: self.trades.len() as u32,
            buy_units: ScaledQuantity(self.current_buy_units),
            sell_units: ScaledQuantity(self.current_sell_units),
            total_units: ScaledQuantity(total),
            delta_units: (self.current_buy_units as i64) - (self.current_sell_units as i64),
        }
    }
}

/// Composite speed tracker maintaining 1s, 5s, and 10s windows concurrently.
pub struct MultiSpeedTracker {
    w1s: SingleWindowTracker,
    w5s: SingleWindowTracker,
    w10s: SingleWindowTracker,
}

impl Default for MultiSpeedTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl MultiSpeedTracker {
    pub fn new() -> Self {
        Self {
            w1s: SingleWindowTracker::new(1_000_000),   // 1s
            w5s: SingleWindowTracker::new(5_000_000),   // 5s
            w10s: SingleWindowTracker::new(10_000_000), // 10s
        }
    }

    pub fn on_trade(&mut self, trade: &NormalizedTradeEvent) {
        self.w1s.on_trade(trade);
        self.w5s.on_trade(trade);
        self.w10s.on_trade(trade);
    }

    pub fn metrics_1s(&self) -> SpeedMetrics {
        self.w1s.metrics()
    }

    pub fn metrics_5s(&self) -> SpeedMetrics {
        self.w5s.metrics()
    }

    pub fn metrics_10s(&self) -> SpeedMetrics {
        self.w10s.metrics()
    }
}
