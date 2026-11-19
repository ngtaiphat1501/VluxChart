//! DeepChart Order Book L2 & Depth Data Contract (P1)
//! Strictly tracks resting limit order liquidity without mixing with executed trade volume.

use crate::numeric::{PriceTicks, ScaledQuantity};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OrderBookSide {
    Bid,
    Ask,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DepthLevel {
    pub price_ticks: PriceTicks,
    pub quantity_units: ScaledQuantity,
    pub order_count: Option<u32>,
}

impl DepthLevel {
    pub fn new(price_ticks: PriceTicks, quantity_units: ScaledQuantity) -> Self {
        Self {
            price_ticks,
            quantity_units,
            order_count: None,
        }
    }
}

/// Normalized Level 2 incremental depth update event from exchange websockets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedDepthUpdate {
    pub schema_version: u32,
    pub instrument_id: String,
    pub venue: String,
    pub exchange_ts_us: i64,
    pub receive_ts_us: i64,
    pub first_update_id: u64,
    pub final_update_id: u64,
    pub bids: Vec<DepthLevel>,
    pub asks: Vec<DepthLevel>,
    pub is_snapshot: bool,
}

/// Normalized snapshot of the top levels of an order book for presentation and heatmap rendering.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderBookSnapshot {
    pub instrument_id: String,
    pub venue: String,
    pub last_update_id: u64,
    pub timestamp_us: i64,
    pub bids: Vec<DepthLevel>,
    pub asks: Vec<DepthLevel>,
}

/// A horizontal time-slice of resting liquidity used for Bookmap-style Liquidity Heatmaps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeatmapSlice {
    pub timestamp_us: i64,
    pub bids: Vec<(i64, u64)>, // (price_ticks, quantity_units)
    pub asks: Vec<(i64, u64)>, // (price_ticks, quantity_units)
}
