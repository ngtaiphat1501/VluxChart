//! DeepChart Bar and Footprint Data Contract

use crate::numeric::{PriceTicks, ScaledQuantity};
use crate::trade::{DataCompleteness, FinalityStatus, NormalizedTradeEvent};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Single Footprint cell at a discrete price tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct FootprintCell {
    pub buy_units: ScaledQuantity,
    pub sell_units: ScaledQuantity,
    pub unknown_units: ScaledQuantity,
    pub total_units: ScaledQuantity,
    pub trade_count: u32,
}

impl FootprintCell {
    pub fn update(&mut self, trade: &NormalizedTradeEvent) {
        self.trade_count += 1;
        match trade.aggressor {
            crate::trade::Aggressor::Buy => self.buy_units += trade.quantity_units,
            crate::trade::Aggressor::Sell => self.sell_units += trade.quantity_units,
            crate::trade::Aggressor::Unknown => self.unknown_units += trade.quantity_units,
        }
        self.total_units += trade.quantity_units;
    }

    pub fn delta_units(&self) -> i64 {
        (self.buy_units.0 as i64) - (self.sell_units.0 as i64)
    }

    pub fn assert_invariant(&self) -> bool {
        self.total_units.0 == (self.buy_units.0 + self.sell_units.0 + self.unknown_units.0)
    }
}

/// Realtime OHLCV Bar with Footprint matrix and Data Quality status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OHLCVBar {
    pub bar_start_us: i64,
    pub timeframe_us: i64,
    pub open_ticks: PriceTicks,
    pub high_ticks: PriceTicks,
    pub low_ticks: PriceTicks,
    pub close_ticks: PriceTicks,
    pub buy_units: ScaledQuantity,
    pub sell_units: ScaledQuantity,
    pub unknown_units: ScaledQuantity,
    pub total_units: ScaledQuantity,
    pub trade_count: u64,
    pub completeness: DataCompleteness,
    pub finality: FinalityStatus,
    pub footprint: BTreeMap<PriceTicks, FootprintCell>,
}

impl OHLCVBar {
    pub fn new(bar_start_us: i64, timeframe_us: i64, initial_trade: &NormalizedTradeEvent) -> Self {
        let mut bar = Self {
            bar_start_us,
            timeframe_us,
            open_ticks: initial_trade.price_ticks,
            high_ticks: initial_trade.price_ticks,
            low_ticks: initial_trade.price_ticks,
            close_ticks: initial_trade.price_ticks,
            buy_units: ScaledQuantity::ZERO,
            sell_units: ScaledQuantity::ZERO,
            unknown_units: ScaledQuantity::ZERO,
            total_units: ScaledQuantity::ZERO,
            trade_count: 0,
            completeness: initial_trade.completeness,
            finality: FinalityStatus::Live,
            footprint: BTreeMap::new(),
        };
        bar.apply_trade(initial_trade);
        bar
    }

    pub fn apply_trade(&mut self, trade: &NormalizedTradeEvent) {
        self.trade_count += 1;

        if trade.price_ticks > self.high_ticks {
            self.high_ticks = trade.price_ticks;
        }
        if trade.price_ticks < self.low_ticks {
            self.low_ticks = trade.price_ticks;
        }
        self.close_ticks = trade.price_ticks;

        match trade.aggressor {
            crate::trade::Aggressor::Buy => self.buy_units += trade.quantity_units,
            crate::trade::Aggressor::Sell => self.sell_units += trade.quantity_units,
            crate::trade::Aggressor::Unknown => self.unknown_units += trade.quantity_units,
        }
        self.total_units += trade.quantity_units;

        let cell = self.footprint.entry(trade.price_ticks).or_default();
        cell.update(trade);

        debug_assert!(
            self.assert_invariant(),
            "Bar Total != Buy + Sell + Unknown invariant violated!"
        );
    }

    /// Delta = BuyVolume - SellVolume
    pub fn delta_units(&self) -> i64 {
        (self.buy_units.0 as i64) - (self.sell_units.0 as i64)
    }

    /// Invariant: Total = Buy + Sell + Unknown
    pub fn assert_invariant(&self) -> bool {
        self.total_units.0 == (self.buy_units.0 + self.sell_units.0 + self.unknown_units.0)
    }

    /// Point of Control (POC): Price tick with maximum total traded volume in this bar.
    pub fn poc_ticks(&self) -> Option<PriceTicks> {
        self.footprint
            .iter()
            .max_by_key(|(_, cell)| cell.total_units.0)
            .map(|(p, _)| *p)
    }
}
