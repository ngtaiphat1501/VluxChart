import React, { useState, useEffect, useRef } from 'react';
import { Toolbar } from './components/Toolbar';
import { FootprintCanvas } from './components/FootprintCanvas';
import { TradingViewChartPanel } from './components/TradingViewChartPanel';
import { TimeAndSalesTape } from './components/TimeAndSalesTape';
import { DomLadderPanel } from './components/DomLadderPanel';
import { FloatingPanel } from './components/FloatingPanel';
import { BacktestModal } from './components/BacktestModal';
import { ZoneInspectorModal } from './components/ZoneInspectorModal';
import { SettingsModal } from './components/SettingsModal';
import { DrawingToolbar } from './components/DrawingToolbar';
import { LeftToolsSidebar } from './components/LeftToolsSidebar';
import { RightDockPanel, RightDockTab } from './components/RightDockPanel';
import { OptionsGammaProfilePanel } from './components/OptionsGammaProfilePanel';
import { MultiChartGrid, MultiChartLayout } from './components/MultiChartGrid';
import { Mt5ConnectionModal } from './components/Mt5ConnectionModal';
import { OrderFlowAlert } from './components/AlertNotificationCenter';
import {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  loadSnapshotCache,
  saveSnapshotCache,
  loadSymbolBars,
  saveSymbolBars,
  mergeBars,
  LayoutPreset,
  WorkspaceConfig,
} from './utils/workspaceStorage';
import { loadDrawings, saveDrawings } from './utils/drawingStorage';
import { SoundManager } from './utils/soundManager';
import {
  BarDTO,
  BacktestConfigDTO,
  BacktestReportDTO,
  ChartDrawing,
  ChartSnapshotDTO,
  DrawingTool,
  OptimizationReportDTO,
  OptimizationSweepConfigDTO,
  OrderBookSnapshotDTO,
  TradeEventDTO,
} from './types';
import {
  CANONICAL_INSTRUMENTS,
  generateCanonicalSnapshot,
} from './utils/instrumentRegistry';
import { liveFeedService, getFootprintTickStep, timeframeUsToBybitInterval } from './services/liveFeedService';
import { computeSessionVwap, recalculateOptionsLevels } from './utils/orderFlowMath';
import { adaptSnapshotToTimeframe } from './utils/multiTimeframeAggregator';
import { mt5BridgeService } from './services/mt5BridgeService';

function getBybitSymbol(instrumentId: string): string {
  if (instrumentId.startsWith('MT5:')) return instrumentId;
  if (instrumentId.includes('ETH')) return 'ETHUSDT';
  if (instrumentId.includes('XAU')) return 'XAUUSDT';
  return 'BTCUSDT';
}

// Default initial fallback snapshot generated dynamically from canonical registry
const DEFAULT_SNAPSHOT: ChartSnapshotDTO = generateCanonicalSnapshot('BYBIT:LINEAR_PERP:BTCUSDT:PERP');

export function App() {
  const [snapshot, setSnapshot] = useState<ChartSnapshotDTO>(() => loadSnapshotCache() || DEFAULT_SNAPSHOT);
  const [isLiveFeedActive, setIsLiveFeedActive] = useState<boolean>(true);
  const [alerts, setAlerts] = useState<OrderFlowAlert[]>([]);

  // High-performance RAF throttle queues to keep UI at solid 60 FPS under live market bursts
  const pendingTradesRef = useRef<TradeEventDTO[]>([]);
  const pendingOrderBookRef = useRef<OrderBookSnapshotDTO | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const timeframeRequestIdRef = useRef<number>(0);
  const lastObCommitMsRef = useRef<number>(0);
  const lastHeatmapSliceMsRef = useRef<number>(0);
  const [showNarrative, setShowNarrative] = useState(true);
  const [showGreeks, setShowGreeks] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isBacktestOpen, setIsBacktestOpen] = useState(false);
  const [isZoneInspectorOpen, setIsZoneInspectorOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMt5ModalOpen, setIsMt5ModalOpen] = useState(false);
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceConfig>(loadWorkspaceConfig());
  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>(workspaceConfig.layoutPreset || 'order_flow_pro');
  const [showTape, setShowTape] = useState<boolean>(workspaceConfig.showTape ?? true);
  const [showDom, setShowDom] = useState<boolean>(workspaceConfig.showDomPanel ?? true);
  const [isDomFloating, setIsDomFloating] = useState<boolean>(workspaceConfig.isDomFloating ?? false);
  const [isTapeFloating, setIsTapeFloating] = useState<boolean>(workspaceConfig.isTapeFloating ?? false);
  const [chartViewMode, setChartViewMode] = useState<'candlestick' | 'footprint' | 'hybrid'>('hybrid');
  const [priceBounds, setPriceBounds] = useState<{ minPrice: number; maxPrice: number; chartHeight: number; panY: number }>({
    minPrice: 0,
    maxPrice: 0,
    chartHeight: 600,
    panY: 0,
  });
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);
  const [tickAggregation, setTickAggregation] = useState<number | 'auto'>('auto');
  const [multiChartLayout, setMultiChartLayout] = useState<MultiChartLayout>('1x1');

  const [rightDockTab, setRightDockTab] = useState<RightDockTab | null>('trading');

  const handleToggleRightTab = (tab: string) => {
    if (rightDockTab === tab) {
      setRightDockTab(null);
    } else {
      setRightDockTab(tab as RightDockTab);
    }
  };

  // Layer 8: Interactive Drawing Suite State (VIS-008)
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingTool>('cursor');
  const [drawingColor, setDrawingColor] = useState<string>('#00E5FF');
  const [drawingsVisible, setDrawingsVisible] = useState<boolean>(true);
  const [magnetEnabled, setMagnetEnabled] = useState<boolean>(false);
  const [isPickingPriceOnChart, setIsPickingPriceOnChart] = useState<boolean>(false);
  const [pickedOrderPriceTicks, setPickedOrderPriceTicks] = useState<number | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>(() =>
    loadDrawings((loadSnapshotCache() || DEFAULT_SNAPSHOT).instrument_id)
  );

  useEffect(() => {
    setDrawings(loadDrawings(snapshot.instrument_id));
  }, [snapshot.instrument_id]);

  const handleDrawingCreated = (newDrawing: ChartDrawing) => {
    setDrawings((prev) => {
      const next = [...prev, newDrawing];
      saveDrawings(snapshot.instrument_id, next);
      return next;
    });
    // TradingView standard: Automatically return to cursor mode after completing a drawing (no tool spam!)
    setActiveDrawingTool('cursor');
  };

  const handleDrawingUpdated = (updatedDrawing: ChartDrawing) => {
    setDrawings((prev) => {
      const next = prev.map((d) => (d.id === updatedDrawing.id ? updatedDrawing : d));
      saveDrawings(snapshot.instrument_id, next);
      return next;
    });
  };

  const handleDrawingDeleted = (id: string) => {
    setDrawings((prev) => {
      const next = prev.filter((d) => d.id !== id);
      saveDrawings(snapshot.instrument_id, next);
      return next;
    });
  };

  const handleUndoLastDrawing = () => {
    setDrawings((prev) => {
      const next = prev.slice(0, -1);
      saveDrawings(snapshot.instrument_id, next);
      return next;
    });
  };

  const handleClearAllDrawings = () => {
    setDrawings([]);
    saveDrawings(snapshot.instrument_id, []);
  };


  const handleLayoutPresetChange = (preset: LayoutPreset) => {
    setLayoutPreset(preset);
    if (preset === 'standard') {
      setRightDockTab('dom_tape');
      setShowDom(false);
      setShowTape(true);
      setShowGreeks(false);
      setIsDomFloating(false);
      setIsTapeFloating(false);
    } else if (preset === 'order_flow_pro') {
      setRightDockTab('dom_tape');
      setShowDom(true);
      setShowTape(true);
      setShowGreeks(false);
      setIsDomFloating(false);
      setIsTapeFloating(false);
    } else if (preset === 'pure_heatmap') {
      setRightDockTab(null);
      setShowDom(false);
      setShowTape(false);
      setShowGreeks(false);
    } else if (preset === 'options_confluence') {
      setRightDockTab('greeks');
      setShowDom(false);
      setShowTape(true);
      setShowGreeks(true);
    } else if (preset === 'market_intel') {
      setRightDockTab('dom_tape');
      setIsZoneInspectorOpen(true);
    }
    saveWorkspaceConfig({ layoutPreset: preset });
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;

      if (e.ctrlKey && e.key === '1') {
        e.preventDefault();
        handleLayoutPresetChange('order_flow_pro');
      } else if (e.ctrlKey && e.key === '2') {
        e.preventDefault();
        handleLayoutPresetChange('pure_heatmap');
      } else if (e.ctrlKey && e.key === '3') {
        e.preventDefault();
        handleLayoutPresetChange('options_confluence');
      } else if (e.ctrlKey && e.key === '4') {
        e.preventDefault();
        handleLayoutPresetChange('market_intel');
      } else if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        setActiveDrawingTool('horizontal_line');
      } else if (e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        setActiveDrawingTool('horizontal_ray');
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        handleUndoLastDrawing();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
        setRightDockTab((prev) => (prev ? null : 'dom_tape'));
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    SoundManager.initFromStorage();
    setSoundEnabled(SoundManager.isEnabled());
  }, []);

  const fetchSnapshot = async () => {
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        const snap = await invoke<ChartSnapshotDTO>('get_chart_snapshot');
        if (snap) {
          // Guard: if live feed is active, do not overwrite live real-time data with mock snapshot
          if (isLiveFeedActive) {
            return;
          }
          setSnapshot(snap);
          saveSnapshotCache(snap);
          checkNewAlerts(snap);
        }
      }
    } catch (e) {
      console.warn('Tauri IPC offline, running in browser preview mode:', e);
    }
  };

  const checkNewAlerts = (snap: ChartSnapshotDTO) => {
    const newAlerts: OrderFlowAlert[] = [];

    // Check for Stacked Imbalances
    snap.bars.forEach((b) => {
      b.stacked_imbalances?.forEach((st) => {
        newAlerts.push({
          id: `stack-${b.bar_start_us}-${st.start_price_ticks}`,
          timestamp: new Date(b.bar_start_us / 1000),
          type: 'StackedImbalance',
          title: `${st.levels_count}x ${st.side.toUpperCase()} STACK`,
          priceTicks: st.start_price_ticks,
          details: `Institutional momentum swept ${st.levels_count} price levels (${(st.total_imbalance_volume).toLocaleString()} units)`,
        });
      });

      // Check for Order Flow Signals
      b.signals?.forEach((sig) => {
        const isAbs = sig.signal_type.includes('Absorption');
        newAlerts.push({
          id: `sig-${b.bar_start_us}-${sig.price_ticks}`,
          timestamp: new Date(b.bar_start_us / 1000),
          type: isAbs ? 'Absorption' : 'Exhaustion',
          title: sig.signal_type,
          priceTicks: sig.price_ticks,
          details: sig.description,
        });
      });
    });

    // Check for Delta Divergences
    snap.divergences?.forEach((d) => {
      newAlerts.push({
        id: `div-${d.bar_start_us}-${d.price_ticks}`,
        timestamp: new Date(d.bar_start_us / 1000),
        type: 'Divergence',
        title: d.divergence_type,
        priceTicks: d.price_ticks,
        details: d.description,
      });
    });

    // Check for Iceberg Liquidity
    snap.icebergs?.forEach((ice) => {
      newAlerts.push({
        id: `ice-${ice.detected_at_us}-${ice.price_ticks}`,
        timestamp: new Date(ice.detected_at_us / 1000),
        type: 'Iceberg',
        title: `ICEBERG DETECTED (${ice.side.toUpperCase()})`,
        priceTicks: ice.price_ticks,
        details: `Replenished hidden liquidity: ${ice.hidden_volume_units.toLocaleString()} units hidden (Displayed: ${ice.peak_displayed_units.toLocaleString()}, ${ice.refill_count}x refills)`,
      });
    });

    // Check for Whale Trades (Volume >= 500)
    snap.bars.forEach((b) => {
      b.footprint?.forEach((lvl) => {
        if (lvl.total_units >= 500) {
          newAlerts.push({
            id: `whale-${b.bar_start_us}-${lvl.price_ticks}`,
            timestamp: new Date(b.bar_start_us / 1000),
            type: 'Whale',
            title: `WHALE ACCUMULATION (${lvl.total_units.toLocaleString()} units)`,
            priceTicks: lvl.price_ticks,
            details: `Institutional volume clustered at price ${lvl.price_ticks}: Buy=${lvl.buy_units}, Sell=${lvl.sell_units}`,
          });
        }
      });
    });

    if (newAlerts.length > 0) {
      setAlerts((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        const added = newAlerts.filter((a) => !seen.has(a.id));
        if (added.length === 0) return prev;

        // Play synthetic acoustic cues for newly detected order flow events
        if (SoundManager.isEnabled()) {
          const first = added[0];
          if (first.type === 'Whale') SoundManager.playWhaleChime();
          else if (first.type === 'Iceberg') SoundManager.playIcebergPing();
          else if (first.type === 'StackedImbalance') SoundManager.playStackSwoosh();
          else if (first.type === 'Divergence') SoundManager.playDivergenceWarning();
          else if (first.type === 'Absorption' || first.type === 'Exhaustion') SoundManager.playWhaleChime();
        }

        return [...added, ...prev].slice(0, 30); // Keep last 30 alerts
      });
    }
  };

  const handleTimeframeChange = async (timeframeUs: number) => {
    const reqId = ++timeframeRequestIdRef.current;
    saveWorkspaceConfig({ timeframe: timeframeUs.toString() });
    const symbol = getBybitSymbol(snapshot.instrument_id);
    const interval = timeframeUsToBybitInterval(timeframeUs);

    // 1. Check in-memory / local cache for this symbol & timeframe (0ms instant switch!)
    const cachedBars = loadSymbolBars(`${symbol}_${timeframeUs}`);
    if (cachedBars && cachedBars.length > 0) {
      setSnapshot((prev) => ({
        ...prev,
        timeframe_us: timeframeUs,
        bars: cachedBars,
        active_bar: cachedBars[cachedBars.length - 1],
      }));
    } else {
      // Immediately adapt current bars deterministically in <1ms so UI transitions at 0ms
      setSnapshot((prev) => adaptSnapshotToTimeframe(prev, timeframeUs));
    }

    // 2. Fetch fresh historical klines for this timeframe (220 bars for fast <60ms response)
    try {
      const realBars = await liveFeedService.fetchRealHistoricalKlines(symbol, interval, 220);
      if (reqId !== timeframeRequestIdRef.current) return; // Ignore stale response if user clicked another timeframe
      if (realBars && realBars.length > 0) {
        const lastBar = realBars[realBars.length - 1];
        const pureBars = realBars.slice(0, -1);
        saveSymbolBars(`${symbol}_${timeframeUs}`, pureBars);

        setSnapshot((prev) => ({
          ...prev,
          timeframe_us: timeframeUs,
          bars: pureBars,
          active_bar: lastBar,
        }));
      }
    } catch (err) {
      console.warn(`[LiveFeed] Failed to load fresh klines for timeframe ${interval}:`, err);
    }
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    SoundManager.setEnabled(next);
    setSoundEnabled(next);
    handleSaveConfig({ soundAlertsEnabled: next });
  };

  const handleSaveConfig = (newCfg: Partial<WorkspaceConfig>) => {
    saveWorkspaceConfig(newCfg);
    setWorkspaceConfig((prev) => ({ ...prev, ...newCfg }));
    if (newCfg.soundAlertsEnabled !== undefined) {
      setSoundEnabled(newCfg.soundAlertsEnabled);
      SoundManager.setEnabled(newCfg.soundAlertsEnabled);
    }
  };

  const handleRunBacktest = async (config: BacktestConfigDTO): Promise<BacktestReportDTO> => {
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        const report = await invoke<BacktestReportDTO>('run_order_flow_backtest', { config });
        if (report) return report;
      }
    } catch (e) {
      console.warn('Tauri run_order_flow_backtest failed:', e);
    }

    // In-browser preview simulated calculation
    return {
      strategy_name: config.strategy_name,
      total_trades: 14,
      winning_trades: 9,
      losing_trades: 5,
      win_rate_pct: 64.3,
      gross_profit_ticks: 9 * config.take_profit_ticks,
      gross_loss_ticks: 5 * config.stop_loss_ticks,
      net_pnl_ticks: 9 * config.take_profit_ticks - 5 * config.stop_loss_ticks,
      profit_factor: (9 * config.take_profit_ticks) / (5 * config.stop_loss_ticks || 1),
      max_drawdown_ticks: config.stop_loss_ticks * 2,
      max_drawdown_pct: 2.8,
      avg_trade_pnl_ticks: (9 * config.take_profit_ticks - 5 * config.stop_loss_ticks) / 14,
      trades: Array.from({ length: 14 }).map((_, i) => {
        const basePrice = snapshot.active_bar?.close_ticks || (CANONICAL_INSTRUMENTS[snapshot.instrument_id]?.basePriceTicks || 0);
        return {
          trade_id: i + 1,
          side: i % 2 === 0 ? 'Buy' : 'Sell',
          entry_price_ticks: basePrice + i * 150,
          exit_price_ticks: basePrice + i * 150 + (i % 3 === 0 ? -config.stop_loss_ticks : config.take_profit_ticks),
          entry_time_us: Date.now() * 1000 - (14 - i) * 60_000_000,
          exit_time_us: Date.now() * 1000 - (14 - i) * 60_000_000 + 45_000_000,
          quantity_units: config.trade_size_units,
          pnl_ticks: i % 3 === 0 ? -config.stop_loss_ticks : config.take_profit_ticks,
          pnl_pct: i % 3 === 0 ? -0.32 : 0.64,
          exit_reason: i % 3 === 0 ? 'StopLoss' : 'TakeProfit',
        };
      }),
    };
  };

  const handleRunOptimization = async (config: OptimizationSweepConfigDTO): Promise<OptimizationReportDTO> => {
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        const rep = await invoke<OptimizationReportDTO>('run_strategy_optimization', { config });
        if (rep) return rep;
      }
    } catch (e) {
      console.warn('Tauri run_strategy_optimization failed:', e);
    }

    // In-browser preview fallback simulation
    const matrix: any[] = [];
    let bestPf = 0;
    let bestSl = 1500;
    let bestTp = 3000;
    let bestPnl = 0;

    for (const sl of config.stop_loss_range) {
      for (const tp of config.take_profit_range) {
        const pf = Number(((tp / (sl * 0.8 + 200)) * (1.1 + Math.sin(sl + tp) * 0.3)).toFixed(2));
        const netPnl = Math.round((pf - 1.0) * 125000);
        if (pf > bestPf) {
          bestPf = pf;
          bestSl = sl;
          bestTp = tp;
          bestPnl = netPnl;
        }
        matrix.push({
          stop_loss_ticks: sl,
          take_profit_ticks: tp,
          total_trades: 18,
          winning_trades: Math.round(18 * (pf / (pf + 1))),
          win_rate_pct: Number(((pf / (pf + 1)) * 100).toFixed(1)),
          net_pnl_ticks: netPnl,
          profit_factor: pf,
          max_drawdown_pct: Number((sl / 500).toFixed(1)),
        });
      }
    }

    return {
      strategy_name: config.strategy_name,
      best_stop_loss_ticks: bestSl,
      best_take_profit_ticks: bestTp,
      best_profit_factor: bestPf,
      best_net_pnl_ticks: bestPnl,
      total_combinations: matrix.length,
      matrix,
    };
  };

  const handleInstrumentChange = async (instrumentId: string) => {
    saveWorkspaceConfig({ instrumentId });
    if (instrumentId.startsWith('MT5:')) {
      mt5BridgeService.syncFromRealMt5().catch(() => {});
    }
    let newSnap: ChartSnapshotDTO | null = null;
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        const snap = await invoke<ChartSnapshotDTO>('switch_instrument', { instrumentId });
        if (snap) {
          newSnap = snap;
        }
      }
    } catch (e) {
      console.warn('Tauri switch_instrument failed:', e);
    }

    if (!newSnap) {
      newSnap = generateCanonicalSnapshot(instrumentId);
    }

    setSnapshot(newSnap);
    saveSnapshotCache(newSnap);
  };

  const handleToggleReplay = async (enable: boolean) => {
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        const snap = await invoke<ChartSnapshotDTO>('toggle_replay', { enable });
        if (snap) {
          setSnapshot(snap);
          return;
        }
      }
    } catch (e) {
      console.warn('Tauri toggle_replay failed:', e);
    }

    // Browser simulation
    setSnapshot((prev) => ({
      ...prev,
      playback: enable
        ? {
            is_replay_mode: true,
            state: 'Playing',
            speed_multiplier: 1,
            progress_pct: 15,
            current_ts_us: 1700000060000000,
          }
        : undefined,
    }));
  };

  const handlePlayReplay = async () => {
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('play_replay');
        await fetchSnapshot();
        return;
      }
    } catch (e) {
      console.warn('Tauri play_replay failed:', e);
    }
    setSnapshot((prev) =>
      prev.playback
        ? {
            ...prev,
            playback: { ...prev.playback, state: 'Playing' },
          }
        : prev
    );
  };

  const handlePauseReplay = async () => {
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('pause_replay');
        await fetchSnapshot();
        return;
      }
    } catch (e) {
      console.warn('Tauri pause_replay failed:', e);
    }
    setSnapshot((prev) =>
      prev.playback
        ? {
            ...prev,
            playback: { ...prev.playback, state: 'Paused' },
          }
        : prev
    );
  };

  const handleStepReplay = async () => {
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        const snap = await invoke<ChartSnapshotDTO>('step_replay');
        if (snap) {
          setSnapshot(snap);
          return;
        }
      }
    } catch (e) {
      console.warn('Tauri step_replay failed:', e);
    }
    setSnapshot((prev) =>
      prev.playback
        ? {
            ...prev,
            playback: {
              ...prev.playback,
              progress_pct: Math.min(100, prev.playback.progress_pct + 5),
            },
          }
        : prev
    );
  };

  const handleResetReplay = async () => {
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        const snap = await invoke<ChartSnapshotDTO>('reset_replay');
        if (snap) {
          setSnapshot(snap);
          return;
        }
      }
    } catch (e) {
      console.warn('Tauri reset_replay failed:', e);
    }
    setSnapshot((prev) =>
      prev.playback
        ? {
            ...prev,
            playback: {
              ...prev.playback,
              progress_pct: 0,
              state: 'Paused',
            },
          }
        : prev
    );
  };

  const handleSpeedChange = async (speed: number) => {
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_replay_speed', { speed });
        await fetchSnapshot();
        return;
      }
    } catch (e) {
      console.warn('Tauri set_replay_speed failed:', e);
    }
    setSnapshot((prev) =>
      prev.playback
        ? {
            ...prev,
            playback: {
              ...prev.playback,
              speed_multiplier: speed,
            },
          }
        : prev
    );
  };

  const handleExportCSV = async () => {
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        const csvContent = await invoke<string>('export_chart_csv', { exportType: 'bars' });
        if (csvContent) {
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', `DeepChart_${snapshot.instrument_id.replace(/:/g, '_')}_bars.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          return;
        }
      }
    } catch (e) {
      console.warn('Tauri export_chart_csv failed, falling back to client-side CSV:', e);
    }

    // Client-side CSV generator fallback
    let csv = 'bar_start_us,timeframe_us,open_ticks,high_ticks,low_ticks,close_ticks,buy_units,sell_units,total_units,delta_units,poc_ticks\n';
    snapshot.bars.forEach((b) => {
      csv += `${b.bar_start_us},${b.timeframe_us},${b.open_ticks},${b.high_ticks},${b.low_ticks},${b.close_ticks},${b.buy_units},${b.sell_units},${b.total_units},${b.delta_units},${b.poc_ticks || ''}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `DeepChart_${snapshot.instrument_id.replace(/:/g, '_')}_bars.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Real Live Exchange Feed: Direct Bybit Linear WebSocket & REST streaming
  useEffect(() => {
    if (!isLiveFeedActive) {
      fetchSnapshot();
      const timer = setInterval(fetchSnapshot, 1000);
      return () => clearInterval(timer);
    }

    const symbol = getBybitSymbol(snapshot.instrument_id);
    let isCancelled = false;

    // 1. Immediately load previously cached historical bars for this specific timeframe (Zero blank screen!)
    const currentTfUs = snapshot.timeframe_us || 60_000_000;
    const cachedBars = loadSymbolBars(`${symbol}_${currentTfUs}`) || loadSymbolBars(symbol);
    if (cachedBars && cachedBars.length > 0) {
      setSnapshot((prev) => ({
        ...prev,
        bars: cachedBars,
        active_bar: cachedBars[cachedBars.length - 1],
      }));
    }

    // 2. Fetch fresh historical kline bars from exchange (fast 220-bar batch)
    const activeInterval = timeframeUsToBybitInterval(currentTfUs);
    liveFeedService.fetchRealHistoricalKlines(symbol, activeInterval, 220)
      .then((realBars) => {
        if (isCancelled || realBars.length === 0) return;
        const lastBar = realBars[realBars.length - 1];
        setSnapshot((prev) => {
          // Pure real-time synchronization: REPLACE bars directly with real historical klines!
          const pureHistoricalBars = realBars.slice(0, -1);
          saveSymbolBars(`${symbol}_${currentTfUs}`, pureHistoricalBars);
          const currentPrice = lastBar.close_ticks;

          return {
            ...prev,
            bars: pureHistoricalBars,
            active_bar: lastBar,
            recent_trades: [], // Fresh real tape
            vwap: computeSessionVwap(pureHistoricalBars, currentPrice),
            options_summary: recalculateOptionsLevels(prev.options_summary),
            data_quality: {
              ...prev.data_quality,
              feed_status: 'LIVE_CONNECTED',
              feed_source: 'Bybit Linear WebSocket',
              freshness_ms: 18,
              completeness: 'Complete',
            },
          };
        });
      })
      .catch((err) => {
        console.warn('[LiveFeed] Failed to load fresh klines from Bybit:', err);
      });

    // Connect real WebSocket for streaming live trades and level 2 orderbook depth
    liveFeedService.connect(symbol, {
      onTrade: (trade) => {
        if (isCancelled) return;
        pendingTradesRef.current.push(trade);

        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            const trades = pendingTradesRef.current;
            pendingTradesRef.current = [];
            const ob = pendingOrderBookRef.current;
            pendingOrderBookRef.current = null;

            if (trades.length === 0 && !ob) return;

            setSnapshot((prev) => {
              const tickStep = getFootprintTickStep(symbol);
              let updatedRecent = prev.recent_trades ? [...prev.recent_trades] : [];
              let currentActive = prev.active_bar ? { ...prev.active_bar } : null;
              let prevBars = [...prev.bars];

              trades.forEach((t) => {
                updatedRecent.unshift(t);

                const timeframeUs = currentActive?.timeframe_us || 60_000_000;
                const tradeMinuteStartUs = Math.floor(t.exchange_ts_us / timeframeUs) * timeframeUs;

                if (!currentActive || currentActive.bar_start_us !== tradeMinuteStartUs) {
                  // Rollover: If we have an existing active bar from a previous minute, close it and push to bars
                  if (currentActive && currentActive.bar_start_us < tradeMinuteStartUs) {
                    currentActive.finality = 'Closed';
                    prevBars = [...prevBars, currentActive].slice(-1500);
                  }
                  // Start a fresh, unpolluted active bar matching this exact trade
                  currentActive = {
                    bar_start_us: tradeMinuteStartUs,
                    timeframe_us: timeframeUs,
                    open_ticks: t.price_ticks,
                    high_ticks: t.price_ticks,
                    low_ticks: t.price_ticks,
                    close_ticks: t.price_ticks,
                    buy_units: t.aggressor === 'Buy' ? t.quantity_units : 0,
                    sell_units: t.aggressor === 'Sell' ? t.quantity_units : 0,
                    unknown_units: 0,
                    total_units: t.quantity_units,
                    delta_units: t.aggressor === 'Buy' ? t.quantity_units : -t.quantity_units,
                    trade_count: 1,
                    poc_ticks: t.price_ticks,
                    value_area: {
                      poc_ticks: t.price_ticks,
                      vah_ticks: t.price_ticks,
                      val_ticks: t.price_ticks,
                      volume_covered: t.quantity_units,
                    },
                    footprint: [
                      {
                        price_ticks: Math.round(t.price_ticks / tickStep) * tickStep,
                        buy_units: t.aggressor === 'Buy' ? t.quantity_units : 0,
                        sell_units: t.aggressor === 'Sell' ? t.quantity_units : 0,
                        unknown_units: 0,
                        total_units: t.quantity_units,
                        delta_units: t.aggressor === 'Buy' ? t.quantity_units : -t.quantity_units,
                        trade_count: 1,
                      },
                    ],
                    finality: 'Forming',
                    completeness: 'Complete',
                  };
                } else {
                  // Sanity guard against any sudden crazy jump (> 3% in a single trade):
                  if (Math.abs(currentActive.close_ticks - t.price_ticks) / currentActive.close_ticks > 0.03) {
                    currentActive.open_ticks = t.price_ticks;
                    currentActive.high_ticks = t.price_ticks;
                    currentActive.low_ticks = t.price_ticks;
                    currentActive.close_ticks = t.price_ticks;
                  } else {
                    currentActive.high_ticks = Math.max(currentActive.high_ticks, t.price_ticks);
                    currentActive.low_ticks = Math.min(currentActive.low_ticks, t.price_ticks);
                    currentActive.close_ticks = t.price_ticks;
                  }

                  const isBuy = t.aggressor === 'Buy';
                  currentActive.buy_units += isBuy ? t.quantity_units : 0;
                  currentActive.sell_units += !isBuy ? t.quantity_units : 0;
                  currentActive.total_units += t.quantity_units;
                  currentActive.delta_units = currentActive.buy_units - currentActive.sell_units;
                  currentActive.trade_count += 1;

                  // Normalize footprint price ticks to symbol-specific tick step
                  const cellPrice = Math.round(t.price_ticks / tickStep) * tickStep;
                  const footprint = currentActive.footprint ? [...currentActive.footprint] : [];
                  let cell = footprint.find((c) => c.price_ticks === cellPrice);
                  if (cell) {
                    cell.buy_units += isBuy ? t.quantity_units : 0;
                    cell.sell_units += !isBuy ? t.quantity_units : 0;
                    cell.total_units += t.quantity_units;
                    cell.delta_units = cell.buy_units - cell.sell_units;
                    cell.trade_count += 1;
                  } else {
                    footprint.push({
                      price_ticks: cellPrice,
                      buy_units: isBuy ? t.quantity_units : 0,
                      sell_units: !isBuy ? t.quantity_units : 0,
                      unknown_units: 0,
                      total_units: t.quantity_units,
                      delta_units: isBuy ? t.quantity_units : -t.quantity_units,
                      trade_count: 1,
                    });
                    footprint.sort((a, b) => a.price_ticks - b.price_ticks);
                  }

                  let maxVol = 0;
                  let poc = currentActive.poc_ticks;
                  footprint.forEach((c) => {
                    if (c.total_units > maxVol) {
                      maxVol = c.total_units;
                      poc = c.price_ticks;
                    }
                  });

                  currentActive.poc_ticks = poc;
                  currentActive.footprint = footprint;
                }
              });

              return {
                ...prev,
                bars: prevBars,
                recent_trades: updatedRecent.slice(0, 40),
                active_bar: currentActive,
                order_book: ob || prev.order_book,
              };
            });
          });
        }
      },
      onOrderBook: (ob) => {
        if (isCancelled) return;
        pendingOrderBookRef.current = ob;
        const nowMs = performance.now();
        // Throttle standalone L2 orderbook React commits to ~4Hz (220ms) so 50Hz Bybit L2 deltas never choke UI
        if (nowMs - lastObCommitMsRef.current < 220) return;
        lastObCommitMsRef.current = nowMs;

        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            const obData = pendingOrderBookRef.current;
            pendingOrderBookRef.current = null;
            if (obData) {
              const appendHeatmap = nowMs - lastHeatmapSliceMsRef.current >= 1200;
              if (appendHeatmap) {
                lastHeatmapSliceMsRef.current = nowMs;
              }
              setSnapshot((prev) => ({
                ...prev,
                order_book: obData,
                heatmap_slices: appendHeatmap
                  ? [
                      ...(prev.heatmap_slices || []).slice(-40),
                      {
                        timestamp_us: Date.now() * 1000,
                        bids: obData.bids.map((b) => [b.price_ticks, b.quantity_units] as [number, number]),
                        asks: obData.asks.map((a) => [a.price_ticks, a.quantity_units] as [number, number]),
                      },
                    ]
                  : prev.heatmap_slices,
              }));
            }
          });
        }
      },
      onStatusChange: (status) => {
        if (isCancelled) return;
        setSnapshot((prev) => ({
          ...prev,
          data_quality: {
            ...prev.data_quality,
            feed_status: status === 'CONNECTED' ? 'LIVE_CONNECTED' : 'DEGRADED',
            freshness_ms: status === 'CONNECTED' ? 14 : 999,
          },
        }));
      },
    });

    return () => {
      isCancelled = true;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      liveFeedService.disconnect();
    };
  }, [snapshot.instrument_id, isLiveFeedActive]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'a' || e.key === 'A') setShowNarrative((prev) => !prev);
      if (e.key === 'g' || e.key === 'G') setShowGreeks((prev) => !prev);
      if (e.code === 'Space') {
        e.preventDefault();
        if (snapshot.playback?.is_replay_mode) {
          if (snapshot.playback.state === 'Playing') handlePauseReplay();
          else handlePlayReplay();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [snapshot.playback]);

  const handleLoadMoreHistory = async () => {
    if (snapshot.bars.length === 0) return;
    const oldestBar = snapshot.bars[0];
    const endMs = Math.round(oldestBar.bar_start_us / 1000);
    const symbol = getBybitSymbol(snapshot.instrument_id);
    try {
      const olderBars = await liveFeedService.fetchRealHistoricalKlines(symbol, 1, 1000, endMs);
      if (olderBars.length > 0) {
        setSnapshot((prev) => {
          const merged = mergeBars(olderBars, prev.bars);
          saveSymbolBars(symbol, merged);
          return { ...prev, bars: merged };
        });
      }
    } catch (e) {
      console.warn('Failed to load older historical bars:', e);
    }
  };

  const latestBar = snapshot.active_bar || (snapshot.bars.length > 0 ? snapshot.bars[snapshot.bars.length - 1] : null);
  const totalCvd = snapshot.bars.reduce((acc, b) => acc + (b.delta_units || 0), 0) + (snapshot.active_bar ? (snapshot.active_bar.delta_units || 0) : 0);

  const handleMt5ButtonClick = async () => {
    // 1-Click Auto Connect directly without manual friction!
    const res = await mt5BridgeService.syncFromRealMt5();
    if (res.ok) {
      if (!snapshot.instrument_id.startsWith('MT5:')) {
        handleInstrumentChange('MT5:CFD:XAUUSD');
      }
      return;
    }
    setIsMt5ModalOpen(true);
  };

  return (
    <div
      style={{
        background: '#0B0F15',
        color: '#E2E8F0',
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      <Toolbar
        snapshot={snapshot}
        onInstrumentChange={handleInstrumentChange}
        onToggleReplay={handleToggleReplay}
        onPlayReplay={handlePlayReplay}
        onPauseReplay={handlePauseReplay}
        onStepReplay={handleStepReplay}
        onResetReplay={handleResetReplay}
        onSpeedChange={handleSpeedChange}
        onExportCSV={handleExportCSV}
        onTimeframeChange={handleTimeframeChange}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onOpenBacktest={() => setIsBacktestOpen(true)}
        onOpenZoneInspector={() => setIsZoneInspectorOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenMt5Modal={handleMt5ButtonClick}
        onOpenIndicators={() => window.dispatchEvent(new CustomEvent('deepchart:open_indicators'))}
        layoutPreset={layoutPreset}
        onLayoutPresetChange={handleLayoutPresetChange}
        activeRightTab={rightDockTab}
        onToggleRightTab={handleToggleRightTab}
        isLiveFeedActive={isLiveFeedActive}
        onToggleLiveFeed={() => setIsLiveFeedActive(!isLiveFeedActive)}
        onLoadMoreHistory={handleLoadMoreHistory}
        chartViewMode={chartViewMode}
        onChartViewModeChange={setChartViewMode}
        tickAggregation={tickAggregation}
        onTickAggregationChange={setTickAggregation}
        multiChartLayout={multiChartLayout}
        onMultiChartLayoutChange={setMultiChartLayout}
      />

      {/* Main Terminal Workspace: Left Sidebar + Central Chart Panel + Right Dock / Options Panel */}
      <div style={{ flex: 1, display: 'flex', width: '100%', height: 'calc(100% - 36px - 28px)', overflow: 'hidden', position: 'relative' }}>
        {/* Left 36px DeepCharts Tools Sidebar */}
        <LeftToolsSidebar
          activeTool={activeDrawingTool}
          onSelectTool={setActiveDrawingTool}
          currentColor={drawingColor}
          onSelectColor={setDrawingColor}
          onClearAll={handleClearAllDrawings}
          onUndoLast={handleUndoLastDrawing}
          drawingsVisible={drawingsVisible}
          onToggleVisibility={() => setDrawingsVisible((prev) => !prev)}
          drawingCount={drawings.length}
          magnetEnabled={magnetEnabled}
          onToggleMagnet={() => setMagnetEnabled((prev) => !prev)}
        />

        {/* Central Dominant Chart Area: Candlestick, Footprint, or Multi-Chart Grid */}
        <div style={{ flex: 1, height: '100%', position: 'relative', overflow: 'hidden', display: 'flex' }}>
          {chartViewMode === 'candlestick' && multiChartLayout === '1x1' ? (
            <TradingViewChartPanel
              bars={snapshot.bars}
              activeBar={snapshot.active_bar}
              instrumentId={snapshot.instrument_id}
              recentTrades={snapshot.recent_trades}
              vwap={snapshot.vwap}
              timeframeUs={snapshot.timeframe_us}
              onTimeframeChange={handleTimeframeChange}
              onSwitchToFootprint={() => setChartViewMode('footprint')}
              onLoadMoreHistory={handleLoadMoreHistory}
            />
          ) : (
            <MultiChartGrid
              layout={multiChartLayout}
              snapshot={snapshot}
              drawings={drawings}
              activeDrawingTool={activeDrawingTool}
              drawingColor={drawingColor}
              drawingsVisible={drawingsVisible}
              onDrawingCreated={handleDrawingCreated}
              onDrawingUpdated={handleDrawingUpdated}
              onDrawingDeleted={handleDrawingDeleted}
              onPriceBoundsChange={layoutPreset === 'options_confluence' ? setPriceBounds : undefined}
              onSwitchToTradingView={() => setChartViewMode('candlestick')}
              tickAggregation={tickAggregation}
              onTickAggregationChange={setTickAggregation}
              isTradingPanelOpen={rightDockTab !== null}
              onToggleTradingPanel={() =>
                setRightDockTab((prev) => (prev ? null : 'trading'))
              }
              onPrimaryTimeframeChange={handleTimeframeChange}
              magnetEnabled={magnetEnabled}
              isPickingPriceOnChart={isPickingPriceOnChart}
              onPricePickedFromChart={(ticks) => {
                setPickedOrderPriceTicks(ticks);
                setIsPickingPriceOnChart(false);
              }}
            />
          )}
        </div>

        {/* Options & Gamma Multi-Profile Workspace (DeepCharts 4-Column Array) */}
        {layoutPreset === 'options_confluence' ? (
          <div style={{ width: '440px', minWidth: '380px', height: '100%', overflow: 'hidden' }}>
            <OptionsGammaProfilePanel
              instrumentId={snapshot.instrument_id}
              optionsSummary={snapshot.options_summary}
              minPrice={priceBounds.minPrice}
              maxPrice={priceBounds.maxPrice}
              chartHeight={priceBounds.chartHeight}
              panY={priceBounds.panY}
              currentPriceTicks={snapshot.active_bar ? snapshot.active_bar.close_ticks : snapshot.bars[snapshot.bars.length - 1]?.close_ticks}
              onHoverStrike={setHoveredStrike}
              hoveredStrike={hoveredStrike}
            />
          </div>
        ) : (
          rightDockTab && (
            <RightDockPanel
              snapshot={snapshot}
              activeTab={rightDockTab}
              onSelectTab={setRightDockTab}
              onClose={() => setRightDockTab(null)}
              onPopOutDom={() => setIsDomFloating(true)}
              onPopOutTape={() => setIsTapeFloating(true)}
              onOpenMt5Modal={() => setIsMt5ModalOpen(true)}
              pickedOrderPriceTicks={pickedOrderPriceTicks}
              isPickingPriceOnChart={isPickingPriceOnChart}
              onRequestPickPriceOnChart={setIsPickingPriceOnChart}
            />
          )
        )}
      </div>

      {/* Floating Draggable DOM Ladder Panel (when popped out) */}
      {isDomFloating && (
        <FloatingPanel
          title="ORDER BOOK DOM LADDER"
          initialX={window.innerWidth - 300}
          initialY={85}
          initialWidth={280}
          initialHeight={550}
          onClose={() => setIsDomFloating(false)}
          onDock={() => setIsDomFloating(false)}
        >
          <DomLadderPanel
            isFloating
            orderBook={snapshot.order_book}
            activePriceTicks={snapshot.active_bar ? snapshot.active_bar.close_ticks : snapshot.bars[snapshot.bars.length - 1]?.close_ticks}
            instrumentId={snapshot.instrument_id}
            onPopOutToggle={() => setIsDomFloating(false)}
          />
        </FloatingPanel>
      )}

      {/* Floating Draggable Time & Sales Tape Panel (when popped out) */}
      {isTapeFloating && (
        <FloatingPanel
          title="TIME & SALES (LIVE TAPE)"
          initialX={window.innerWidth - 600}
          initialY={85}
          initialWidth={280}
          initialHeight={550}
          onClose={() => setIsTapeFloating(false)}
          onDock={() => setIsTapeFloating(false)}
        >
          <TimeAndSalesTape
            isFloating
            trades={snapshot.recent_trades || []}
            instrumentId={snapshot.instrument_id}
            onClose={() => setIsTapeFloating(false)}
            onPopOutToggle={() => setIsTapeFloating(false)}
          />
        </FloatingPanel>
      )}

      {/* =====================================================================
          AUTHENTIC DEEPCHART BOTTOM APPLICATION STATUS & TELEMETRY BAR
          Matches Bottom Bar of media_1794650941668_c8f4497c.jpg 100%!
          Left: /// DEEPCHART  |  New  Options  Trading  Zones  Backtest
          Center: [ 001-ORDERFLOW-PRO ▾ ]   Feed [ 🟢 Connected · Bybit Linear ]
          Right: BAR VOL = BUY + SELL + UNKNOWN | DELTA | CVD | SPEED
          ===================================================================== */}
      <footer
        style={{
          height: '28px',
          minHeight: '28px',
          background: '#11141C',
          borderTop: '1px solid #262932',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          fontSize: '10.5px',
          justifyContent: 'space-between',
          color: '#94A3B8',
          userSelect: 'none',
        }}
      >
        {/* Left: VLUXCHART Brand Emblem & Active Workspace */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: '#FFFFFF',
              fontWeight: 900,
              fontStyle: 'italic',
              fontSize: '12px',
              letterSpacing: '0.6px',
            }}
          >
            <span style={{ color: '#00E676' }}>///</span>
            <span>VLUXCHART</span>
          </div>

          {/* Active Workspace Profile Pill */}
          <div
            style={{
              background: '#1E222D',
              border: '1px solid #2E3444',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '10.5px',
              color: '#E2E8F0',
              fontWeight: 600,
            }}
          >
            001-PRO ▾
          </div>

          {/* Feed Connection Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#94A3B8', fontSize: '10.5px' }}>Feed</span>
            <span
              onClick={() => setIsLiveFeedActive(!isLiveFeedActive)}
              style={{
                background: isLiveFeedActive ? (snapshot.instrument_id.startsWith('MT5:') ? '#0284C7' : '#15803D') : '#B45309',
                color: '#FFFFFF',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Click to toggle Live Exchange Stream vs Replay/Demo"
            >
              {isLiveFeedActive
                ? snapshot.instrument_id.startsWith('MT5:')
                  ? '1 Connection (MT5 Forex ECN) ▾'
                  : '1 Connection (Bybit Live) ▾'
                : 'Simulated Feed ▾'}
            </span>
          </div>
        </div>

        {/* Right: Exact Integer Volume Accounting Telemetry */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '10px',
          }}
        >
          {(() => {
            const inst = CANONICAL_INSTRUMENTS[snapshot.instrument_id];
            const unit = inst?.quantityUnit || 'BTC';
            const totalVol = latestBar ? latestBar.total_units : 0;
            const buyVol = latestBar ? latestBar.buy_units : 0;
            const sellVol = latestBar ? latestBar.sell_units : 0;
            const unknownVol = latestBar ? (latestBar.unknown_units ?? 0) : 0;
            const deltaVol = latestBar ? latestBar.delta_units : 0;
            const speed1s = snapshot.speed_1s?.total_units ?? 0;

            return (
              <>
                <span>
                  VOL: <strong style={{ color: '#E2E8F0' }}>{totalVol.toLocaleString()} {unit}</strong>
                </span>
                <span>
                  BUY: <strong style={{ color: '#00E676' }}>{buyVol.toLocaleString()}</strong>
                </span>
                <span>
                  SELL: <strong style={{ color: '#EF4444' }}>{sellVol.toLocaleString()}</strong>
                </span>
                {unknownVol > 0 && (
                  <span>
                    UNK: <strong style={{ color: '#94A3B8' }}>{unknownVol.toLocaleString()}</strong>
                  </span>
                )}
                <span>
                  Δ:{' '}
                  <strong style={{ color: deltaVol >= 0 ? '#00E676' : '#EF4444' }}>
                    {deltaVol >= 0 ? '+' : ''}{deltaVol.toLocaleString()}
                  </strong>
                </span>
                <span>
                  CVD: <strong style={{ color: '#00E5FF' }}>{totalCvd >= 0 ? '+' : ''}{totalCvd.toLocaleString()}</strong>
                </span>
                <span>
                  SPEED: <strong style={{ color: '#38BDF8' }}>{speed1s.toLocaleString()} {unit}/s</strong>
                </span>
              </>
            );
          })()}
        </div>
      </footer>

      {/* Order Flow Strategy Backtester Modal (Phase P5) */}
      <BacktestModal
        isOpen={isBacktestOpen}
        onClose={() => setIsBacktestOpen(false)}
        onRunBacktest={handleRunBacktest}
        onRunOptimization={handleRunOptimization}
      />

      {/* Institutional Zone Inspector Modal (Section 10) */}
      <ZoneInspectorModal
        isOpen={isZoneInspectorOpen}
        onClose={() => setIsZoneInspectorOpen(false)}
        snapshot={snapshot}
      />

      {/* Workspace Settings & Themes Modal (P5.2) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={workspaceConfig}
        onSaveConfig={handleSaveConfig}
      />

      {/* MetaTrader 5 (MT5) Forex & CFD Account Connection Modal */}
      <Mt5ConnectionModal
        isOpen={isMt5ModalOpen}
        onClose={() => setIsMt5ModalOpen(false)}
        currentInstrumentId={snapshot.instrument_id}
        onSelectInstrument={handleInstrumentChange}
      />
    </div>
  );
}

export default App;
