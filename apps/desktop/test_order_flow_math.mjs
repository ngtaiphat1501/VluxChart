/**
 * Exhaustive Verification Script for DeepChart Market Microstructure Mathematical Engine
 */

import {
  computeSessionVwap,
  computeSteidlmayerValueArea,
  computeDiagonalImbalances,
  aggregateFootprintCells,
  computeBarStatistics,
  computeNakedPocs,
  detectAbsorptionEvents,
  detectCvdDivergences,
  recalculateOptionsLevels,
  computeProprietaryZoneLines,
  computeFixedRangeVolumeProfile,
  computeSessionTpoProfile,
  detectUnfinishedAuctions,
  computeClusterSearchThreshold,
} from './src/utils/orderFlowMath.ts';
import {
  hasFeatureAccess,
  normalizeAccountTier,
  getTierBadgeMeta,
} from './src/utils/entitlements.ts';
import {
  buildNonTimeBarsFromRealData,
  appendLiveTradeToNonTimeSeries,
  formatCustomFrameBadge,
  parseSyntheticFormula,
  evaluateFormulaAst,
  registerSyntheticInstrument,
  buildSyntheticBarsFromRealLegs,
} from './src/utils/customFrameAndSyntheticEngine.ts';
import { parseRealDatabentoMboCaptureText } from './src/services/cmeMboService.ts';

console.log('=== STARTING EXHAUSTIVE ORDER FLOW MATHEMATICAL AUDIT ===\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
    passedTests++;
  }
}

// ---------------------------------------------------------------------------
// TEST 1: Discrete Tick Aggregation - Volume Conservation Theorem
// Invariant: Sum(Aggregated) === Sum(Original)
// ---------------------------------------------------------------------------
console.log('--- TEST 1: Discrete Tick Aggregation Volume Conservation ---');
const originalCells = [
  { price_ticks: 6700000, buy_units: 50, sell_units: 30, unknown_units: 0, total_units: 80, delta_units: 20, trade_count: 5 },
  { price_ticks: 6700050, buy_units: 40, sell_units: 60, unknown_units: 0, total_units: 100, delta_units: -20, trade_count: 8 },
  { price_ticks: 6700100, buy_units: 100, sell_units: 10, unknown_units: 0, total_units: 110, delta_units: 90, trade_count: 12 },
  { price_ticks: 6700150, buy_units: 20, sell_units: 40, unknown_units: 0, total_units: 60, delta_units: -20, trade_count: 4 },
];
const originalTotalVol = originalCells.reduce((acc, c) => acc + c.total_units, 0);
const originalTotalDelta = originalCells.reduce((acc, c) => acc + c.delta_units, 0);

const agg2x = aggregateFootprintCells(originalCells, 50, 2);
const aggTotalVol = agg2x.reduce((acc, c) => acc + c.total_units, 0);
const aggTotalDelta = agg2x.reduce((acc, c) => acc + c.delta_units, 0);

assert(originalTotalVol === aggTotalVol, `Volume is strictly conserved: ${originalTotalVol} === ${aggTotalVol}`);
assert(originalTotalDelta === aggTotalDelta, `Delta is strictly conserved: ${originalTotalDelta} === ${aggTotalDelta}`);
assert(agg2x.length <= originalCells.length, `Tick aggregation reduces row count: ${agg2x.length} <= ${originalCells.length}`);

// ---------------------------------------------------------------------------
// TEST 2: Steidlmayer 70% Value Area & True POC (CBOT Standard)
// Invariants: POC has maximum volume, volume in [VAL, VAH] >= 70% of total
// ---------------------------------------------------------------------------
console.log('\n--- TEST 2: Steidlmayer 70% Value Area & True POC ---');
const vaCells = [
  { price_ticks: 100, buy_units: 5, sell_units: 5, total_units: 10, delta_units: 0, unknown_units: 0, trade_count: 1 },
  { price_ticks: 105, buy_units: 20, sell_units: 20, total_units: 40, delta_units: 0, unknown_units: 0, trade_count: 2 },
  { price_ticks: 110, buy_units: 50, sell_units: 50, total_units: 100, delta_units: 0, unknown_units: 0, trade_count: 5 }, // POC
  { price_ticks: 115, buy_units: 15, sell_units: 15, total_units: 30, delta_units: 0, unknown_units: 0, trade_count: 2 },
  { price_ticks: 120, buy_units: 10, sell_units: 10, total_units: 20, delta_units: 0, unknown_units: 0, trade_count: 1 },
];
const va = computeSteidlmayerValueArea(vaCells, 5);
assert(va.poc_ticks === 110, `POC is identified at max volume level: POC=${va.poc_ticks} (expected 110)`);
assert(va.val_ticks <= va.poc_ticks && va.poc_ticks <= va.vah_ticks, `POC lies within Value Area: VAL=${va.val_ticks} <= POC=${va.poc_ticks} <= VAH=${va.vah_ticks}`);
assert(va.volume_covered >= 200 * 0.70, `Value Area encloses >= 70% of total bar volume: covered=${va.volume_covered} >= 140`);

// ---------------------------------------------------------------------------
// TEST 3: Diagonal Imbalance & Stacked Momentum (Biais et al. 1995)
// Invariant: Ask[k+1] >= 3.0 * Bid[k] for Buy Imbalance, Bid[k] >= 3.0 * Ask[k+1] for Sell
// ---------------------------------------------------------------------------
console.log('\n--- TEST 3: Diagonal Imbalance & Stacked Sweeps ---');
const imbCells = [
  { price_ticks: 100, buy_units: 10, sell_units: 50, total_units: 60, delta_units: -40, unknown_units: 0, trade_count: 1 },
  { price_ticks: 105, buy_units: 200, sell_units: 50, total_units: 250, delta_units: 150, unknown_units: 0, trade_count: 2 }, // 200 >= 3 * 50 -> Buy Imb
  { price_ticks: 110, buy_units: 300, sell_units: 50, total_units: 350, delta_units: 250, unknown_units: 0, trade_count: 3 }, // 300 >= 3 * 50 -> Buy Imb
  { price_ticks: 115, buy_units: 400, sell_units: 10, total_units: 410, delta_units: 390, unknown_units: 0, trade_count: 4 }, // 400 >= 3 * 50 -> Buy Imb
];
const imbResult = computeDiagonalImbalances(imbCells, 3.0, 10);
assert(imbResult.buyImbalancePrices.has(105), `Buy Imbalance detected at 105 (Ask 200 vs Bid 50)`);
assert(imbResult.buyImbalancePrices.has(110), `Buy Imbalance detected at 110 (Ask 300 vs Bid 50)`);
assert(imbResult.buyImbalancePrices.has(115), `Buy Imbalance detected at 115 (Ask 400 vs Bid 50)`);
assert(imbResult.stackedImbalances.length >= 1, `Stacked Imbalance detected (>= 3 consecutive levels)`);
assert(imbResult.stackedImbalances[0].side === 'buy', `Stacked Imbalance side is 'buy'`);

// ---------------------------------------------------------------------------
// TEST 4: Naked POC (NPOC / Unmitigated POC) Tracking
// Invariants: Untested POC remains naked (isMitigated=false); touched POC is mitigated
// ---------------------------------------------------------------------------
console.log('\n--- TEST 4: Naked POC (NPOC) Tracker ---');
const mockBars = [
  {
    bar_start_us: 1000000,
    timeframe_us: 60000000,
    open_ticks: 100,
    high_ticks: 108,
    low_ticks: 98,
    close_ticks: 105,
    buy_units: 100,
    sell_units: 80,
    unknown_units: 0,
    total_units: 180,
    delta_units: 20,
    trade_count: 10,
    poc_ticks: 106, // Level 106 will be tested in bar 1
    value_area: null,
    footprint: [{ price_ticks: 106, buy_units: 50, sell_units: 40, total_units: 90, delta_units: 10, unknown_units: 0, trade_count: 5 }],
    finality: 'Final',
    completeness: 'Complete',
  },
  {
    bar_start_us: 2000000,
    timeframe_us: 60000000,
    open_ticks: 105,
    high_ticks: 112, // Touches 106!
    low_ticks: 103,
    close_ticks: 110,
    buy_units: 120,
    sell_units: 80,
    unknown_units: 0,
    total_units: 200,
    delta_units: 40,
    trade_count: 12,
    poc_ticks: 111, // Level 111 will NEVER be touched in bar 2
    value_area: null,
    footprint: [{ price_ticks: 111, buy_units: 80, sell_units: 30, total_units: 110, delta_units: 50, unknown_units: 0, trade_count: 6 }],
    finality: 'Final',
    completeness: 'Complete',
  },
  {
    bar_start_us: 3000000,
    timeframe_us: 60000000,
    open_ticks: 110,
    high_ticks: 115,
    low_ticks: 113, // Range 113 - 115, DOES NOT touch 111
    close_ticks: 114,
    buy_units: 80,
    sell_units: 60,
    unknown_units: 0,
    total_units: 140,
    delta_units: 20,
    trade_count: 8,
    poc_ticks: 114,
    value_area: null,
    footprint: [],
    finality: 'Final',
    completeness: 'Complete',
  },
];

const analyzed = computeBarStatistics(mockBars);
const npocs = computeNakedPocs(analyzed);

assert(npocs.length === 2, `Evaluated NPOCs for completed bars: length=${npocs.length}`);
assert(npocs[0].priceTicks === 106 && npocs[0].isMitigated === true, `Bar 0 POC (106) was mitigated by Bar 1`);
assert(npocs[1].priceTicks === 111 && npocs[1].isMitigated === false, `Bar 1 POC (111) is NAKED (Unmitigated)`);

// ---------------------------------------------------------------------------
// TEST 5: Institutional Limit Order Absorption (Hasbrouck 1991 / Kyle 1985)
// Invariant: Extreme delta at wick with price rejection
// ---------------------------------------------------------------------------
console.log('\n--- TEST 5: Institutional Limit Order Absorption ---');
const absorptionBars = [
  {
    bar_start_us: 1000000,
    timeframe_us: 60000000,
    open_ticks: 105,
    high_ticks: 110,
    low_ticks: 95,
    close_ticks: 108, // Long lower wick, closed strong
    buy_units: 100,
    sell_units: 200,
    unknown_units: 0,
    total_units: 300,
    delta_units: -100,
    trade_count: 20,
    poc_ticks: 96,
    value_area: null,
    footprint: [
      { price_ticks: 96, buy_units: 10, sell_units: 150, total_units: 160, delta_units: -140, unknown_units: 0, trade_count: 10 }, // Heavy sell absorbed!
      { price_ticks: 108, buy_units: 80, sell_units: 20, total_units: 100, delta_units: 60, unknown_units: 0, trade_count: 8 },
    ],
    finality: 'Final',
    completeness: 'Complete',
  },
];
const analyzedAbs = computeBarStatistics(absorptionBars);
const absEvents = detectAbsorptionEvents(analyzedAbs, 30);
assert(absEvents.length === 1, `Detected Absorption Event count: ${absEvents.length}`);
assert(absEvents[0].type === 'BullishAbsorption', `Absorption type is BullishAbsorption: ${absEvents[0].type}`);
assert(absEvents[0].priceTicks === 96, `Absorption detected at low price tick: 96`);

// ---------------------------------------------------------------------------
// TEST 6: Cumulative Volume Delta (CVD) Divergence Detection
// Invariant: Higher High in Price + Lower High in CVD = Bearish Divergence
// ---------------------------------------------------------------------------
console.log('\n--- TEST 6: CVD Divergence Detection ---');
const divBars = [
  {
    bar_start_us: 1000000,
    timeframe_us: 60000000,
    open_ticks: 100,
    high_ticks: 105,
    low_ticks: 95,
    close_ticks: 104,
    buy_units: 200,
    sell_units: 50,
    unknown_units: 0,
    total_units: 250,
    delta_units: 150,
    trade_count: 10,
    poc_ticks: 104,
    value_area: null,
    footprint: [],
    finality: 'Final',
    completeness: 'Complete',
  },
  {
    bar_start_us: 2000000,
    timeframe_us: 60000000,
    open_ticks: 104,
    high_ticks: 106,
    low_ticks: 100,
    close_ticks: 105,
    buy_units: 150,
    sell_units: 50,
    unknown_units: 0,
    total_units: 200,
    delta_units: 100,
    trade_count: 8,
    poc_ticks: 105,
    value_area: null,
    footprint: [],
    finality: 'Final',
    completeness: 'Complete',
  },
  {
    bar_start_us: 3000000,
    timeframe_us: 60000000,
    open_ticks: 105,
    high_ticks: 107,
    low_ticks: 102,
    close_ticks: 106,
    buy_units: 120,
    sell_units: 60,
    unknown_units: 0,
    total_units: 180,
    delta_units: 60,
    trade_count: 6,
    poc_ticks: 106,
    value_area: null,
    footprint: [],
    finality: 'Final',
    completeness: 'Complete',
  },
  {
    bar_start_us: 4000000,
    timeframe_us: 60000000,
    open_ticks: 106,
    high_ticks: 110, // New Higher High! (110 > 107)
    low_ticks: 104,
    close_ticks: 105,
    buy_units: 30,
    sell_units: 500, // Massive selling! Delta = -470 -> CVD collapses!
    unknown_units: 0,
    total_units: 530,
    delta_units: -470,
    trade_count: 15,
    poc_ticks: 105,
    value_area: null,
    footprint: [],
    finality: 'Final',
    completeness: 'Complete',
  },
];

const analyzedDiv = computeBarStatistics(divBars);
const divergences = detectCvdDivergences(analyzedDiv, 2);
assert(divergences.length >= 1, `Detected CVD Divergence: count=${divergences.length}`);
assert(divergences[0].divergence_type === 'BearishDivergence', `Correctly identified Bearish Divergence (New High with Collapsing CVD)`);

// ---------------------------------------------------------------------------
// TEST 8: Options Engine Open Interest Walls & Max Pain Theorem
// Invariants: Call Wall = argmax(Call_OI), Put Wall = argmax(Put_OI),
//             Max Pain minimizes sum of intrinsic buyer payouts.
// ---------------------------------------------------------------------------
console.log('\n--- TEST 8: Options Open Interest Walls & Max Pain Invariants ---');
const sampleStrikes = [
  { strike_ticks: 65000, call_oi: 500, put_oi: 3500, call_delta: 0.8, call_gamma: 0.001, call_theta: -10, call_vega: 2, put_delta: -0.2, put_gamma: 0.001, put_theta: -5, put_vega: 2, iv_smile: 0.6 },
  { strike_ticks: 67000, call_oi: 2000, put_oi: 1500, call_delta: 0.5, call_gamma: 0.002, call_theta: -15, call_vega: 2.5, put_delta: -0.5, put_gamma: 0.002, put_theta: -15, put_vega: 2.5, iv_smile: 0.52 },
  { strike_ticks: 70000, call_oi: 4200, put_oi: 800, call_delta: 0.2, call_gamma: 0.001, call_theta: -8, call_vega: 1.8, put_delta: -0.8, put_gamma: 0.001, put_theta: -12, put_vega: 1.8, iv_smile: 0.58 },
];
const rawSummary = {
  underlying_asset: 'BTC',
  total_call_oi: 0,
  total_put_oi: 0,
  put_call_ratio: 0,
  call_wall_ticks: 0,
  put_wall_ticks: 0,
  max_pain_ticks: 0,
  atm_iv: 0.52,
  net_delta: 100,
  net_gamma: 0.001,
  strikes: sampleStrikes,
};
const calculatedOpt = recalculateOptionsLevels(rawSummary);
assert(calculatedOpt !== null, 'recalculateOptionsLevels returned valid object');
assert(calculatedOpt.call_wall_ticks === 70000, `Call Wall matches maximum Call OI (4200 at 70000): got ${calculatedOpt.call_wall_ticks}`);
assert(calculatedOpt.put_wall_ticks === 65000, `Put Wall matches maximum Put OI (3500 at 65000): got ${calculatedOpt.put_wall_ticks}`);
assert(calculatedOpt.total_call_oi === 6700, `Total Call OI conservation: 500 + 2000 + 4200 = 6700`);
assert(calculatedOpt.total_put_oi === 5800, `Total Put OI conservation: 3500 + 1500 + 800 = 5800`);
assert(calculatedOpt.max_pain_ticks === 67000, `Max Pain matches payout minimizer (67000): got ${calculatedOpt.max_pain_ticks}`);

// ---------------------------------------------------------------------------
// TEST 9: Top 7 Proprietary Buy/Sell Horizontal Zone Indicators & Gold Microstructure
// Invariants: VA-EDGE auto-disabled on Gold < H1, enabled on Gold H1+ and Crypto M5
// ---------------------------------------------------------------------------
console.log('\n--- TEST 9: Top 7 Proprietary Zone Lines & Gold Microstructure Adaptation ---');
const synthetic30Bars = Array.from({ length: 30 }).map((_, idx) => {
  const base = 384000 + Math.round(Math.sin(idx * 0.4) * 400);
  const vol = idx === 24 ? 1200 : 300;
  const buy = idx === 24 ? 850 : 160;
  const sell = vol - buy;
  return {
    bar_start_us: 1760000000000000 + idx * 300_000_000,
    timeframe_us: 300_000_000,
    open_ticks: base - 30,
    high_ticks: base + 80,
    low_ticks: base - 80,
    close_ticks: base + 40,
    buy_units: buy,
    sell_units: sell,
    unknown_units: 0,
    total_units: vol,
    delta_units: buy - sell,
    trade_count: 25,
    poc_ticks: base,
    value_area: null,
    footprint: [
      { price_ticks: base - 50, buy_units: 20, sell_units: 20, total_units: 40, delta_units: 0, unknown_units: 0, trade_count: 2 },
      { price_ticks: base - 25, buy_units: 10, sell_units: 5, total_units: 15, delta_units: 5, unknown_units: 0, trade_count: 1 },
      { price_ticks: base, buy_units: Math.round(buy * 0.6), sell_units: Math.round(sell * 0.6), total_units: Math.round(vol * 0.6), delta_units: Math.round((buy - sell) * 0.6), unknown_units: 0, trade_count: 10 },
      { price_ticks: base + 25, buy_units: 40, sell_units: 10, total_units: 50, delta_units: 30, unknown_units: 0, trade_count: 3 },
      { price_ticks: base + 50, buy_units: 30, sell_units: 10, total_units: 40, delta_units: 20, unknown_units: 0, trade_count: 2 },
    ],
    finality: 'Closed',
    completeness: 'Complete',
  };
});
const calc30 = computeBarStatistics(synthetic30Bars);
const sessionVwap30 = computeSessionVwap(synthetic30Bars, 384000);

const goldM5Lines = computeProprietaryZoneLines(calc30, sessionVwap30, 36, 'MT5:CFD:XAUUSD', 300_000_000);
const goldH1Lines = computeProprietaryZoneLines(calc30, sessionVwap30, 36, 'MT5:CFD:XAUUSD', 3_600_000_000);
const btcM5Lines = computeProprietaryZoneLines(calc30, sessionVwap30, 36, 'BYBIT:LINEAR_PERP:BTCUSDT:PERP', 300_000_000);

assert(goldM5Lines.length > 0 && goldM5Lines.length <= 8, `Gold M5 Top-7 produces bounded active lines: ${goldM5Lines.length}`);
assert(!goldM5Lines.some((l) => l.indicator === 'VA-EDGE'), `VA-EDGE strictly suppressed on Gold M5 (< H1)`);
assert(goldH1Lines.some((l) => l.indicator === 'VA-EDGE'), `VA-EDGE enabled on Gold H1+`);
assert(btcM5Lines.some((l) => l.indicator === 'VA-EDGE'), `VA-EDGE enabled on Crypto BTCUSDT M5`);

// ---------------------------------------------------------------------------
// TEST 10: Fixed Range Volume Profile (FRVP) Exact Accounting & 70% Value Area
// ---------------------------------------------------------------------------
console.log('\n--- TEST 10: ATAS Fixed Range Volume Profile (FRVP) ---');
const frvpResult = computeFixedRangeVolumeProfile(
  synthetic30Bars,
  synthetic30Bars[5].bar_start_us,
  synthetic30Bars[14].bar_start_us,
  25
);
assert(frvpResult !== null && frvpResult.barCount === 10, `FRVP sliced exact 10 bars: got ${frvpResult?.barCount}`);
assert(
  frvpResult.valTicks <= frvpResult.pocTicks && frvpResult.pocTicks <= frvpResult.vahTicks,
  `FRVP contiguous Value Area encloses POC (${frvpResult.valTicks} <= ${frvpResult.pocTicks} <= ${frvpResult.vahTicks})`
);
const frvpBinSum = frvpResult.bins.reduce((s, b) => s + b.totalUnits, 0);
assert(frvpBinSum === frvpResult.totalVolume, `FRVP volume conservation (${frvpBinSum} === ${frvpResult.totalVolume})`);

// ---------------------------------------------------------------------------
// TEST 11: CBOT TPO Market Profile (IBH/IBL 60m A+B & Interior Single Prints)
// ---------------------------------------------------------------------------
console.log('\n--- TEST 11: TPO Market Profile (IBH/IBL & Single Prints) ---');
const dayBaseUs = 86_400_000_000 * 20500;
const tpoBars = [
  // Period A (0..30m): trades 3600.00 - 3605.00
  { bar_start_us: dayBaseUs, timeframe_us: 900_000_000, open_ticks: 360100, high_ticks: 360500, low_ticks: 360000, close_ticks: 360400, buy_units: 100, sell_units: 80, unknown_units: 0, total_units: 180, delta_units: 20, trade_count: 10, poc_ticks: 360200, value_area: null, footprint: [], finality: 'Closed', completeness: 'Complete' },
  // Period B (30..60m): trades 3602.00 - 3608.00 -> IBH = 360800, IBL = 360000
  { bar_start_us: dayBaseUs + 1_800_000_000, timeframe_us: 900_000_000, open_ticks: 360400, high_ticks: 360800, low_ticks: 360200, close_ticks: 360700, buy_units: 120, sell_units: 90, unknown_units: 0, total_units: 210, delta_units: 30, trade_count: 12, poc_ticks: 360500, value_area: null, footprint: [], finality: 'Closed', completeness: 'Complete' },
  // Period C (60..90m): impulsive breakout from 3607.00 through 3615.00 (creating Single Prints around 3609-3612)
  { bar_start_us: dayBaseUs + 3_600_000_000, timeframe_us: 900_000_000, open_ticks: 360700, high_ticks: 361600, low_ticks: 360700, close_ticks: 361500, buy_units: 300, sell_units: 50, unknown_units: 0, total_units: 350, delta_units: 250, trade_count: 20, poc_ticks: 361400, value_area: null, footprint: [], finality: 'Closed', completeness: 'Complete' },
  // Period D (90..120m): consolidates high at 3613.00 - 3616.00 -> leaves 3609.00..3612.00 as interior C-period Single Prints!
  { bar_start_us: dayBaseUs + 5_400_000_000, timeframe_us: 900_000_000, open_ticks: 361500, high_ticks: 361600, low_ticks: 361300, close_ticks: 361450, buy_units: 140, sell_units: 130, unknown_units: 0, total_units: 270, delta_units: 10, trade_count: 15, poc_ticks: 361450, value_area: null, footprint: [], finality: 'Closed', completeness: 'Complete' },
];
const tpoProfile = computeSessionTpoProfile(tpoBars, 100);
assert(tpoProfile !== null, 'TPO Profile computed for session');
assert(tpoProfile.ibhTicks === 360800 && tpoProfile.iblTicks === 360000, `TPO Initial Balance (A+B) exact: IBH=${tpoProfile.ibhTicks}, IBL=${tpoProfile.iblTicks}`);
assert(
  tpoProfile.singlePrintZones.some((z) => z.letter === 'C' && z.lowTicks === 360900),
  `TPO detected interior C-period Single Print zone`
);

// ---------------------------------------------------------------------------
// TEST 12: Unfinished Auction (UA) & Cluster Search Threshold
// ---------------------------------------------------------------------------
console.log('\n--- TEST 12: Unfinished Auction & Cluster Search ---');
const uaBars = [
  {
    bar_start_us: 1000000,
    timeframe_us: 60000000,
    open_ticks: 360000,
    high_ticks: 360300,
    low_ticks: 359900,
    close_ticks: 360200,
    buy_units: 150,
    sell_units: 110,
    unknown_units: 0,
    total_units: 260,
    delta_units: 40,
    trade_count: 18,
    poc_ticks: 360100,
    value_area: null,
    footprint: [
      { price_ticks: 359900, buy_units: 0, sell_units: 45, total_units: 45, delta_units: -45, unknown_units: 0, trade_count: 4 }, // Finished low (0 Buy)
      { price_ticks: 360100, buy_units: 70, sell_units: 30, total_units: 100, delta_units: 40, unknown_units: 0, trade_count: 8 },
      { price_ticks: 360300, buy_units: 80, sell_units: 35, total_units: 115, delta_units: 45, unknown_units: 0, trade_count: 6 }, // Unfinished High (both > 0!)
    ],
    finality: 'Closed',
    completeness: 'Complete',
  },
  {
    bar_start_us: 2000000,
    timeframe_us: 60000000,
    open_ticks: 360200,
    high_ticks: 360250, // Does NOT breach 360300 -> UA High stays unmitigated!
    low_ticks: 360000,
    close_ticks: 360100,
    buy_units: 60,
    sell_units: 70,
    unknown_units: 0,
    total_units: 130,
    delta_units: -10,
    trade_count: 9,
    poc_ticks: 360100,
    value_area: null,
    footprint: [
      { price_ticks: 360000, buy_units: 0, sell_units: 30, total_units: 30, delta_units: -30, unknown_units: 0, trade_count: 3 },
      { price_ticks: 360100, buy_units: 30, sell_units: 40, total_units: 70, delta_units: -10, unknown_units: 0, trade_count: 4 },
      { price_ticks: 360250, buy_units: 30, sell_units: 0, total_units: 30, delta_units: 30, unknown_units: 0, trade_count: 2 },
    ],
    finality: 'Closed',
    completeness: 'Complete',
  },
];
const uas = detectUnfinishedAuctions(uaBars);
assert(uas.length === 1 && uas[0].side === 'HIGH' && uas[0].priceTicks === 360300, `Detected exact unmitigated Unfinished High at 360300`);
const clsThresh = computeClusterSearchThreshold(10, 500, 500);
assert(clsThresh >= 120, `Cluster Search adaptive threshold scales cleanly: ${clsThresh}`);

// ---------------------------------------------------------------------------
// TEST 13: 3-Tier Account Entitlements Matrix (PILOT vs PRO vs QUANT)
// ---------------------------------------------------------------------------
console.log('\n--- TEST 13: 3-Tier Account Privileges & Entitlements ---');
assert(normalizeAccountTier('STANDARD PILOT') === 'STANDARD PILOT', 'Normalizes STANDARD PILOT');
assert(normalizeAccountTier('INSTITUTIONAL PRO') === 'INSTITUTIONAL PRO', 'Normalizes INSTITUTIONAL PRO');
assert(normalizeAccountTier('QUANT DESK') === 'QUANT DESK', 'Normalizes QUANT DESK');
assert(!hasFeatureAccess('STANDARD PILOT', 'options_gex'), 'PILOT locks Gold/Crypto Options GEX');
assert(!hasFeatureAccess('STANDARD PILOT', 'fixed_range_vp'), 'PILOT locks Fixed Range VP');
assert(hasFeatureAccess('INSTITUTIONAL PRO', 'options_gex'), 'PRO unlocks Gold/Crypto Options GEX');
assert(hasFeatureAccess('INSTITUTIONAL PRO', 'fixed_range_vp'), 'PRO unlocks Fixed Range VP');
assert(hasFeatureAccess('INSTITUTIONAL PRO', 'tpo_profile'), 'PRO unlocks TPO Market Profile');
assert(!hasFeatureAccess('INSTITUTIONAL PRO', 'backtester'), 'PRO locks Quant Strategy Backtester');
assert(hasFeatureAccess('QUANT DESK', 'backtester'), 'QUANT unlocks Strategy Backtester');
assert(hasFeatureAccess('QUANT DESK', 'mbo_l3'), 'QUANT unlocks MBO L3 Suite');
assert(getTierBadgeMeta('QUANT DESK').shortBadge === 'QUANT', 'QUANT badge meta resolves');

// ---------------------------------------------------------------------------
// TEST 14: Real Non-Time Order Flow Bars (Volume / Tick / Range) & Safe Synthetic AST
// ---------------------------------------------------------------------------
console.log('\n--- TEST 14: Non-Time Bars (Range / Volume / Tick) & Synthetic Formula AST ---');
assert(formatCustomFrameBadge({ category: 'volume', value: 500 }) === '500V', 'Formats 500V badge');
assert(formatCustomFrameBadge({ category: 'tick', value: 250 }) === '250T', 'Formats 250T badge');
assert(formatCustomFrameBadge({ category: 'range', value: 10 }) === '10R', 'Formats 10R badge');

const realM1Sample = [
  {
    bar_start_us: 1_700_000_000_000_000,
    timeframe_us: 60_000_000,
    open_ticks: 362000,
    high_ticks: 362250,
    low_ticks: 361950,
    close_ticks: 362200,
    buy_units: 360,
    sell_units: 240,
    unknown_units: 0,
    total_units: 600,
    delta_units: 120,
    trade_count: 120,
    poc_ticks: 362100,
    value_area: null,
    footprint: [
      { price_ticks: 361950, buy_units: 40, sell_units: 80, unknown_units: 0, total_units: 120, delta_units: -40, trade_count: 24 },
      { price_ticks: 362100, buy_units: 180, sell_units: 100, unknown_units: 0, total_units: 280, delta_units: 80, trade_count: 56 },
      { price_ticks: 362250, buy_units: 140, sell_units: 60, unknown_units: 0, total_units: 200, delta_units: 80, trade_count: 40 },
    ],
    finality: 'Closed',
    completeness: 'Complete',
  },
  {
    bar_start_us: 1_700_000_060_000_000,
    timeframe_us: 60_000_000,
    open_ticks: 362200,
    high_ticks: 362500,
    low_ticks: 362150,
    close_ticks: 362450,
    buy_units: 420,
    sell_units: 180,
    unknown_units: 0,
    total_units: 600,
    delta_units: 240,
    trade_count: 150,
    poc_ticks: 362350,
    value_area: null,
    footprint: [
      { price_ticks: 362150, buy_units: 60, sell_units: 90, unknown_units: 0, total_units: 150, delta_units: -30, trade_count: 35 },
      { price_ticks: 362350, buy_units: 210, sell_units: 50, unknown_units: 0, total_units: 260, delta_units: 160, trade_count: 65 },
      { price_ticks: 362500, buy_units: 150, sell_units: 40, unknown_units: 0, total_units: 190, delta_units: 110, trade_count: 50 },
    ],
    finality: 'Closed',
    completeness: 'Complete',
  },
];

// 14a. Volume Bars: 500V exact volume & delta conservation
const volBars = buildNonTimeBarsFromRealData(realM1Sample, { category: 'volume', value: 500 }, 'MT5:CFD:XAUUSD');
const volTotalIn = realM1Sample.reduce((s, b) => s + b.total_units, 0);
const volTotalOut = volBars.reduce((s, b) => s + b.total_units, 0);
const volDeltaIn = realM1Sample.reduce((s, b) => s + b.delta_units, 0);
const volDeltaOut = volBars.reduce((s, b) => s + b.delta_units, 0);
assert(volBars.length === 3, `500V splits 1200 units into 2 closed (500+500) + 1 forming (200) bar (got ${volBars.length})`);
assert(volBars[0].total_units === 500 && volBars[1].total_units === 500 && volBars[2].total_units === 200, 'Exact 500V threshold splits');
assert(volTotalOut === volTotalIn && volDeltaOut === volDeltaIn, `Volume Bar strict volume (${volTotalOut}) & delta (${volDeltaOut}) conservation`);

// 14b. Tick Bars: 100T exact trade_count threshold & monotonic timestamps (>=1s spacing)
const tickBars = buildNonTimeBarsFromRealData(realM1Sample, { category: 'tick', value: 100 }, 'MT5:CFD:XAUUSD');
assert(tickBars.length === 3 && tickBars[0].trade_count === 100 && tickBars[1].trade_count === 100 && tickBars[2].trade_count === 70, '100T exact tick count splits (100, 100, 70)');
assert(tickBars.every((b, idx) => idx === 0 || b.bar_start_us >= tickBars[idx - 1].bar_start_us + 1_000_000), 'Non-time bars maintain >= 1s monotonic bar_start_us');

// 14c. Range Bars: 15R on XAUUSD (1 pip = 10 ticks -> maxSpanTicks = 150 ticks = $1.50)
const rangeBars = buildNonTimeBarsFromRealData(realM1Sample, { category: 'range', value: 15 }, 'MT5:CFD:XAUUSD');
assert(rangeBars.length >= 3, `15R builds multiple range bars across $5.50 excursion (got ${rangeBars.length})`);
assert(rangeBars.every((b) => b.high_ticks - b.low_ticks <= 150), 'Every Range Bar strictly satisfies high_ticks - low_ticks <= maxSpanTicks (150)');
const rngVolOut = rangeBars.reduce((s, b) => s + b.total_units, 0);
assert(rngVolOut === volTotalIn, `Range Bar strict total volume conservation (${rngVolOut} === ${volTotalIn})`);

// 14d. Live Tick-by-Tick Rollover (`appendLiveTradeToNonTimeSeries`)
let liveClosed = volBars.slice(0, -1);
let liveActive = volBars[volBars.length - 1]; // currently 200 units
const rolloverRes = appendLiveTradeToNonTimeSeries(
  liveClosed,
  liveActive,
  {
    exchange_ts_us: 1_700_000_125_000_000,
    price_ticks: 362520,
    quantity_units: 300,
    aggressor: 'Buy',
  },
  { category: 'volume', value: 500 },
  'MT5:CFD:XAUUSD'
);
assert(
  rolloverRes.closedBars.length === 3 && rolloverRes.closedBars[2].total_units === 500 && rolloverRes.activeBar.total_units === 0,
  'Live trade hitting 500V closes active bar and opens fresh forming bar'
);

// 14e. Safe Recursive-Descent Synthetic Formula Parser & Multi-Leg Real Evaluator (Ratio + Negative Basis Spread)
const ratioSpec = parseSyntheticFormula('SYNTH:XAUEUR_TEST', 'XAUUSD / EURUSD');
registerSyntheticInstrument(ratioSpec);
assert(
  ratioSpec.legInstrumentIds.length === 2 &&
    ratioSpec.legInstrumentIds.includes('MT5:CFD:XAUUSD') &&
    ratioSpec.legInstrumentIds.includes('MT5:FOREX:EURUSD'),
  'AST resolves XAUUSD and EURUSD legs cleanly without eval()'
);
const evalVal = evaluateFormulaAst(ratioSpec.ast, { 'MT5:CFD:XAUUSD': 3630.0, 'MT5:FOREX:EURUSD': 1.1 });
assert(Math.abs(evalVal - 3300.0) < 1e-6, `Evaluates 3630 / 1.1 === 3300.0 (got ${evalVal})`);

const basisSpec = parseSyntheticFormula('SYNTH:GOLD_BASIS_TEST', 'XAUUSD - XAUUSDT');
registerSyntheticInstrument(basisSpec);
const basisBars = buildSyntheticBarsFromRealLegs(
  basisSpec,
  {
    'MT5:CFD:XAUUSD': [
      {
        ...realM1Sample[0],
        open_ticks: 362000, // $3,620.00 (scale 100)
        high_ticks: 362200,
        low_ticks: 361900,
        close_ticks: 362100, // $3,621.00
      },
    ],
    'BYBIT:LINEAR_PERP:XAUUSDT:PERP': [
      {
        ...realM1Sample[0],
        open_ticks: 363500, // $3,635.00 (scale 100)
        high_ticks: 363700,
        low_ticks: 363400,
        close_ticks: 363600, // $3,636.00
      },
    ],
  },
  60_000_000
);
assert(
  basisBars.length === 1 && basisBars[0].close_ticks < 0,
  `Multi-leg basis spread XAUUSD - XAUUSDT preserves negative spread ticks (${basisBars[0]?.close_ticks})`
);

// ---------------------------------------------------------------------------
// TEST 15: CME Globex Level-3 MBO (`GLBX.MDP3`) FIFO Queue, Iceberg & Stop-Sweep
// ---------------------------------------------------------------------------
console.log('\n--- TEST 15: CME Globex Level-3 MBO (GLBX.MDP3) FIFO Queue & Stop-Sweep ---');
const sampleGlbxNdjson = [
  '{"hd":{"ts_event":"1732450000000000000","rtype":160},"order_id":"5001","action":"A","side":"B","price":"5980000000000","size":12,"sequence":1}',
  '{"hd":{"ts_event":"1732450000000500000","rtype":160},"order_id":"5002","action":"A","side":"B","price":"5980000000000","size":30,"sequence":2}',
  '{"hd":{"ts_event":"1732450000001000000","rtype":160},"order_id":"5001","action":"M","side":"B","price":"5980000000000","size":18,"sequence":3}',
  '{"hd":{"ts_event":"1732450000001500000","rtype":160},"order_id":"6001","action":"A","side":"A","price":"5980250000000","size":10,"sequence":4}',
  '{"hd":{"ts_event":"1732450000002000000","rtype":160},"order_id":"0","action":"T","side":"B","price":"5980250000000","size":16,"sequence":5}',
  '{"hd":{"ts_event":"1732450000002000000","rtype":160},"order_id":"6001","action":"F","side":"A","price":"5980250000000","size":16,"sequence":6}',
  '{"hd":{"ts_event":"1732450000002500000","rtype":160},"order_id":"0","action":"T","side":"B","price":"5980500000000","size":8,"sequence":7}',
  '{"hd":{"ts_event":"1732450000003000000","rtype":160},"order_id":"0","action":"T","side":"B","price":"5980750000000","size":9,"sequence":8}',
].join('\n');

const cmeParsed = parseRealDatabentoMboCaptureText(sampleGlbxNdjson, 'CME:FUT:ES');
assert(cmeParsed.ok && cmeParsed.bestBidTicks === 598000, 'Parses CME ES 1e-9 fixed-point price 5980.00 -> 598000 ticks');
assert(
  cmeParsed.bids[0].totalContracts === 48 &&
    cmeParsed.bids[0].fifoQueue[0].orderIdTail === '5002' &&
    cmeParsed.bids[0].fifoQueue[1].orderIdTail === '5001',
  'Enforces CME Globex FIFO queue priority loss on order size increase (#5002 ahead of #5001)'
);
assert(
  cmeParsed.icebergs.length === 1 && cmeParsed.icebergs[0].hiddenVolumeUnits === 6,
  'Detects native CME Order-ID Iceberg replenishment (16 executed > 10 displayed => 6 hidden)'
);
assert(
  cmeParsed.stopSweeps.length === 1 && cmeParsed.stopSweeps[0].levelsSwept === 3,
  'Detects CME matching-engine 3-level Stop-Sweep burst within <= 5ms window'
);

console.log(`\n======================================================`);
console.log(`🎉 AUDIT COMPLETE: ${passedTests}/${totalTests} MATHEMATICAL INVARIANTS VERIFIED!`);
console.log(`======================================================\n`);
