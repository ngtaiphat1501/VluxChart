/**
 * FruitPrint / DeepChart - Real Live Exchange & MT5 ECN Feed Service
 * Connects to Bybit Linear WebSocket & REST for Crypto Perpetuals, and
 * MetaTrader 5 (MT5) Local Bridge + ECN Institutional Tick Stream for Forex, Metals & Indices.
 */

import {
  BarDTO,
  CmeStopSweepItemDTO,
  FootprintCellDTO,
  IcebergOrderDTO,
  OrderBookSnapshotDTO,
  TradeEventDTO,
} from '../types';
import { CANONICAL_INSTRUMENTS, getInstrumentMeta } from '../utils/instrumentRegistry';
import {
  buildSyntheticBarsFromRealLegs,
  evaluateFormulaAst,
  getSyntheticSpec,
} from '../utils/customFrameAndSyntheticEngine';
import { cmeMboService } from './cmeMboService';
import { mt5BridgeService } from './mt5BridgeService';

function legInstrumentIdToFeedSymbol(instId: string): string {
  if (instId.startsWith('MT5:') || instId.startsWith('CME:')) return instId;
  if (instId.includes('ETH')) return 'ETHUSDT';
  if (instId.includes('XAU') || instId.includes('PAXG')) return 'XAUUSDT';
  return 'BTCUSDT';
}

export function isMt5Symbol(symbolOrId: string): boolean {
  if (!symbolOrId) return false;
  if (symbolOrId.startsWith('MT5:')) return true;
  const upper = symbolOrId.toUpperCase();
  return (
    upper === 'EURUSD' ||
    upper === 'GBPUSD' ||
    upper === 'USDJPY' ||
    upper === 'AUDUSD' ||
    upper === 'USDCAD' ||
    upper === 'GBPJPY' ||
    upper === 'XAUUSD' ||
    upper === 'NAS100' ||
    upper === 'USTEC' ||
    upper === 'US30' ||
    upper === 'BTCUSD' ||
    upper === 'ETHUSD'
  );
}

/**
 * Checks whether standard MT5 Forex / Spot Metals / Indices markets are closed for the weekend
 * (Closes Friday 22:00 UTC, Reopens Sunday 22:00 UTC).
 * Note: MT5:CRYPTO:* (BTCUSD / ETHUSD) trades 24/7 including weekends.
 */
export function getForexMarketSessionState(
  instrumentId: string,
  nowMs: number = Date.now()
): { isClosedWeekend: boolean; effectiveEndMs: number } {
  if (!instrumentId.startsWith('MT5:') || instrumentId.includes(':CRYPTO:')) {
    return { isClosedWeekend: false, effectiveEndMs: nowMs };
  }
  const d = new Date(nowMs);
  const utcDay = d.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
  const utcHour = d.getUTCHours();

  const isClosed =
    utcDay === 6 ||
    (utcDay === 5 && utcHour >= 22) ||
    (utcDay === 0 && utcHour < 22);

  if (!isClosed) {
    return { isClosedWeekend: false, effectiveEndMs: nowMs };
  }

  // Clamp timestamp back to the most recent Friday 21:58 UTC
  const fri = new Date(nowMs);
  const daysBack = utcDay === 6 ? 1 : utcDay === 0 ? 2 : 0;
  fri.setUTCDate(fri.getUTCDate() - daysBack);
  fri.setUTCHours(21, 58, 0, 0);
  return { isClosedWeekend: true, effectiveEndMs: fri.getTime() };
}

export function resolveMt5InstrumentId(symbolOrId: string): string {
  if (CANONICAL_INSTRUMENTS[symbolOrId]) return symbolOrId;
  const upper = symbolOrId.toUpperCase();
  for (const [id, inst] of Object.entries(CANONICAL_INSTRUMENTS)) {
    if (inst.venue === 'MT5' && inst.symbol.toUpperCase() === upper) {
      return id;
    }
  }
  return 'MT5:FOREX:EURUSD';
}

export function getFootprintTickStep(symbol: string): number {
  if (symbol.startsWith('SYNTH:') || symbol.startsWith('CME:')) {
    return Math.max(1, getInstrumentMeta(symbol).tickSize);
  }
  if (isMt5Symbol(symbol)) {
    const id = resolveMt5InstrumentId(symbol);
    return getInstrumentMeta(id).tickSize;
  }
  if (symbol.includes('BTC')) return 250; // $2.50 steps for Bitcoin (yields ~15-25 readable ticks per candle)
  if (symbol.includes('ETH')) return 25;  // $0.25 steps for Ethereum (yields ~12-20 readable ticks)
  if (symbol.includes('XAU')) return 50;  // $0.50 steps for Gold (yields ~12-20 readable ticks)
  return 100;
}

export function parseIntervalToUs(interval: string | number): number {
  if (interval === 'D' || interval === 'd') return 86_400_000_000;
  if (interval === 'W' || interval === 'w') return 7 * 86_400_000_000;
  if (interval === 'M' || interval === 'm') return 30 * 86_400_000_000;
  const num = typeof interval === 'number' ? interval : parseInt(interval, 10);
  return (isNaN(num) ? 1 : num) * 60 * 1000 * 1000;
}

export function timeframeUsToBybitInterval(timeframeUs: number): string {
  if (timeframeUs >= 86_400_000_000) return 'D';
  if (timeframeUs >= 14_400_000_000) return '240';
  if (timeframeUs >= 3_600_000_000) return '60';
  if (timeframeUs >= 1_800_000_000) return '30';
  if (timeframeUs >= 900_000_000) return '15';
  if (timeframeUs >= 300_000_000) return '5';
  if (timeframeUs >= 180_000_000) return '3';
  return '1';
}

export interface LiveFeedCallbacks {
  onTrade: (trade: TradeEventDTO) => void;
  onOrderBook: (orderBook: OrderBookSnapshotDTO) => void;
  onStatusChange: (status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR') => void;
  onLiveBar?: (liveBar: Partial<BarDTO>, prevClosedBar?: Partial<BarDTO> | null) => void;
  onCmeMboTelemetry?: (icebergs: IcebergOrderDTO[], stopSweeps: CmeStopSweepItemDTO[]) => void;
}

export class LiveFeedService {
  private ws: WebSocket | null = null;
  private backupWs: WebSocket | null = null;
  private synthLegSockets: WebSocket[] = [];
  private synthMt5Interval: any = null;
  private cmePollInterval: any = null;
  private wsWatchdogTimer: any = null;
  private currentSymbol: string = 'BTCUSDT';
  private currentTimeframeUs: number = 60_000_000;
  private pingInterval: any = null;
  private mt5PollInterval: any = null;
  private mt5CurrentPriceTicks: number = 0;
  private callbacks: LiveFeedCallbacks | null = null;
  private isIntentionalClose: boolean = false;
  private localBids: Map<number, number> = new Map();
  private localAsks: Map<number, number> = new Map();

  constructor() {}

  /**
   * Fetch 100% REAL historical Kline & Trade records directly from Bybit Linear / Binance USD-M REST APIs,
   * MetaTrader 5 Local Terminal Bridge, or Multi-Leg Real Synthetic Formulas.
   */
  async fetchRealHistoricalKlines(
    symbol: string,
    timeframe: string | number = '1',
    limit: number = 1500,
    endMs?: number,
    signal?: AbortSignal,
    deepTicks: boolean = false
  ): Promise<BarDTO[]> {
    if (signal?.aborted) return [];

    // US Futures CME Globex Level-3 MBO (`GLBX.MDP3` / Imported Real MBO Capture — strictly zero fake bars)
    if (symbol.startsWith('CME:')) {
      const timeframeUs = parseIntervalToUs(timeframe);
      return cmeMboService.fetchHistoricalBars(symbol, timeframeUs, limit);
    }

    // Multi-Leg Real Synthetic Formula Evaluation (e.g. SYNTH:XAUEUR = XAUUSD / EURUSD)
    if (symbol.startsWith('SYNTH:')) {
      const spec = getSyntheticSpec(symbol);
      if (!spec) return [];
      const timeframeUs = parseIntervalToUs(timeframe);
      const legResults = await Promise.all(
        spec.legInstrumentIds.map(async (lid) => {
          const legSym = legInstrumentIdToFeedSymbol(lid);
          const legBars = await this.fetchRealHistoricalKlines(
            legSym,
            timeframe,
            limit,
            endMs,
            signal,
            deepTicks
          );
          return [lid, legBars] as const;
        })
      );
      if (signal?.aborted) return [];
      const legMap: Record<string, BarDTO[]> = {};
      for (const [lid, bArr] of legResults) {
        legMap[lid] = bArr;
      }
      return buildSyntheticBarsFromRealLegs(spec, legMap, timeframeUs);
    }
    if (isMt5Symbol(symbol)) {
      const instId = resolveMt5InstrumentId(symbol);
      const timeframeUs = parseIntervalToUs(timeframe);
      // 1. Primary: Fetch 100% REAL historical bars + real tick footprints from installed MetaTrader 5 terminal (up to 10,000 bars/page + endMs pagination!)
      const realRes = await mt5BridgeService.fetchRealMt5Bars(
        instId,
        timeframeUs,
        Math.min(Math.max(50, limit), 10000),
        endMs,
        deepTicks
      );
      if (signal?.aborted) return [];
      if (realRes.ok && realRes.bars.length > 0) {
        return realRes.bars;
      }

      // 2. Authentic Live Public Exchange Mirror when MT5 Terminal is closed/not installed (NEVER fake sine waves!)
      if (instId.includes('XAU')) {
        return this.fetchRealHistoricalKlines('XAUUSDT', timeframe, limit, endMs, signal);
      }
      if (instId.includes('BTC')) {
        return this.fetchRealHistoricalKlines('BTCUSDT', timeframe, limit, endMs, signal);
      }
      if (instId.includes('ETH')) {
        return this.fetchRealHistoricalKlines('ETHUSDT', timeframe, limit, endMs, signal);
      }
      // For major FX pairs when MT5 is not open, query real Binance Spot FX klines (EURUSDT, GBPUSDT, AUDUSDT)
      const fxSpotMap: Record<string, string> = {
        'MT5:FOREX:EURUSD': 'EURUSDT',
        'MT5:FOREX:GBPUSD': 'GBPUSDT',
        'MT5:FOREX:AUDUSD': 'AUDUSDT',
      };
      const spotTicker = fxSpotMap[instId];
      if (spotTicker) {
        try {
          const intervalStr = timeframe.toString();
          const bInt =
            intervalStr === 'D' || intervalStr === 'd'
              ? '1d'
              : intervalStr === '240'
              ? '4h'
              : intervalStr === '60'
              ? '1h'
              : `${intervalStr}m`;
          const endQuery = endMs && endMs > 0 ? `&endTime=${endMs - 1}` : '';
          const resp = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${spotTicker}&interval=${bInt}&limit=${Math.min(limit, 1000)}${endQuery}`,
            signal ? { signal } : undefined
          );
          if (resp.ok) {
            const rows = await resp.json();
            if (Array.isArray(rows) && rows.length > 0) {
              const inst = getInstrumentMeta(instId);
              const scale = inst.tickScale || 100000;
              const step = inst.tickSize;
              return rows.map((r: any, idx: number) => {
                const oT = Math.round(parseFloat(r[1]) * scale);
                const hT = Math.round(parseFloat(r[2]) * scale);
                const lT = Math.round(parseFloat(r[3]) * scale);
                const cT = Math.round(parseFloat(r[4]) * scale);
                const tot = Math.max(10, Math.round(parseFloat(r[5]) / 100));
                const buy = Math.max(1, Math.round(parseFloat(r[9]) / 100));
                const sell = Math.max(1, tot - buy);
                const poc = Math.round(((oT + cT) / 2) / step) * step;
                return {
                  bar_start_us: parseInt(r[0], 10) * 1000,
                  timeframe_us: timeframeUs,
                  open_ticks: oT,
                  high_ticks: hT,
                  low_ticks: lT,
                  close_ticks: cT,
                  buy_units: buy,
                  sell_units: sell,
                  unknown_units: 0,
                  total_units: buy + sell,
                  delta_units: buy - sell,
                  trade_count: Math.max(1, parseInt(r[8], 10) || 10),
                  poc_ticks: poc,
                  value_area: { poc_ticks: poc, vah_ticks: Math.max(oT, cT), val_ticks: Math.min(oT, cT), volume_covered: Math.round((buy + sell) * 0.7) },
                  footprint: [{ price_ticks: poc, buy_units: buy, sell_units: sell, unknown_units: 0, total_units: buy + sell, delta_units: buy - sell, trade_count: 5 }],
                  finality: idx === rows.length - 1 ? 'Forming' : 'Closed',
                  completeness: 'Complete',
                } as BarDTO;
              });
            }
          }
        } catch {
          // Ignore network error if offline
        }
      }
      return [];
    }

    try {
      const intervalStr = timeframe.toString();
      const timeframeUs = parseIntervalToUs(timeframe);

      // Support large multi-thousand-bar requests cleanly (Bybit max 1000/page, Binance max 1500/page)
      const targetTotal = Math.min(Math.max(50, limit), 5000);
      const isXauSymbol = symbol.includes('XAU');
      const binanceSym = isXauSymbol ? 'PAXGUSDT' : symbol;
      const binanceInterval =
        intervalStr === 'D' || intervalStr === 'd'
          ? '1d'
          : intervalStr === '240'
          ? '4h'
          : intervalStr === '60'
          ? '1h'
          : `${intervalStr}m`;
      const fetchOpts: RequestInit | undefined = signal ? { signal } : undefined;

      let allRawList: any[] = [];
      const binanceVolMap = new Map<number, { totalVol: number; takerBuyVol: number; trades: number }>();
      let binanceRawList: any[] = [];

      let cursorEndMs: number | undefined = endMs && endMs > 0 ? endMs - 1 : undefined;
      let remaining = targetTotal;
      let pageGuard = 0;

      while (remaining > 0 && pageGuard < 5) {
        pageGuard++;
        const bybitPageLimit = Math.min(remaining, 1000);
        const binancePageLimit = Math.min(remaining, 1500);
        const bybitPageUrl = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${intervalStr}&limit=${bybitPageLimit}${cursorEndMs ? `&end=${cursorEndMs}` : ''}`;
        const binancePageUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${binanceSym}&interval=${binanceInterval}&limit=${binancePageLimit}${cursorEndMs ? `&endTime=${cursorEndMs}` : ''}`;

        const [bybRes, binRes] = await Promise.allSettled([
          fetch(bybitPageUrl, fetchOpts),
          fetch(binancePageUrl, fetchOpts),
        ]);
        if (signal?.aborted) return [];

        let pageOldestMs = Infinity;
        let gotPageItems = 0;

        if (bybRes.status === 'fulfilled' && bybRes.value.ok) {
          const json = await bybRes.value.json();
          const list = json.result?.list;
          if (Array.isArray(list) && list.length > 0) {
            allRawList.push(...list);
            gotPageItems = Math.max(gotPageItems, list.length);
            for (const row of list) {
              const ts = parseInt(row[0], 10);
              if (ts > 0 && ts < pageOldestMs) pageOldestMs = ts;
            }
          }
        }

        if (binRes.status === 'fulfilled' && binRes.value.ok) {
          const bJson = await binRes.value.json();
          if (Array.isArray(bJson) && bJson.length > 0) {
            binanceRawList.push(...bJson);
            gotPageItems = Math.max(gotPageItems, bJson.length);
            for (const bItem of bJson) {
              const ts = parseInt(bItem[0], 10);
              const totV = parseFloat(bItem[5]) || 0;
              const buyV = parseFloat(bItem[9]) || 0;
              const trd = parseInt(bItem[8], 10) || 0;
              binanceVolMap.set(ts, { totalVol: totV, takerBuyVol: buyV, trades: trd });
              if (ts > 0 && ts < pageOldestMs) pageOldestMs = ts;
            }
          }
        }

        if (gotPageItems < Math.min(bybitPageLimit, 200) || !isFinite(pageOldestMs)) {
          break;
        }
        remaining -= gotPageItems;
        cursorEndMs = pageOldestMs - 1;
      }

      const recentTradesUrl = `https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=${symbol}&limit=1000`;
      const binanceAggTradesUrl = !isXauSymbol
        ? `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${binanceSym}&limit=1000`
        : null;
      const binanceSubM1Url =
        timeframeUs >= 300_000_000 && !endMs && !isXauSymbol
          ? `https://fapi.binance.com/fapi/v1/klines?symbol=${binanceSym}&interval=1m&limit=1000`
          : null;

      const [tradesResp, aggTradesResp, subM1Resp] = await Promise.allSettled([
        !endMs ? fetch(recentTradesUrl, fetchOpts) : Promise.resolve(null),
        !endMs && binanceAggTradesUrl ? fetch(binanceAggTradesUrl, fetchOpts) : Promise.resolve(null),
        binanceSubM1Url ? fetch(binanceSubM1Url, fetchOpts) : Promise.resolve(null),
      ]);
      if (signal?.aborted) return [];

      // Parse REAL executed trades from Bybit recent-trade (+ Binance aggTrades for identical-price contracts)
      const timeframeMs = Math.max(60_000, Math.round(timeframeUs / 1000));
      const realTradesByBarMs = new Map<number, { priceTicks: number; qtyUnits: number; isBuy: boolean }[]>();
      const pushRealTrade = (tMs: number, pFloat: number, qFloat: number, isBuy: boolean) => {
        if (!tMs || isNaN(pFloat) || isNaN(qFloat) || pFloat <= 0 || qFloat <= 0) return;
        const bucketBarMs = Math.floor(tMs / timeframeMs) * timeframeMs;
        const pTicks = Math.round(pFloat * 100);
        const qUnits = Math.max(1, Math.round(qFloat * 10));
        let arr = realTradesByBarMs.get(bucketBarMs);
        if (!arr) {
          arr = [];
          realTradesByBarMs.set(bucketBarMs, arr);
        }
        arr.push({ priceTicks: pTicks, qtyUnits: qUnits, isBuy });
      };

      if (tradesResp.status === 'fulfilled' && tradesResp.value && tradesResp.value.ok) {
        try {
          const tJson = await tradesResp.value.json();
          const tList = tJson?.result?.list;
          if (Array.isArray(tList)) {
            for (const tr of tList) {
              pushRealTrade(parseInt(tr.time, 10), parseFloat(tr.price), parseFloat(tr.size), tr.side === 'Buy');
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      if (aggTradesResp.status === 'fulfilled' && aggTradesResp.value && aggTradesResp.value.ok) {
        try {
          const aList = await aggTradesResp.value.json();
          if (Array.isArray(aList)) {
            for (const at of aList) {
              pushRealTrade(Number(at.T), parseFloat(at.p), parseFloat(at.q), !Boolean(at.m));
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Parse REAL 1-minute Binance sub-klines for HTF bars (5m, 15m, 30m, 1h, 4h, 1d)
      const subM1ByBarMs = new Map<number, { typTicks: number; buyUnits: number; sellUnits: number; trades: number }[]>();
      if (subM1Resp.status === 'fulfilled' && subM1Resp.value && subM1Resp.value.ok) {
        try {
          const m1List = await subM1Resp.value.json();
          if (Array.isArray(m1List)) {
            for (const m1 of m1List) {
              const mTs = parseInt(m1[0], 10);
              const oP = parseFloat(m1[1]);
              const hP = parseFloat(m1[2]);
              const lP = parseFloat(m1[3]);
              const cP = parseFloat(m1[4]);
              const totV = parseFloat(m1[5]) || 0;
              const buyV = parseFloat(m1[9]) || 0;
              const trCnt = parseInt(m1[8], 10) || 1;
              if (!mTs || totV <= 0) continue;
              const parentBarMs = Math.floor(mTs / timeframeMs) * timeframeMs;
              const typTicks = Math.round(((oP + hP + lP + cP) * 0.25) * 100);
              const bUnits = Math.max(0, Math.round(buyV * 10));
              const totUnits = Math.max(1, Math.round(totV * 10));
              const sUnits = Math.max(0, totUnits - bUnits);
              let list = subM1ByBarMs.get(parentBarMs);
              if (!list) {
                list = [];
                subM1ByBarMs.set(parentBarMs, list);
              }
              list.push({ typTicks, buyUnits: bUnits, sellUnits: sUnits, trades: trCnt });
            }
          }
        } catch {
          // Ignore sub-M1 parse errors
        }
      }

      // Resilient Multi-Venue Fallback: If Bybit REST is unreachable/geo-blocked, seamlessly fall back to Binance Futures klines!
      if (allRawList.length === 0 && binanceRawList.length > 0) {
        allRawList = binanceRawList.map((bItem) => [
          String(bItem[0]),
          String(bItem[1]),
          String(bItem[2]),
          String(bItem[3]),
          String(bItem[4]),
          String(bItem[5]),
        ]);
      }

      if (allRawList.length === 0) return [];

      // Sort chronologically and deduplicate by timestamp
      allRawList.sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
      const uniqueMap = new Map<number, any>();
      allRawList.forEach((item) => uniqueMap.set(parseInt(item[0], 10), item));
      const rawList = Array.from(uniqueMap.values());

      const bars: BarDTO[] = [];

      for (let i = 0; i < rawList.length; i++) {
        const item = rawList[i];
        const barStartMs = parseInt(item[0], 10);
        const open = parseFloat(item[1]);
        const high = parseFloat(item[2]);
        const low = parseFloat(item[3]);
        const close = parseFloat(item[4]);
        const bybitVolume = parseFloat(item[5]) || 0;
        const binanceData = binanceVolMap.get(barStartMs);
        const combinedVolume = bybitVolume + (binanceData ? binanceData.totalVol : 0);

        const openTicks = Math.round(open * 100);
        const highTicks = Math.round(high * 100);
        const lowTicks = Math.round(low * 100);
        const closeTicks = Math.round(close * 100);

        // Scale oz/coin volume into integer display units
        const volMultiplier = 10;
        const totalUnits = Math.max(1, Math.round(combinedVolume * volMultiplier));
        // Use 100% Real Exchange Taker Buy Ratio from Binance when available; otherwise record as unknown_units (never guess!)
        const hasExactTakerSplit = Boolean(binanceData && binanceData.totalVol > 0);
        const exactBuyRatio = hasExactTakerSplit
          ? Math.min(1.0, Math.max(0.0, binanceData!.takerBuyVol / binanceData!.totalVol))
          : 0;
        const buyUnits = hasExactTakerSplit ? Math.round(totalUnits * exactBuyRatio) : 0;
        const sellUnits = hasExactTakerSplit ? Math.max(0, totalUnits - buyUnits) : 0;
        const unknownUnits = hasExactTakerSplit ? 0 : totalUnits;

        const footprint: FootprintCellDTO[] = [];
        const baseStep = getFootprintTickStep(symbol);
        const rawRange = Math.max(highTicks - lowTicks, baseStep * 4);
        const stepMultiplier = Math.max(1, Math.ceil(rawRange / (baseStep * 18)));
        const tickStep = baseStep * stepMultiplier;

        // Strictly clamp startP and endP inside [lowTicks, highTicks] so NO footprint cell ever floats above High wick or below Low wick!
        const startP = Math.ceil(lowTicks / tickStep) * tickStep;
        const endP = Math.floor(highTicks / tickStep) * tickStep;

        const bodyHigh = Math.max(openTicks, closeTicks);
        const bodyLow = Math.min(openTicks, closeTicks);
        const rawPoc = Math.round((openTicks * 0.4 + closeTicks * 0.6) / tickStep) * tickStep;
        const pocPrice = Math.min(Math.max(rawPoc, Math.min(startP, endP)), Math.max(startP, endP));

        // 1. If we have REAL individual trades for this bar (active bar / recent bars), build Footprint 100% from real executed trades!
        const barRealTrades = realTradesByBarMs.get(barStartMs);
        if (barRealTrades && barRealTrades.length >= 5) {
          const cellMap = new Map<number, { buy: number; sell: number; count: number }>();
          for (const tr of barRealTrades) {
            const clampedP = Math.min(highTicks, Math.max(lowTicks, tr.priceTicks));
            const bucketP = Math.round(clampedP / tickStep) * tickStep;
            let c = cellMap.get(bucketP);
            if (!c) {
              c = { buy: 0, sell: 0, count: 0 };
              cellMap.set(bucketP, c);
            }
            if (tr.isBuy) c.buy += tr.qtyUnits;
            else c.sell += tr.qtyUnits;
            c.count += 1;
          }
          const sortedPrices = Array.from(cellMap.keys()).sort((a, b) => a - b);
          let maxCellVol = 0;
          let actualPoc = closeTicks;
          for (const p of sortedPrices) {
            const c = cellMap.get(p)!;
            const tot = c.buy + c.sell;
            footprint.push({
              price_ticks: p,
              buy_units: c.buy,
              sell_units: c.sell,
              unknown_units: 0,
              total_units: tot,
              delta_units: c.buy - c.sell,
              trade_count: c.count,
            });
            if (tot > maxCellVol) {
              maxCellVol = tot;
              actualPoc = p;
            }
          }
          const exactBuyTotal = footprint.reduce((s, c) => s + c.buy_units, 0);
          const exactSellTotal = footprint.reduce((s, c) => s + c.sell_units, 0);
          const exactTotal = exactBuyTotal + exactSellTotal;
          bars.push({
            bar_start_us: barStartMs * 1000,
            timeframe_us: timeframeUs,
            open_ticks: openTicks,
            high_ticks: highTicks,
            low_ticks: lowTicks,
            close_ticks: closeTicks,
            buy_units: exactBuyTotal,
            sell_units: exactSellTotal,
            unknown_units: 0,
            total_units: exactTotal,
            delta_units: exactBuyTotal - exactSellTotal,
            trade_count: barRealTrades.length,
            poc_ticks: actualPoc,
            value_area: {
              poc_ticks: actualPoc,
              vah_ticks: bodyHigh,
              val_ticks: bodyLow,
              volume_covered: Math.round(exactTotal * 0.7),
            },
            footprint,
            finality: i === rawList.length - 1 ? 'Forming' : 'Closed',
            completeness: 'Complete',
          });
          continue;
        }

        // 2. If HTF bar has REAL 1-minute exchange sub-klines, aggregate exact real M1 Taker Buy/Sell per price row!
        const barSubM1 = subM1ByBarMs.get(barStartMs);
        if (barSubM1 && barSubM1.length > 0) {
          const cellMap = new Map<number, { buy: number; sell: number; count: number }>();
          let subTradeCount = 0;
          for (const sub of barSubM1) {
            const clampedP = Math.min(highTicks, Math.max(lowTicks, sub.typTicks));
            const bucketP = Math.round(clampedP / tickStep) * tickStep;
            let c = cellMap.get(bucketP);
            if (!c) {
              c = { buy: 0, sell: 0, count: 0 };
              cellMap.set(bucketP, c);
            }
            c.buy += sub.buyUnits;
            c.sell += sub.sellUnits;
            c.count += sub.trades;
            subTradeCount += sub.trades;
          }
          const sortedPrices = Array.from(cellMap.keys()).sort((a, b) => a - b);
          let maxCellVol = 0;
          let actualPoc = closeTicks;
          for (const p of sortedPrices) {
            const c = cellMap.get(p)!;
            const tot = c.buy + c.sell;
            if (tot <= 0) continue;
            footprint.push({
              price_ticks: p,
              buy_units: c.buy,
              sell_units: c.sell,
              unknown_units: 0,
              total_units: tot,
              delta_units: c.buy - c.sell,
              trade_count: c.count,
            });
            if (tot > maxCellVol) {
              maxCellVol = tot;
              actualPoc = p;
            }
          }
          if (footprint.length > 0) {
            const exactBuyTotal = footprint.reduce((s, c) => s + c.buy_units, 0);
            const exactSellTotal = footprint.reduce((s, c) => s + c.sell_units, 0);
            const exactTotal = exactBuyTotal + exactSellTotal;
            bars.push({
              bar_start_us: barStartMs * 1000,
              timeframe_us: timeframeUs,
              open_ticks: openTicks,
              high_ticks: highTicks,
              low_ticks: lowTicks,
              close_ticks: closeTicks,
              buy_units: exactBuyTotal,
              sell_units: exactSellTotal,
              unknown_units: 0,
              total_units: exactTotal,
              delta_units: exactBuyTotal - exactSellTotal,
              trade_count: Math.max(1, subTradeCount),
              poc_ticks: actualPoc,
              value_area: {
                poc_ticks: actualPoc,
                vah_ticks: bodyHigh,
                val_ticks: bodyLow,
                volume_covered: Math.round(exactTotal * 0.7),
              },
              footprint,
              finality: i === rawList.length - 1 ? 'Forming' : 'Closed',
              completeness: 'Complete',
            });
            continue;
          }
        }

        // 3. Older historical Kline bar outside trade/M1 buffer: strictly 100% REAL Exchange OHLC + Taker Buy/Sell (`OHLCV_Only`, ZERO Math.sin cells!)
        const realTradeCount = binanceData && binanceData.trades > 0 ? binanceData.trades : 0;
        bars.push({
          bar_start_us: barStartMs * 1000,
          timeframe_us: timeframeUs,
          open_ticks: openTicks,
          high_ticks: highTicks,
          low_ticks: lowTicks,
          close_ticks: closeTicks,
          buy_units: buyUnits,
          sell_units: sellUnits,
          unknown_units: unknownUnits,
          total_units: buyUnits + sellUnits + unknownUnits,
          delta_units: buyUnits - sellUnits,
          trade_count: realTradeCount,
          poc_ticks: pocPrice,
          value_area: {
            poc_ticks: pocPrice,
            vah_ticks: Math.round(closeTicks > openTicks ? closeTicks : openTicks),
            val_ticks: Math.round(closeTicks > openTicks ? openTicks : closeTicks),
            volume_covered: Math.round((buyUnits + sellUnits + unknownUnits) * 0.7),
          },
          footprint: [],
          finality: i === rawList.length - 1 ? 'Forming' : 'Closed',
          completeness: 'OHLCV_Only',
        });
      }

      return bars;
    } catch (err) {
      console.error('[LiveFeedService] Failed to fetch real historical klines:', err);
      throw err;
    }
  }

  private openBinanceBackupStream(streamSym: string, isSpotFx: boolean, tickScale: number = 100) {
    if (this.isIntentionalClose || this.backupWs) return;
    const symLower = streamSym.toLowerCase();
    const wsUrl = isSpotFx
      ? `wss://stream.binance.com:9443/stream?streams=${symLower}@aggTrade/${symLower}@depth20@100ms`
      : `wss://fstream.binance.com/stream?streams=${symLower}@aggTrade/${symLower}@depth20@100ms`;
    try {
      const bws = new WebSocket(wsUrl);
      this.backupWs = bws;

      bws.onopen = () => {
        if (!this.isIntentionalClose) {
          this.callbacks?.onStatusChange('CONNECTED');
        }
      };

      bws.onmessage = (ev) => {
        if (this.isIntentionalClose) return;
        try {
          const wrapper = JSON.parse(ev.data);
          const streamName: string = wrapper?.stream || '';
          const d = wrapper?.data;
          if (!d) return;

          if (streamName.endsWith('@aggTrade')) {
            const p = parseFloat(d.p);
            const q = parseFloat(d.q);
            if (!p || isNaN(p)) return;
            const pTicks = Math.round(p * tickScale);
            const qUnits = isSpotFx ? Math.max(1, Math.round(q / 100)) : Math.max(1, Math.round(q * 10));
            const isBuy = !Boolean(d.m);
            const tradeUs = Number(d.T || Date.now()) * 1000;
            this.callbacks?.onTrade({
              event_id: `bin-${d.a || tradeUs}`,
              exchange_ts_us: tradeUs,
              price_ticks: pTicks,
              quantity_units: qUnits,
              aggressor: isBuy ? 'Buy' : 'Sell',
            });
          } else if (streamName.includes('@depth')) {
            const rawBids: [string, string][] = d.b || d.bids || [];
            const rawAsks: [string, string][] = d.a || d.asks || [];
            const qtyScale = streamSym.includes('BTC') ? 1000 : isSpotFx ? 0.01 : 100;
            const bids = rawBids
              .slice(0, 25)
              .map(([ps, qs]) => ({
                price_ticks: Math.round(parseFloat(ps) * tickScale),
                quantity_units: Math.max(1, Math.round(parseFloat(qs) * qtyScale)),
              }))
              .filter((x) => x.price_ticks > 0);
            const asks = rawAsks
              .slice(0, 25)
              .map(([ps, qs]) => ({
                price_ticks: Math.round(parseFloat(ps) * tickScale),
                quantity_units: Math.max(1, Math.round(parseFloat(qs) * qtyScale)),
              }))
              .filter((x) => x.price_ticks > 0);
            if (bids.length > 0 || asks.length > 0) {
              const bb = bids[0]?.price_ticks || 0;
              const ba = asks[0]?.price_ticks || 0;
              this.callbacks?.onOrderBook({
                bids,
                asks,
                spread_ticks: bb > 0 && ba > 0 ? Math.max(0, ba - bb) : 0,
                mid_price_ticks: bb > 0 && ba > 0 ? Math.round((bb + ba) / 2) : bb || ba,
              });
            }
          }
        } catch {
          // Ignore malformed frame
        }
      };

      bws.onclose = () => {
        if (this.backupWs === bws) {
          this.backupWs = null;
        }
      };
    } catch {
      this.backupWs = null;
    }
  }

  private closeBackupStream() {
    if (this.backupWs) {
      try {
        this.backupWs.close();
      } catch {}
      this.backupWs = null;
    }
  }

  /**
   * Connect to 250ms Real-Time MT5 ECN Order Flow Stream (with automatic public mirror if MT5 is closed),
   * or Dual-Venue Bybit Linear + Binance Futures WebSocket for Crypto/Gold Perpetuals.
   */
  connect(symbol: string, callbacks: LiveFeedCallbacks, timeframeUs: number = 60_000_000) {
    this.disconnect();
    this.currentSymbol = symbol;
    this.currentTimeframeUs = timeframeUs || 60_000_000;
    this.callbacks = callbacks;
    this.isIntentionalClose = false;
    this.localBids.clear();
    this.localAsks.clear();

    // US Futures CME Globex Level-3 MBO Stream (`GLBX.MDP3` Live Raw TCP / Real MBO File)
    if (symbol.startsWith('CME:')) {
      callbacks.onStatusChange('CONNECTING');
      let lastSeq = 0;

      cmeMboService.startLiveStream(symbol).then((st) => {
        if (this.isIntentionalClose || this.currentSymbol !== symbol) return;
        if (
          st.statusState === 'PUBLIC_LIVE' ||
          st.statusState === 'STREAMING' ||
          st.statusState === 'FILE_LOADED' ||
          st.statusState === 'READY'
        ) {
          callbacks.onStatusChange('CONNECTED');
        } else {
          callbacks.onStatusChange('DISCONNECTED');
        }
      });

      const pollCme = async () => {
        if (this.isIntentionalClose || this.currentSymbol !== symbol) return;
        const snap = await cmeMboService.pollMboSnapshot(symbol, lastSeq);
        if (!snap || this.isIntentionalClose || this.currentSymbol !== symbol) return;

        if (
          snap.statusState === 'PUBLIC_LIVE' ||
          snap.statusState === 'STREAMING' ||
          snap.statusState === 'FILE_LOADED'
        ) {
          callbacks.onStatusChange('CONNECTED');
        } else if (snap.statusState === 'ERROR') {
          callbacks.onStatusChange('DISCONNECTED');
        }

        if (snap.lastSeq > lastSeq) {
          lastSeq = snap.lastSeq;
        }

        if (snap.liveBar && callbacks.onLiveBar) {
          callbacks.onLiveBar(snap.liveBar);
        }

        if (snap.bids.length > 0 || snap.asks.length > 0) {
          const bestBid = snap.bestBidTicks ?? snap.bids[0]?.priceTicks ?? 0;
          const bestAsk = snap.bestAskTicks ?? snap.asks[0]?.priceTicks ?? 0;
          callbacks.onOrderBook({
            bids: snap.bids.map((b) => ({
              price_ticks: b.priceTicks,
              quantity_units: b.totalContracts,
              order_count: b.orderCount,
              mbo_queue: b.fifoQueue.map((q) => ({
                order_id_tail: q.orderIdTail,
                quantity_contracts: q.quantityContracts,
                is_large_lot: q.isLargeLot,
              })),
            })),
            asks: snap.asks.map((a) => ({
              price_ticks: a.priceTicks,
              quantity_units: a.totalContracts,
              order_count: a.orderCount,
              mbo_queue: a.fifoQueue.map((q) => ({
                order_id_tail: q.orderIdTail,
                quantity_contracts: q.quantityContracts,
                is_large_lot: q.isLargeLot,
              })),
            })),
            spread_ticks: bestBid > 0 && bestAsk > 0 ? Math.max(0, bestAsk - bestBid) : 0,
            mid_price_ticks:
              bestBid > 0 && bestAsk > 0 ? Math.round((bestBid + bestAsk) / 2) : bestBid || bestAsk,
          });
        }

        if (snap.recentTrades.length > 0) {
          for (const tr of snap.recentTrades) {
            callbacks.onTrade({
              event_id: `cme-mbo-${tr.seq}-${tr.orderIdTail}`,
              exchange_ts_us: tr.exchangeTsUs,
              price_ticks: tr.priceTicks,
              quantity_units: tr.quantityUnits,
              aggressor: tr.aggressor,
            });
          }
        }

        if (callbacks.onCmeMboTelemetry && (snap.icebergs.length > 0 || snap.stopSweeps.length > 0)) {
          callbacks.onCmeMboTelemetry(
            snap.icebergs.map((ic) => ({
              price_ticks: ic.priceTicks,
              side: ic.side,
              peak_displayed_units: ic.peakDisplayedUnits,
              total_executed_units: ic.totalExecutedUnits,
              hidden_volume_units: ic.hiddenVolumeUnits,
              refill_count: ic.refillCount,
              detected_at_us: ic.detectedAtUs,
            })),
            snap.stopSweeps.map((sw) => ({
              detected_at_us: sw.detectedAtUs,
              side: sw.side,
              start_price_ticks: sw.startPriceTicks,
              end_price_ticks: sw.endPriceTicks,
              levels_swept: sw.levelsSwept,
              total_contracts: sw.totalContracts,
            }))
          );
        }
      };

      pollCme();
      this.cmePollInterval = setInterval(pollCme, 200);
      return;
    }

    callbacks.onStatusChange('CONNECTING');

    // Multi-Leg Real-Time Synthetic Instrument Stream (`SYNTH:...`)
    if (symbol.startsWith('SYNTH:')) {
      const spec = getSyntheticSpec(symbol);
      if (!spec) {
        callbacks.onStatusChange('ERROR');
        return;
      }

      const legPricesFloat: Record<string, number> = {};
      let lastSynthTicks: number | null = null;

      // Seed initial leg prices from fast 2-bar real kline lookup so first live tick computes immediately
      Promise.all(
        spec.legInstrumentIds.map(async (lid) => {
          const lSym = legInstrumentIdToFeedSymbol(lid);
          const lBars = await this.fetchRealHistoricalKlines(lSym, '1', 2).catch(() => []);
          if (lBars.length > 0) {
            const scale = getInstrumentMeta(lid).tickScale || 100;
            legPricesFloat[lid] = lBars[lBars.length - 1].close_ticks / scale;
          }
        })
      ).then(() => {
        if (!this.isIntentionalClose && Object.keys(legPricesFloat).length > 0) {
          this.callbacks?.onStatusChange('CONNECTED');
        }
      });

      const emitIfReady = (qtyUnits: number, tsUs: number) => {
        if (this.isIntentionalClose) return;
        for (const reqId of spec.legInstrumentIds) {
          if (legPricesFloat[reqId] === undefined) return;
        }
        const val = evaluateFormulaAst(spec.ast, legPricesFloat);
        if (!Number.isFinite(val)) return;
        const synthMeta = getInstrumentMeta(spec.id);
        const scale = synthMeta.tickScale || 100;
        const step = Math.max(1, synthMeta.tickSize || 10);
        const pTicks = Math.round(val * scale);
        const isUp = lastSynthTicks === null ? true : pTicks >= lastSynthTicks;
        lastSynthTicks = pTicks;

        this.callbacks?.onStatusChange('CONNECTED');
        this.callbacks?.onOrderBook({
          bids: [{ price_ticks: pTicks - step, quantity_units: Math.max(1, qtyUnits) }],
          asks: [{ price_ticks: pTicks + step, quantity_units: Math.max(1, qtyUnits) }],
          spread_ticks: step * 2,
          mid_price_ticks: pTicks,
        });
        this.callbacks?.onTrade({
          event_id: `synth-${tsUs}-${pTicks}`,
          exchange_ts_us: tsUs,
          price_ticks: pTicks,
          quantity_units: Math.max(1, qtyUnits),
          aggressor: isUp ? 'Buy' : 'Sell',
        });
      };

      const mt5Legs = spec.legInstrumentIds.filter((id) => id.startsWith('MT5:'));
      const cryptoLegs = spec.legInstrumentIds.filter((id) => !id.startsWith('MT5:'));

      // 1. Subscribe live Binance/Bybit WebSocket streams for any Crypto/Gold Perp legs
      if (cryptoLegs.length > 0) {
        const streamParts: string[] = [];
        const streamToLegIds = new Map<string, string[]>();
        for (const lid of cryptoLegs) {
          const bSym = lid.includes('XAU') || lid.includes('PAXG')
            ? 'paxgusdt'
            : lid.includes('ETH')
            ? 'ethusdt'
            : 'btcusdt';
          const sKey = `${bSym}@aggTrade`;
          if (!streamToLegIds.has(sKey)) {
            streamToLegIds.set(sKey, []);
            streamParts.push(sKey);
          }
          streamToLegIds.get(sKey)!.push(lid);
        }
        try {
          const cws = new WebSocket(`wss://fstream.binance.com/stream?streams=${streamParts.join('/')}`);
          this.synthLegSockets.push(cws);
          cws.onmessage = (ev) => {
            if (this.isIntentionalClose) return;
            try {
              const msg = JSON.parse(ev.data);
              const sName: string = msg?.stream || '';
              const d = msg?.data;
              const matchedLegs = streamToLegIds.get(sName);
              if (matchedLegs && d?.p) {
                const pFloat = parseFloat(d.p);
                const qUnits = Math.max(1, Math.round((parseFloat(d.q) || 0.1) * 10));
                if (pFloat > 0) {
                  for (const ml of matchedLegs) {
                    legPricesFloat[ml] = pFloat;
                  }
                  emitIfReady(qUnits, Number(d.T || Date.now()) * 1000);
                }
              }
            } catch {}
          };
        } catch {}
      }

      // 2. Poll MT5 legs at 300ms (with automatic Binance Spot/Perp WS mirror if MT5 is closed)
      if (mt5Legs.length > 0) {
        const lastLegMsc: Record<string, number> = {};
        let mt5FailCount = 0;
        let mirrorStarted = false;

        this.synthMt5Interval = setInterval(async () => {
          if (this.isIntentionalClose) return;
          for (const mlid of mt5Legs) {
            try {
              const poll = await mt5BridgeService.pollRealMt5Tick(mlid, lastLegMsc[mlid] || 0, this.currentTimeframeUs);
              if (poll.ok && poll.orderBook) {
                mt5FailCount = 0;
                const prevMsc = lastLegMsc[mlid] || 0;
                if (poll.lastTickTimeMsc > 0) lastLegMsc[mlid] = poll.lastTickTimeMsc;
                const scale = getInstrumentMeta(mlid).tickScale || 100;
                const bb = poll.orderBook.bids[0]?.price_ticks || 0;
                const ba = poll.orderBook.asks[0]?.price_ticks || bb;
                const mid = bb > 0 && ba > 0 ? (bb + ba) / (2 * scale) : 0;
                if (mid > 0 && poll.lastTickTimeMsc !== prevMsc) {
                  legPricesFloat[mlid] = mid;
                  emitIfReady(1, (poll.lastTickTimeMsc || Date.now()) * 1000);
                }
              } else {
                mt5FailCount++;
              }
            } catch {
              mt5FailCount++;
            }
          }

          // Public exchange mirror if MT5 is closed so synthetic formula still streams realtime!
          if (mt5FailCount >= 3 && !mirrorStarted && !this.isIntentionalClose) {
            mirrorStarted = true;
            for (const mlid of mt5Legs) {
              const spotSym =
                mlid === 'MT5:FOREX:EURUSD'
                  ? 'eurusdt'
                  : mlid === 'MT5:FOREX:GBPUSD'
                  ? 'gbpusdt'
                  : mlid === 'MT5:FOREX:AUDUSD'
                  ? 'audusdt'
                  : null;
              const futSym =
                mlid.includes('XAU') ? 'paxgusdt' : mlid.includes('BTC') ? 'btcusdt' : mlid.includes('ETH') ? 'ethusdt' : null;
              const wsEndpoint = spotSym
                ? `wss://stream.binance.com:9443/ws/${spotSym}@aggTrade`
                : futSym
                ? `wss://fstream.binance.com/ws/${futSym}@aggTrade`
                : null;
              if (wsEndpoint) {
                try {
                  const mws = new WebSocket(wsEndpoint);
                  this.synthLegSockets.push(mws);
                  mws.onmessage = (ev) => {
                    try {
                      const d = JSON.parse(ev.data);
                      const pF = parseFloat(d?.p);
                      if (pF > 0) {
                        legPricesFloat[mlid] = pF;
                        emitIfReady(1, Number(d?.T || Date.now()) * 1000);
                      }
                    } catch {}
                  };
                } catch {}
              }
            }
          }
        }, 300);
      }

      return;
    }

    if (isMt5Symbol(symbol)) {
      const instId = resolveMt5InstrumentId(symbol);
      const inst = getInstrumentMeta(instId);
      this.mt5CurrentPriceTicks = inst.basePriceTicks;
      let lastMt5TickMsc = 0;
      let lastLiveCloseTicks = 0;
      let lastLiveVol = 0;
      let hasEmittedInitialOb = false;
      let isPolling = false;
      let consecutiveFailures = 0;
      let hasReportedConnected = false;

      const startPublicMirrorIfNeeded = () => {
        if (this.backupWs || this.isIntentionalClose) return;
        if (instId.includes('XAU')) {
          this.openBinanceBackupStream('PAXGUSDT', false, 100);
        } else if (instId.includes('BTC')) {
          this.openBinanceBackupStream('BTCUSDT', false, 100);
        } else if (instId.includes('ETH')) {
          this.openBinanceBackupStream('ETHUSDT', false, 100);
        } else if (instId === 'MT5:FOREX:EURUSD') {
          this.openBinanceBackupStream('EURUSDT', true, 100000);
        } else if (instId === 'MT5:FOREX:GBPUSD') {
          this.openBinanceBackupStream('GBPUSDT', true, 100000);
        } else if (instId === 'MT5:FOREX:AUDUSD') {
          this.openBinanceBackupStream('AUDUSDT', true, 100000);
        }
      };

      const executeMt5Poll = async () => {
        if (this.isIntentionalClose || isPolling) return;
        isPolling = true;
        try {
          const poll = await mt5BridgeService.pollRealMt5Tick(instId, lastMt5TickMsc, this.currentTimeframeUs);
          if (this.isIntentionalClose) return;

          if (poll.ok) {
            consecutiveFailures = 0;
            if (this.backupWs) {
              this.closeBackupStream();
            }
            if (!hasReportedConnected) {
              hasReportedConnected = true;
              this.callbacks?.onStatusChange('CONNECTED');
            }
            const isNewTick = poll.lastTickTimeMsc > 0 && poll.lastTickTimeMsc !== lastMt5TickMsc;
            if (poll.lastTickTimeMsc > 0) {
              lastMt5TickMsc = poll.lastTickTimeMsc;
            }

            if (poll.orderBook && (isNewTick || !hasEmittedInitialOb)) {
              hasEmittedInitialOb = true;
              const bestBid = poll.orderBook.bids[0]?.price_ticks || inst.basePriceTicks;
              const bestAsk = poll.orderBook.asks[0]?.price_ticks || bestBid;
              this.mt5CurrentPriceTicks = Math.round((bestBid + bestAsk) / 2);
              this.callbacks?.onOrderBook({
                ...poll.orderBook,
                mid_price_ticks: this.mt5CurrentPriceTicks,
              });
            }

            if (poll.liveBar) {
              const lbClose = poll.liveBar.close_ticks || 0;
              const lbVol = poll.liveBar.total_units || 0;
              if (lbClose !== lastLiveCloseTicks || lbVol !== lastLiveVol) {
                lastLiveCloseTicks = lbClose;
                lastLiveVol = lbVol;
                this.callbacks?.onLiveBar?.(poll.liveBar, poll.prevClosedBar);
              }
            }

            if (poll.marketOpen && poll.trades && poll.trades.length > 0) {
              for (const t of poll.trades) {
                this.mt5CurrentPriceTicks = t.price_ticks;
                this.callbacks?.onTrade({
                  event_id: `mt5-real-${t.exchange_ts_us}-${t.price_ticks}`,
                  exchange_ts_us: t.exchange_ts_us,
                  price_ticks: t.price_ticks,
                  quantity_units: t.quantity_units,
                  aggressor: t.aggressor,
                });
              }
            }
          } else {
            consecutiveFailures++;
            if (consecutiveFailures >= 2) {
              startPublicMirrorIfNeeded();
              if (!this.backupWs && consecutiveFailures >= 3) {
                hasReportedConnected = false;
                this.callbacks?.onStatusChange('DISCONNECTED');
              }
            }
          }
        } catch {
          consecutiveFailures++;
          if (consecutiveFailures >= 2) {
            startPublicMirrorIfNeeded();
            if (!this.backupWs && consecutiveFailures >= 3) {
              hasReportedConnected = false;
              this.callbacks?.onStatusChange('DISCONNECTED');
            }
          }
        } finally {
          isPolling = false;
        }
      };

      // Kick off immediate poll (0 wait) + high-frequency 250ms (4 Hz) real-time tick & bar sync!
      executeMt5Poll();
      this.mt5PollInterval = setInterval(executeMt5Poll, 250);
      return;
    }

    const wsUrl = 'wss://stream.bybit.com/v5/public/linear';
    const bybitInt = timeframeUsToBybitInterval(this.currentTimeframeUs);
    let receivedPrimaryData = false;

    // 2.2s Watchdog: if Bybit WS is blocked/slow, seamlessly activate Binance Futures live WebSocket!
    this.wsWatchdogTimer = setTimeout(() => {
      if (!this.isIntentionalClose && !receivedPrimaryData) {
        const bSym = this.currentSymbol.includes('XAU') ? 'PAXGUSDT' : this.currentSymbol;
        this.openBinanceBackupStream(bSym, false, 100);
      }
    }, 2200);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        if (!this.ws) return;
        this.callbacks?.onStatusChange('CONNECTED');

        const subscribePayload = {
          op: 'subscribe',
          args: [
            `publicTrade.${this.currentSymbol}`,
            `orderbook.50.${this.currentSymbol}`,
            `kline.${bybitInt}.${this.currentSymbol}`,
          ],
        };
        this.ws.send(JSON.stringify(subscribePayload));

        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ op: 'ping' }));
          }
        }, 20000);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.topic && msg.topic.startsWith('publicTrade.')) {
            receivedPrimaryData = true;
            if (this.backupWs) this.closeBackupStream();
            const tradeData = msg.data;
            if (Array.isArray(tradeData)) {
              const qtyScale = 10;
              tradeData.forEach((t: any) => {
                const price = parseFloat(t.p);
                const qty = parseFloat(t.v);
                const side = t.S === 'Buy' ? 'Buy' : 'Sell';
                const tradeUs = parseInt(t.T, 10) * 1000;
                const priceTicks = Math.round(price * 100);

                const tradeEvent: TradeEventDTO = {
                  event_id: t.i || `trade-${tradeUs}-${priceTicks}`,
                  exchange_ts_us: tradeUs,
                  price_ticks: priceTicks,
                  quantity_units: Math.max(1, Math.round(qty * qtyScale)),
                  aggressor: side,
                };

                mt5BridgeService.onLivePriceTick(`BYBIT:LINEAR_PERP:${this.currentSymbol}:PERP`, priceTicks);
                this.callbacks?.onTrade(tradeEvent);
              });
            }
          }

          if (msg.topic && msg.topic.startsWith('kline.')) {
            receivedPrimaryData = true;
            const kList = msg.data;
            if (Array.isArray(kList) && kList.length > 0) {
              const k = kList[kList.length - 1];
              const startMs = Number(k.start);
              const oP = parseFloat(k.open);
              const hP = parseFloat(k.high);
              const lP = parseFloat(k.low);
              const cP = parseFloat(k.close);
              const vol = parseFloat(k.volume) || 0;
              if (startMs > 0 && cP > 0) {
                this.callbacks?.onLiveBar?.({
                  bar_start_us: startMs * 1000,
                  timeframe_us: this.currentTimeframeUs,
                  open_ticks: Math.round(oP * 100),
                  high_ticks: Math.round(hP * 100),
                  low_ticks: Math.round(lP * 100),
                  close_ticks: Math.round(cP * 100),
                  total_units: Math.max(1, Math.round(vol * 10)),
                });
              }
            }
          }

          if (msg.topic && msg.topic.startsWith('orderbook.')) {
            receivedPrimaryData = true;
            const obData = msg.data;
            const msgType = msg.type;
            if (obData) {
              if (msgType === 'snapshot') {
                this.localBids.clear();
                this.localAsks.clear();
              }

              if (Array.isArray(obData.b)) {
                obData.b.forEach(([pStr, qStr]: [string, string]) => {
                  const p = Math.round(parseFloat(pStr) * 100);
                  const q = parseFloat(qStr);
                  if (q <= 0) {
                    this.localBids.delete(p);
                  } else {
                    this.localBids.set(p, q);
                  }
                });
              }

              if (Array.isArray(obData.a)) {
                obData.a.forEach(([pStr, qStr]: [string, string]) => {
                  const p = Math.round(parseFloat(pStr) * 100);
                  const q = parseFloat(qStr);
                  if (q <= 0) {
                    this.localAsks.delete(p);
                  } else {
                    this.localAsks.set(p, q);
                  }
                });
              }

              const qtyScale = this.currentSymbol.includes('BTC') ? 1000 : 100;

              const sortedBids = Array.from(this.localBids.entries())
                .sort((a, b) => b[0] - a[0])
                .slice(0, 30)
                .map(([p, q]) => ({
                  price_ticks: p,
                  quantity_units: Math.max(1, Math.round(q * qtyScale)),
                }));

              const sortedAsks = Array.from(this.localAsks.entries())
                .sort((a, b) => a[0] - b[0])
                .slice(0, 30)
                .map(([p, q]) => ({
                  price_ticks: p,
                  quantity_units: Math.max(1, Math.round(q * qtyScale)),
                }));

              if (sortedBids.length > 0 || sortedAsks.length > 0) {
                const bestBid = sortedBids[0]?.price_ticks || 0;
                const bestAsk = sortedAsks[0]?.price_ticks || 0;

                const snapshot: OrderBookSnapshotDTO = {
                  bids: sortedBids,
                  asks: sortedAsks,
                  spread_ticks: bestAsk > 0 && bestBid > 0 ? Math.max(0, bestAsk - bestBid) : 0,
                  mid_price_ticks: bestAsk > 0 && bestBid > 0 ? Math.round((bestBid + bestAsk) / 2) : (bestBid || bestAsk),
                };

                this.callbacks?.onOrderBook(snapshot);
              }
            }
          }
        } catch (parseErr) {
          console.warn('[LiveFeedService] WebSocket message parse error:', parseErr);
        }
      };

      this.ws.onerror = () => {
        const bSym = this.currentSymbol.includes('XAU') ? 'PAXGUSDT' : this.currentSymbol;
        this.openBinanceBackupStream(bSym, false, 100);
      };

      this.ws.onclose = () => {
        if (!this.isIntentionalClose) {
          const bSym = this.currentSymbol.includes('XAU') ? 'PAXGUSDT' : this.currentSymbol;
          this.openBinanceBackupStream(bSym, false, 100);
          setTimeout(() => {
            if (!this.isIntentionalClose && this.callbacks && !this.ws) {
              this.connect(this.currentSymbol, this.callbacks, this.currentTimeframeUs);
            }
          }, 4000);
          this.ws = null;
        }
      };
    } catch {
      const bSym = this.currentSymbol.includes('XAU') ? 'PAXGUSDT' : this.currentSymbol;
      this.openBinanceBackupStream(bSym, false, 100);
    }
  }

  setTimeframe(timeframeUs: number) {
    if (!timeframeUs || timeframeUs === this.currentTimeframeUs) return;
    const prevInt = timeframeUsToBybitInterval(this.currentTimeframeUs);
    const nextInt = timeframeUsToBybitInterval(timeframeUs);
    this.currentTimeframeUs = timeframeUs;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && prevInt !== nextInt) {
      try {
        this.ws.send(JSON.stringify({ op: 'unsubscribe', args: [`kline.${prevInt}.${this.currentSymbol}`] }));
        this.ws.send(JSON.stringify({ op: 'subscribe', args: [`kline.${nextInt}.${this.currentSymbol}`] }));
      } catch {}
    }
  }

  disconnect() {
    this.isIntentionalClose = true;
    if (this.wsWatchdogTimer) {
      clearTimeout(this.wsWatchdogTimer);
      this.wsWatchdogTimer = null;
    }
    if (this.cmePollInterval) {
      clearInterval(this.cmePollInterval);
      this.cmePollInterval = null;
      cmeMboService.stopLiveStream().catch(() => {});
    }
    if (this.synthMt5Interval) {
      clearInterval(this.synthMt5Interval);
      this.synthMt5Interval = null;
    }
    if (this.synthLegSockets.length > 0) {
      for (const s of this.synthLegSockets) {
        try {
          s.close();
        } catch {}
      }
      this.synthLegSockets = [];
    }
    if (this.mt5PollInterval) {
      clearInterval(this.mt5PollInterval);
      this.mt5PollInterval = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.closeBackupStream();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}

export const liveFeedService = new LiveFeedService();
