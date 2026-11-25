export interface FootprintCellDTO {
  price_ticks: number;
  buy_units: number;
  sell_units: number;
  unknown_units: number;
  total_units: number;
  delta_units: number;
  trade_count: number;
}

export interface ValueAreaDTO {
  poc_ticks: number;
  vah_ticks: number;
  val_ticks: number;
  volume_covered: number;
}

export interface StackedImbalanceDTO {
  side: 'Buy' | 'Sell' | string;
  start_price_ticks: number;
  end_price_ticks: number;
  levels_count: number;
  total_imbalance_volume: number;
}

export interface OrderFlowSignalDTO {
  signal_type: 'BullishAbsorption' | 'BearishAbsorption' | 'BuyingExhaustion' | 'SellingExhaustion' | string;
  price_ticks: number;
  volume_units: number;
  description: string;
}

export interface BarDTO {
  bar_start_us: number;
  timeframe_us: number;
  open_ticks: number;
  high_ticks: number;
  low_ticks: number;
  close_ticks: number;
  buy_units: number;
  sell_units: number;
  unknown_units: number;
  total_units: number;
  delta_units: number;
  trade_count: number;
  poc_ticks: number | null;
  value_area: ValueAreaDTO | null;
  footprint: FootprintCellDTO[];
  stacked_imbalances?: StackedImbalanceDTO[];
  signals?: OrderFlowSignalDTO[];
  finality: string;
  completeness: string;
}

export interface SpeedMetricsDTO {
  window_ms: number;
  trade_count: number;
  buy_units: number;
  sell_units: number;
  total_units: number;
  delta_units: number;
}

export interface DataQualityStatusDTO {
  feed_status: string;
  feed_source?: string;
  freshness_ms?: number;
  latency_ms: number;
  total_gaps_detected: number;
  completeness: string;
  volume_invariant_ok: boolean;
  last_event_id: string;
  last_updated_us: number;
}

export interface MboQueueOrderItemDTO {
  order_id_tail: string;
  quantity_contracts: number;
  is_large_lot: boolean;
}

export interface CmeStopSweepItemDTO {
  detected_at_us: number;
  side: 'Buy' | 'Sell' | string;
  start_price_ticks: number;
  end_price_ticks: number;
  levels_swept: number;
  total_contracts: number;
}

export interface OrderBookLevelDTO {
  price_ticks: number;
  quantity_units: number;
  order_count?: number;
  mbo_queue?: MboQueueOrderItemDTO[];
}

export interface OrderBookSnapshotDTO {
  bids: OrderBookLevelDTO[];
  asks: OrderBookLevelDTO[];
  spread_ticks: number | null;
  mid_price_ticks: number | null;
}

export interface HeatmapSliceDTO {
  timestamp_us: number;
  bids: [number, number][];
  asks: [number, number][];
}

export interface StrikeGreeksDTO {
  strike_ticks: number;
  call_delta: number;
  call_gamma: number;
  call_theta: number;
  call_vega: number;
  put_delta: number;
  put_gamma: number;
  put_theta: number;
  put_vega: number;
  iv_smile: number;
  call_oi: number;
  put_oi: number;
}

export interface OptionsSummaryDTO {
  underlying_asset: string;
  total_call_oi: number;
  total_put_oi: number;
  put_call_ratio: number;
  call_wall_ticks: number;
  put_wall_ticks: number;
  max_pain_ticks: number;
  atm_iv?: number;
  net_delta?: number;
  net_gamma?: number;
  strikes?: StrikeGreeksDTO[];
}

export interface MarketNarrativeDTO {
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'CONSOLIDATION' | string;
  headline: string;
  order_flow_summary: string;
  options_confluence: string;
  institutional_bias: string;
  risk_alert: string;
}

export interface IcebergOrderDTO {
  price_ticks: number;
  side: 'Bid' | 'Ask' | string;
  peak_displayed_units: number;
  total_executed_units: number;
  hidden_volume_units: number;
  refill_count: number;
  detected_at_us: number;
}

export interface PlaybackStatusDTO {
  is_replay_mode: boolean;
  state: 'Playing' | 'Paused' | 'Completed' | string;
  speed_multiplier: number;
  progress_pct: number;
  current_ts_us: number;
}

export interface VwapBandDTO {
  vwap_ticks: number;
  upper_1sigma_ticks: number;
  lower_1sigma_ticks: number;
  upper_2sigma_ticks: number;
  lower_2sigma_ticks: number;
  total_volume: number;
}

export interface DeltaDivergenceDTO {
  bar_start_us: number;
  divergence_type: 'BullishDivergence' | 'BearishDivergence' | string;
  price_ticks: number;
  cvd_delta: number;
  description: string;
}

export interface VolumeProfileBinDTO {
  price_ticks: number;
  buy_units: number;
  sell_units: number;
  total_units: number;
}

export interface SessionVolumeProfileDTO {
  bins: VolumeProfileBinDTO[];
  poc_ticks: number;
  vah_ticks: number;
  val_ticks: number;
  total_volume: number;
}

export interface VenueShareDTO {
  venue: string;
  buy_units: number;
  sell_units: number;
  total_units: number;
  delta_units: number;
  trade_count: number;
  share_pct: number;
}

export interface MultiVenueSummaryDTO {
  symbol: string;
  total_aggregated_units: number;
  total_aggregated_delta: number;
  venue_shares: VenueShareDTO[];
}

export interface FeedStatusDTO {
  connection_state: 'Connected' | 'Reconnecting' | 'Disconnected' | 'Stale' | string;
  endpoint: string;
  total_messages: number;
  messages_per_sec: number;
  reconnect_count: number;
  last_latency_ms: number;
  is_live: boolean;
}

export interface ChartSnapshotDTO {
  instrument_id: string;
  venue: string;
  timeframe_us: number;
  bars: BarDTO[];
  active_bar: BarDTO | null;
  speed_1s: SpeedMetricsDTO;
  speed_5s: SpeedMetricsDTO;
  speed_10s: SpeedMetricsDTO;
  cvd_units: number;
  data_quality: DataQualityStatusDTO;
  order_book?: OrderBookSnapshotDTO;
  heatmap_slices?: HeatmapSliceDTO[];
  options_summary?: OptionsSummaryDTO;
  playback?: PlaybackStatusDTO;
  vwap?: VwapBandDTO;
  divergences?: DeltaDivergenceDTO[];
  volume_profile?: SessionVolumeProfileDTO;
  multi_venue?: MultiVenueSummaryDTO;
  market_narrative?: MarketNarrativeDTO;
  icebergs?: IcebergOrderDTO[];
  cme_stop_sweeps?: CmeStopSweepItemDTO[];
  recent_trades?: TradeEventDTO[];
  paper_position?: PaperPositionDTO;
  feed_status?: FeedStatusDTO;
}

export interface PaperPositionDTO {
  side: 'Buy' | 'Sell' | string;
  quantity_units: number;
  entry_price_ticks: number;
  current_price_ticks: number;
  unrealized_pnl_ticks: number;
  unrealized_pnl_usd: number;
  stop_loss_ticks: number;
  take_profit_ticks: number;
  open_time_us: number;
}

export interface OptimizationSweepConfigDTO {
  strategy_name: string;
  stop_loss_range: number[];
  take_profit_range: number[];
  trade_size_units: number;
  slippage_ticks: number;
}

export interface OptimizationResultItemDTO {
  stop_loss_ticks: number;
  take_profit_ticks: number;
  total_trades: number;
  winning_trades: number;
  win_rate_pct: number;
  net_pnl_ticks: number;
  profit_factor: number;
  max_drawdown_pct: number;
}

export interface OptimizationReportDTO {
  strategy_name: string;
  best_stop_loss_ticks: number;
  best_take_profit_ticks: number;
  best_profit_factor: number;
  best_net_pnl_ticks: number;
  total_combinations: number;
  matrix: OptimizationResultItemDTO[];
}

export interface TradeEventDTO {
  event_id: string;
  exchange_ts_us: number;
  price_ticks: number;
  quantity_units: number;
  aggressor: 'Buy' | 'Sell' | 'Unknown' | string;
}

export interface InstrumentDefinition {
  instrument_id: string;
  venue: string;
  symbol: string;
  market_type: string;
  price_tick: number;
  trade_unit: string;
}

export interface BacktestConfigDTO {
  strategy_name: string;
  trade_size_units: number;
  stop_loss_ticks: number;
  take_profit_ticks: number;
  slippage_ticks: number;
}

export interface BacktestTradeDTO {
  trade_id: number;
  side: string;
  entry_price_ticks: number;
  exit_price_ticks: number;
  entry_time_us: number;
  exit_time_us: number;
  quantity_units: number;
  pnl_ticks: number;
  pnl_pct: number;
  exit_reason: string;
}

export interface BacktestReportDTO {
  strategy_name: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate_pct: number;
  gross_profit_ticks: number;
  gross_loss_ticks: number;
  net_pnl_ticks: number;
  profit_factor: number;
  max_drawdown_ticks: number;
  max_drawdown_pct: number;
  avg_trade_pnl_ticks: number;
  trades: BacktestTradeDTO[];
}

export * from './types/drawings';

