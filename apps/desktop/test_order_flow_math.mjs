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
} from './src/utils/orderFlowMath.ts';

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

console.log(`\n======================================================`);
console.log(`🎉 AUDIT COMPLETE: ${passedTests}/${totalTests} MATHEMATICAL INVARIANTS VERIFIED!`);
console.log(`======================================================\n`);
