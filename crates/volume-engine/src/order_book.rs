//! DeepChart Local Order Book & Depth Management (P1)
//! Maintains a deterministic L2 resting order book using BTreeMaps.
//! When quantity is 0, the price level is pruned immediately.

use data_contract::{
    DepthLevel, HeatmapSlice, NormalizedDepthUpdate, OrderBookSnapshot, PriceTicks, ScaledQuantity,
};
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct LocalOrderBook {
    pub instrument_id: String,
    pub last_update_id: u64,
    pub last_timestamp_us: i64,
    pub bids: BTreeMap<PriceTicks, ScaledQuantity>,
    pub asks: BTreeMap<PriceTicks, ScaledQuantity>,
}

impl LocalOrderBook {
    pub fn new(instrument_id: impl Into<String>) -> Self {
        Self {
            instrument_id: instrument_id.into(),
            last_update_id: 0,
            last_timestamp_us: 0,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
        }
    }

    /// Applies an incremental L2 depth update or snapshot.
    pub fn apply_update(&mut self, update: &NormalizedDepthUpdate) {
        if update.is_snapshot {
            self.bids.clear();
            self.asks.clear();
        }

        // Apply Bids
        for level in &update.bids {
            if level.quantity_units.0 == 0 {
                self.bids.remove(&level.price_ticks);
            } else {
                self.bids.insert(level.price_ticks, level.quantity_units);
            }
        }

        // Apply Asks
        for level in &update.asks {
            if level.quantity_units.0 == 0 {
                self.asks.remove(&level.price_ticks);
            } else {
                self.asks.insert(level.price_ticks, level.quantity_units);
            }
        }

        self.last_update_id = update.final_update_id;
        self.last_timestamp_us = update.exchange_ts_us;
    }

    pub fn best_bid(&self) -> Option<(PriceTicks, ScaledQuantity)> {
        self.bids.iter().next_back().map(|(&p, &q)| (p, q))
    }

    pub fn best_ask(&self) -> Option<(PriceTicks, ScaledQuantity)> {
        self.asks.iter().next().map(|(&p, &q)| (p, q))
    }

    pub fn spread_ticks(&self) -> Option<i64> {
        match (self.best_bid(), self.best_ask()) {
            (Some((bid, _)), Some((ask, _))) => Some(ask.0 - bid.0),
            _ => None,
        }
    }

    pub fn mid_price_ticks(&self) -> Option<i64> {
        match (self.best_bid(), self.best_ask()) {
            (Some((bid, _)), Some((ask, _))) => Some((bid.0 + ask.0) / 2),
            _ => None,
        }
    }

    pub fn snapshot(&self, max_depth: usize) -> OrderBookSnapshot {
        // Bids: descending by price
        let bids = self
            .bids
            .iter()
            .rev()
            .take(max_depth)
            .map(|(&price_ticks, &quantity_units)| DepthLevel::new(price_ticks, quantity_units))
            .collect();

        // Asks: ascending by price
        let asks = self
            .asks
            .iter()
            .take(max_depth)
            .map(|(&price_ticks, &quantity_units)| DepthLevel::new(price_ticks, quantity_units))
            .collect();

        OrderBookSnapshot {
            instrument_id: self.instrument_id.clone(),
            venue: "ORDERBOOK".into(),
            last_update_id: self.last_update_id,
            timestamp_us: self.last_timestamp_us,
            bids,
            asks,
        }
    }

    pub fn to_heatmap_slice(&self, timestamp_us: i64, max_depth: usize) -> HeatmapSlice {
        let bids = self
            .bids
            .iter()
            .rev()
            .take(max_depth)
            .map(|(&p, &q)| (p.0, q.0))
            .collect();

        let asks = self
            .asks
            .iter()
            .take(max_depth)
            .map(|(&p, &q)| (p.0, q.0))
            .collect();

        HeatmapSlice {
            timestamp_us,
            bids,
            asks,
        }
    }
}
