//! DeepChart Feed Adapters
//! Venue-specific adapters for Bybit V5 Linear and Binance Futures (BTC, ETH, XAUUSDT).

pub mod mt5_bridge;
pub use mt5_bridge::{Mt5ReferenceAdapter, Mt5TickPayload};

pub mod websocket_client;
pub use websocket_client::{
    LiveFeedConfig, LiveFeedDispatcher, LiveFeedTelemetry, ReconnectionManager,
};

use data_contract::{
    Aggressor, AggressorOrigin, DataCompleteness, NormalizedTradeEvent, PriceTicks, ScaledQuantity,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AdapterError {
    #[error("JSON deserialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Missing required field: {0}")]
    MissingField(String),
    #[error("Invalid numeric value: {0}")]
    InvalidNumeric(String),
    #[error("Unsupported topic or event type: {0}")]
    UnsupportedType(String),
}

/// Feed connection lifecycle state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Stale,
    Reconnecting,
}

/// Tracks WebSocket heartbeats to detect silent network freezes
#[derive(Debug, Clone)]
pub struct HeartbeatTracker {
    last_message_ts_us: i64,
    timeout_duration_us: i64,
}

impl HeartbeatTracker {
    pub fn new(timeout_duration_ms: i64) -> Self {
        Self {
            last_message_ts_us: 0,
            timeout_duration_us: timeout_duration_ms * 1_000,
        }
    }

    pub fn record_activity(&mut self, now_us: i64) {
        self.last_message_ts_us = now_us;
    }

    pub fn is_stale(&self, now_us: i64) -> bool {
        if self.last_message_ts_us == 0 {
            return false;
        }
        (now_us - self.last_message_ts_us) > self.timeout_duration_us
    }

    pub fn last_activity_us(&self) -> i64 {
        self.last_message_ts_us
    }
}

// ----------------------------------------------------------------------------
// BYBIT V5 LINEAR ADAPTER
// ----------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize)]
pub struct BybitTradeItem {
    #[serde(rename = "T")]
    pub trade_time_ms: i64,
    #[serde(rename = "s")]
    pub symbol: String,
    #[serde(rename = "S")]
    pub side: String,
    #[serde(rename = "v")]
    pub volume: String,
    #[serde(rename = "p")]
    pub price: String,
    #[serde(rename = "i")]
    pub trade_id: String,
    #[serde(rename = "BT")]
    pub block_trade: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct BybitTradeMessage {
    #[allow(dead_code)]
    pub topic: Option<String>,
    pub data: Option<Vec<BybitTradeItem>>,
}

pub struct BybitLinearAdapter;

impl BybitLinearAdapter {
    pub fn parse_public_trades(
        raw_json: &str,
        receive_ts_us: i64,
        price_tick: f64,
        quantity_scale: u64,
        trade_unit: &str,
    ) -> Result<Vec<NormalizedTradeEvent>, AdapterError> {
        let msg: BybitTradeMessage = serde_json::from_str(raw_json)?;
        let mut results = Vec::new();

        if let Some(trades) = msg.data {
            for t in trades {
                let price_f64: f64 = t
                    .price
                    .parse()
                    .map_err(|_| AdapterError::InvalidNumeric(format!("Invalid price: {}", t.price)))?;
                let qty_f64: f64 = t
                    .volume
                    .parse()
                    .map_err(|_| AdapterError::InvalidNumeric(format!("Invalid volume: {}", t.volume)))?;

                let aggressor = match t.side.as_str() {
                    "Buy" => Aggressor::Buy,
                    "Sell" => Aggressor::Sell,
                    _ => Aggressor::Unknown,
                };

                let instrument_id = format!("BYBIT:LINEAR_PERP:{}:PERP", t.symbol);
                let event = NormalizedTradeEvent::new(
                    instrument_id,
                    "BYBIT",
                    "publicTrade",
                    t.trade_id,
                    t.trade_time_ms * 1_000,
                    receive_ts_us,
                    PriceTicks::from_f64(price_f64, price_tick),
                    ScaledQuantity::from_f64(qty_f64, quantity_scale),
                    quantity_scale,
                    trade_unit,
                    aggressor,
                    AggressorOrigin::ExchangeDirect,
                );
                results.push(event);
            }
        }

        Ok(results)
    }
}

// ----------------------------------------------------------------------------
// BINANCE USDⓈ-M FUTURES ADAPTER
// ----------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize)]
pub struct BinanceAggTradePayload {
    #[serde(rename = "e")]
    pub event_type: String,
    #[serde(rename = "E")]
    pub event_time_ms: i64,
    #[serde(rename = "s")]
    pub symbol: String,
    #[serde(rename = "a")]
    pub agg_trade_id: i64,
    #[serde(rename = "p")]
    pub price: String,
    #[serde(rename = "q")]
    pub quantity: String,
    #[serde(rename = "f")]
    pub first_trade_id: i64,
    #[serde(rename = "l")]
    pub last_trade_id: i64,
    #[serde(rename = "T")]
    pub trade_time_ms: i64,
    #[serde(rename = "m")]
    pub is_buyer_maker: bool,
}

pub struct BinanceFuturesAdapter;

impl BinanceFuturesAdapter {
    pub fn parse_agg_trade(
        raw_json: &str,
        receive_ts_us: i64,
        price_tick: f64,
        quantity_scale: u64,
        trade_unit: &str,
    ) -> Result<NormalizedTradeEvent, AdapterError> {
        let payload: BinanceAggTradePayload = serde_json::from_str(raw_json)?;

        if payload.event_type != "aggTrade" {
            return Err(AdapterError::UnsupportedType(payload.event_type));
        }

        let price_f64: f64 = payload
            .price
            .parse()
            .map_err(|_| AdapterError::InvalidNumeric(format!("Invalid price: {}", payload.price)))?;
        let qty_f64: f64 = payload
            .quantity
            .parse()
            .map_err(|_| AdapterError::InvalidNumeric(format!("Invalid qty: {}", payload.quantity)))?;

        // Rule: if buyer is maker (m == true), the taker who crossed the spread was SELLER.
        let aggressor = if payload.is_buyer_maker {
            Aggressor::Sell
        } else {
            Aggressor::Buy
        };

        let instrument_id = format!("BINANCE:USDS_M_PERP:{}:PERP", payload.symbol);
        let event = NormalizedTradeEvent {
            schema_version: 1,
            instrument_id,
            venue: "BINANCE".into(),
            source_feed: "aggTrade".into(),
            event_id: payload.agg_trade_id.to_string(),
            exchange_ts_us: payload.trade_time_ms * 1_000,
            receive_ts_us,
            price_ticks: PriceTicks::from_f64(price_f64, price_tick),
            quantity_units: ScaledQuantity::from_f64(qty_f64, quantity_scale),
            quantity_scale,
            trade_unit: trade_unit.into(),
            aggressor,
            aggressor_origin: AggressorOrigin::ExchangeDirect,
            completeness: DataCompleteness::Complete,
        };

        Ok(event)
    }
}
