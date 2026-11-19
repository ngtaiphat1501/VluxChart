//! DeepChart Options Flow & Analytics Data Contract (P2 & P2.2)
//! Tracks Call/Put option contracts, Strike distribution, Open Interest,
//! Key Resistance/Support levels (Call Wall, Put Wall, Max Pain),
//! and Black-Scholes Greeks (Delta, Gamma, Theta, Vega) & Implied Volatility (IV).
//!
//! Rule R-DATA-03: Options volume is never added to perpetual/spot executed volume.

use crate::numeric::{PriceTicks, ScaledQuantity};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OptionType {
    Call,
    Put,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OptionContractDefinition {
    pub contract_symbol: String,  // e.g. "BTC-29MAR26-95000-C"
    pub underlying_asset: String, // e.g. "BTC"
    pub option_type: OptionType,
    pub strike_ticks: PriceTicks,
    pub expiration_ts_us: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OptionsTradeEvent {
    pub event_id: String,
    pub contract_symbol: String,
    pub underlying_asset: String,
    pub option_type: OptionType,
    pub strike_ticks: PriceTicks,
    pub exchange_ts_us: i64,
    pub premium_ticks: PriceTicks,
    pub quantity_contracts: ScaledQuantity,
    pub notional_usd: u64,
    pub is_block_trade: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StrikeOpenInterest {
    pub strike_ticks: PriceTicks,
    pub call_open_interest: ScaledQuantity,
    pub put_open_interest: ScaledQuantity,
    pub call_volume_24h: ScaledQuantity,
    pub put_volume_24h: ScaledQuantity,
}

/// Black-Scholes Greeks and Implied Volatility for an option contract or strike.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptionGreeks {
    pub delta: f64,
    pub gamma: f64,
    pub theta: f64,
    pub vega: f64,
    pub iv: f64,
}

impl Default for OptionGreeks {
    fn default() -> Self {
        Self {
            delta: 0.0,
            gamma: 0.0,
            theta: 0.0,
            vega: 0.0,
            iv: 0.50,
        }
    }
}

/// Analytics and Greeks for a single strike price level.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StrikeGreeksInfo {
    pub strike_ticks: PriceTicks,
    pub call_greeks: OptionGreeks,
    pub put_greeks: OptionGreeks,
    pub iv_smile: f64,
    pub call_oi: ScaledQuantity,
    pub put_oi: ScaledQuantity,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptionsMarketSummary {
    pub underlying_asset: String,
    pub total_call_oi: ScaledQuantity,
    pub total_put_oi: ScaledQuantity,
    pub put_call_ratio: f64, // (Put OI / Call OI)
    pub call_wall_strike: PriceTicks, // Strike with highest Call OI
    pub put_wall_strike: PriceTicks,  // Strike with highest Put OI
    pub max_pain_strike: PriceTicks,  // Strike where option holders lose most value
    pub atm_iv: f64,                  // At-The-Money Implied Volatility (annualized, e.g. 0.55 = 55%)
    pub net_delta: f64,               // Market aggregate net delta exposure
    pub net_gamma: f64,               // Market aggregate net gamma exposure
    pub strikes: Vec<StrikeOpenInterest>,
    pub strike_greeks: Vec<StrikeGreeksInfo>,
}
