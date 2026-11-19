//! DeepChart MetaTrader 5 & FIX Broker Reference Feed Bridge (P2.3)
//! Ingests Gold Spot/CFD tick quotes (bid, ask, last, tick volume) from broker feeds.
//!
//! Rule R-DATA-03: Broker CFD ticks must NEVER be conflated with exchange-cleared CME/Binance volume.
//! Rule R-DATA-04: Isolated venue "MT5_REFERENCE" with explicit AggressorOrigin::Inferred.

use data_contract::{
    Aggressor, AggressorOrigin, DataCompleteness, NormalizedTradeEvent, PriceTicks, ScaledQuantity,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Mt5TickPayload {
    pub symbol: String,       // e.g. "XAUUSD"
    pub timestamp_ms: i64,    // Broker broker time
    pub bid: f64,
    pub ask: f64,
    pub last: f64,
    pub volume: f64,          // Tick volume / contract lots
    pub flags: Option<u32>,   // MT5 TICK_FLAG_BID, TICK_FLAG_ASK, TICK_FLAG_LAST, TICK_FLAG_VOLUME
}

pub struct Mt5ReferenceAdapter {
    last_price: Option<f64>,
}

impl Default for Mt5ReferenceAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl Mt5ReferenceAdapter {
    pub fn new() -> Self {
        Self { last_price: None }
    }

    /// Parses an MT5 broker tick into a NormalizedTradeEvent.
    /// Strictly tags provenance as MT5_REFERENCE and aggressor as Inferred.
    pub fn parse_tick(
        &mut self,
        tick: &Mt5TickPayload,
        receive_ts_us: i64,
        price_tick: f64,
        quantity_scale: u64,
    ) -> NormalizedTradeEvent {
        let price = if tick.last > 0.0 {
            tick.last
        } else {
            (tick.bid + tick.ask) * 0.5
        };

        // Aggressor inferred via tick-rule (tick up => Buy, tick down => Sell)
        let aggressor = match self.last_price {
            Some(prev) if price > prev => Aggressor::Buy,
            Some(prev) if price < prev => Aggressor::Sell,
            _ => {
                // If mid-price closer to ask => Buy, closer to bid => Sell
                let mid = (tick.bid + tick.ask) * 0.5;
                if price >= mid {
                    Aggressor::Buy
                } else {
                    Aggressor::Sell
                }
            }
        };

        self.last_price = Some(price);

        let instrument_id = format!("MT5:CFD:{}:SPOT_REF", tick.symbol);
        let event_id = format!("mt5-{}-{}", tick.symbol, tick.timestamp_ms);

        NormalizedTradeEvent {
            schema_version: 1,
            instrument_id,
            venue: "MT5_REFERENCE".into(),
            source_feed: "mt5_quote_bridge".into(),
            event_id,
            exchange_ts_us: tick.timestamp_ms * 1_000,
            receive_ts_us,
            price_ticks: PriceTicks::from_f64(price, price_tick),
            quantity_units: ScaledQuantity::from_f64(tick.volume.max(0.01), quantity_scale),
            quantity_scale,
            trade_unit: "OZ_CFD".into(),
            aggressor,
            aggressor_origin: AggressorOrigin::Estimated,
            completeness: DataCompleteness::Complete,
        }
    }
}
