/**
 * DeepChart / VluxChart On-Demand Historical Market Data Pack Service
 *
 * Lightweight Installer Architecture (ATAS / Sierra Chart / Quantower Standard):
 * - Zero heavy historical archives bundled inside the `.exe` binary.
 * - After Login, users download only the Market Data Packs they need (Gold, Crypto, MT5 Forex, Macro HTF).
 * - In Desktop App (Tauri), packs are Gzip-compressed, SHA-256 verified, and persisted
 *   atomically in `%LOCALAPPDATA%\DeepChart\market-data\*.json.gz`.
 * - In Browser preview mode, packs are persisted in IndexedDB (`vluxchart_market_data_v1`)
 *   to avoid `localStorage` 5MB quota limits and synchronous UI stalls.
 */

import { BarDTO } from '../types';
import { liveFeedService, timeframeUsToBybitInterval } from './liveFeedService';
import { saveSymbolBars } from '../utils/workspaceStorage';

export interface InstalledDataPackDTO {
  pack_id: string;
  title: string;
  symbols: string[];
  timeframes: string[];
  bar_count: number;
  uncompressed_bytes: number;
  compressed_bytes: number;
  sha256: string;
  updated_at_ms: number;
  source: string;
}

export interface DataManifestDTO {
  storage_dir: string;
  total_compressed_bytes: number;
  total_uncompressed_bytes: number;
  total_bars: number;
  has_core_data: boolean;
  packs: InstalledDataPackDTO[];
}

export interface IntegrityCheckItemDTO {
  pack_id: string;
  ok: boolean;
  message: string;
}

export interface IntegrityReportDTO {
  all_valid: boolean;
  checked_count: number;
  items: IntegrityCheckItemDTO[];
}

export interface DataPackCatalogItem {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  recommended: boolean;
  estimatedSizeLabel: string;
  sourceLabel: string;
  tasks: {
    symbol: string;
    cacheKeyPrefix: string;
    timeframeUs: number;
    tfLabel: string;
    limit: number;
  }[];
}

export interface DataDownloadProgress {
  packId: string;
  packTitle: string;
  stage: string;
  completedTasks: number;
  totalTasks: number;
  percent: number;
  barsDownloaded: number;
  bytesTransferred: number;
  speedKbps: number;
  completedPackIds: string[];
}

export const DATA_PACK_CATALOG: DataPackCatalogItem[] = [
  {
    id: 'gold_institutional',
    title: 'Gold Institutional Pack (XAUUSDT / PAXG)',
    subtitle: 'Khởi tạo sâu 6,000+ nến Vàng đa khung M1 · M5 · M15 · H1 (tự động tải nối tiếp không giới hạn khi kéo lịch sử)',
    badge: 'KHUYÊN DÙNG · VÀNG',
    recommended: true,
    estimatedSizeLabel: '~2.8 MB (Gzip)',
    sourceLabel: 'Bybit Linear + Binance Futures',
    tasks: [
      { symbol: 'XAUUSDT', cacheKeyPrefix: 'XAUUSDT', timeframeUs: 60_000_000, tfLabel: '1m', limit: 1500 },
      { symbol: 'XAUUSDT', cacheKeyPrefix: 'XAUUSDT', timeframeUs: 300_000_000, tfLabel: '5m', limit: 1500 },
      { symbol: 'XAUUSDT', cacheKeyPrefix: 'XAUUSDT', timeframeUs: 900_000_000, tfLabel: '15m', limit: 1500 },
      { symbol: 'XAUUSDT', cacheKeyPrefix: 'XAUUSDT', timeframeUs: 3_600_000_000, tfLabel: '1h', limit: 1500 },
    ],
  },
  {
    id: 'crypto_core',
    title: 'Crypto Futures Core (BTCUSDT & ETHUSDT)',
    subtitle: 'Khởi tạo sâu 7,500+ nến + Taker Buy/Sell Delta thực tế từ Bybit & Binance (Streaming Realtime + Unlimited Scroll)',
    badge: 'CORE CRYPTO',
    recommended: true,
    estimatedSizeLabel: '~3.4 MB (Gzip)',
    sourceLabel: 'Bybit Linear + Binance USD-M',
    tasks: [
      { symbol: 'BTCUSDT', cacheKeyPrefix: 'BTCUSDT', timeframeUs: 60_000_000, tfLabel: '1m', limit: 1500 },
      { symbol: 'BTCUSDT', cacheKeyPrefix: 'BTCUSDT', timeframeUs: 300_000_000, tfLabel: '5m', limit: 1500 },
      { symbol: 'BTCUSDT', cacheKeyPrefix: 'BTCUSDT', timeframeUs: 900_000_000, tfLabel: '15m', limit: 1500 },
      { symbol: 'ETHUSDT', cacheKeyPrefix: 'ETHUSDT', timeframeUs: 300_000_000, tfLabel: '5m', limit: 1500 },
      { symbol: 'ETHUSDT', cacheKeyPrefix: 'ETHUSDT', timeframeUs: 900_000_000, tfLabel: '15m', limit: 1500 },
    ],
  },
  {
    id: 'mt5_forex_pack',
    title: 'MT5 Gold & Forex ECN Pack (XAUUSD · EURUSD)',
    subtitle: 'Đồng bộ sâu 7,500+ nến & khối lượng tick thật 100% từ MetaTrader 5 (hỗ trợ kéo ngược hàng chục nghìn nến lịch sử)',
    badge: 'MT5 ECN',
    recommended: false,
    estimatedSizeLabel: '~2.6 MB (Gzip)',
    sourceLabel: 'MetaTrader 5 Local Bridge',
    tasks: [
      { symbol: 'MT5:CFD:XAUUSD', cacheKeyPrefix: 'MT5:CFD:XAUUSD', timeframeUs: 60_000_000, tfLabel: '1m', limit: 1500 },
      { symbol: 'MT5:CFD:XAUUSD', cacheKeyPrefix: 'MT5:CFD:XAUUSD', timeframeUs: 300_000_000, tfLabel: '5m', limit: 1500 },
      { symbol: 'MT5:CFD:XAUUSD', cacheKeyPrefix: 'MT5:CFD:XAUUSD', timeframeUs: 900_000_000, tfLabel: '15m', limit: 1500 },
      { symbol: 'MT5:CFD:XAUUSD', cacheKeyPrefix: 'MT5:CFD:XAUUSD', timeframeUs: 3_600_000_000, tfLabel: '1h', limit: 1500 },
      { symbol: 'MT5:FOREX:EURUSD', cacheKeyPrefix: 'MT5:FOREX:EURUSD', timeframeUs: 300_000_000, tfLabel: '5m', limit: 1500 },
    ],
  },
  {
    id: 'macro_htf_pack',
    title: 'Macro Structure HTF Pack (4H & 1D)',
    subtitle: 'Cấu trúc vĩ mô dài hạn nhiều năm 4H/Daily (4,500+ nến) cho Vàng và BTC/ETH (NPOC, Value Area, Weekly Profile)',
    badge: 'MACRO HTF',
    recommended: false,
    estimatedSizeLabel: '~1.6 MB (Gzip)',
    sourceLabel: 'Bybit Linear + Binance Futures',
    tasks: [
      { symbol: 'XAUUSDT', cacheKeyPrefix: 'XAUUSDT', timeframeUs: 14_400_000_000, tfLabel: '4h', limit: 1500 },
      { symbol: 'XAUUSDT', cacheKeyPrefix: 'XAUUSDT', timeframeUs: 86_400_000_000, tfLabel: '1d', limit: 1000 },
      { symbol: 'BTCUSDT', cacheKeyPrefix: 'BTCUSDT', timeframeUs: 14_400_000_000, tfLabel: '4h', limit: 1500 },
      { symbol: 'BTCUSDT', cacheKeyPrefix: 'BTCUSDT', timeframeUs: 86_400_000_000, tfLabel: '1d', limit: 1000 },
    ],
  },
];

const IDB_NAME = 'vluxchart_market_data_v1';
const IDB_STORE_PACKS = 'packs';
const IDB_STORE_META = 'manifest';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
}

function openBrowserDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_PACKS)) {
        db.createObjectStore(IDB_STORE_PACKS, { keyPath: 'pack_id' });
      }
      if (!db.objectStoreNames.contains(IDB_STORE_META)) {
        db.createObjectStore(IDB_STORE_META, { keyPath: 'pack_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function sha256HexBrowser(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// In-memory index of hydrated pack series (`${symbol}_${timeframeUs}` -> BarDTO[])
const HYDRATED_PACK_BARS = new Map<string, BarDTO[]>();

function isLegacySyntheticWaveSeries(bars: BarDTO[]): boolean {
  if (!Array.isArray(bars) || bars.length < 10) return false;
  const sample = bars.slice(0, 12);
  let matchCount = 0;
  for (const b of sample) {
    if (b.trade_count === Math.round(b.total_units / 6) + 1) {
      matchCount++;
    }
  }
  return matchCount >= 10;
}

class DataPackService {
  private manifestListeners = new Set<(m: DataManifestDTO) => void>();
  private dirtySeriesKeys = new Set<string>();
  private autoPersistTimer: ReturnType<typeof setTimeout> | null = null;

  subscribeManifest(listener: (m: DataManifestDTO) => void): () => void {
    this.manifestListeners.add(listener);
    return () => {
      this.manifestListeners.delete(listener);
    };
  }

  private emitManifestRefresh(): void {
    if (this.manifestListeners.size === 0) return;
    this.getManifest()
      .then((m) => {
        this.manifestListeners.forEach((fn) => fn(m));
      })
      .catch(() => {});
  }

  getHydratedBars(symbol: string, timeframeUs: number): BarDTO[] | null {
    const direct = HYDRATED_PACK_BARS.get(`${symbol}_${timeframeUs}`);
    if (direct && direct.length > 0 && !isLegacySyntheticWaveSeries(direct)) return direct;
    return null;
  }

  updateHydratedSeries(symbol: string, timeframeUs: number, bars: BarDTO[]): void {
    if (Array.isArray(bars) && bars.length > 0 && !isLegacySyntheticWaveSeries(bars)) {
      const key = `${symbol}_${timeframeUs}`;
      HYDRATED_PACK_BARS.set(key, bars);
      this.dirtySeriesKeys.add(key);
      this.scheduleAutoPersist();
    }
  }

  /**
   * ATAS / Sierra Chart (.scid) Continuous Auto-Sync:
   * Automatically Gzip-persists newly streamed live Footprint candles & scrolled historical pages
   * to `%LOCALAPPDATA%\DeepChart\market-data\live_accumulated_cache.json.gz` in the background.
   */
  private scheduleAutoPersist(): void {
    if (this.autoPersistTimer) {
      clearTimeout(this.autoPersistTimer);
    }
    this.autoPersistTimer = setTimeout(async () => {
      this.autoPersistTimer = null;
      if (this.dirtySeriesKeys.size === 0) return;
      this.dirtySeriesKeys.clear();

      try {
        const seriesMap: Record<string, BarDTO[]> = {};
        const symbolsSet = new Set<string>();
        let totalBars = 0;
        for (const [k, bList] of HYDRATED_PACK_BARS.entries()) {
          if (bList.length > 0) {
            seriesMap[k] = bList;
            totalBars += bList.length;
            const lastUnderscore = k.lastIndexOf('_');
            if (lastUnderscore > 0) symbolsSet.add(k.slice(0, lastUnderscore));
          }
        }
        if (totalBars === 0) return;

        const payloadJson = JSON.stringify(seriesMap);
        const symbols = Array.from(symbolsSet);
        const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
        const title = 'Live & Scrolled Order Flow Store (Auto-Synced)';
        const source = 'Realtime Stream + Historical Cache [REAL-V2]';

        if (isTauriRuntime()) {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke<InstalledDataPackDTO>('data_save_pack', {
            packId: 'live_accumulated_cache',
            title,
            symbols,
            timeframes,
            barCount: totalBars,
            source,
            payloadJson,
          });
        } else {
          const sha256 = await sha256HexBrowser(payloadJson);
          const rawBytes = new TextEncoder().encode(payloadJson).length;
          const meta: InstalledDataPackDTO = {
            pack_id: 'live_accumulated_cache',
            title,
            symbols,
            timeframes,
            bar_count: totalBars,
            uncompressed_bytes: rawBytes,
            compressed_bytes: rawBytes,
            sha256,
            updated_at_ms: Date.now(),
            source,
          };
          const db = await openBrowserDb();
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction([IDB_STORE_PACKS, IDB_STORE_META], 'readwrite');
            tx.objectStore(IDB_STORE_PACKS).put({ pack_id: 'live_accumulated_cache', payload: payloadJson });
            tx.objectStore(IDB_STORE_META).put(meta);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        }
        this.emitManifestRefresh();
      } catch (e) {
        console.warn('[DataPackService] Auto-persist checkpoint warning:', e);
      }
    }, 5000);
  }

  async getManifest(): Promise<DataManifestDTO> {
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<DataManifestDTO>('data_get_manifest');
    }

    try {
      const db = await openBrowserDb();
      const packs: InstalledDataPackDTO[] = await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_META, 'readonly');
        const req = tx.objectStore(IDB_STORE_META).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const totalCompressed = packs.reduce((s, p) => s + p.compressed_bytes, 0);
      const totalUncompressed = packs.reduce((s, p) => s + p.uncompressed_bytes, 0);
      const totalBars = packs.reduce((s, p) => s + p.bar_count, 0);
      return {
        storage_dir: 'IndexedDB://vluxchart_market_data_v1 (Browser Sandbox)',
        total_compressed_bytes: totalCompressed,
        total_uncompressed_bytes: totalUncompressed,
        total_bars: totalBars,
        has_core_data: packs.length > 0 && totalBars > 0,
        packs,
      };
    } catch {
      return {
        storage_dir: 'IndexedDB (Unavailable)',
        total_compressed_bytes: 0,
        total_uncompressed_bytes: 0,
        total_bars: 0,
        has_core_data: false,
        packs: [],
      };
    }
  }

  async savePackPayload(
    pack: DataPackCatalogItem,
    seriesMap: Record<string, BarDTO[]>,
    totalBars: number
  ): Promise<InstalledDataPackDTO> {
    const payloadJson = JSON.stringify(seriesMap);
    const symbols = Array.from(new Set(pack.tasks.map((t) => t.symbol)));
    const timeframes = Array.from(new Set(pack.tasks.map((t) => t.tfLabel)));

    // Populate in-memory cache immediately for instant 0ms chart switching
    for (const [seriesKey, bars] of Object.entries(seriesMap)) {
      if (bars.length > 0) {
        HYDRATED_PACK_BARS.set(seriesKey, bars);
        saveSymbolBars(seriesKey, bars);
      }
    }

    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<InstalledDataPackDTO>('data_save_pack', {
        packId: pack.id,
        title: pack.title,
        symbols,
        timeframes,
        barCount: totalBars,
        source: `${pack.sourceLabel} [REAL-V2]`,
        payloadJson,
      });
    }

    // Browser IndexedDB storage
    const sha256 = await sha256HexBrowser(payloadJson);
    const rawBytes = new TextEncoder().encode(payloadJson).length;
    const meta: InstalledDataPackDTO = {
      pack_id: pack.id,
      title: pack.title,
      symbols,
      timeframes,
      bar_count: totalBars,
      uncompressed_bytes: rawBytes,
      compressed_bytes: rawBytes,
      sha256,
      updated_at_ms: Date.now(),
      source: `${pack.sourceLabel} [REAL-V2]`,
    };

    const db = await openBrowserDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([IDB_STORE_PACKS, IDB_STORE_META], 'readwrite');
      tx.objectStore(IDB_STORE_PACKS).put({ pack_id: pack.id, payload: payloadJson });
      tx.objectStore(IDB_STORE_META).put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return meta;
  }

  async hydrateAllInstalledPacks(): Promise<number> {
    const manifest = await this.getManifest();
    let hydratedSeries = 0;

    for (const p of manifest.packs) {
      try {
        // Purge any pre-V2 pack created before the strict 100% real-data enforcement
        if (!p.source || !p.source.includes('[REAL-V2]')) {
          await this.deletePack(p.pack_id).catch(() => {});
          continue;
        }
        let jsonStr: string | null = null;
        if (isTauriRuntime()) {
          const { invoke } = await import('@tauri-apps/api/core');
          jsonStr = await invoke<string>('data_load_pack', { packId: p.pack_id });
        } else {
          const db = await openBrowserDb();
          const row: any = await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE_PACKS, 'readonly');
            const req = tx.objectStore(IDB_STORE_PACKS).get(p.pack_id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          jsonStr = row?.payload || null;
        }

        if (jsonStr) {
          const seriesMap = JSON.parse(jsonStr) as Record<string, BarDTO[]>;
          let hadPoisonedSynthetic = false;
          for (const [seriesKey, bars] of Object.entries(seriesMap)) {
            if (Array.isArray(bars) && bars.length > 0) {
              if (isLegacySyntheticWaveSeries(bars)) {
                hadPoisonedSynthetic = true;
                continue;
              }
              HYDRATED_PACK_BARS.set(seriesKey, bars);
              saveSymbolBars(seriesKey, bars);
              hydratedSeries++;
            }
          }
          if (hadPoisonedSynthetic) {
            // Auto-heal: remove stale pack generated during an earlier MT5 bridge timeout
            this.deletePack(p.pack_id).catch(() => {});
          }
        }
      } catch (e) {
        console.warn(`[DataPackService] Failed to hydrate pack ${p.pack_id}:`, e);
      }
    }
    return hydratedSeries;
  }

  async downloadAllPacks(
    onProgress: (p: DataDownloadProgress) => void,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; installed: InstalledDataPackDTO[]; errors: string[] }> {
    return this.downloadPacks(
      DATA_PACK_CATALOG.map((p) => p.id),
      onProgress,
      signal
    );
  }

  async downloadPacks(
    packIds: string[],
    onProgress: (p: DataDownloadProgress) => void,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; installed: InstalledDataPackDTO[]; errors: string[] }> {
    const selectedPacks = DATA_PACK_CATALOG.filter((p) => packIds.includes(p.id));
    const totalTasks = selectedPacks.reduce((s, p) => s + p.tasks.length, 0);
    let completedTasks = 0;
    let totalBarsDownloaded = 0;
    let totalBytesTransferred = 0;
    const startMs = performance.now();
    const installed: InstalledDataPackDTO[] = [];
    const completedPackIds: string[] = [];
    const errors: string[] = [];

    for (const pack of selectedPacks) {
      if (signal?.aborted) {
        errors.push('Người dùng đã hủy quá trình tải dữ liệu.');
        break;
      }

      const seriesMap: Record<string, BarDTO[]> = {};
      let packBars = 0;

      for (const task of pack.tasks) {
        if (signal?.aborted) break;

        onProgress({
          packId: pack.id,
          packTitle: pack.title,
          stage: `Đang tải ${task.symbol} khung ${task.tfLabel} (${task.limit} nến)...`,
          completedTasks,
          totalTasks,
          percent: Math.round((completedTasks / Math.max(totalTasks, 1)) * 100),
          barsDownloaded: totalBarsDownloaded,
          bytesTransferred: totalBytesTransferred,
          speedKbps:
            performance.now() - startMs > 100
              ? Math.round((totalBytesTransferred / 1024) / ((performance.now() - startMs) / 1000))
              : 0,
          completedPackIds: [...completedPackIds],
        });

        try {
          const interval = timeframeUsToBybitInterval(task.timeframeUs);
          const bars = await liveFeedService.fetchRealHistoricalKlines(
            task.symbol,
            interval,
            task.limit,
            undefined,
            signal,
            true
          );
          if (bars && bars.length > 0) {
            const key = `${task.cacheKeyPrefix}_${task.timeframeUs}`;
            seriesMap[key] = bars;
            packBars += bars.length;
            totalBarsDownloaded += bars.length;
            totalBytesTransferred += JSON.stringify(bars).length;
          }
        } catch (err) {
          errors.push(`Lỗi tải ${task.symbol} ${task.tfLabel}: ${String(err)}`);
        }

        completedTasks++;
        onProgress({
          packId: pack.id,
          packTitle: pack.title,
          stage: `Hoàn tất ${task.symbol} ${task.tfLabel} · Đang nén & kiểm tra SHA-256...`,
          completedTasks,
          totalTasks,
          percent: Math.round((completedTasks / Math.max(totalTasks, 1)) * 100),
          barsDownloaded: totalBarsDownloaded,
          bytesTransferred: totalBytesTransferred,
          speedKbps:
            performance.now() - startMs > 100
              ? Math.round((totalBytesTransferred / 1024) / ((performance.now() - startMs) / 1000))
              : 0,
          completedPackIds: [...completedPackIds],
        });
      }

      if (signal?.aborted) break;

      if (packBars > 0) {
        try {
          const saved = await this.savePackPayload(pack, seriesMap, packBars);
          installed.push(saved);
          completedPackIds.push(pack.id);
        } catch (e) {
          errors.push(`Lỗi lưu gói ${pack.id}: ${String(e)}`);
        }
      } else {
        errors.push(`Không nhận được dữ liệu nến cho gói ${pack.title} (kiểm tra kết nối mạng).`);
      }
    }

    return {
      ok: installed.length > 0 && !signal?.aborted,
      installed,
      errors,
    };
  }

  async deletePack(packId: string): Promise<DataManifestDTO> {
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<DataManifestDTO>('data_delete_pack', { packId });
    }
    const db = await openBrowserDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([IDB_STORE_PACKS, IDB_STORE_META], 'readwrite');
      tx.objectStore(IDB_STORE_PACKS).delete(packId);
      tx.objectStore(IDB_STORE_META).delete(packId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return this.getManifest();
  }

  async clearAll(): Promise<DataManifestDTO> {
    HYDRATED_PACK_BARS.clear();
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<DataManifestDTO>('data_clear_all');
    }
    const db = await openBrowserDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([IDB_STORE_PACKS, IDB_STORE_META], 'readwrite');
      tx.objectStore(IDB_STORE_PACKS).clear();
      tx.objectStore(IDB_STORE_META).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return this.getManifest();
  }

  async verifyIntegrity(): Promise<IntegrityReportDTO> {
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<IntegrityReportDTO>('data_verify_integrity');
    }
    const manifest = await this.getManifest();
    const db = await openBrowserDb();
    const items: IntegrityCheckItemDTO[] = [];
    let allValid = true;
    for (const p of manifest.packs) {
      const row: any = await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE_PACKS, 'readonly');
        const req = tx.objectStore(IDB_STORE_PACKS).get(p.pack_id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!row?.payload) {
        allValid = false;
        items.push({ pack_id: p.pack_id, ok: false, message: 'Missing IndexedDB archive' });
      } else {
        const digest = await sha256HexBrowser(row.payload);
        if (digest === p.sha256) {
          items.push({ pack_id: p.pack_id, ok: true, message: `SHA-256 OK (${digest.slice(0, 12)}..)` });
        } else {
          allValid = false;
          items.push({ pack_id: p.pack_id, ok: false, message: 'Checksum mismatch' });
        }
      }
    }
    return { all_valid: allValid, checked_count: items.length, items };
  }
}

export const dataPackService = new DataPackService();
