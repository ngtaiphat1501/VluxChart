//! DeepChart Data Contract Core Crate
//! The single source of truth for all types, schemas, and mathematical invariants.

pub mod bar;
pub mod depth;
pub mod instrument;
pub mod mbo;
pub mod numeric;
pub mod options;
pub mod trade;

pub use bar::{FootprintCell, OHLCVBar};
pub use depth::{DepthLevel, HeatmapSlice, NormalizedDepthUpdate, OrderBookSide, OrderBookSnapshot};
pub use instrument::{InstrumentDefinition, InstrumentError, InstrumentRegistry};
pub use mbo::{IcebergOrderDetection, MboOrderAction, MboOrderEvent};
pub use numeric::{PriceTicks, ScaledQuantity};
pub use options::{
    OptionContractDefinition, OptionGreeks, OptionType, OptionsMarketSummary, OptionsTradeEvent,
    StrikeGreeksInfo, StrikeOpenInterest,
};
pub use trade::{
    Aggressor, AggressorOrigin, DataCompleteness, FinalityStatus, NormalizedTradeEvent,
};
