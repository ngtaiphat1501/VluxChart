/**
 * DeepChart / VluxChart — US Futures CME Globex Level-3 MBO Frontend Service
 *
 * Bridges directly to Rust `cme_mbo.rs` Tauri commands:
 * - Official Databento `GLBX.MDP3` (Live Raw TCP `:13000` CRAM-SHA256 + Historical REST + Local File Import)
 * - Structured Prop-Firm Gateway Adapters (`dxFeed` dxLink & `Rithmic` R|Protocol)
 * - Strict BYOK & 100% Real Market Data Policy: Zero simulated bars, zero fake order_ids.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  BarDTO,
  CmeStopSweepItemDTO,
  FootprintCellDTO,
  IcebergOrderDTO,
  MboQueueOrderItemDTO,
} from '../types.ts';
import { getInstrumentMeta } from '../utils/instrumentRegistry.ts';

export type CmeProviderKind = 'databento' | 'dxfeed' | 'rithmic';

export interface CmeConfigInputDTO {
  provider: CmeProviderKind;
  databentoCredential?: string;
  dxfeedWsUrl?: string;
  dxfeedAccessCode?: string;
  rithmicGatewayUri?: string;
  rithmicUser?: string;
  rithmicSystem?: string;
}

export interface CmeConnectionStatusDTO {
  configured: boolean;
  provider: CmeProviderKind;
  maskedCredential: string;
  dataset: string;
  liveStreaming: boolean;
  activeInstrumentId: string | null;
  statusState:
    | 'PUBLIC_LIVE'
    | 'UNCONFIGURED'
    | 'READY'
    | 'STREAMING'
    | 'FILE_LOADED'
    | 'ERROR'
    | string;
  statusMessage: string;
  totalMboEventsProcessed: number;
  restingOrdersCount: number;
  dxfeedWsUrl: string;
  rithmicGatewayUri: string;
  rithmicUser: string;
  rithmicSystem: string;
}

export interface CmeMboLevelDTO {
  priceTicks: number;
  totalContracts: number;
  orderCount: number;
  fifoQueue: {
    orderIdTail: string;
    quantityContracts: number;
    isLargeLot: boolean;
  }[];
}

export interface CmeTradeTickDTO {
  seq: number;
  exchangeTsUs: number;
  priceTicks: number;
  quantityUnits: number;
  aggressor: 'Buy' | 'Sell' | string;
  orderIdTail: string;
}

export interface CmeMboPollSnapshotDTO {
  ok: boolean;
  instrumentId: string;
  provider: string;
  statusState: string;
  statusMessage: string;
  lastSeq: number;
  totalMboEvents: number;
  restingOrdersCount: number;
  bestBidTicks: number | null;
  bestAskTicks: number | null;
  bids: CmeMboLevelDTO[];
  asks: CmeMboLevelDTO[];
  recentTrades: CmeTradeTickDTO[];
  icebergs: {
    priceTicks: number;
    side: string;
    peakDisplayedUnits: number;
    totalExecutedUnits: number;
    hiddenVolumeUnits: number;
    refillCount: number;
    detectedAtUs: number;
  }[];
  stopSweeps: {
    detectedAtUs: number;
    side: string;
    startPriceTicks: number;
    endPriceTicks: number;
    levelsSwept: number;
    totalContracts: number;
  }[];
  reconstructedBars: BarDTO[];
  liveBar?: BarDTO | null;
}

function isTauriAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Pure TypeScript deterministic parser for authentic Databento `GLBX.MDP3` `mbo` JSON/NDJSON/CSV
 * capture files when selected via `<input type="file">` in WebView or standalone browser QA.
 * Zero random/synthetic generation — processes only real MBO records present in `rawText`.
 */
export function parseRealDatabentoMboCaptureText(
  rawText: string,
  instrumentId: string
): CmeMboPollSnapshotDTO {
  const inst = getInstrumentMeta(instrumentId);
  const priceScale = inst.tickScale || 100;
  const tickStep = Math.max(1, inst.tickSize || 25);

  interface OrderNode {
    orderId: string;
    side: 'B' | 'A';
    priceTicks: number;
    qty: number;
  }

  const orders = new Map<string, OrderNode>();
  const bidQueues = new Map<number, string[]>();
  const askQueues = new Map<number, string[]>();
  const levelExecStats = new Map<string, { initDisp: number; exec: number; refills: number; tsUs: number }>();
  const icebergs: CmeMboPollSnapshotDTO['icebergs'] = [];
  const stopSweeps: CmeMboPollSnapshotDTO['stopSweeps'] = [];
  const recentTrades: CmeTradeTickDTO[] = [];
  const barsMap = new Map<number, BarDTO>();

  let totalEvents = 0;
  let seqCounter = 0;
  let sweepWin: {
    startUs: number;
    side: string;
    firstPx: number;
    lastPx: number;
    prices: Set<number>;
    contracts: number;
  } | null = null;

  const parsePriceTicks = (rawPx: unknown): number | null => {
    if (rawPx === null || rawPx === undefined) return null;
    const s = String(rawPx).trim();
    if (!s || s === '9223372036854775807') return null;
    if (!s.includes('.')) {
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) return null;
      if (Math.abs(n) > 10_000_000) {
        return Math.round((n / 1_000_000_000) * priceScale);
      }
      return Math.round(n);
    }
    const f = Number(s);
    if (!Number.isFinite(f) || f <= 0) return null;
    return Math.round(f * priceScale);
  };

  const parseTsUs = (rawTs: unknown): number => {
    if (rawTs === null || rawTs === undefined) return Date.now() * 1000;
    const s = String(rawTs).trim();
    if (/^\d+$/.test(s)) {
      if (s.length >= 18) {
        // Nanoseconds string -> slice microseconds cleanly without float precision loss
        return Number(s.slice(0, s.length - 3));
      }
      const n = Number(s);
      return n > 1e14 ? n : n * 1000;
    }
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms * 1000 : Date.now() * 1000;
  };

  const recordExecution = (
    oid: string,
    aggressor: 'Buy' | 'Sell',
    priceTicks: number,
    size: number,
    tsUs: number
  ) => {
    if (size <= 0) return;
    seqCounter += 1;
    const tail = oid && oid !== '0' ? oid.slice(-6) : 'MKT';
    recentTrades.push({
      seq: seqCounter,
      exchangeTsUs: tsUs,
      priceTicks,
      quantityUnits: size,
      aggressor,
      orderIdTail: tail,
    });
    if (recentTrades.length > 300) recentTrades.shift();

    if (sweepWin && sweepWin.side === aggressor && Math.abs(tsUs - sweepWin.startUs) <= 5_000) {
      sweepWin.lastPx = priceTicks;
      sweepWin.prices.add(priceTicks);
      sweepWin.contracts += size;
    } else {
      if (sweepWin && sweepWin.prices.size >= 3 && sweepWin.contracts >= 15) {
        stopSweeps.push({
          detectedAtUs: sweepWin.startUs,
          side: sweepWin.side,
          startPriceTicks: sweepWin.firstPx,
          endPriceTicks: sweepWin.lastPx,
          levelsSwept: sweepWin.prices.size,
          totalContracts: sweepWin.contracts,
        });
      }
      sweepWin = {
        startUs: tsUs,
        side: aggressor,
        firstPx: priceTicks,
        lastPx: priceTicks,
        prices: new Set([priceTicks]),
        contracts: size,
      };
    }

    const tfUs = 60_000_000;
    const bucketUs = Math.floor(tsUs / tfUs) * tfUs;
    const cellPx = Math.round(priceTicks / tickStep) * tickStep;
    const isBuy = aggressor === 'Buy';

    let bar = barsMap.get(bucketUs);
    if (!bar) {
      bar = {
        bar_start_us: bucketUs,
        timeframe_us: tfUs,
        open_ticks: priceTicks,
        high_ticks: priceTicks,
        low_ticks: priceTicks,
        close_ticks: priceTicks,
        buy_units: 0,
        sell_units: 0,
        unknown_units: 0,
        total_units: 0,
        delta_units: 0,
        trade_count: 0,
        poc_ticks: cellPx,
        value_area: {
          poc_ticks: cellPx,
          vah_ticks: priceTicks,
          val_ticks: priceTicks,
          volume_covered: 0,
        },
        footprint: [],
        finality: 'Closed',
        completeness: 'Complete',
      };
      barsMap.set(bucketUs, bar);
    }

    bar.high_ticks = Math.max(bar.high_ticks, priceTicks);
    bar.low_ticks = Math.min(bar.low_ticks, priceTicks);
    bar.close_ticks = priceTicks;
    if (isBuy) bar.buy_units += size;
    else bar.sell_units += size;
    bar.total_units = bar.buy_units + bar.sell_units;
    bar.delta_units = bar.buy_units - bar.sell_units;
    bar.trade_count += 1;

    let cell: FootprintCellDTO | undefined = bar.footprint.find((c) => c.price_ticks === cellPx);
    if (cell) {
      if (isBuy) cell.buy_units += size;
      else cell.sell_units += size;
      cell.total_units += size;
      cell.delta_units = cell.buy_units - cell.sell_units;
      cell.trade_count += 1;
    } else {
      bar.footprint.push({
        price_ticks: cellPx,
        buy_units: isBuy ? size : 0,
        sell_units: !isBuy ? size : 0,
        unknown_units: 0,
        total_units: size,
        delta_units: isBuy ? size : -size,
        trade_count: 1,
      });
      bar.footprint.sort((a, b) => a.price_ticks - b.price_ticks);
    }

    let maxCell = bar.footprint[0];
    for (const c of bar.footprint) {
      if (c.total_units > maxCell.total_units) maxCell = c;
    }
    bar.poc_ticks = maxCell.price_ticks;
    bar.value_area = {
      poc_ticks: maxCell.price_ticks,
      vah_ticks: bar.high_ticks,
      val_ticks: bar.low_ticks,
      volume_covered: Math.round(bar.total_units * 0.7),
    };
  };

  const applyRecord = (
    action: string,
    side: string,
    oid: string,
    priceTicks: number | null,
    size: number,
    tsUs: number
  ) => {
    const act = action.toUpperCase();
    if (act === 'R') {
      orders.clear();
      bidQueues.clear();
      askQueues.clear();
      totalEvents += 1;
      return;
    }
    if (priceTicks === null) return;
    totalEvents += 1;

    if (act === 'T') {
      recordExecution(oid, side.toUpperCase() === 'A' ? 'Sell' : 'Buy', priceTicks, size, tsUs);
      return;
    }

    const sNorm = side.toUpperCase();
    if (sNorm !== 'B' && sNorm !== 'A') return;
    if (!oid || oid === '0') return;

    const qMap = sNorm === 'B' ? bidQueues : askQueues;

    if (act === 'A') {
      orders.set(oid, { orderId: oid, side: sNorm, priceTicks, qty: size });
      const q = qMap.get(priceTicks) || [];
      q.push(oid);
      qMap.set(priceTicks, q);
      const stKey = `${sNorm}_${priceTicks}`;
      const st = levelExecStats.get(stKey) || { initDisp: 0, exec: 0, refills: 0, tsUs };
      st.initDisp += size;
      levelExecStats.set(stKey, st);
    } else if (act === 'M') {
      const existing = orders.get(oid);
      if (existing) {
        const oldQty = existing.qty;
        existing.qty = size;
        if (size > oldQty) {
          const q = qMap.get(existing.priceTicks);
          if (q) {
            const idx = q.indexOf(oid);
            if (idx >= 0) {
              q.splice(idx, 1);
              q.push(oid);
            }
          }
        }
      }
    } else if (act === 'C') {
      const existing = orders.get(oid);
      if (existing) {
        orders.delete(oid);
        const q = qMap.get(existing.priceTicks);
        if (q) {
          const idx = q.indexOf(oid);
          if (idx >= 0) q.splice(idx, 1);
        }
      }
    } else if (act === 'F') {
      const existing = orders.get(oid);
      if (existing) {
        existing.qty = Math.max(0, existing.qty - size);
        const stKey = `${existing.side}_${existing.priceTicks}`;
        const st = levelExecStats.get(stKey) || { initDisp: size, exec: 0, refills: 0, tsUs };
        st.exec += size;
        st.tsUs = tsUs;
        if (st.exec > st.initDisp && st.initDisp > 0) {
          const hidden = st.exec - st.initDisp;
          if (st.refills === 0 || hidden >= st.initDisp * (st.refills + 1)) {
            st.refills += 1;
          }
          icebergs.push({
            priceTicks: existing.priceTicks,
            side: existing.side === 'B' ? 'Bid' : 'Ask',
            peakDisplayedUnits: st.initDisp,
            totalExecutedUnits: st.exec,
            hiddenVolumeUnits: hidden,
            refillCount: st.refills,
            detectedAtUs: tsUs,
          });
          if (icebergs.length > 30) icebergs.shift();
        }
        levelExecStats.set(stKey, st);

        if (existing.qty === 0) {
          orders.delete(oid);
          const q = qMap.get(existing.priceTicks);
          if (q) {
            const idx = q.indexOf(oid);
            if (idx >= 0) q.splice(idx, 1);
          }
        }
        if (recentTrades.length === 0 || recentTrades[recentTrades.length - 1].exchangeTsUs !== tsUs) {
          recordExecution(oid, existing.side === 'B' ? 'Sell' : 'Buy', existing.priceTicks, size, tsUs);
        }
      }
    }
  };

  const lines = rawText.split(/\r?\n/);
  const firstNonEmpty = lines.find((l) => l.trim().length > 0)?.trim() || '';
  if (firstNonEmpty && !firstNonEmpty.startsWith('{') && firstNonEmpty.includes(',')) {
    const headers = firstNonEmpty.split(',').map((h) => h.trim());
    const iTs = headers.findIndex((h) => h === 'ts_event' || h === 'ts_recv');
    const iAct = headers.indexOf('action');
    const iSide = headers.indexOf('side');
    const iPx = headers.indexOf('price');
    const iSz = headers.indexOf('size');
    const iOid = headers.indexOf('order_id');
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].trim();
      if (!row) continue;
      const cols = row.split(',');
      if (iAct < 0 || iSide < 0 || iPx < 0 || iSz < 0) break;
      applyRecord(
        cols[iAct] || '',
        cols[iSide] || '',
        iOid >= 0 ? (cols[iOid] || '').trim() : '0',
        parsePriceTicks(cols[iPx]),
        Number(cols[iSz] || 0),
        iTs >= 0 ? parseTsUs(cols[iTs]) : Date.now() * 1000
      );
    }
  } else {
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj.hd?.rtype !== undefined && Number(obj.hd.rtype) !== 160) continue;
        applyRecord(
          String(obj.action || ''),
          String(obj.side || 'N'),
          String(obj.order_id || '0'),
          parsePriceTicks(obj.price),
          Number(obj.size || 0),
          parseTsUs(obj.hd?.ts_event ?? obj.ts_event ?? obj.ts_recv)
        );
      } catch {
        // skip malformed line
      }
    }
  }

  const tailSweep = sweepWin as {
    startUs: number;
    side: string;
    firstPx: number;
    lastPx: number;
    prices: Set<number>;
    contracts: number;
  } | null;
  if (tailSweep && tailSweep.prices.size >= 3 && tailSweep.contracts >= 15) {
    stopSweeps.push({
      detectedAtUs: tailSweep.startUs,
      side: tailSweep.side,
      startPriceTicks: tailSweep.firstPx,
      endPriceTicks: tailSweep.lastPx,
      levelsSwept: tailSweep.prices.size,
      totalContracts: tailSweep.contracts,
    });
  }

  const buildLevels = (qMap: Map<number, string[]>, desc: boolean): CmeMboLevelDTO[] => {
    const sortedPrices = Array.from(qMap.keys()).sort((a, b) => (desc ? b - a : a - b));
    const out: CmeMboLevelDTO[] = [];
    for (const px of sortedPrices) {
      const q = qMap.get(px) || [];
      let total = 0;
      let count = 0;
      const fifoQueue: CmeMboLevelDTO['fifoQueue'] = [];
      for (const oid of q) {
        const ord = orders.get(oid);
        if (ord && ord.qty > 0) {
          count += 1;
          total += ord.qty;
          if (fifoQueue.length < 12) {
            fifoQueue.push({
              orderIdTail: oid.slice(-4),
              quantityContracts: ord.qty,
              isLargeLot: ord.qty >= 25,
            });
          }
        }
      }
      if (total > 0) {
        out.push({ priceTicks: px, totalContracts: total, orderCount: count, fifoQueue });
        if (out.length >= 25) break;
      }
    }
    return out;
  };

  const bids = buildLevels(bidQueues, true);
  const asks = buildLevels(askQueues, false);
  const reconstructedBars = Array.from(barsMap.values()).sort(
    (a, b) => a.bar_start_us - b.bar_start_us
  );
  if (reconstructedBars.length > 0) {
    reconstructedBars[reconstructedBars.length - 1].finality = 'Forming';
  }

  return {
    ok: totalEvents > 0,
    instrumentId,
    provider: 'DATABENTO_MBO_FILE',
    statusState: totalEvents > 0 ? 'FILE_LOADED' : 'ERROR',
    statusMessage:
      totalEvents > 0
        ? `Đã nạp ${totalEvents.toLocaleString()} bản ghi CME MBO thật (${orders.size.toLocaleString()} lệnh chờ trên sổ FIFO)`
        : 'Tệp không chứa bản ghi CME GLBX.MDP3 MBO hợp lệ',
    lastSeq: seqCounter,
    totalMboEvents: totalEvents,
    restingOrdersCount: orders.size,
    bestBidTicks: bids[0]?.priceTicks ?? null,
    bestAskTicks: asks[0]?.priceTicks ?? null,
    bids,
    asks,
    recentTrades,
    icebergs,
    stopSweeps,
    reconstructedBars,
  };
}

class CmeMboService {
  private cachedStatus: CmeConnectionStatusDTO = {
    configured: false,
    provider: 'databento',
    maskedCredential: '',
    dataset: 'GLBX.MDP3 (CME Globex Level-3 MBO)',
    liveStreaming: false,
    activeInstrumentId: null,
    statusState: 'PUBLIC_LIVE',
    statusMessage:
      'Đang chạy Nến & Khối lượng CME thật miễn phí · Nhập khóa Databento / Rithmic để mở khóa thêm Sổ lệnh L3 MBO FIFO',
    totalMboEventsProcessed: 0,
    restingOrdersCount: 0,
    dxfeedWsUrl: '',
    rithmicGatewayUri: '',
    rithmicUser: '',
    rithmicSystem: 'Rithmic Paper Trading',
  };

  private inMemoryImportedSnapshot: CmeMboPollSnapshotDTO | null = null;
  private listeners = new Set<(st: CmeConnectionStatusDTO) => void>();

  subscribeStatus(cb: (st: CmeConnectionStatusDTO) => void): () => void {
    this.listeners.add(cb);
    cb(this.cachedStatus);
    return () => this.listeners.delete(cb);
  }

  private emitStatus(next: CmeConnectionStatusDTO) {
    this.cachedStatus = next;
    this.listeners.forEach((fn) => fn(next));
  }

  getCachedStatus(): CmeConnectionStatusDTO {
    return this.cachedStatus;
  }

  async getStatus(): Promise<CmeConnectionStatusDTO> {
    if (this.inMemoryImportedSnapshot) {
      return this.cachedStatus;
    }
    if (!isTauriAvailable()) {
      return this.cachedStatus;
    }
    try {
      const res = await invoke<CmeConnectionStatusDTO>('cme_get_status');
      this.emitStatus(res);
      return res;
    } catch {
      return this.cachedStatus;
    }
  }

  async saveAndVerifyConfig(input: CmeConfigInputDTO): Promise<CmeConnectionStatusDTO> {
    if (!isTauriAvailable()) {
      throw new Error(
        'Xác thực cổng TCP/TLS CME Globex yêu cầu chạy ứng dụng Desktop (VluxChart-DeepChart.exe)'
      );
    }
    this.inMemoryImportedSnapshot = null;
    const res = await invoke<CmeConnectionStatusDTO>('cme_save_config', { input });
    this.emitStatus(res);
    return res;
  }

  async clearConfig(): Promise<CmeConnectionStatusDTO> {
    this.inMemoryImportedSnapshot = null;
    if (!isTauriAvailable()) {
      this.emitStatus({
        ...this.cachedStatus,
        configured: false,
        maskedCredential: '',
        liveStreaming: false,
        statusState: 'UNCONFIGURED',
        statusMessage: 'Đã xóa cấu hình CME MBO trên máy',
      });
      return this.cachedStatus;
    }
    const res = await invoke<CmeConnectionStatusDTO>('cme_clear_config');
    this.emitStatus(res);
    return res;
  }

  async fetchHistoricalBars(
    instrumentId: string,
    timeframeUs: number,
    limit: number = 1500
  ): Promise<BarDTO[]> {
    if (
      this.inMemoryImportedSnapshot &&
      this.inMemoryImportedSnapshot.instrumentId === instrumentId &&
      this.inMemoryImportedSnapshot.reconstructedBars.length > 0
    ) {
      return this.inMemoryImportedSnapshot.reconstructedBars;
    }
    if (!isTauriAvailable()) {
      return [];
    }
    try {
      return await invoke<BarDTO[]>('cme_fetch_historical_bars', {
        instrumentId,
        timeframeUs,
        limit,
      });
    } catch {
      return [];
    }
  }

  async startLiveStream(instrumentId: string): Promise<CmeConnectionStatusDTO> {
    if (
      this.inMemoryImportedSnapshot &&
      this.inMemoryImportedSnapshot.instrumentId === instrumentId
    ) {
      return this.cachedStatus;
    }
    if (!isTauriAvailable()) {
      return this.cachedStatus;
    }
    try {
      const res = await invoke<CmeConnectionStatusDTO>('cme_start_live_stream', {
        instrumentId,
      });
      this.emitStatus(res);
      return res;
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : e?.message || 'Chưa cấu hình khóa CME MBO';
      const next: CmeConnectionStatusDTO = {
        ...this.cachedStatus,
        liveStreaming: false,
        statusState: this.cachedStatus.configured ? 'ERROR' : 'UNCONFIGURED',
        statusMessage: msg,
      };
      this.emitStatus(next);
      return next;
    }
  }

  async stopLiveStream(): Promise<void> {
    if (!isTauriAvailable()) return;
    try {
      await invoke('cme_stop_live_stream');
    } catch {
      // ignore
    }
  }

  async importLocalFileByPath(
    filePath: string,
    instrumentId: string
  ): Promise<CmeMboPollSnapshotDTO> {
    if (!isTauriAvailable()) {
      throw new Error('Hãy dùng nút Chọn Tệp (.json / .csv) trực tiếp trên hộp thoại');
    }
    const snap = await invoke<CmeMboPollSnapshotDTO>('cme_import_mbo_file', {
      filePath,
      instrumentId,
    });
    this.inMemoryImportedSnapshot = snap;
    await this.getStatus();
    return snap;
  }

  async importBrowserFileObject(
    file: File,
    instrumentId: string
  ): Promise<CmeMboPollSnapshotDTO> {
    let rawText = '';
    if (file.name.toLowerCase().endsWith('.gz') && typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('gzip');
      const decompressed = file.stream().pipeThrough(ds);
      rawText = await new Response(decompressed).text();
    } else {
      rawText = await file.text();
    }
    const snap = parseRealDatabentoMboCaptureText(rawText, instrumentId);
    if (!snap.ok) {
      throw new Error(snap.statusMessage);
    }
    this.inMemoryImportedSnapshot = snap;
    this.emitStatus({
      ...this.cachedStatus,
      activeInstrumentId: instrumentId,
      statusState: 'FILE_LOADED',
      statusMessage: snap.statusMessage,
      totalMboEventsProcessed: snap.totalMboEvents,
      restingOrdersCount: snap.restingOrdersCount,
    });
    return snap;
  }

  async pollMboSnapshot(
    instrumentId: string,
    sinceSeq: number
  ): Promise<CmeMboPollSnapshotDTO | null> {
    if (
      this.inMemoryImportedSnapshot &&
      this.inMemoryImportedSnapshot.instrumentId === instrumentId
    ) {
      const mem = this.inMemoryImportedSnapshot;
      return {
        ...mem,
        recentTrades: mem.recentTrades.filter((t) => t.seq > sinceSeq),
      };
    }
    if (!isTauriAvailable()) {
      return null;
    }
    try {
      return await invoke<CmeMboPollSnapshotDTO>('cme_poll_mbo_snapshot', {
        instrumentId,
        sinceSeq,
      });
    } catch {
      return null;
    }
  }

  static toCanonicalIcebergs(snap: CmeMboPollSnapshotDTO): IcebergOrderDTO[] {
    return snap.icebergs.map((ic) => ({
      price_ticks: ic.priceTicks,
      side: ic.side,
      peak_displayed_units: ic.peakDisplayedUnits,
      total_executed_units: ic.totalExecutedUnits,
      hidden_volume_units: ic.hiddenVolumeUnits,
      refill_count: ic.refillCount,
      detected_at_us: ic.detectedAtUs,
    }));
  }

  static toCanonicalStopSweeps(snap: CmeMboPollSnapshotDTO): CmeStopSweepItemDTO[] {
    return snap.stopSweeps.map((sw) => ({
      detected_at_us: sw.detectedAtUs,
      side: sw.side,
      start_price_ticks: sw.startPriceTicks,
      end_price_ticks: sw.endPriceTicks,
      levels_swept: sw.levelsSwept,
      total_contracts: sw.totalContracts,
    }));
  }

  static mapQueueItems(
    fifoQueue: CmeMboLevelDTO['fifoQueue']
  ): MboQueueOrderItemDTO[] {
    return fifoQueue.map((q) => ({
      order_id_tail: q.orderIdTail,
      quantity_contracts: q.quantityContracts,
      is_large_lot: q.isLargeLot,
    }));
  }
}

export const cmeMboService = new CmeMboService();
