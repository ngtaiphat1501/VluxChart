//! DeepChart Volume & Footprint Engine
//! Calculates exact volume delta, cumulative volume delta (CVD), rolling volume speed, POC, and price bin matrix.

pub mod ai_narrator;
pub mod backtester;
pub mod bar_manager;
pub mod execution_simulator;
pub mod heatmap;
pub mod indicators;
pub mod mbo_engine;
pub mod multi_venue;
pub mod options_engine;
pub mod order_book;
pub mod speed;
pub mod volume_profile;
pub mod vwap;

pub use ai_narrator::{generate_market_narrative, MarketNarrative};
pub use backtester::{
    BacktestConfig, BacktestReport, BacktestTrade, OptimizationReport, OptimizationResultItem,
    OptimizationSweepConfig, OrderFlowBacktester, StrategyType,
};
pub use execution_simulator::{
    ExecutionSimulator, SimOrderSide, SimOrderStatus, SimOrderType, SimulatedOrder,
};

pub use bar_manager::{BarEvent, BarManager, BarManagerConfig};
pub use heatmap::HeatmapTracker;
pub use mbo_engine::{MboOrderBook, MboOrderEntry};
pub use indicators::{
    compute_diagonal_imbalances, compute_poc, compute_stacked_imbalances, compute_value_area,
    detect_order_flow_signals, CumulativeVolumeDelta, DiagonalImbalance, ImbalanceSide,
    OrderFlowSignal, OrderFlowSignalType, PocInfo, StackedImbalance, ValueArea,
};
pub use multi_venue::{MultiVenueAggregateSummary, MultiVenueAggregator, VenueShare};
pub use options_engine::OptionsAnalyticsEngine;
pub use order_book::LocalOrderBook;
pub use speed::{MultiSpeedTracker, SingleWindowTracker, SpeedMetrics};
pub use volume_profile::{
    compute_session_volume_profile, SessionVolumeProfile, VolumeProfileBin,
};
pub use vwap::{
    detect_delta_divergence, DeltaDivergence, DivergenceType, VwapBand, VwapTracker,
};

// Backwards-compatible alias
pub type VolumeSpeedWindow = speed::SingleWindowTracker;
