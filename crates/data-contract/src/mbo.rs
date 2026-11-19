//! DeepChart Market-by-Order (MBO / L3) & Iceberg Data Contract (P2.4)
//! Tracks individual order queue lifecycles: Add, Modify, Cancel, Execute,
//! and identifies hidden/replenished Iceberg liquidity.
//!
//! Rule R-DATA-03: MBO order events must preserve discrete exchange order IDs.
//! Rule R-DATA-04: Venue and feed attribution must be strictly isolated.

use crate::depth::OrderBookSide;
use crate::numeric::{PriceTicks, ScaledQuantity};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MboOrderAction {
    Add,
    Modify,
    Cancel,
    Execute,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MboOrderEvent {
    pub instrument_id: String,
    pub venue: String,
    pub order_id: u64,
    pub side: OrderBookSide,
    pub action: MboOrderAction,
    pub price_ticks: PriceTicks,
    pub quantity_units: ScaledQuantity,
    pub exchange_ts_us: i64,
    pub sequence_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IcebergOrderDetection {
    pub price_ticks: PriceTicks,
    pub side: OrderBookSide,
    pub peak_displayed_units: ScaledQuantity,
    pub total_executed_units: ScaledQuantity,
    pub hidden_volume_units: ScaledQuantity,
    pub refill_count: u32,
    pub detected_at_us: i64,
}
