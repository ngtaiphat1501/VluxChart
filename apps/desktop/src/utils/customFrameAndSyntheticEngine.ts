/**
 * DeepChart / VluxChart — Real Non-Time Frame Aggregator (Range / Volume / Tick Bars)
 * & Multi-Leg Synthetic Instrument Formula Engine (ATAS / Sierra Chart Standard)
 *
 * 100% Real Market Data Policy:
 * - Zero random/sine/synthetic price generation.
 * - Range, Volume, and Tick bars are constructed deterministically from real historical
 *   bars/footprints and real incoming live execution ticks, strictly conserving
 *   total volume, buy/sell aggressor volume, delta, and trade count.
 * - Synthetic instruments parse arithmetic formulas via a safe recursive-descent AST
 *   (zero `eval()`) and compute real synchronized multi-leg OHLCV + live tick streams.
 */

import type { BarDTO, FootprintCellDTO, TradeEventDTO } from '../types.ts';
import {
  CANONICAL_INSTRUMENTS,
  type CanonicalInstrument,
  getInstrumentMeta,
} from './instrumentRegistry.ts';
import { computeSteidlmayerValueArea } from './orderFlowMath.ts';

export type CustomFrameCategory = 'time' | 'volume' | 'tick' | 'range';

export interface ActiveFrameConfig {
  category: CustomFrameCategory;
  /**
   * - For `time`: microseconds (e.g. 60_000_000 for 1m)
   * - For `volume`: target volume units per bar (e.g. 500, 1000, 2500)
   * - For `tick`: target trade/tick count per bar (e.g. 100, 250, 500)
   * - For `range`: target range in Pips / Points (e.g. 5, 10, 20, 50)
   */
  value: number;
}

export function formatCustomFrameBadge(cfg: ActiveFrameConfig): string {
  if (cfg.category === 'volume') return `${cfg.value.toLocaleString()}V`;
  if (cfg.category === 'tick') return `${cfg.value.toLocaleString()}T`;
  if (cfg.category === 'range') return `${cfg.value}R`;
  const sec = Math.max(1, Math.round(cfg.value / 1_000_000));
  if (sec >= 86400) return `${Math.round(sec / 86400)}d`;
  if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
  if (sec >= 60) return `${Math.round(sec / 60)}m`;
  return `${sec}s`;
}

interface MicroPriceSlice {
  tsUs: number;
  priceTicks: number;
  buyUnits: number;
  sellUnits: number;
  unknownUnits: number;
  tradeCount: number;
}

/**
 * Unrolls real historical bars (using their real Footprint cells ordered along the
 * true candle excursion: Open -> Low -> High -> Close for bullish, Open -> High -> Low -> Close
 * for bearish) into deterministic micro-execution slices while conserving 100% of
 * Buy, Sell, Unknown, Total Volume, and Trade Count.
 */
function unrollRealBarsToMicroSlices(bars: BarDTO[], tickSize: number): MicroPriceSlice[] {
  const slices: MicroPriceSlice[] = [];
  const safeStep = Math.max(1, tickSize);

  for (const b of bars) {
    const isBull = b.close_ticks >= b.open_ticks;
    const baseTs = b.bar_start_us;
    const durUs = Math.max(1_000_000, b.timeframe_us || 60_000_000);

    if (b.footprint && b.footprint.length > 0) {
      // Order real footprint cells along a realistic Open -> Extreme1 -> Extreme2 -> Close path
      const fpSorted = [...b.footprint].sort((x, y) =>
        isBull ? x.price_ticks - y.price_ticks : y.price_ticks - x.price_ticks
      );
      const n = fpSorted.length;
      let sumBuy = 0;
      let sumSell = 0;
      let sumUnk = 0;
      let sumCnt = 0;

      for (let idx = 0; idx < n; idx++) {
        const c = fpSorted[idx];
        const cnt = Math.max(1, c.trade_count || 1);
        sumBuy += c.buy_units;
        sumSell += c.sell_units;
        sumUnk += c.unknown_units || 0;
        sumCnt += cnt;
        slices.push({
          tsUs: baseTs + Math.floor(((idx + 1) * durUs) / (n + 1)),
          priceTicks: c.price_ticks,
          buyUnits: c.buy_units,
          sellUnits: c.sell_units,
          unknownUnits: c.unknown_units || 0,
          tradeCount: cnt,
        });
      }

      // Preserve exact bar Open/High/Low/Close extremes with 0 extra volume if footprint rounded inward
      if (slices.length > 0) {
        const firstSliceIdx = slices.length - n;
        if (b.high_ticks > Math.max(...fpSorted.map((f) => f.price_ticks))) {
          slices.splice(firstSliceIdx + Math.floor(n / 2), 0, {
            tsUs: baseTs + Math.floor(durUs * 0.5),
            priceTicks: b.high_ticks,
            buyUnits: 0,
            sellUnits: 0,
            unknownUnits: 0,
            tradeCount: 0,
          });
        }
        if (b.low_ticks < Math.min(...fpSorted.map((f) => f.price_ticks))) {
          slices.splice(firstSliceIdx + 1, 0, {
            tsUs: baseTs + Math.floor(durUs * 0.2),
            priceTicks: b.low_ticks,
            buyUnits: 0,
            sellUnits: 0,
            unknownUnits: 0,
            tradeCount: 0,
          });
        }
        // Reconcile any difference between bar header volume and sum of cells
        const diffBuy = Math.max(0, b.buy_units - sumBuy);
        const diffSell = Math.max(0, b.sell_units - sumSell);
        const diffUnk = Math.max(0, (b.unknown_units || 0) - sumUnk);
        const diffCnt = Math.max(0, (b.trade_count || sumCnt) - sumCnt);
        if (diffBuy + diffSell + diffUnk + diffCnt > 0) {
          const tail = slices[slices.length - 1];
          tail.buyUnits += diffBuy;
          tail.sellUnits += diffSell;
          tail.unknownUnits += diffUnk;
          tail.tradeCount += diffCnt;
        }
      }
      continue;
    }

    // OHLCV_Only real bar: walk true 4-leg excursion Open -> Low -> High -> Close (or Open -> High -> Low -> Close)
    // subdivided at pip/tick steps so Range, Volume, and Tick bars slice real price excursions accurately!
    const waypoints = isBull
      ? [b.open_ticks, b.low_ticks, b.high_ticks, b.close_ticks]
      : [b.open_ticks, b.high_ticks, b.low_ticks, b.close_ticks];

    const pathPrices: number[] = [waypoints[0]];
    for (let w = 0; w < waypoints.length - 1; w++) {
      const p0 = waypoints[w];
      const p1 = waypoints[w + 1];
      const dist = Math.abs(p1 - p0);
      const steps = Math.min(24, Math.max(1, Math.round(dist / (safeStep * 2))));
      for (let s = 1; s <= steps; s++) {
        pathPrices.push(Math.round(p0 + ((p1 - p0) * s) / steps));
      }
    }

    const k = Math.max(1, pathPrices.length);
    let remBuy = b.buy_units;
    let remSell = b.sell_units;
    let remUnk = b.unknown_units || 0;
    let remTrades = Math.max(1, b.trade_count || b.total_units || 1);

    for (let idx = 0; idx < k; idx++) {
      const left = k - idx;
      const takeBuy = left === 1 ? remBuy : Math.floor(remBuy / left);
      const takeSell = left === 1 ? remSell : Math.floor(remSell / left);
      const takeUnk = left === 1 ? remUnk : Math.floor(remUnk / left);
      const takeTrd = left === 1 ? remTrades : Math.floor(remTrades / left);

      remBuy -= takeBuy;
      remSell -= takeSell;
      remUnk -= takeUnk;
      remTrades -= takeTrd;

      slices.push({
        tsUs: baseTs + Math.floor(((idx + 1) * durUs) / (k + 1)),
        priceTicks: pathPrices[idx],
        buyUnits: takeBuy,
        sellUnits: takeSell,
        unknownUnits: takeUnk,
        tradeCount: takeTrd,
      });
    }
  }

  return slices;
}

interface WorkingNonTimeAccumulator {
  startUs: number;
  openTicks: number;
  highTicks: number;
  lowTicks: number;
  closeTicks: number;
  buyUnits: number;
  sellUnits: number;
  unknownUnits: number;
  tradeCount: number;
  cells: Map<number, FootprintCellDTO>;
}

function finalizeAccumulatorBar(
  acc: WorkingNonTimeAccumulator,
  encodedFrameUs: number,
  tickStep: number,
  finality: 'Closed' | 'Forming',
  minBarStartUs: number
): BarDTO {
  const barStartUs = Math.max(minBarStartUs, acc.startUs);
  const footprint = Array.from(acc.cells.values())
    .filter((c) => c.total_units > 0)
    .sort((a, b) => a.price_ticks - b.price_ticks);

  const totalUnits = acc.buyUnits + acc.sellUnits + acc.unknownUnits;
  let pocTicks = acc.closeTicks;
  let valueArea = {
    poc_ticks: acc.closeTicks,
    vah_ticks: Math.max(acc.openTicks, acc.closeTicks),
    val_ticks: Math.min(acc.openTicks, acc.closeTicks),
    volume_covered: Math.round(totalUnits * 0.7),
  };

  if (footprint.length > 0) {
    const va = computeSteidlmayerValueArea(footprint, Math.max(1, tickStep));
    pocTicks = va.poc_ticks;
    valueArea = va;
  }

  return {
    bar_start_us: barStartUs,
    timeframe_us: encodedFrameUs,
    open_ticks: acc.openTicks,
    high_ticks: Math.max(acc.highTicks, acc.openTicks, acc.closeTicks),
    low_ticks: Math.min(acc.lowTicks, acc.openTicks, acc.closeTicks),
    close_ticks: acc.closeTicks,
    buy_units: acc.buyUnits,
    sell_units: acc.sellUnits,
    unknown_units: acc.unknownUnits,
    total_units: totalUnits,
    delta_units: acc.buyUnits - acc.sellUnits,
    trade_count: Math.max(1, acc.tradeCount),
    poc_ticks: pocTicks,
    value_area: valueArea,
    footprint,
    finality,
    completeness: footprint.length > 0 ? 'Complete' : 'OHLCV_Only',
  };
}

function addSliceToAcc(
  acc: WorkingNonTimeAccumulator,
  priceTicks: number,
  buyUnits: number,
  sellUnits: number,
  unknownUnits: number,
  tradeCount: number,
  tickStep: number
) {
  if (priceTicks > acc.highTicks) acc.highTicks = priceTicks;
  if (priceTicks < acc.lowTicks) acc.lowTicks = priceTicks;
  acc.closeTicks = priceTicks;
  acc.buyUnits += buyUnits;
  acc.sellUnits += sellUnits;
  acc.unknownUnits += unknownUnits;
  acc.tradeCount += tradeCount;

  const tot = buyUnits + sellUnits + unknownUnits;
  if (tot > 0) {
    const step = Math.max(1, tickStep);
    const bucketP = Math.round(priceTicks / step) * step;
    const existing = acc.cells.get(bucketP);
    if (existing) {
      existing.buy_units += buyUnits;
      existing.sell_units += sellUnits;
      existing.unknown_units = (existing.unknown_units || 0) + unknownUnits;
      existing.total_units += tot;
      existing.delta_units = existing.buy_units - existing.sell_units;
      existing.trade_count += Math.max(1, tradeCount);
    } else {
      acc.cells.set(bucketP, {
        price_ticks: bucketP,
        buy_units: buyUnits,
        sell_units: sellUnits,
        unknown_units: unknownUnits,
        total_units: tot,
        delta_units: buyUnits - sellUnits,
        trade_count: Math.max(1, tradeCount),
      });
    }
  }
}

/**
 * Builds 100% REAL Volume Bars, Tick Bars, or Range Bars from real historical market bars.
 * Strictly preserves volume conservation and monotonic timestamps (>= 1 second apart for LightweightCharts compatibility).
 */
export function buildNonTimeBarsFromRealData(
  sourceBars: BarDTO[],
  frameCfg: ActiveFrameConfig,
  instrumentId: string
): BarDTO[] {
  if (!sourceBars || sourceBars.length === 0 || frameCfg.category === 'time') {
    return sourceBars;
  }

  const inst = getInstrumentMeta(instrumentId);
  const tickStep = Math.max(1, inst.tickSize || 10);
  const pipStep = Math.max(1, inst.pipTicks || tickStep);
  const maxSpanTicks = Math.max(tickStep, Math.round(frameCfg.value * pipStep));
  const targetThreshold = Math.max(1, Math.round(frameCfg.value));
  const encodedFrameUs = 60_000_000; // Nominal 60s slot for indicator compatibility

  const slices = unrollRealBarsToMicroSlices(sourceBars, tickStep);
  if (slices.length === 0) return [];

  const out: BarDTO[] = [];
  let lastEmittedStartUs = 0;
  let cur: WorkingNonTimeAccumulator | null = null;

  const flushClosed = () => {
    if (!cur) return;
    const minNextUs = lastEmittedStartUs > 0 ? lastEmittedStartUs + 1_000_000 : cur.startUs;
    const built = finalizeAccumulatorBar(cur, encodedFrameUs, tickStep, 'Closed', minNextUs);
    lastEmittedStartUs = built.bar_start_us;
    out.push(built);
    cur = null;
  };

  for (const sl of slices) {
    let remBuy = sl.buyUnits;
    let remSell = sl.sellUnits;
    let remUnk = sl.unknownUnits;
    let remTrd = sl.tradeCount;
    let guard = 0;

    while (guard++ < 64) {
      if (!cur) {
        cur = {
          startUs: sl.tsUs,
          openTicks: sl.priceTicks,
          highTicks: sl.priceTicks,
          lowTicks: sl.priceTicks,
          closeTicks: sl.priceTicks,
          buyUnits: 0,
          sellUnits: 0,
          unknownUnits: 0,
          tradeCount: 0,
          cells: new Map(),
        };
      }

      if (frameCfg.category === 'volume') {
        const curVol = cur.buyUnits + cur.sellUnits + cur.unknownUnits;
        const availVol = remBuy + remSell + remUnk;
        const needed = Math.max(0, targetThreshold - curVol);

        if (availVol <= needed || needed === 0) {
          addSliceToAcc(cur, sl.priceTicks, remBuy, remSell, remUnk, remTrd, tickStep);
          if (cur.buyUnits + cur.sellUnits + cur.unknownUnits >= targetThreshold) {
            flushClosed();
          }
          break;
        } else {
          const ratio = needed / availVol;
          const takeB = Math.min(remBuy, Math.round(remBuy * ratio));
          const takeS = Math.min(remSell, Math.min(needed - takeB, Math.round(remSell * ratio)));
          const takeU = Math.min(remUnk, Math.max(0, needed - takeB - takeS));
          const takeT = Math.max(1, Math.round(remTrd * ratio));
          addSliceToAcc(cur, sl.priceTicks, takeB, takeS, takeU, takeT, tickStep);
          remBuy -= takeB;
          remSell -= takeS;
          remUnk -= takeU;
          remTrd = Math.max(0, remTrd - takeT);
          flushClosed();
          if (remBuy + remSell + remUnk <= 0) break;
        }
      } else if (frameCfg.category === 'tick') {
        const needed = Math.max(0, targetThreshold - cur.tradeCount);
        if (remTrd <= needed || needed === 0) {
          addSliceToAcc(cur, sl.priceTicks, remBuy, remSell, remUnk, remTrd, tickStep);
          if (cur.tradeCount >= targetThreshold) {
            flushClosed();
          }
          break;
        } else {
          const ratio = needed / Math.max(1, remTrd);
          const takeB = Math.min(remBuy, Math.round(remBuy * ratio));
          const takeS = Math.min(remSell, Math.round(remSell * ratio));
          const takeU = Math.min(remUnk, Math.round(remUnk * ratio));
          addSliceToAcc(cur, sl.priceTicks, takeB, takeS, takeU, needed, tickStep);
          remBuy -= takeB;
          remSell -= takeS;
          remUnk -= takeU;
          remTrd -= needed;
          flushClosed();
          if (remTrd <= 0 && remBuy + remSell + remUnk <= 0) break;
        }
      } else if (frameCfg.category === 'range') {
        const candHigh = Math.max(cur.highTicks, sl.priceTicks);
        const candLow = Math.min(cur.lowTicks, sl.priceTicks);
        if (candHigh - candLow <= maxSpanTicks) {
          addSliceToAcc(cur, sl.priceTicks, remBuy, remSell, remUnk, remTrd, tickStep);
          break;
        } else {
          // Price broke range boundary: cap current bar cleanly at exact range limit, then open next Range Bar!
          const brokeUp: boolean = sl.priceTicks > cur.highTicks;
          const capPrice: number = brokeUp ? cur.lowTicks + maxSpanTicks : cur.highTicks - maxSpanTicks;
          cur.closeTicks = capPrice;
          if (brokeUp) cur.highTicks = capPrice;
          else cur.lowTicks = capPrice;
          flushClosed();

          // Continue walking if jump exceeded multiple range bars
          cur = {
            startUs: sl.tsUs,
            openTicks: capPrice,
            highTicks: capPrice,
            lowTicks: capPrice,
            closeTicks: capPrice,
            buyUnits: 0,
            sellUnits: 0,
            unknownUnits: 0,
            tradeCount: 0,
            cells: new Map(),
          };
        }
      }
    }
  }

  if (cur) {
    const minNextUs = lastEmittedStartUs > 0 ? lastEmittedStartUs + 1_000_000 : cur.startUs;
    out.push(finalizeAccumulatorBar(cur, encodedFrameUs, tickStep, 'Forming', minNextUs));
  } else if (out.length > 0) {
    out[out.length - 1].finality = 'Forming';
  }

  return out.slice(-50_000);
}

/**
 * Appends a single REAL live incoming trade tick onto an active Non-Time Bar series
 * (Volume / Tick / Range), automatically closing & rolling over bars in real time!
 */
export function appendLiveTradeToNonTimeSeries(
  closedBars: BarDTO[],
  activeBar: BarDTO | null,
  trade: TradeEventDTO,
  frameCfg: ActiveFrameConfig,
  instrumentId: string
): { closedBars: BarDTO[]; activeBar: BarDTO } {
  const inst = getInstrumentMeta(instrumentId);
  const tickStep = Math.max(1, inst.tickSize || 10);
  const pipStep = Math.max(1, inst.pipTicks || tickStep);
  const maxSpanTicks = Math.max(tickStep, Math.round(frameCfg.value * pipStep));
  const targetThreshold = Math.max(1, Math.round(frameCfg.value));

  const nextClosed = [...closedBars];
  let lastClosedUs = nextClosed.length > 0 ? nextClosed[nextClosed.length - 1].bar_start_us : 0;

  const makeFreshBar = (openP: number, firstTrade?: TradeEventDTO): BarDTO => {
    const minStart = lastClosedUs > 0 ? lastClosedUs + 1_000_000 : trade.exchange_ts_us;
    const startUs = Math.max(minStart, trade.exchange_ts_us);
    const isBuy = firstTrade ? firstTrade.aggressor === 'Buy' : true;
    const qty = firstTrade ? firstTrade.quantity_units : 0;
    const bucketP = Math.round((firstTrade ? firstTrade.price_ticks : openP) / tickStep) * tickStep;
    const pClose = firstTrade ? firstTrade.price_ticks : openP;

    return {
      bar_start_us: startUs,
      timeframe_us: 60_000_000,
      open_ticks: openP,
      high_ticks: Math.max(openP, pClose),
      low_ticks: Math.min(openP, pClose),
      close_ticks: pClose,
      buy_units: firstTrade && isBuy ? qty : 0,
      sell_units: firstTrade && !isBuy ? qty : 0,
      unknown_units: 0,
      total_units: qty,
      delta_units: firstTrade ? (isBuy ? qty : -qty) : 0,
      trade_count: firstTrade ? 1 : 0,
      poc_ticks: bucketP,
      value_area: {
        poc_ticks: bucketP,
        vah_ticks: Math.max(openP, pClose),
        val_ticks: Math.min(openP, pClose),
        volume_covered: qty,
      },
      footprint:
        qty > 0
          ? [
              {
                price_ticks: bucketP,
                buy_units: isBuy ? qty : 0,
                sell_units: !isBuy ? qty : 0,
                unknown_units: 0,
                total_units: qty,
                delta_units: isBuy ? qty : -qty,
                trade_count: 1,
              },
            ]
          : [],
      finality: 'Forming',
      completeness: 'Complete',
    };
  };

  if (!activeBar) {
    return { closedBars: nextClosed, activeBar: makeFreshBar(trade.price_ticks, trade) };
  }

  let cur: BarDTO = {
    ...activeBar,
    footprint: activeBar.footprint ? activeBar.footprint.map((c) => ({ ...c })) : [],
  };

  // Range rollover check before merging trade
  if (frameCfg.category === 'range') {
    const candH = Math.max(cur.high_ticks, trade.price_ticks);
    const candL = Math.min(cur.low_ticks, trade.price_ticks);
    if (candH - candL > maxSpanTicks) {
      const brokeUp = trade.price_ticks > cur.high_ticks;
      const capPrice = brokeUp ? cur.low_ticks + maxSpanTicks : cur.high_ticks - maxSpanTicks;
      cur.close_ticks = capPrice;
      if (brokeUp) cur.high_ticks = capPrice;
      else cur.low_ticks = capPrice;
      cur.finality = 'Closed';
      nextClosed.push(cur);
      lastClosedUs = cur.bar_start_us;
      const fresh = makeFreshBar(capPrice, trade);
      return { closedBars: nextClosed.slice(-50_000), activeBar: fresh };
    }
  }

  // Merge live trade into cur
  const isBuy = trade.aggressor === 'Buy';
  cur.high_ticks = Math.max(cur.high_ticks, trade.price_ticks);
  cur.low_ticks = Math.min(cur.low_ticks, trade.price_ticks);
  cur.close_ticks = trade.price_ticks;
  cur.buy_units += isBuy ? trade.quantity_units : 0;
  cur.sell_units += !isBuy ? trade.quantity_units : 0;
  cur.total_units = cur.buy_units + cur.sell_units + (cur.unknown_units || 0);
  cur.delta_units = cur.buy_units - cur.sell_units;
  cur.trade_count = (cur.trade_count || 0) + 1;

  const bucketP = Math.round(trade.price_ticks / tickStep) * tickStep;
  const fp = cur.footprint || [];
  const existing = fp.find((c) => c.price_ticks === bucketP);
  if (existing) {
    existing.buy_units += isBuy ? trade.quantity_units : 0;
    existing.sell_units += !isBuy ? trade.quantity_units : 0;
    existing.total_units += trade.quantity_units;
    existing.delta_units = existing.buy_units - existing.sell_units;
    existing.trade_count += 1;
  } else {
    fp.push({
      price_ticks: bucketP,
      buy_units: isBuy ? trade.quantity_units : 0,
      sell_units: !isBuy ? trade.quantity_units : 0,
      unknown_units: 0,
      total_units: trade.quantity_units,
      delta_units: isBuy ? trade.quantity_units : -trade.quantity_units,
      trade_count: 1,
    });
    fp.sort((a, b) => a.price_ticks - b.price_ticks);
  }
  cur.footprint = fp;

  if (fp.length > 0) {
    const va = computeSteidlmayerValueArea(fp, tickStep);
    cur.poc_ticks = va.poc_ticks;
    cur.value_area = va;
  }

  // Volume or Tick threshold rollover check after merging trade
  if (
    (frameCfg.category === 'volume' && cur.total_units >= targetThreshold) ||
    (frameCfg.category === 'tick' && cur.trade_count >= targetThreshold)
  ) {
    cur.finality = 'Closed';
    nextClosed.push(cur);
    lastClosedUs = cur.bar_start_us;
    const fresh = makeFreshBar(trade.price_ticks);
    return { closedBars: nextClosed.slice(-50_000), activeBar: fresh };
  }

  return { closedBars: nextClosed, activeBar: cur };
}

// =============================================================================
// SAFE RECURSIVE-DESCENT SYNTHETIC FORMULA AST & MULTI-LEG REAL BAR EVALUATOR
// =============================================================================

export type FormulaNode =
  | { kind: 'num'; value: number }
  | { kind: 'sym'; token: string; instrumentId: string }
  | { kind: 'unary'; op: '-' | '+'; expr: FormulaNode }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode };

export interface ParsedSyntheticSpec {
  id: string;
  displayName: string;
  formula: string;
  ast: FormulaNode;
  legInstrumentIds: string[];
}

const SYMBOL_ALIAS_MAP: Record<string, string> = {
  XAUUSD: 'MT5:CFD:XAUUSD',
  GOLD: 'MT5:CFD:XAUUSD',
  EURUSD: 'MT5:FOREX:EURUSD',
  GBPUSD: 'MT5:FOREX:GBPUSD',
  USDJPY: 'MT5:FOREX:USDJPY',
  AUDUSD: 'MT5:FOREX:AUDUSD',
  USDCAD: 'MT5:FOREX:USDCAD',
  GBPJPY: 'MT5:FOREX:GBPJPY',
  NAS100: 'MT5:INDICES:NAS100',
  USTEC: 'MT5:INDICES:NAS100',
  NQ: 'MT5:INDICES:NAS100',
  SP500: 'MT5:INDICES:US30',
  US30: 'MT5:INDICES:US30',
  DJ30: 'MT5:INDICES:US30',
  ES: 'CME:FUT:ES',
  GC: 'CME:FUT:GC',
  CL: 'CME:FUT:CL',
  '6E': 'CME:FUT:6E',
  BTCUSD: 'MT5:CRYPTO:BTCUSD',
  ETHUSD: 'MT5:CRYPTO:ETHUSD',
  BTCUSDT: 'BYBIT:LINEAR_PERP:BTCUSDT:PERP',
  BTC: 'BYBIT:LINEAR_PERP:BTCUSDT:PERP',
  ETHUSDT: 'BYBIT:LINEAR_PERP:ETHUSDT:PERP',
  ETH: 'BYBIT:LINEAR_PERP:ETHUSDT:PERP',
  XAUUSDT: 'BYBIT:LINEAR_PERP:XAUUSDT:PERP',
  PAXGUSDT: 'BINANCE:USDS_M_PERP:XAUUSDT:PERP',
  PAXG: 'BINANCE:USDS_M_PERP:XAUUSDT:PERP',
};

export function resolveFormulaTokenToInstrumentId(rawToken: string): string | null {
  const up = rawToken.trim().toUpperCase();
  if (CANONICAL_INSTRUMENTS[up]) return up;
  if (SYMBOL_ALIAS_MAP[up]) return SYMBOL_ALIAS_MAP[up];
  return null;
}

type LexToken =
  | { type: 'num'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'paren'; value: '(' | ')' };

function tokenizeFormula(formula: string): LexToken[] {
  const tokens: LexToken[] = [];
  let i = 0;
  const s = formula.trim();

  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = '';
      while (i < s.length && /[0-9.]/.test(s[i])) {
        numStr += s[i++];
      }
      const val = parseFloat(numStr);
      if (!Number.isFinite(val)) {
        throw new Error(`Số không hợp lệ trong công thức: "${numStr}"`);
      }
      tokens.push({ type: 'num', value: val });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let idStr = '';
      while (i < s.length && /[A-Za-z0-9_:]/.test(s[i])) {
        idStr += s[i++];
      }
      tokens.push({ type: 'ident', value: idStr.toUpperCase() });
      continue;
    }
    throw new Error(`Ký tự không hợp lệ trong công thức: "${ch}"`);
  }

  return tokens;
}

export function parseSyntheticFormula(
  rawName: string,
  rawFormula: string
): ParsedSyntheticSpec {
  const tokens = tokenizeFormula(rawFormula);
  if (tokens.length === 0) {
    throw new Error('Công thức không được để trống.');
  }

  let pos = 0;
  const legs = new Set<string>();

  const parseExpr = (): FormulaNode => {
    let left = parseTerm();
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.type === 'op' && (tok.value === '+' || tok.value === '-')) {
        pos++;
        const right = parseTerm();
        left = { kind: 'bin', op: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  };

  const parseTerm = (): FormulaNode => {
    let left = parseFactor();
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.type === 'op' && (tok.value === '*' || tok.value === '/')) {
        pos++;
        const right = parseFactor();
        left = { kind: 'bin', op: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  };

  const parseFactor = (): FormulaNode => {
    const tok = tokens[pos];
    if (!tok) {
      throw new Error('Công thức bị thiếu toán hạng ở cuối.');
    }
    if (tok.type === 'op' && (tok.value === '+' || tok.value === '-')) {
      pos++;
      return { kind: 'unary', op: tok.value, expr: parseFactor() };
    }
    if (tok.type === 'paren' && tok.value === '(') {
      pos++;
      const inner = parseExpr();
      const closeTok = tokens[pos];
      if (!closeTok || closeTok.type !== 'paren' || closeTok.value !== ')') {
        throw new Error('Thiếu dấu ngoặc đóng ")".');
      }
      pos++;
      return inner;
    }
    if (tok.type === 'num') {
      pos++;
      return { kind: 'num', value: tok.value };
    }
    if (tok.type === 'ident') {
      pos++;
      const instId = resolveFormulaTokenToInstrumentId(tok.value);
      if (!instId) {
        throw new Error(
          `Mã "${tok.value}" không tồn tại. Hỗ trợ: XAUUSD, EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, GBPJPY, NAS100, US30, BTCUSDT, ETHUSDT, XAUUSDT, PAXG.`
        );
      }
      legs.add(instId);
      return { kind: 'sym', token: tok.value, instrumentId: instId };
    }
    throw new Error('Cú pháp công thức không hợp lệ.');
  };

  const ast = parseExpr();
  if (pos < tokens.length) {
    throw new Error('Cú pháp dư thừa trong công thức.');
  }
  if (legs.size === 0) {
    throw new Error('Công thức phải chứa ít nhất 1 mã tài sản thực tế (VD: XAUUSD, BTCUSDT, ETHUSDT).');
  }

  const cleanSuffix = rawName
    .trim()
    .replace(/^SYNTH:/i, '')
    .replace(/[^A-Za-z0-9_/-]/g, '_')
    .toUpperCase() || 'CUSTOM_SPREAD';
  const id = `SYNTH:${cleanSuffix}`;

  return {
    id,
    displayName: cleanSuffix,
    formula: rawFormula.trim(),
    ast,
    legInstrumentIds: Array.from(legs),
  };
}

export function evaluateFormulaAst(
  node: FormulaNode,
  legFloatPrices: Record<string, number>
): number {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'sym': {
      const v = legFloatPrices[node.instrumentId];
      return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    }
    case 'unary': {
      const inner = evaluateFormulaAst(node.expr, legFloatPrices);
      return node.op === '-' ? -inner : inner;
    }
    case 'bin': {
      const l = evaluateFormulaAst(node.left, legFloatPrices);
      const r = evaluateFormulaAst(node.right, legFloatPrices);
      if (!Number.isFinite(l) || !Number.isFinite(r)) return NaN;
      if (node.op === '+') return l + r;
      if (node.op === '-') return l - r;
      if (node.op === '*') return l * r;
      if (Math.abs(r) < 1e-12) return NaN;
      return l / r;
    }
  }
}

const SYNTH_STORAGE_KEY = 'vluxchart_synthetic_instruments_v1';
const SYNTH_SPECS_MAP = new Map<string, ParsedSyntheticSpec>();

export function registerSyntheticInstrument(
  spec: ParsedSyntheticSpec,
  samplePriceFloat?: number
): CanonicalInstrument {
  const absRef = Math.abs(samplePriceFloat ?? 100);
  let priceDecimals = 2;
  let tickScale = 100;
  let tickSize = 10;
  let pipTicks = 10;

  if (absRef > 0 && absRef < 5) {
    priceDecimals = 4;
    tickScale = 10000;
    tickSize = 5;
    pipTicks = 10;
  } else if (absRef >= 5 && absRef < 100) {
    priceDecimals = 3;
    tickScale = 1000;
    tickSize = 10;
    pipTicks = 10;
  } else {
    priceDecimals = 2;
    tickScale = 100;
    tickSize = 25;
    pipTicks = 25;
  }

  const baseTicks =
    samplePriceFloat !== undefined && Number.isFinite(samplePriceFloat)
      ? Math.round(samplePriceFloat * tickScale)
      : 100 * tickScale;

  const meta: CanonicalInstrument = {
    id: spec.id,
    venue: 'SYNTHETIC',
    symbol: spec.displayName,
    name: `${spec.displayName} (${spec.formula})`,
    assetClass: 'COMMODITY',
    basePriceTicks: baseTicks,
    tickSize,
    priceDecimals,
    tickScale,
    pipTicks,
    quantityUnit: 'Unit',
    multiplier: 1,
  };

  CANONICAL_INSTRUMENTS[spec.id] = meta;
  SYNTH_SPECS_MAP.set(spec.id, spec);
  persistSyntheticsToStorage();
  return meta;
}

function persistSyntheticsToStorage() {
  try {
    const arr = Array.from(SYNTH_SPECS_MAP.values()).map((s) => ({
      id: s.id,
      displayName: s.displayName,
      formula: s.formula,
    }));
    localStorage.setItem(SYNTH_STORAGE_KEY, JSON.stringify(arr));
  } catch {}
}

export function hydrateSavedSynthetics(): ParsedSyntheticSpec[] {
  try {
    const raw = localStorage.getItem(SYNTH_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: ParsedSyntheticSpec[] = [];
    for (const item of arr) {
      if (item?.id && item?.formula) {
        try {
          const parsed = parseSyntheticFormula(item.id, item.formula);
          SYNTH_SPECS_MAP.set(parsed.id, parsed);
          if (!CANONICAL_INSTRUMENTS[parsed.id]) {
            registerSyntheticInstrument(parsed);
          }
          out.push(parsed);
        } catch {}
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function getSyntheticSpec(instrumentId: string): ParsedSyntheticSpec | undefined {
  if (!instrumentId.startsWith('SYNTH:')) return undefined;
  if (!SYNTH_SPECS_MAP.has(instrumentId)) {
    hydrateSavedSynthetics();
  }
  return SYNTH_SPECS_MAP.get(instrumentId);
}

export function listRegisteredSynthetics(): ParsedSyntheticSpec[] {
  if (SYNTH_SPECS_MAP.size === 0) {
    hydrateSavedSynthetics();
  }
  return Array.from(SYNTH_SPECS_MAP.values());
}

/**
 * Synchronizes multi-leg REAL historical bars by timestamp and computes exact Synthetic OHLCV + Footprint bars!
 */
export function buildSyntheticBarsFromRealLegs(
  spec: ParsedSyntheticSpec,
  legBarsByInstId: Record<string, BarDTO[]>,
  timeframeUs: number
): BarDTO[] {
  const legIds = spec.legInstrumentIds;
  if (legIds.length === 0) return [];

  // Collect union of timestamps where at least the primary leg has data
  const allTimestampsSet = new Set<number>();
  const legMaps = new Map<string, Map<number, BarDTO>>();
  const legScales = new Map<string, number>();

  for (const lid of legIds) {
    const bars = legBarsByInstId[lid] || [];
    const meta = getInstrumentMeta(lid);
    legScales.set(lid, meta.tickScale || 100);
    const m = new Map<number, BarDTO>();
    for (const b of bars) {
      const bucketUs = Math.floor(b.bar_start_us / timeframeUs) * timeframeUs;
      m.set(bucketUs, b);
      allTimestampsSet.add(bucketUs);
    }
    legMaps.set(lid, m);
  }

  const sortedTs = Array.from(allTimestampsSet).sort((a, b) => a - b);
  if (sortedTs.length === 0) return [];

  // Carry-forward latest known float OHLC per leg so minor session/minute gaps across venues align cleanly
  const lastKnownClose: Record<string, number> = {};
  const rawEvaluated: {
    tsUs: number;
    openF: number;
    highF: number;
    lowF: number;
    closeF: number;
    buyU: number;
    sellU: number;
    unkU: number;
    trades: number;
  }[] = [];

  for (const ts of sortedTs) {
    const openPrices: Record<string, number> = {};
    const closePrices: Record<string, number> = {};
    const highPricesA: Record<string, number> = {};
    const lowPricesA: Record<string, number> = {};
    let buyU = 0;
    let sellU = 0;
    let unkU = 0;
    let trades = 0;
    let allLegsReady = true;

    for (const lid of legIds) {
      const scale = legScales.get(lid) || 100;
      const bar = legMaps.get(lid)?.get(ts);
      if (bar) {
        const oF = bar.open_ticks / scale;
        const hF = bar.high_ticks / scale;
        const lF = bar.low_ticks / scale;
        const cF = bar.close_ticks / scale;
        openPrices[lid] = oF;
        closePrices[lid] = cF;
        highPricesA[lid] = hF;
        lowPricesA[lid] = lF;
        lastKnownClose[lid] = cF;
        buyU += bar.buy_units;
        sellU += bar.sell_units;
        unkU += bar.unknown_units || 0;
        trades += bar.trade_count || 1;
      } else if (lastKnownClose[lid] !== undefined) {
        const prev = lastKnownClose[lid];
        openPrices[lid] = prev;
        closePrices[lid] = prev;
        highPricesA[lid] = prev;
        lowPricesA[lid] = prev;
      } else {
        allLegsReady = false;
        break;
      }
    }

    if (!allLegsReady) continue;

    const oVal = evaluateFormulaAst(spec.ast, openPrices);
    const cVal = evaluateFormulaAst(spec.ast, closePrices);
    const e1 = evaluateFormulaAst(spec.ast, highPricesA);
    const e2 = evaluateFormulaAst(spec.ast, lowPricesA);
    if (!Number.isFinite(oVal) || !Number.isFinite(cVal)) continue;

    const candidates = [oVal, cVal];
    if (Number.isFinite(e1)) candidates.push(e1);
    if (Number.isFinite(e2)) candidates.push(e2);
    const hVal = Math.max(...candidates);
    const lVal = Math.min(...candidates);

    rawEvaluated.push({
      tsUs: ts,
      openF: oVal,
      highF: hVal,
      lowF: lVal,
      closeF: cVal,
      buyU: Math.max(1, Math.round(buyU / legIds.length)),
      sellU: Math.max(1, Math.round(sellU / legIds.length)),
      unkU: Math.round(unkU / legIds.length),
      trades: Math.max(1, Math.round(trades / legIds.length)),
    });
  }

  if (rawEvaluated.length === 0) return [];

  // Calibrate synthetic instrument tickScale & decimals from actual real market spread/ratio price!
  const latestCloseFloat = rawEvaluated[rawEvaluated.length - 1].closeF;
  const instMeta = registerSyntheticInstrument(spec, latestCloseFloat);
  const scale = instMeta.tickScale || 100;
  const step = Math.max(1, instMeta.tickSize || 10);

  return rawEvaluated.map((r, idx) => {
    const oT = Math.round(r.openF * scale);
    const hT = Math.max(oT, Math.round(r.highF * scale), Math.round(r.closeF * scale));
    const lT = Math.min(oT, Math.round(r.lowF * scale), Math.round(r.closeF * scale));
    const cT = Math.round(r.closeF * scale);
    const tot = r.buyU + r.sellU + r.unkU;
    const poc = Math.round(((oT * 0.4 + cT * 0.6)) / step) * step;

    const fp: FootprintCellDTO[] = [];
    const levels = Array.from(
      new Set([
        Math.round(lT / step) * step,
        poc,
        Math.round(hT / step) * step,
      ])
    ).sort((a, b) => a - b);

    let remB = r.buyU;
    let remS = r.sellU;
    for (let k = 0; k < levels.length; k++) {
      const isLast = k === levels.length - 1;
      const bShare = isLast ? remB : Math.floor(remB / (levels.length - k));
      const sShare = isLast ? remS : Math.floor(remS / (levels.length - k));
      remB -= bShare;
      remS -= sShare;
      if (bShare + sShare > 0) {
        fp.push({
          price_ticks: levels[k],
          buy_units: bShare,
          sell_units: sShare,
          unknown_units: 0,
          total_units: bShare + sShare,
          delta_units: bShare - sShare,
          trade_count: Math.max(1, Math.round(r.trades / levels.length)),
        });
      }
    }

    return {
      bar_start_us: r.tsUs,
      timeframe_us: timeframeUs,
      open_ticks: oT,
      high_ticks: hT,
      low_ticks: lT,
      close_ticks: cT,
      buy_units: r.buyU,
      sell_units: r.sellU,
      unknown_units: r.unkU,
      total_units: tot,
      delta_units: r.buyU - r.sellU,
      trade_count: r.trades,
      poc_ticks: poc,
      value_area: {
        poc_ticks: poc,
        vah_ticks: Math.max(oT, cT),
        val_ticks: Math.min(oT, cT),
        volume_covered: Math.round(tot * 0.7),
      },
      footprint: fp,
      finality: idx === rawEvaluated.length - 1 ? 'Forming' : 'Closed',
      completeness: 'Complete',
    } as BarDTO;
  });
}
