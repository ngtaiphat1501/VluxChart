import type {
  BarDTO,
  ChartSnapshotDTO,
  FootprintCellDTO,
  OrderBookSnapshotDTO,
  OptionsSummaryDTO,
  TradeEventDTO,
} from '../types.ts';

export interface CanonicalInstrument {
  id: string;
  venue: string;
  symbol: string;
  name: string;
  assetClass: 'CRYPTO' | 'COMMODITY' | 'INDEX' | 'FOREX';
  basePriceTicks: number; // integer scaled ticks (e.g. 6726000 = $67,260.00; 108450 = 1.08450 EURUSD)
  tickSize: number;       // ticks increment per footprint row
  priceDecimals: number;  // 2 for Crypto/Gold/Indices, 5 for EURUSD/GBPUSD, 3 for USDJPY
  tickScale?: number;     // divisor to convert price_ticks -> float price (default 100; 100000 for 5-dec FX; 1000 for 3-dec FX)
  pipTicks?: number;      // number of ticks in 1 standard Pip (e.g., 10 ticks = 0.00010 on EURUSD)
  quantityUnit: string;
  multiplier: number;
}

export const CANONICAL_INSTRUMENTS: Record<string, CanonicalInstrument> = {
  // ===========================================================================
  // METATRADER 5 (MT5) FOREX, METALS, INDICES & 24/7 CRYPTO SYMBOLS
  // ===========================================================================
  'MT5:FOREX:EURUSD': {
    id: 'MT5:FOREX:EURUSD',
    venue: 'MT5',
    symbol: 'EURUSD',
    name: 'MT5 EURUSD (Euro / US Dollar)',
    assetClass: 'FOREX',
    basePriceTicks: 110217, // 1.10217
    tickSize: 5,            // 0.5 pip (0.00005) footprint step
    priceDecimals: 5,
    tickScale: 100000,
    pipTicks: 10,
    quantityUnit: 'Lot',
    multiplier: 100000,
  },
  'MT5:FOREX:GBPUSD': {
    id: 'MT5:FOREX:GBPUSD',
    venue: 'MT5',
    symbol: 'GBPUSD',
    name: 'MT5 GBPUSD (British Pound / US Dollar)',
    assetClass: 'FOREX',
    basePriceTicks: 132102, // 1.32102
    tickSize: 5,
    priceDecimals: 5,
    tickScale: 100000,
    pipTicks: 10,
    quantityUnit: 'Lot',
    multiplier: 100000,
  },
  'MT5:FOREX:USDJPY': {
    id: 'MT5:FOREX:USDJPY',
    venue: 'MT5',
    symbol: 'USDJPY',
    name: 'MT5 USDJPY (US Dollar / Japanese Yen)',
    assetClass: 'FOREX',
    basePriceTicks: 159701, // 159.701
    tickSize: 5,            // 0.5 pip (0.005)
    priceDecimals: 3,
    tickScale: 1000,
    pipTicks: 10,
    quantityUnit: 'Lot',
    multiplier: 1000,
  },
  'MT5:FOREX:AUDUSD': {
    id: 'MT5:FOREX:AUDUSD',
    venue: 'MT5',
    symbol: 'AUDUSD',
    name: 'MT5 AUDUSD (Australian Dollar / US Dollar)',
    assetClass: 'FOREX',
    basePriceTicks: 67746,  // 0.67746
    tickSize: 5,
    priceDecimals: 5,
    tickScale: 100000,
    pipTicks: 10,
    quantityUnit: 'Lot',
    multiplier: 100000,
  },
  'MT5:FOREX:USDCAD': {
    id: 'MT5:FOREX:USDCAD',
    venue: 'MT5',
    symbol: 'USDCAD',
    name: 'MT5 USDCAD (US Dollar / Canadian Dollar)',
    assetClass: 'FOREX',
    basePriceTicks: 142702, // 1.42702
    tickSize: 5,
    priceDecimals: 5,
    tickScale: 100000,
    pipTicks: 10,
    quantityUnit: 'Lot',
    multiplier: 100000,
  },
  'MT5:FOREX:GBPJPY': {
    id: 'MT5:FOREX:GBPJPY',
    venue: 'MT5',
    symbol: 'GBPJPY',
    name: 'MT5 GBPJPY (British Pound / Japanese Yen)',
    assetClass: 'FOREX',
    basePriceTicks: 210970, // 210.970
    tickSize: 10,           // 1.0 pip (0.010)
    priceDecimals: 3,
    tickScale: 1000,
    pipTicks: 10,
    quantityUnit: 'Lot',
    multiplier: 1000,
  },
  'MT5:CFD:XAUUSD': {
    id: 'MT5:CFD:XAUUSD',
    venue: 'MT5',
    symbol: 'XAUUSD',
    name: 'MT5 XAUUSD (Gold Spot / US Dollar)',
    assetClass: 'COMMODITY',
    basePriceTicks: 362200, // $3,622.00
    tickSize: 25,           // $0.25 step (matches mt5_live_bridge.py footprintStepTicks=25)
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 10,
    quantityUnit: 'Lot',
    multiplier: 100,
  },
  'MT5:INDICES:NAS100': {
    id: 'MT5:INDICES:NAS100',
    venue: 'MT5',
    symbol: 'USTEC',
    name: 'MT5 USTEC / NAS100 (Nasdaq 100 Index)',
    assetClass: 'INDEX',
    basePriceTicks: 2787855, // 27,878.55
    tickSize: 50,            // 0.50 step
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 100,
    quantityUnit: 'Lot',
    multiplier: 1,
  },
  'MT5:INDICES:US30': {
    id: 'MT5:INDICES:US30',
    venue: 'MT5',
    symbol: 'US30',
    name: 'MT5 US30 / DJ30 (Wall Street 30 Index)',
    assetClass: 'INDEX',
    basePriceTicks: 5227200, // 52,272.00
    tickSize: 100,           // 1.00 step
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 100,
    quantityUnit: 'Lot',
    multiplier: 1,
  },
  'MT5:CRYPTO:BTCUSD': {
    id: 'MT5:CRYPTO:BTCUSD',
    venue: 'MT5',
    symbol: 'BTCUSD',
    name: 'MT5 BTCUSD (Bitcoin / USD 24/7)',
    assetClass: 'CRYPTO',
    basePriceTicks: 6454929, // $64,549.29
    tickSize: 50,
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 100,
    quantityUnit: 'Lot',
    multiplier: 1,
  },
  'MT5:CRYPTO:ETHUSD': {
    id: 'MT5:CRYPTO:ETHUSD',
    venue: 'MT5',
    symbol: 'ETHUSD',
    name: 'MT5 ETHUSD (Ethereum / USD 24/7)',
    assetClass: 'CRYPTO',
    basePriceTicks: 181113, // $1,811.13
    tickSize: 10,
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 100,
    quantityUnit: 'Lot',
    multiplier: 1,
  },

  // ===========================================================================
  // CRYPTO PERPETUAL SYMBOLS (BYBIT / BINANCE)
  // ===========================================================================
  'BYBIT:LINEAR_PERP:BTCUSDT:PERP': {
    id: 'BYBIT:LINEAR_PERP:BTCUSDT:PERP',
    venue: 'BYBIT',
    symbol: 'BTCUSDT',
    name: 'Bybit BTCUSDT (Perpetual)',
    assetClass: 'CRYPTO',
    basePriceTicks: 6726000, // $67,260.00
    tickSize: 50,
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 100,
    quantityUnit: 'BTC',
    multiplier: 1,
  },
  'BYBIT:LINEAR_PERP:ETHUSDT:PERP': {
    id: 'BYBIT:LINEAR_PERP:ETHUSDT:PERP',
    venue: 'BYBIT',
    symbol: 'ETHUSDT',
    name: 'Bybit ETHUSDT (Perpetual)',
    assetClass: 'CRYPTO',
    basePriceTicks: 190800, // $1,908.00
    tickSize: 10,
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 100,
    quantityUnit: 'ETH',
    multiplier: 1,
  },
  'BYBIT:LINEAR_PERP:XAUUSDT:PERP': {
    id: 'BYBIT:LINEAR_PERP:XAUUSDT:PERP',
    venue: 'BYBIT',
    symbol: 'XAUUSDT',
    name: 'Bybit XAUUSDT (Gold Perp)',
    assetClass: 'COMMODITY',
    basePriceTicks: 388350, // $3,883.50
    tickSize: 10,
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 10,
    quantityUnit: 'oz',
    multiplier: 1,
  },
  'BINANCE:USDS_M_PERP:BTCUSDT:PERP': {
    id: 'BINANCE:USDS_M_PERP:BTCUSDT:PERP',
    venue: 'BINANCE',
    symbol: 'BTCUSDT',
    name: 'Binance BTCUSDT (USDⓈ-M)',
    assetClass: 'CRYPTO',
    basePriceTicks: 6725000, // $67,250.00
    tickSize: 50,
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 100,
    quantityUnit: 'BTC',
    multiplier: 1,
  },
  'BINANCE:USDS_M_PERP:ETHUSDT:PERP': {
    id: 'BINANCE:USDS_M_PERP:ETHUSDT:PERP',
    venue: 'BINANCE',
    symbol: 'ETHUSDT',
    name: 'Binance ETHUSDT (USDⓈ-M)',
    assetClass: 'CRYPTO',
    basePriceTicks: 190800, // $1,908.00
    tickSize: 10,
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 100,
    quantityUnit: 'ETH',
    multiplier: 1,
  },
  'BINANCE:USDS_M_PERP:XAUUSDT:PERP': {
    id: 'BINANCE:USDS_M_PERP:XAUUSDT:PERP',
    venue: 'BINANCE',
    symbol: 'XAUUSDT',
    name: 'Binance XAUUSDT (Gold Perp)',
    assetClass: 'COMMODITY',
    basePriceTicks: 388600, // $3,886.00
    tickSize: 10,
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 10,
    quantityUnit: 'oz',
    multiplier: 1,
  },
  'AGGREGATED:MULTI_PERP:BTCUSDT:COMBINED': {
    id: 'AGGREGATED:MULTI_PERP:BTCUSDT:COMBINED',
    venue: 'MULTI-VENUE',
    symbol: 'BTCUSDT',
    name: 'Aggregated BTCUSDT (Bybit + Binance)',
    assetClass: 'CRYPTO',
    basePriceTicks: 6725500, // $67,255.00
    tickSize: 50,
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 100,
    quantityUnit: 'BTC',
    multiplier: 1,
  },
  'AGGREGATED:MULTI_PERP:XAUUSDT:COMBINED': {
    id: 'AGGREGATED:MULTI_PERP:XAUUSDT:COMBINED',
    venue: 'MULTI-VENUE',
    symbol: 'XAUUSDT-AGG',
    name: 'Aggregated Gold XAU/PAXG (Bybit + Binance + Deribit)',
    assetClass: 'COMMODITY',
    basePriceTicks: 386000, // $3,860.00
    tickSize: 10,
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 10,
    quantityUnit: 'oz',
    multiplier: 1,
  },

  // ===========================================================================
  // US FUTURES — CME GLOBEX LEVEL-3 MBO (`GLBX.MDP3` / DXFEED / RITHMIC)
  // ===========================================================================
  'CME:FUT:ES': {
    id: 'CME:FUT:ES',
    venue: 'CME_MBO',
    symbol: 'ES',
    name: 'CME E-mini S&P 500 Futures (ES=F · L3 MBO)',
    assetClass: 'INDEX',
    basePriceTicks: 720650, // 7,206.50
    tickSize: 25,           // $0.25 (12.50 USD / tick)
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 25,
    quantityUnit: 'Contract',
    multiplier: 50,
  },
  'CME:FUT:NQ': {
    id: 'CME:FUT:NQ',
    venue: 'CME_MBO',
    symbol: 'NQ',
    name: 'CME E-mini Nasdaq-100 Futures (NQ=F · L3 MBO)',
    assetClass: 'INDEX',
    basePriceTicks: 2623975, // 26,239.75
    tickSize: 25,            // $0.25 (5.00 USD / tick)
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 25,
    quantityUnit: 'Contract',
    multiplier: 20,
  },
  'CME:FUT:GC': {
    id: 'CME:FUT:GC',
    venue: 'CME_MBO',
    symbol: 'GC',
    name: 'COMEX Gold Futures (GC=F · L3 MBO)',
    assetClass: 'COMMODITY',
    basePriceTicks: 356850, // $3,568.50
    tickSize: 10,           // $0.10 (10.00 USD / tick)
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 10,
    quantityUnit: 'Contract',
    multiplier: 100,
  },
  'CME:FUT:CL': {
    id: 'CME:FUT:CL',
    venue: 'CME_MBO',
    symbol: 'CL',
    name: 'NYMEX WTI Crude Oil Futures (CL=F · L3 MBO)',
    assetClass: 'COMMODITY',
    basePriceTicks: 8067, // $80.67
    tickSize: 1,          // $0.01 (10.00 USD / tick)
    priceDecimals: 2,
    tickScale: 100,
    pipTicks: 1,
    quantityUnit: 'Contract',
    multiplier: 1000,
  },
  'CME:FUT:6E': {
    id: 'CME:FUT:6E',
    venue: 'CME_MBO',
    symbol: '6E',
    name: 'CME Euro FX Futures (6E=F · L3 MBO)',
    assetClass: 'FOREX',
    basePriceTicks: 109770, // 1.09770
    tickSize: 5,            // 0.00005 ($6.25 / tick)
    priceDecimals: 5,
    tickScale: 100000,
    pipTicks: 10,
    quantityUnit: 'Contract',
    multiplier: 125000,
  },
};

export function getInstrumentMeta(instrumentId: string): CanonicalInstrument {
  return (
    CANONICAL_INSTRUMENTS[instrumentId] ||
    CANONICAL_INSTRUMENTS['BYBIT:LINEAR_PERP:BTCUSDT:PERP']
  );
}

export function formatInstrumentPrice(priceTicks: number, instrumentId: string): string {
  const inst = getInstrumentMeta(instrumentId);
  const scale = inst.tickScale || 100;
  return (priceTicks / scale).toFixed(inst.priceDecimals);
}

export function formatPriceDiffPips(diffTicks: number, instrumentId: string): string {
  const inst = getInstrumentMeta(instrumentId);
  const sign = diffTicks > 0 ? '+' : '';
  if (inst.venue === 'MT5' || inst.assetClass === 'FOREX') {
    const pipSize = inst.pipTicks || 10;
    const pips = diffTicks / pipSize;
    return `${sign}${pips.toFixed(1)} pips`;
  }
  const scale = inst.tickScale || 100;
  return `${sign}${(diffTicks / scale).toFixed(inst.priceDecimals)}`;
}

export function computePositionPnlUsd(
  side: 'Buy' | 'Sell',
  entryTicks: number,
  exitTicks: number,
  lotsOrQty: number,
  instrumentId: string
): number {
  const inst = getInstrumentMeta(instrumentId);
  const rawDiff = side === 'Buy' ? exitTicks - entryTicks : entryTicks - exitTicks;
  if (inst.venue === 'MT5' || inst.assetClass === 'FOREX') {
    const pipSize = inst.pipTicks || 10;
    const pips = rawDiff / pipSize;
    // Standard MT5 Forex / Gold Lot: 1.00 Lot ≈ $10.00 per pip
    return pips * 10 * lotsOrQty;
  }
  const scale = inst.tickScale || 100;
  return (rawDiff / scale) * lotsOrQty;
}

/**
 * Creates a strictly empty initial snapshot state (ZERO fake/simulated candles, trades, or order books)
 * while waiting for live exchange / MetaTrader 5 market data to stream in.
 */
export function createEmptyLiveSnapshot(
  instrumentId: string,
  timeframeUs: number = 60_000_000
): ChartSnapshotDTO {
  const inst =
    CANONICAL_INSTRUMENTS[instrumentId] ||
    CANONICAL_INSTRUMENTS['MT5:CFD:XAUUSD'];

  return {
    instrument_id: inst.id,
    venue: inst.venue,
    timeframe_us: timeframeUs,
    bars: [],
    active_bar: null,
    speed_1s: { window_ms: 1000, trade_count: 0, buy_units: 0, sell_units: 0, total_units: 0, delta_units: 0 },
    speed_5s: { window_ms: 5000, trade_count: 0, buy_units: 0, sell_units: 0, total_units: 0, delta_units: 0 },
    speed_10s: { window_ms: 10000, trade_count: 0, buy_units: 0, sell_units: 0, total_units: 0, delta_units: 0 },
    cvd_units: 0,
    data_quality: {
      feed_status: 'CONNECTING',
      latency_ms: 0,
      total_gaps_detected: 0,
      completeness: 'CONNECTING',
      volume_invariant_ok: true,
      last_event_id: '',
      last_updated_us: Date.now() * 1000,
    },
    recent_trades: [],
  };
}
