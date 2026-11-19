//! DeepChart Workspace Layout & Preference Persistence
//! Safely persists user terminal layout, active overlays, themes, floating windows, and fast cold-start snapshot caches.

import { BarDTO, ChartSnapshotDTO } from '../types';

export type FootprintColorMode = 'bid_ask' | 'delta_gradient' | 'monochrome';
export type HeatmapPalette = 'fire' | 'neon' | 'greyscale';
export type LayoutPreset = 'standard' | 'order_flow_pro' | 'pure_heatmap' | 'options_confluence' | 'market_intel';

export interface FloatingWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isOpen: boolean;
}

export interface WorkspaceConfig {
  instrumentId: string;
  timeframe: string;
  layoutPreset: LayoutPreset;
  showHeatmap: boolean;
  showOptions: boolean;
  showSignals: boolean;
  showVwap: boolean;
  showVolumeProfile: boolean;
  soundAlertsEnabled: boolean;
  showDomPanel: boolean;
  showTape: boolean;
  isDomFloating: boolean;
  isTapeFloating: boolean;
  footprintMode: FootprintColorMode;
  heatmapPalette: HeatmapPalette;
  whaleVolumeThreshold: number;
  imbalanceRatioPct: number;
  minStackedLevels: number;
}

const STORAGE_KEY = 'deepchart_workspace_config_v4';
const SNAPSHOT_CACHE_KEY = 'deepchart_snapshot_cache_v6';

// In-memory zero-latency cache to avoid synchronous JSON.parse / JSON.stringify blocking on timeframe switches
const MEMORY_BARS_CACHE = new Map<string, BarDTO[]>();
const PENDING_SAVE_TIMERS = new Map<string, ReturnType<typeof setTimeout>>();

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  instrumentId: 'BYBIT:LINEAR_PERP:BTCUSDT:PERP',
  timeframe: '1m',
  layoutPreset: 'standard',
  showHeatmap: true,
  showOptions: true,
  showSignals: true,
  showVwap: true,
  showVolumeProfile: true,
  soundAlertsEnabled: true,
  showDomPanel: true,
  showTape: true,
  isDomFloating: false,
  isTapeFloating: false,
  footprintMode: 'bid_ask',
  heatmapPalette: 'fire',
  whaleVolumeThreshold: 500,
  imbalanceRatioPct: 300,
  minStackedLevels: 3,
};

export function loadWorkspaceConfig(): WorkspaceConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_WORKSPACE_CONFIG, ...parsed };
    }
  } catch (e) {
    console.warn('Failed to load workspace config, using defaults:', e);
  }
  return DEFAULT_WORKSPACE_CONFIG;
}

export function saveWorkspaceConfig(config: Partial<WorkspaceConfig>): void {
  try {
    const current = loadWorkspaceConfig();
    const updated = { ...current, ...config };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to save workspace config:', e);
  }
}

/// Instant Cold-Start Local Cache: Caches latest snapshot in LocalStorage
/// Allows the terminal to render immediately on application relaunch without flicker.
export function saveSnapshotCache(snapshot: ChartSnapshotDTO): void {
  try {
    // Only cache reasonable subset of bars (e.g. up to 100) to keep localStorage fast
    const pruned: ChartSnapshotDTO = {
      ...snapshot,
      bars: snapshot.bars.slice(-100),
      heatmap_slices: snapshot.heatmap_slices?.slice(-50),
      recent_trades: snapshot.recent_trades?.slice(-100),
    };
    localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(pruned));
  } catch (e) {
    // Ignore quota errors if storage full
  }
}

export function loadSnapshotCache(): ChartSnapshotDTO | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_CACHE_KEY);
    if (raw) {
      const snap = JSON.parse(raw) as ChartSnapshotDTO;
      // Sanity check: purge obsolete mock snapshot if BTC bars are at old $95k level or 2023 mock timestamps
      if (
        snap.bars?.some((b) => b.bar_start_us < 1730000000000000) ||
        (snap.instrument_id?.includes('BTC') && snap.bars?.some((b) => b.close_ticks > 8000000))
      ) {
        localStorage.removeItem(SNAPSHOT_CACHE_KEY);
        return null;
      }
      return snap;
    }
  } catch (e) {
    console.warn('Failed to parse snapshot cache:', e);
  }
  return null;
}

export function loadSymbolBars(symbol: string): BarDTO[] {
  const mem = MEMORY_BARS_CACHE.get(symbol);
  if (mem && mem.length > 0) {
    return mem;
  }
  try {
    const raw = localStorage.getItem(`deepchart_bars_v6_${symbol}`);
    if (raw) {
      const bars = JSON.parse(raw) as BarDTO[];
      // Sanity check: if cached bars have mock timestamps (< Nov 2024) or wildly inaccurate mock prices, purge them
      if (
        bars.some((b) => b.bar_start_us < 1730000000000000) ||
        (symbol.includes('BTC') && bars.some((b) => b.close_ticks > 8000000 || b.close_ticks < 4000000))
      ) {
        localStorage.removeItem(`deepchart_bars_v6_${symbol}`);
        return [];
      }
      MEMORY_BARS_CACHE.set(symbol, bars);
      return bars;
    }
  } catch (e) {
    console.warn('Failed to load symbol bars cache:', e);
  }
  return [];
}

export function saveSymbolBars(symbol: string, bars: BarDTO[]): void {
  // 1. Update in-memory cache immediately (0ms latency, zero main-thread freeze)
  const memTrimmed = bars.slice(-350);
  MEMORY_BARS_CACHE.set(symbol, memTrimmed);

  // 2. Debounce & defer localStorage serialization off the UI interaction frame
  const existingTimer = PENDING_SAVE_TIMERS.get(symbol);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    PENDING_SAVE_TIMERS.delete(symbol);
    try {
      // Only persist the latest 140 bars to localStorage to keep JSON.stringify < 2ms
      const storageTrimmed = memTrimmed.slice(-140);
      localStorage.setItem(`deepchart_bars_v6_${symbol}`, JSON.stringify(storageTrimmed));
    } catch {
      // ignore quota error
    }
  }, 250);
  PENDING_SAVE_TIMERS.set(symbol, timer);
}

export function mergeBars(existing: BarDTO[], incoming: BarDTO[]): BarDTO[] {
  if (existing.length === 0) return incoming;
  if (incoming.length === 0) return existing;

  // Sanity check: Discard existing bars if their price scale is completely mismatched (>15% deviation, e.g. mock 95k vs real 67k)
  const existingPrice = existing[existing.length - 1].close_ticks;
  const incomingPrice = incoming[0].close_ticks;
  if (incomingPrice > 0 && Math.abs(existingPrice - incomingPrice) / incomingPrice > 0.15) {
    return [...incoming].sort((a, b) => a.bar_start_us - b.bar_start_us);
  }

  const barMap = new Map<number, BarDTO>();
  existing.forEach((b) => barMap.set(b.bar_start_us, b));
  incoming.forEach((b) => barMap.set(b.bar_start_us, b));
  const merged = Array.from(barMap.values());
  merged.sort((a, b) => a.bar_start_us - b.bar_start_us);
  return merged;
}
