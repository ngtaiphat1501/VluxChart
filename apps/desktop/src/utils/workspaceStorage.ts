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
const SNAPSHOT_CACHE_KEY = 'deepchart_snapshot_cache_v8';
const BARS_CACHE_PREFIX = 'deepchart_bars_v8_';

// In-memory zero-latency cache to avoid synchronous JSON.parse / JSON.stringify blocking on timeframe switches
const MEMORY_BARS_CACHE = new Map<string, BarDTO[]>();
const PENDING_SAVE_TIMERS = new Map<string, ReturnType<typeof setTimeout>>();
let PENDING_SNAPSHOT_SAVE_TIMER: ReturnType<typeof setTimeout> | null = null;

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

/// Instant Cold-Start Local Cache: Debounced & off-frame so symbol/timeframe switches NEVER stutter on JSON.stringify
export function saveSnapshotCache(snapshot: ChartSnapshotDTO): void {
  if (!snapshot.bars || snapshot.bars.length === 0) {
    return;
  }
  if (PENDING_SNAPSHOT_SAVE_TIMER) {
    clearTimeout(PENDING_SNAPSHOT_SAVE_TIMER);
  }
  PENDING_SNAPSHOT_SAVE_TIMER = setTimeout(() => {
    PENDING_SNAPSHOT_SAVE_TIMER = null;
    try {
      const pruned: ChartSnapshotDTO = {
        ...snapshot,
        bars: snapshot.bars.slice(-60),
        heatmap_slices: snapshot.heatmap_slices?.slice(-24),
        recent_trades: snapshot.recent_trades?.slice(-40),
      };
      localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(pruned));
    } catch {
      // Ignore quota errors if storage full
    }
  }, 450);
}

export function loadSnapshotCache(): ChartSnapshotDTO | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_CACHE_KEY);
    if (raw) {
      const snap = JSON.parse(raw) as ChartSnapshotDTO;
      // Sanity check: purge empty snapshots, ancient pre-2024 fixtures, or corrupted non-positive prices
      const isSynth = Boolean(snap.instrument_id && snap.instrument_id.startsWith('SYNTH:'));
      if (
        !Array.isArray(snap.bars) ||
        snap.bars.length === 0 ||
        snap.bars.some((b) => b.bar_start_us < 1704067200000000 || (!isSynth && b.close_ticks <= 0))
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
    const raw = localStorage.getItem(`${BARS_CACHE_PREFIX}${symbol}`);
    if (raw) {
      const bars = JSON.parse(raw) as BarDTO[];
      // Sanity check: purge ancient pre-2024 fixtures, non-positive prices, or legacy synthetic sine-wave bars
      const isLegacySynthetic =
        Array.isArray(bars) &&
        bars.length >= 10 &&
        bars.slice(0, 10).every((b) => b.trade_count === Math.round(b.total_units / 6) + 1);
      const isSynthSym = symbol.startsWith('SYNTH:');
      if (
        !Array.isArray(bars) ||
        isLegacySynthetic ||
        bars.some((b) => b.bar_start_us < 1704067200000000 || (!isSynthSym && b.close_ticks <= 0))
      ) {
        localStorage.removeItem(`${BARS_CACHE_PREFIX}${symbol}`);
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
  // 1. Keep up to 50,000 historical bars in fast RAM cache (zero artificial 350-bar truncation!)
  const memTrimmed = bars.length > 50_000 ? bars.slice(-50_000) : bars;
  MEMORY_BARS_CACHE.set(symbol, memTrimmed);

  // 2. Debounce & defer localStorage serialization off the UI interaction frame
  const existingTimer = PENDING_SAVE_TIMERS.get(symbol);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    PENDING_SAVE_TIMERS.delete(symbol);
    try {
      // Persist latest 240 bars in localStorage for instant cold-start while full history lives in RAM + Gzip Data Packs
      const storageTrimmed = memTrimmed.slice(-240);
      localStorage.setItem(`${BARS_CACHE_PREFIX}${symbol}`, JSON.stringify(storageTrimmed));
    } catch {
      // ignore quota error
    }
  }, 250);
  PENDING_SAVE_TIMERS.set(symbol, timer);
}

export function mergeBars(existing: BarDTO[], incoming: BarDTO[]): BarDTO[] {
  if (existing.length === 0) return incoming;
  if (incoming.length === 0) return existing;

  // Only guard against genuine cross-symbol scale collisions (>5x difference, e.g. $60k BTC vs $3.6k Gold),
  // NEVER discard genuine multi-week/multi-year historical swings (>2% away from current price)!
  const existingPrice = existing[existing.length - 1].close_ticks;
  const incomingPrice = incoming[incoming.length - 1].close_ticks;
  if (
    existingPrice > 0 &&
    incomingPrice > 0 &&
    Math.max(existingPrice, incomingPrice) / Math.min(existingPrice, incomingPrice) > 5.0
  ) {
    return [...incoming].sort((a, b) => a.bar_start_us - b.bar_start_us);
  }

  const barMap = new Map<number, BarDTO>();
  existing.forEach((b) => barMap.set(b.bar_start_us, b));
  incoming.forEach((b) => barMap.set(b.bar_start_us, b));
  const merged = Array.from(barMap.values());
  merged.sort((a, b) => a.bar_start_us - b.bar_start_us);
  return merged;
}
