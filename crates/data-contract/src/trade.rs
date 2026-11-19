//! DeepChart Normalized Trade Event Model

use crate::numeric::{PriceTicks, ScaledQuantity};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Aggressor {
    Buy,
    Sell,
    Unknown,
}

impl Aggressor {
    pub fn is_buy(self) -> bool {
        matches!(self, Self::Buy)
    }

    pub fn is_sell(self) -> bool {
        matches!(self, Self::Sell)
    }

    pub fn is_unknown(self) -> bool {
        matches!(self, Self::Unknown)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AggressorOrigin {
    ExchangeDirect,
    Estimated,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DataCompleteness {
    Complete,
    Partial,
    Unverified,
    Stale,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FinalityStatus {
    Live,
    Closed,
    Corrected,
    Preliminary,
    Reconciled,
    Final,
}

/// Canonical Normalized Trade Event adhering to Rule R-DATA-01 to R-DATA-12.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedTradeEvent {
    pub schema_version: u32,
    pub instrument_id: String,
    pub venue: String,
    pub source_feed: String,
    pub event_id: String,
    pub exchange_ts_us: i64,
    pub receive_ts_us: i64,
    pub price_ticks: PriceTicks,
    pub quantity_units: ScaledQuantity,
    pub quantity_scale: u64,
    pub trade_unit: String,
    pub aggressor: Aggressor,
    pub aggressor_origin: AggressorOrigin,
    pub completeness: DataCompleteness,
}

impl NormalizedTradeEvent {
    pub fn new(
        instrument_id: impl Into<String>,
        venue: impl Into<String>,
        source_feed: impl Into<String>,
        event_id: impl Into<String>,
        exchange_ts_us: i64,
        receive_ts_us: i64,
        price_ticks: PriceTicks,
        quantity_units: ScaledQuantity,
        quantity_scale: u64,
        trade_unit: impl Into<String>,
        aggressor: Aggressor,
        aggressor_origin: AggressorOrigin,
    ) -> Self {
        Self {
            schema_version: 1,
            instrument_id: instrument_id.into(),
            venue: venue.into(),
            source_feed: source_feed.into(),
            event_id: event_id.into(),
            exchange_ts_us,
            receive_ts_us,
            price_ticks,
            quantity_units,
            quantity_scale,
            trade_unit: trade_unit.into(),
            aggressor,
            aggressor_origin,
            completeness: DataCompleteness::Complete,
        }
    }

    /// Latency from exchange execution to client ingestion in microseconds.
    pub fn latency_us(&self) -> i64 {
        self.receive_ts_us - self.exchange_ts_us
    }
}
