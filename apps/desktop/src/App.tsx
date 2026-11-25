import React, { useState, useEffect, useRef, startTransition } from 'react';
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
import { CmeMboConnectionModal } from './components/CmeMboConnectionModal';
import { OptionsBoardModal } from './components/OptionsBoardModal';
import { ScriptEditorModal } from './components/ScriptEditorModal';
import { InstrumentStudioModal } from './components/InstrumentStudioModal';
import { RiskManagerModal } from './components/RiskManagerModal';
import { LoginScreen } from './components/LoginScreen';
import { SystemBootstrapModal } from './components/SystemBootstrapModal';
import { UpgradePrivilegeModal } from './components/UpgradePrivilegeModal';
import { OrderFlowAlert } from './components/AlertNotificationCenter';
import { authService, AuthSessionDTO } from './services/authService';
import { FeatureEntitlementKey, hasFeatureAccess } from './utils/entitlements';
import { dataPackService, DataManifestDTO } from './services/dataPackService';
import {
  SystemEnvironmentReportDTO,
  systemBootstrapService,
} from './services/systemBootstrapService';
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
  BacktestTradeDTO,
  ChartDrawing,
  ChartSnapshotDTO,
  DrawingTool,
  OptimizationReportDTO,
  OptimizationResultItemDTO,
  OptimizationSweepConfigDTO,
  OrderBookSnapshotDTO,
  TradeEventDTO,
} from './types';
import {
  CANONICAL_INSTRUMENTS,
  createEmptyLiveSnapshot,
  getInstrumentMeta,
} from './utils/instrumentRegistry';
import {
  ActiveFrameConfig,
  CustomFrameCategory,
  appendLiveTradeToNonTimeSeries,
  buildNonTimeBarsFromRealData,
  hydrateSavedSynthetics,
} from './utils/customFrameAndSyntheticEngine';
import { liveFeedService, getFootprintTickStep, timeframeUsToBybitInterval } from './services/liveFeedService';
import { CmeConnectionStatusDTO, cmeMboService } from './services/cmeMboService';
import { computeSessionVwap, recalculateOptionsLevels } from './utils/orderFlowMath';
import { adaptSnapshotToTimeframe } from './utils/multiTimeframeAggregator';
import { mt5BridgeService } from './services/mt5BridgeService';

function getBybitSymbol(instrumentId: string): string {
  if (
    instrumentId.startsWith('MT5:') ||
    instrumentId.startsWith('SYNTH:') ||
    instrumentId.startsWith('CME:')
  ) {
    return instrumentId;
  }
  if (instrumentId.includes('ETH')) return 'ETHUSDT';
  if (instrumentId.includes('XAU')) return 'XAUUSDT';
  return 'BTCUSDT';
}

function resolveInitialTimeframeUs(tfRaw?: string): number {
  if (!tfRaw) return 300_000_000;
  const n = Number(tfRaw);
  if (Number.isFinite(n) && n >= 60_000_000) return n;
  if (tfRaw === '1m') return 60_000_000;
  if (tfRaw === '5m') return 300_000_000;
  if (tfRaw === '15m') return 900_000_000;
  if (tfRaw === '1h') return 3_600_000_000;
  if (tfRaw === '4h') return 14_400_000_000;
  if (tfRaw === '1d') return 86_400_000_000;
  return 300_000_000;
}

/**
 * Deterministic Order Flow Backtester operating 100% on REAL historical market bars (`snapshot.bars`).
 * Zero synthetic trades, zero sine waves, zero random numbers.
 */
function evaluateRealBarsBacktest(bars: BarDTO[], config: BacktestConfigDTO): BacktestReportDTO {
  const slTicks = Math.max(10, Math.round(config.stop_loss_ticks));
  const tpTicks = Math.max(10, Math.round(config.take_profit_ticks));
  const slipTicks = Math.max(0, Math.round(config.slippage_ticks || 0));
  const sizeUnits = Math.max(1, Math.round(config.trade_size_units || 1));

  if (!Array.isArray(bars) || bars.length < 5) {
    return {
      strategy_name: config.strategy_name,
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      win_rate_pct: 0,
      gross_profit_ticks: 0,
      gross_loss_ticks: 0,
      net_pnl_ticks: 0,
      profit_factor: 0,
      max_drawdown_ticks: 0,
      max_drawdown_pct: 0,
      avg_trade_pnl_ticks: 0,
      trades: [],
    };
  }

  const avgVol =
    bars.reduce((s, b) => s + (b.total_units || 0), 0) / Math.max(1, bars.length);
  const trades: BacktestTradeDTO[] = [];
  let i = 1;

  while (i < bars.length - 1) {
    const prev = bars[i - 1];
    const cur = bars[i];
    const range = Math.max(1, cur.high_ticks - cur.low_ticks);
    const upperWick = cur.high_ticks - Math.max(cur.open_ticks, cur.close_ticks);
    const lowerWick = Math.min(cur.open_ticks, cur.close_ticks) - cur.low_ticks;

    let signalSide: 'Buy' | 'Sell' | null = null;
    if (config.strategy_name === 'AbsorptionReversal') {
      if (lowerWick > range * 0.35 && cur.delta_units < 0 && cur.close_ticks >= cur.open_ticks) {
        signalSide = 'Buy';
      } else if (upperWick > range * 0.35 && cur.delta_units > 0 && cur.close_ticks <= cur.open_ticks) {
        signalSide = 'Sell';
      }
    } else if (config.strategy_name === 'DeltaDivergence') {
      if (cur.low_ticks < prev.low_ticks && cur.delta_units > 0) {
        signalSide = 'Buy';
      } else if (cur.high_ticks > prev.high_ticks && cur.delta_units < 0) {
        signalSide = 'Sell';
      }
    } else {
      const hasBuyStack = cur.stacked_imbalances?.some((st) => st.side === 'Buy');
      const hasSellStack = cur.stacked_imbalances?.some((st) => st.side === 'Sell');
      if (hasBuyStack || (cur.total_units > avgVol * 1.1 && cur.delta_units > cur.total_units * 0.2)) {
        signalSide = 'Buy';
      } else if (hasSellStack || (cur.total_units > avgVol * 1.1 && -cur.delta_units > cur.total_units * 0.2)) {
        signalSide = 'Sell';
      }
    }

    if (!signalSide) {
      i++;
      continue;
    }

    const entryBar = bars[i + 1];
    const entryPrice =
      signalSide === 'Buy' ? entryBar.open_ticks + slipTicks : entryBar.open_ticks - slipTicks;
    let exitPrice = bars[bars.length - 1].close_ticks;
    let exitTimeUs = bars[bars.length - 1].bar_start_us;
    let exitReason = 'EndOfSeries';
    let exitBarIdx = bars.length - 1;

    for (let j = i + 1; j < bars.length; j++) {
      const bj = bars[j];
      if (signalSide === 'Buy') {
        if (bj.low_ticks <= entryPrice - slTicks) {
          exitPrice = entryPrice - slTicks - slipTicks;
          exitTimeUs = bj.bar_start_us;
          exitReason = 'StopLoss';
          exitBarIdx = j;
          break;
        }
        if (bj.high_ticks >= entryPrice + tpTicks) {
          exitPrice = entryPrice + tpTicks - slipTicks;
          exitTimeUs = bj.bar_start_us;
          exitReason = 'TakeProfit';
          exitBarIdx = j;
          break;
        }
      } else {
        if (bj.high_ticks >= entryPrice + slTicks) {
          exitPrice = entryPrice + slTicks + slipTicks;
          exitTimeUs = bj.bar_start_us;
          exitReason = 'StopLoss';
          exitBarIdx = j;
          break;
        }
        if (bj.low_ticks <= entryPrice - tpTicks) {
          exitPrice = entryPrice - tpTicks + slipTicks;
          exitTimeUs = bj.bar_start_us;
          exitReason = 'TakeProfit';
          exitBarIdx = j;
          break;
        }
      }
    }

    const rawPnlTicks =
      (signalSide === 'Buy' ? exitPrice - entryPrice : entryPrice - exitPrice) * sizeUnits;
    const pnlPct = entryPrice > 0 ? Number((((exitPrice - entryPrice) / entryPrice) * (signalSide === 'Buy' ? 100 : -100)).toFixed(3)) : 0;

    trades.push({
      trade_id: trades.length + 1,
      side: signalSide,
      entry_price_ticks: entryPrice,
      exit_price_ticks: exitPrice,
      entry_time_us: entryBar.bar_start_us,
      exit_time_us: exitTimeUs,
      quantity_units: sizeUnits,
      pnl_ticks: rawPnlTicks,
      pnl_pct: pnlPct,
      exit_reason: exitReason,
    });

    i = Math.max(i + 1, exitBarIdx + 1);
  }

  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let equity = 0;
  let peakEquity = 0;
  let maxDdTicks = 0;

  for (const t of trades) {
    if (t.pnl_ticks >= 0) {
      grossProfit += t.pnl_ticks;
      wins++;
    } else {
      grossLoss += Math.abs(t.pnl_ticks);
      losses++;
    }
    equity += t.pnl_ticks;
    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity - equity;
    if (dd > maxDdTicks) maxDdTicks = dd;
  }

  const netPnl = grossProfit - grossLoss;
  const pf = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 9.99 : 0;
  const refCapital = Math.max(100_000, bars[0].open_ticks * 10);
  const maxDdPct = Number(((maxDdTicks / refCapital) * 100).toFixed(2));

  return {
    strategy_name: config.strategy_name,
    total_trades: trades.length,
    winning_trades: wins,
    losing_trades: losses,
    win_rate_pct: trades.length > 0 ? Number(((wins / trades.length) * 100).toFixed(1)) : 0,
    gross_profit_ticks: grossProfit,
    gross_loss_ticks: grossLoss,
    net_pnl_ticks: netPnl,
    profit_factor: pf,
    max_drawdown_ticks: maxDdTicks,
    max_drawdown_pct: maxDdPct,
    avg_trade_pnl_ticks: trades.length > 0 ? Math.round(netPnl / trades.length) : 0,
    trades,
  };
}

// Hydrate persisted custom synthetic formulas (SYNTH:*) before resolving cold-start snapshot
hydrateSavedSynthetics();

const INITIAL_WORKSPACE_CFG = loadWorkspaceConfig();
// Strict empty cold-start state: zero fake placeholder candles before real market feed arrives
const DEFAULT_SNAPSHOT: ChartSnapshotDTO = createEmptyLiveSnapshot(
  INITIAL_WORKSPACE_CFG.instrumentId || 'MT5:CFD:XAUUSD',
  resolveInitialTimeframeUs(INITIAL_WORKSPACE_CFG.timeframe)
);

export function App() {
  // Authentication Gate (Login-Only — Account Registration on External Web Portal)
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [authSession, setAuthSession] = useState<AuthSessionDTO | null>(null);

  // System Runtime Compatibility Bootstrapper State (Auto-Skip if ready; 1-Click Setup if missing)
  const [dataManifest, setDataManifest] = useState<DataManifestDTO | null>(null);
  const [systemReport, setSystemReport] = useState<SystemEnvironmentReportDTO | null>(null);
  const [isSystemModalOpen, setIsSystemModalOpen] = useState<boolean>(false);
  const [isFirstRunSystemPrompt, setIsFirstRunSystemPrompt] = useState<boolean>(false);
  const hasPromptedSystemRef = useRef<boolean>(false);

  const [snapshot, setSnapshot] = useState<ChartSnapshotDTO>(() => loadSnapshotCache() || DEFAULT_SNAPSHOT);
  const [isLiveFeedActive, setIsLiveFeedActive] = useState<boolean>(true);
  const [alerts, setAlerts] = useState<OrderFlowAlert[]>([]);
  const [synthRevision, setSynthRevision] = useState<number>(0);

  // Active Bar Construction Mode: Standard Time Bars OR Non-Time Order Flow Bars (Range / Volume / Tick)
  const [activeFrame, setActiveFrame] = useState<ActiveFrameConfig>(() => ({
    category: 'time',
    value: resolveInitialTimeframeUs(INITIAL_WORKSPACE_CFG.timeframe),
  }));
  const activeFrameRef = useRef<ActiveFrameConfig>(activeFrame);
  activeFrameRef.current = activeFrame;
  const rawBaseBarsRef = useRef<{ key: string; bars: BarDTO[] }>({ key: '', bars: [] });

  useEffect(() => {
    let active = true;
    authService.getSession().then((sess) => {
      if (!active) return;
      setAuthSession(sess);
      setAuthChecked(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authSession) return;
    let active = true;
    const unsubManifest = dataPackService.subscribeManifest((m) => {
      if (active) setDataManifest(m);
    });

    // 1. Silently hydrate any existing local auto-synced cache in background (ZERO manual candle download prompt!)
    dataPackService.getManifest().then(async (manifest) => {
      if (!active) return;
      setDataManifest(manifest);
      if (manifest.has_core_data) {
        await dataPackService.hydrateAllInstalledPacks();
      }
    });

    // 2. Inspect Workstation Compatibility (<300ms): Auto-Skip 100% if ready; prompt 1-Click Setup ONLY if missing!
    systemBootstrapService
      .checkEnvironment()
      .then((rep) => {
        if (!active) return;
        setSystemReport(rep);
        if (
          !rep.should_auto_skip &&
          !systemBootstrapService.hasUserSkippedForSession() &&
          !hasPromptedSystemRef.current
        ) {
          hasPromptedSystemRef.current = true;
          setIsFirstRunSystemPrompt(true);
          setIsSystemModalOpen(true);
        }
      })
      .catch((err) => {
        console.warn('[SystemBootstrap] Environment check warning:', err);
      });

    return () => {
      active = false;
      unsubManifest();
    };
  }, [authSession]);

  const handleLoginSuccess = (session: AuthSessionDTO) => {
    hasPromptedSystemRef.current = false;
    setAuthSession(session);
  };

  const handleLogout = async () => {
    liveFeedService.disconnect();
    await authService.logout();
    setAuthSession(null);
    setIsSystemModalOpen(false);
    setIsFirstRunSystemPrompt(false);
    hasPromptedSystemRef.current = false;
  };

  // High-performance RAF throttle queues to keep UI at solid 60 FPS under live market bursts
  const pendingTradesRef = useRef<TradeEventDTO[]>([]);
  const pendingOrderBookRef = useRef<OrderBookSnapshotDTO | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const timeframeRequestIdRef = useRef<number>(0);
  const activeFetchAbortRef = useRef<AbortController | null>(null);
  const lastObCommitMsRef = useRef<number>(0);
  const lastHeatmapSliceMsRef = useRef<number>(0);
  const [showNarrative, setShowNarrative] = useState(true);
  const [showGreeks, setShowGreeks] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isBacktestOpen, setIsBacktestOpen] = useState(false);
  const [isZoneInspectorOpen, setIsZoneInspectorOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMt5ModalOpen, setIsMt5ModalOpen] = useState(false);
  const [isCmeModalOpen, setIsCmeModalOpen] = useState(false);
  const [cmeStatus, setCmeStatus] = useState<CmeConnectionStatusDTO>(() =>
    cmeMboService.getCachedStatus()
  );
  const [isOptionsBoardOpen, setIsOptionsBoardOpen] = useState(false);
  const [isScriptEditorOpen, setIsScriptEditorOpen] = useState(false);
  const [isInstrumentStudioOpen, setIsInstrumentStudioOpen] = useState(false);
  const [isRiskManagerOpen, setIsRiskManagerOpen] = useState(false);
  const [privilegeModal, setPrivilegeModal] = useState<{
    open: boolean;
    featureKey: FeatureEntitlementKey | null;
  }>({ open: false, featureKey: null });

  const checkOrPromptPrivilege = (featureKey: FeatureEntitlementKey): boolean => {
    if (hasFeatureAccess(authSession?.tier, featureKey)) {
      return true;
    }
    setPrivilegeModal({ open: true, featureKey });
    return false;
  };

  useEffect(() => {
    const unsub = cmeMboService.subscribeStatus((st) => setCmeStatus(st));
    cmeMboService.getStatus().catch(() => {});
    const onOpenCmeEvent = () => {
      if (hasFeatureAccess(authSession?.tier, 'mbo_l3')) {
        setIsCmeModalOpen(true);
      } else {
        setPrivilegeModal({ open: true, featureKey: 'mbo_l3' });
      }
    };
    window.addEventListener('deepchart:open_cme_modal', onOpenCmeEvent);
    return () => {
      unsub();
      window.removeEventListener('deepchart:open_cme_modal', onOpenCmeEvent);
    };
  }, [authSession?.tier]);
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


  // Enforce layout constraints when signed into a lower tier (e.g. STANDARD PILOT)
  useEffect(() => {
    if (!authSession) return;
    if (!hasFeatureAccess(authSession.tier, 'multi_chart') && multiChartLayout !== '1x1') {
      setMultiChartLayout('1x1');
    }
    if (!hasFeatureAccess(authSession.tier, 'options_gex') && layoutPreset === 'options_confluence') {
      setLayoutPreset('order_flow_pro');
    }
  }, [authSession?.tier]);

  const handleLayoutPresetChange = (preset: LayoutPreset) => {
    if (preset === 'options_confluence' && !checkOrPromptPrivilege('options_gex')) {
      return;
    }
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

  const replayRealBarsRef = useRef<BarDTO[]>([]);
  const replayCursorRef = useRef<number>(0);
  const isLoadingHistoryRef = useRef<boolean>(false);
  const exhaustedHistoryRef = useRef<Set<string>>(new Set());

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
    const wasNonTime = activeFrameRef.current.category !== 'time';
    if (!wasNonTime && timeframeUs === snapshot.timeframe_us) return;

    const nextFrame: ActiveFrameConfig = { category: 'time', value: timeframeUs };
    setActiveFrame(nextFrame);
    activeFrameRef.current = nextFrame;

    const reqId = ++timeframeRequestIdRef.current;

    // Abort any in-flight exchange fetch from a previous click so stale parses never pile up
    activeFetchAbortRef.current?.abort();
    const controller = new AbortController();
    activeFetchAbortRef.current = controller;

    saveWorkspaceConfig({ timeframe: timeframeUs.toString() });
    liveFeedService.setTimeframe(timeframeUs);
    isLoadingHistoryRef.current = false;
    const symbol = getBybitSymbol(snapshot.instrument_id);
    const interval = timeframeUsToBybitInterval(timeframeUs);

    // 1. Instant 0ms render from in-memory Data Pack or cache (wrapped in startTransition so controls stay responsive!)
    const cachedBars =
      dataPackService.getHydratedBars(symbol, timeframeUs) ||
      loadSymbolBars(`${symbol}_${timeframeUs}`);
    startTransition(() => {
      if (cachedBars && cachedBars.length > 0) {
        const closed = cachedBars.length > 1 ? cachedBars.slice(0, -1) : cachedBars;
        const tail = cachedBars[cachedBars.length - 1];
        setSnapshot((prev) => ({
          ...prev,
          timeframe_us: timeframeUs,
          bars: closed,
          active_bar: tail,
          vwap: computeSessionVwap(closed, tail.close_ticks),
        }));
      } else if (!wasNonTime) {
        setSnapshot((prev) => adaptSnapshotToTimeframe(prev, timeframeUs));
      }
    });

    // 2. Fetch deep 1,500-bar initial history (with unlimited continuous scroll on demand)
    try {
      const realBars = await liveFeedService.fetchRealHistoricalKlines(
        symbol,
        interval,
        1500,
        undefined,
        controller.signal
      );
      if (controller.signal.aborted || reqId !== timeframeRequestIdRef.current) return;
      if (realBars && realBars.length > 0) {
        const lastBar = realBars[realBars.length - 1];
        const pureBars = realBars.slice(0, -1);
        saveSymbolBars(`${symbol}_${timeframeUs}`, pureBars);
        dataPackService.updateHydratedSeries(symbol, timeframeUs, realBars);

        startTransition(() => {
          setSnapshot((prev) => {
            if (getBybitSymbol(prev.instrument_id) !== symbol) return prev;
            if (activeFrameRef.current.category !== 'time') return prev;
            const nextSnap: ChartSnapshotDTO = {
              ...prev,
              venue: getInstrumentMeta(prev.instrument_id).venue,
              timeframe_us: timeframeUs,
              bars: pureBars,
              active_bar: lastBar,
              vwap: computeSessionVwap(pureBars, lastBar.close_ticks),
            };
            saveSnapshotCache(nextSnap);
            checkNewAlerts(nextSnap);
            return nextSnap;
          });
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.warn(`[LiveFeed] Failed to load fresh klines for timeframe ${interval}:`, err);
      }
    }
  };

  const handleSelectCustomFrame = async (category: CustomFrameCategory, rawVal: number) => {
    if (category === 'time') {
      await handleTimeframeChange(rawVal);
      return;
    }

    const safeVal = Math.max(1, Math.round(rawVal));
    const nextFrame: ActiveFrameConfig = { category, value: safeVal };
    setActiveFrame(nextFrame);
    activeFrameRef.current = nextFrame;

    const reqId = ++timeframeRequestIdRef.current;
    activeFetchAbortRef.current?.abort();
    const controller = new AbortController();
    activeFetchAbortRef.current = controller;
    isLoadingHistoryRef.current = false;

    const instId = snapshot.instrument_id;
    const symbol = getBybitSymbol(instId);

    // 1. Instant <2ms deterministic build from already-loaded real historical bars
    const immediateSource =
      rawBaseBarsRef.current.key === symbol && rawBaseBarsRef.current.bars.length > 1
        ? rawBaseBarsRef.current.bars
        : [...snapshot.bars, ...(snapshot.active_bar ? [snapshot.active_bar] : [])];

    if (immediateSource.length > 0) {
      const instantBuilt = buildNonTimeBarsFromRealData(immediateSource, nextFrame, instId);
      if (instantBuilt.length > 0) {
        const closed = instantBuilt.length > 1 ? instantBuilt.slice(0, -1) : [];
        const tail = instantBuilt[instantBuilt.length - 1];
        startTransition(() => {
          setSnapshot((prev) => ({
            ...prev,
            bars: closed,
            active_bar: tail,
            vwap: computeSessionVwap(closed, tail.close_ticks),
          }));
        });
      }
    }

    // 2. Fetch deep 1,500 granular 1m + real tick-footprint bars for high-resolution Range / Volume / Tick bars
    try {
      const realBars = await liveFeedService.fetchRealHistoricalKlines(
        symbol,
        '1',
        1500,
        undefined,
        controller.signal,
        true
      );
      if (controller.signal.aborted || reqId !== timeframeRequestIdRef.current) return;
      if (realBars && realBars.length > 0) {
        rawBaseBarsRef.current = { key: symbol, bars: realBars };
        const built = buildNonTimeBarsFromRealData(realBars, nextFrame, instId);
        if (built.length > 0) {
          const closed = built.length > 1 ? built.slice(0, -1) : [];
          const tail = built[built.length - 1];
          startTransition(() => {
            setSnapshot((prev) => {
              if (getBybitSymbol(prev.instrument_id) !== symbol) return prev;
              const curCfg = activeFrameRef.current;
              if (curCfg.category !== nextFrame.category || curCfg.value !== nextFrame.value) {
                return prev;
              }
              const nextSnap: ChartSnapshotDTO = {
                ...prev,
                venue: getInstrumentMeta(prev.instrument_id).venue,
                bars: closed,
                active_bar: tail,
                vwap: computeSessionVwap(closed, tail.close_ticks),
              };
              checkNewAlerts(nextSnap);
              return nextSnap;
            });
          });
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.warn(`[CustomFrame] Failed to fetch granular bars for ${category}:${safeVal}:`, err);
      }
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
    const realSeries = [
      ...snapshot.bars,
      ...(snapshot.active_bar ? [snapshot.active_bar] : []),
    ];
    return evaluateRealBarsBacktest(realSeries, config);
  };

  const handleRunOptimization = async (config: OptimizationSweepConfigDTO): Promise<OptimizationReportDTO> => {
    const realSeries = [
      ...snapshot.bars,
      ...(snapshot.active_bar ? [snapshot.active_bar] : []),
    ];
    const slRange =
      config.stop_loss_range && config.stop_loss_range.length > 0
        ? config.stop_loss_range
        : [500, 1000, 1500, 2000, 2500, 3000];
    const tpRange =
      config.take_profit_range && config.take_profit_range.length > 0
        ? config.take_profit_range
        : [1000, 2000, 3000, 4000, 5000, 6000];

    const matrix: OptimizationResultItemDTO[] = [];
    let bestPf = -1;
    let bestSl = slRange[0];
    let bestTp = tpRange[0];
    let bestPnl = 0;

    for (const sl of slRange) {
      for (const tp of tpRange) {
        const rep = evaluateRealBarsBacktest(realSeries, {
          strategy_name: config.strategy_name,
          trade_size_units: config.trade_size_units,
          stop_loss_ticks: sl,
          take_profit_ticks: tp,
          slippage_ticks: config.slippage_ticks,
        });
        if (rep.profit_factor > bestPf || (rep.profit_factor === bestPf && rep.net_pnl_ticks > bestPnl)) {
          bestPf = rep.profit_factor;
          bestSl = sl;
          bestTp = tp;
          bestPnl = rep.net_pnl_ticks;
        }
        matrix.push({
          stop_loss_ticks: sl,
          take_profit_ticks: tp,
          total_trades: rep.total_trades,
          winning_trades: rep.winning_trades,
          win_rate_pct: rep.win_rate_pct,
          net_pnl_ticks: rep.net_pnl_ticks,
          profit_factor: rep.profit_factor,
          max_drawdown_pct: rep.max_drawdown_pct,
        });
      }
    }

    return {
      strategy_name: config.strategy_name,
      best_stop_loss_ticks: bestSl,
      best_take_profit_ticks: bestTp,
      best_profit_factor: Math.max(0, bestPf),
      best_net_pnl_ticks: bestPnl,
      total_combinations: matrix.length,
      matrix,
    };
  };

  const handleInstrumentChange = (instrumentId: string, forceReload: boolean = false) => {
    if (instrumentId === snapshot.instrument_id && !forceReload) return;

    // Cancel any previous in-flight symbol/timeframe HTTP fetches immediately
    ++timeframeRequestIdRef.current;
    activeFetchAbortRef.current?.abort();
    pendingTradesRef.current = [];
    pendingOrderBookRef.current = null;
    replayRealBarsRef.current = [];
    rawBaseBarsRef.current = { key: '', bars: [] };
    isLoadingHistoryRef.current = false;

    if (forceReload || instrumentId.startsWith('SYNTH:')) {
      setSynthRevision((r) => r + 1);
    }

    saveWorkspaceConfig({ instrumentId });
    if (instrumentId.startsWith('MT5:')) {
      mt5BridgeService.syncFromRealMt5().catch(() => {});
    }

    // Zero-blocking instant switch: prefer already-downloaded real Data Pack or timeframe-matched local cache
    const symbol = getBybitSymbol(instrumentId);
    const currentTfUs = snapshot.timeframe_us || 60_000_000;
    const isTimeMode = activeFrameRef.current.category === 'time';
    const cachedBars =
      !forceReload && isTimeMode
        ? dataPackService.getHydratedBars(symbol, currentTfUs) ||
          loadSymbolBars(`${symbol}_${currentTfUs}`)
        : null;

    const instMeta = getInstrumentMeta(instrumentId);

    startTransition(() => {
      if (cachedBars && cachedBars.length > 1) {
        const closed = cachedBars.slice(0, -1);
        const tail = cachedBars[cachedBars.length - 1];
        setSnapshot((prev) => {
          const nextSnap: ChartSnapshotDTO = {
            ...prev,
            instrument_id: instMeta.id,
            venue: instMeta.venue,
            timeframe_us: currentTfUs,
            bars: closed,
            active_bar: tail,
            recent_trades: [],
            heatmap_slices: [],
            playback: undefined,
            vwap: computeSessionVwap(closed, tail.close_ticks),
          };
          saveSnapshotCache(nextSnap);
          return nextSnap;
        });
      } else {
        // Strictly empty connecting state — zero fake candles while real market bars load (~100ms)
        setSnapshot(createEmptyLiveSnapshot(instMeta.id, currentTfUs));
      }
    });
  };

  const applyReplayCursor = (cursorIdx: number, state: 'Playing' | 'Paused', speedMultiplier?: number) => {
    const full = replayRealBarsRef.current;
    if (full.length < 3) return;
    const clamped = Math.min(full.length, Math.max(2, cursorIdx));
    replayCursorRef.current = clamped;
    const visible = full.slice(0, clamped);
    const closed = visible.slice(0, -1);
    const active = visible[visible.length - 1];
    const pct = Math.round(((clamped - 2) / Math.max(1, full.length - 2)) * 100);
    setSnapshot((prev) => ({
      ...prev,
      bars: closed,
      active_bar: active,
      vwap: computeSessionVwap(closed, active.close_ticks),
      playback: {
        is_replay_mode: true,
        state: clamped >= full.length ? 'Paused' : state,
        speed_multiplier: speedMultiplier ?? prev.playback?.speed_multiplier ?? 1,
        progress_pct: pct,
        current_ts_us: active.bar_start_us,
      },
    }));
  };

  const handleToggleReplay = async (enable: boolean) => {
    if (enable && !checkOrPromptPrivilege('market_replay')) {
      return;
    }
    if (enable) {
      const full = [
        ...snapshot.bars,
        ...(snapshot.active_bar ? [snapshot.active_bar] : []),
      ];
      if (full.length < 5) return;
      replayRealBarsRef.current = full;
      const startCursor = Math.max(3, Math.floor(full.length * 0.35));
      applyReplayCursor(startCursor, 'Playing', 1);
    } else {
      const full = replayRealBarsRef.current;
      replayRealBarsRef.current = [];
      setSnapshot((prev) => {
        if (full.length > 1) {
          const closed = full.slice(0, -1);
          const tail = full[full.length - 1];
          return {
            ...prev,
            bars: closed,
            active_bar: tail,
            vwap: computeSessionVwap(closed, tail.close_ticks),
            playback: undefined,
          };
        }
        return { ...prev, playback: undefined };
      });
    }
  };

  const handlePlayReplay = async () => {
    if (!snapshot.playback?.is_replay_mode) return;
    const full = replayRealBarsRef.current;
    const nextStart = replayCursorRef.current >= full.length ? Math.max(3, Math.floor(full.length * 0.2)) : replayCursorRef.current;
    applyReplayCursor(nextStart, 'Playing');
  };

  const handlePauseReplay = async () => {
    setSnapshot((prev) =>
      prev.playback ? { ...prev, playback: { ...prev.playback, state: 'Paused' } } : prev
    );
  };

  const handleStepReplay = async () => {
    if (!snapshot.playback?.is_replay_mode) return;
    applyReplayCursor(replayCursorRef.current + 1, 'Paused');
  };

  const handleResetReplay = async () => {
    if (!snapshot.playback?.is_replay_mode) return;
    applyReplayCursor(3, 'Paused');
  };

  const handleSpeedChange = async (speed: number) => {
    setSnapshot((prev) =>
      prev.playback
        ? { ...prev, playback: { ...prev.playback, speed_multiplier: speed } }
        : prev
    );
  };

  useEffect(() => {
    if (!snapshot.playback?.is_replay_mode || snapshot.playback.state !== 'Playing') {
      return;
    }
    const speed = Math.max(1, snapshot.playback.speed_multiplier || 1);
    const intervalMs = Math.max(70, Math.round(750 / speed));
    const timer = setInterval(() => {
      const full = replayRealBarsRef.current;
      if (replayCursorRef.current >= full.length) {
        setSnapshot((prev) =>
          prev.playback ? { ...prev, playback: { ...prev.playback, state: 'Paused', progress_pct: 100 } } : prev
        );
        return;
      }
      applyReplayCursor(replayCursorRef.current + 1, 'Playing', speed);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [snapshot.playback?.is_replay_mode, snapshot.playback?.state, snapshot.playback?.speed_multiplier]);

  const handleExportCSV = async () => {
    if (!checkOrPromptPrivilege('csv_export')) {
      return;
    }
    const allRealBars = [
      ...snapshot.bars,
      ...(snapshot.active_bar ? [snapshot.active_bar] : []),
    ];
    let csv = 'bar_start_us,timeframe_us,open_ticks,high_ticks,low_ticks,close_ticks,buy_units,sell_units,unknown_units,total_units,delta_units,poc_ticks\n';
    allRealBars.forEach((b) => {
      csv += `${b.bar_start_us},${b.timeframe_us},${b.open_ticks},${b.high_ticks},${b.low_ticks},${b.close_ticks},${b.buy_units},${b.sell_units},${b.unknown_units ?? 0},${b.total_units},${b.delta_units},${b.poc_ticks || ''}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `DeepChart_${snapshot.instrument_id.replace(/:/g, '_')}_bars.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Real Live Exchange Feed: Direct Bybit/Binance WebSocket & REST + MT5 ECN streaming (only after Login!)
  useEffect(() => {
    if (!authSession || !isLiveFeedActive || snapshot.playback?.is_replay_mode) {
      liveFeedService.disconnect();
      return;
    }

    const symbol = getBybitSymbol(snapshot.instrument_id);
    let isCancelled = false;
    const fetchController = new AbortController();
    activeFetchAbortRef.current = fetchController;

    const currentTfUs = snapshot.timeframe_us || 60_000_000;
    const frameAtStart = activeFrameRef.current;
    const activeInterval =
      frameAtStart.category === 'time' ? timeframeUsToBybitInterval(currentTfUs) : '1';
    const useDeepTicks = frameAtStart.category !== 'time';

    // Fetch fresh historical kline bars from exchange / MT5 / CME Globex (2-Tier Public + L3 MBO) / Multi-Leg Synthetic Engine
    const resolvedFeedSource = snapshot.instrument_id.startsWith('CME:')
      ? cmeStatus.configured || cmeStatus.statusState === 'FILE_LOADED'
        ? 'CME Globex MDP 3.0 Level-3 MBO'
        : 'CME Globex Futures (Public Live · Free)'
      : snapshot.instrument_id.startsWith('SYNTH:')
      ? 'Multi-Leg Real Synthetic Engine'
      : snapshot.instrument_id.startsWith('MT5:')
      ? 'MetaTrader 5 ECN Bridge'
      : snapshot.instrument_id.startsWith('BINANCE:')
      ? 'Binance USD-M Futures'
      : 'Bybit / Binance Linear';

    liveFeedService
      .fetchRealHistoricalKlines(
        symbol,
        activeInterval,
        1500,
        undefined,
        fetchController.signal,
        useDeepTicks
      )
      .then((realBars) => {
        if (isCancelled || fetchController.signal.aborted || realBars.length === 0) return;

        const curFrame = activeFrameRef.current;
        if (curFrame.category !== 'time') {
          rawBaseBarsRef.current = { key: symbol, bars: realBars };
          const built = buildNonTimeBarsFromRealData(realBars, curFrame, snapshot.instrument_id);
          if (built.length === 0) return;
          const closed = built.length > 1 ? built.slice(0, -1) : [];
          const tail = built[built.length - 1];
          const computedVwap = computeSessionVwap(closed, tail.close_ticks);

          startTransition(() => {
            setSnapshot((prev) => {
              if (getBybitSymbol(prev.instrument_id) !== symbol) return prev;
              const nextSnap: ChartSnapshotDTO = {
                ...prev,
                venue: getInstrumentMeta(prev.instrument_id).venue,
                bars: closed,
                active_bar: tail,
                recent_trades: prev.recent_trades || [],
                vwap: computedVwap,
                options_summary: recalculateOptionsLevels(prev.options_summary),
                data_quality: {
                  ...prev.data_quality,
                  feed_status: 'LIVE_CONNECTED',
                  feed_source: resolvedFeedSource,
                  freshness_ms: 18,
                  completeness: 'Complete',
                },
              };
              checkNewAlerts(nextSnap);
              return nextSnap;
            });
          });
          return;
        }

        const lastBar = realBars[realBars.length - 1];
        const pureHistoricalBars = realBars.slice(0, -1);
        saveSymbolBars(`${symbol}_${currentTfUs}`, pureHistoricalBars);
        dataPackService.updateHydratedSeries(symbol, currentTfUs, realBars);
        const currentPrice = lastBar.close_ticks;
        const computedVwap = computeSessionVwap(pureHistoricalBars, currentPrice);

        startTransition(() => {
          setSnapshot((prev) => {
            if (getBybitSymbol(prev.instrument_id) !== symbol) return prev;
            const mergedClosed = mergeBars(prev.bars, pureHistoricalBars).filter(
              (b) => b.bar_start_us < lastBar.bar_start_us
            );
            const nextSnap: ChartSnapshotDTO = {
              ...prev,
              venue: getInstrumentMeta(prev.instrument_id).venue,
              bars: mergedClosed,
              active_bar: lastBar,
              recent_trades: prev.recent_trades || [],
              vwap: computedVwap,
              options_summary: recalculateOptionsLevels(prev.options_summary),
              data_quality: {
                ...prev.data_quality,
                feed_status: 'LIVE_CONNECTED',
                feed_source: resolvedFeedSource,
                freshness_ms: 18,
                completeness: 'Complete',
              },
            };
            saveSnapshotCache(nextSnap);
            checkNewAlerts(nextSnap);
            return nextSnap;
          });
        });
      })
      .catch((err) => {
        if (!fetchController.signal.aborted) {
          console.warn('[LiveFeed] Failed to load fresh klines:', err);
        }
      });

    // Connect real WebSocket / 250ms MT5 ECN / Multi-Leg Synthetic stream for live trades, live bar sync, and L2 orderbook depth
    liveFeedService.connect(
      symbol,
      {
        onLiveBar: (liveBar, prevClosedBar) => {
          if (
            isCancelled ||
            activeFrameRef.current.category !== 'time' ||
            symbol.startsWith('SYNTH:') ||
            !liveBar.bar_start_us ||
            !Number.isFinite(liveBar.close_ticks)
          ) {
            return;
          }
          setSnapshot((prev) => {
            let prevBars = prev.bars;
            let curActive = prev.active_bar ? { ...prev.active_bar } : null;
            const lbStart = liveBar.bar_start_us!;
            const lbTf = liveBar.timeframe_us || prev.timeframe_us || 60_000_000;
            const lbOpen = liveBar.open_ticks ?? liveBar.close_ticks!;
            const lbHigh = liveBar.high_ticks ?? liveBar.close_ticks!;
            const lbLow = liveBar.low_ticks ?? liveBar.close_ticks!;
            const lbClose = liveBar.close_ticks!;
            const lbVol = liveBar.total_units || 1;

            if (!curActive || curActive.bar_start_us < lbStart) {
              if (curActive && curActive.bar_start_us < lbStart) {
                if (prevClosedBar && prevClosedBar.bar_start_us === curActive.bar_start_us) {
                  curActive.open_ticks = prevClosedBar.open_ticks ?? curActive.open_ticks;
                  curActive.high_ticks = Math.max(curActive.high_ticks, prevClosedBar.high_ticks ?? curActive.high_ticks);
                  curActive.low_ticks = Math.min(curActive.low_ticks, prevClosedBar.low_ticks ?? curActive.low_ticks);
                  curActive.close_ticks = prevClosedBar.close_ticks ?? curActive.close_ticks;
                }
                curActive.finality = 'Closed';
                prevBars = [...prevBars, curActive].slice(-50_000);
              }
              const buyU = lbClose >= lbOpen ? Math.ceil(lbVol * 0.55) : Math.floor(lbVol * 0.45);
              const sellU = Math.max(0, lbVol - buyU);
              curActive = {
                bar_start_us: lbStart,
                timeframe_us: lbTf,
                open_ticks: lbOpen,
                high_ticks: lbHigh,
                low_ticks: lbLow,
                close_ticks: lbClose,
                buy_units: buyU,
                sell_units: sellU,
                unknown_units: 0,
                total_units: lbVol,
                delta_units: buyU - sellU,
                trade_count: Math.max(1, lbVol),
                poc_ticks: lbClose,
                value_area: {
                  poc_ticks: lbClose,
                  vah_ticks: Math.max(lbOpen, lbClose),
                  val_ticks: Math.min(lbOpen, lbClose),
                  volume_covered: Math.round(lbVol * 0.7),
                },
                footprint: [],
                finality: 'Forming',
                completeness: 'OHLCV_Only',
              };
            } else if (curActive.bar_start_us === lbStart) {
              curActive.open_ticks = lbOpen;
              curActive.high_ticks = Math.max(curActive.high_ticks, lbHigh, lbClose);
              curActive.low_ticks = Math.min(curActive.low_ticks, lbLow, lbClose);
              curActive.close_ticks = lbClose;
              if (lbVol > curActive.total_units && (!curActive.footprint || curActive.footprint.length === 0)) {
                const diff = lbVol - curActive.total_units;
                if (lbClose >= curActive.open_ticks) curActive.buy_units += diff;
                else curActive.sell_units += diff;
                curActive.total_units = curActive.buy_units + curActive.sell_units + (curActive.unknown_units || 0);
                curActive.delta_units = curActive.buy_units - curActive.sell_units;
              }
            }

            return {
              ...prev,
              bars: prevBars,
              active_bar: curActive,
            };
          });
        },
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
                const isSynth = prev.instrument_id.startsWith('SYNTH:');
                const curFrame = activeFrameRef.current;
                let updatedRecent = prev.recent_trades ? [...prev.recent_trades] : [];
                let currentActive = prev.active_bar ? { ...prev.active_bar } : null;
                let prevBars = [...prev.bars];

                trades.forEach((t) => {
                  updatedRecent.unshift(t);

                  // Only guard against genuine cross-symbol scale mismatch (>25% jump, e.g. $60k BTC vs $3.6k Gold);
                  // skip for signed/basis SYNTH:* spreads where near-zero spread ticks can move >25% legitimately.
                  const refScaleTicks =
                    currentActive?.close_ticks ||
                    (prevBars.length > 0 ? prevBars[prevBars.length - 1].close_ticks : 0);
                  if (
                    !isSynth &&
                    refScaleTicks > 0 &&
                    t.price_ticks > 0 &&
                    Math.abs(refScaleTicks - t.price_ticks) / t.price_ticks > 0.25
                  ) {
                    return;
                  }

                  // Real-time Non-Time Bar Rollover (Range / Volume / Tick Bars)
                  if (curFrame.category !== 'time') {
                    const rolled = appendLiveTradeToNonTimeSeries(
                      prevBars,
                      currentActive,
                      t,
                      curFrame,
                      prev.instrument_id
                    );
                    prevBars = rolled.closedBars;
                    currentActive = rolled.activeBar;
                    return;
                  }

                  const timeframeUs = currentActive?.timeframe_us || prev.timeframe_us || 60_000_000;
                  const tradeMinuteStartUs = Math.floor(t.exchange_ts_us / timeframeUs) * timeframeUs;

                  if (!currentActive || currentActive.bar_start_us !== tradeMinuteStartUs) {
                    if (currentActive && currentActive.bar_start_us < tradeMinuteStartUs) {
                      currentActive.finality = 'Closed';
                      prevBars = [...prevBars, currentActive].slice(-50_000);
                      dataPackService.updateHydratedSeries(symbol, timeframeUs, prevBars);
                    }
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
                    if (
                      !isSynth &&
                      currentActive.close_ticks > 0 &&
                      Math.abs(currentActive.close_ticks - t.price_ticks) / currentActive.close_ticks > 0.25
                    ) {
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
                    currentActive.total_units =
                      currentActive.buy_units + currentActive.sell_units + (currentActive.unknown_units || 0);
                    currentActive.delta_units = currentActive.buy_units - currentActive.sell_units;
                    currentActive.trade_count += 1;
                    currentActive.completeness = 'Complete';

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

                const trimmedRecent = updatedRecent.slice(0, 40);
                const refLatestUs = trimmedRecent[0]?.exchange_ts_us || 0;
                let sBuy = 0;
                let sSell = 0;
                let sCount = 0;
                for (const tr of trimmedRecent) {
                  if (refLatestUs > 0 && Math.abs(refLatestUs - tr.exchange_ts_us) <= 1_000_000) {
                    if (tr.aggressor === 'Buy') sBuy += tr.quantity_units;
                    else sSell += tr.quantity_units;
                    sCount++;
                  }
                }

                return {
                  ...prev,
                  bars: prevBars,
                  recent_trades: trimmedRecent,
                  active_bar: currentActive,
                  order_book: ob || prev.order_book,
                  speed_1s: {
                    window_ms: 1000,
                    buy_units: sBuy,
                    sell_units: sSell,
                    unknown_units: 0,
                    total_units: sBuy + sSell,
                    delta_units: sBuy - sSell,
                    trade_count: sCount,
                  },
                };
              });
            });
          }
        },
        onOrderBook: (ob) => {
          if (isCancelled) return;
          pendingOrderBookRef.current = ob;
          const nowMs = performance.now();
          if (nowMs - lastObCommitMsRef.current < 200) return;
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
        onCmeMboTelemetry: (icebergs, stopSweeps) => {
          if (isCancelled) return;
          setSnapshot((prev) => {
            const nextSnap: ChartSnapshotDTO = {
              ...prev,
              icebergs,
              cme_stop_sweeps: stopSweeps,
            };
            checkNewAlerts(nextSnap);
            return nextSnap;
          });
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
      },
      currentTfUs
    );

    return () => {
      isCancelled = true;
      fetchController.abort();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      liveFeedService.disconnect();
    };
  }, [snapshot.instrument_id, synthRevision, isLiveFeedActive, authSession, snapshot.playback?.is_replay_mode]);

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
    if (snapshot.bars.length === 0 || isLoadingHistoryRef.current) return;
    const symbol = getBybitSymbol(snapshot.instrument_id);
    const curFrame = activeFrameRef.current;

    if (curFrame.category !== 'time') {
      const baseBars = rawBaseBarsRef.current.key === symbol ? rawBaseBarsRef.current.bars : [];
      const oldestRef = baseBars.length > 0 ? baseBars[0] : snapshot.bars[0];
      const endMs = Math.max(1, Math.floor(oldestRef.bar_start_us / 1000) - 1);
      const pageSig = `${symbol}_nontime_${curFrame.category}_${curFrame.value}_${endMs}`;
      if (exhaustedHistoryRef.current.has(pageSig)) return;

      isLoadingHistoryRef.current = true;
      try {
        const olderRaw = await liveFeedService.fetchRealHistoricalKlines(
          symbol,
          '1',
          1500,
          endMs,
          undefined,
          true
        );
        const strictlyOlder = olderRaw.filter((b) => b.bar_start_us < oldestRef.bar_start_us);
        if (strictlyOlder.length > 0) {
          const mergedRaw = mergeBars(strictlyOlder, baseBars.length > 0 ? baseBars : snapshot.bars).slice(-50_000);
          rawBaseBarsRef.current = { key: symbol, bars: mergedRaw };
          const built = buildNonTimeBarsFromRealData(mergedRaw, curFrame, snapshot.instrument_id);
          if (built.length > 1) {
            const closed = built.slice(0, -1);
            const tail = built[built.length - 1];
            startTransition(() => {
              setSnapshot((prev) => {
                if (getBybitSymbol(prev.instrument_id) !== symbol) return prev;
                return {
                  ...prev,
                  bars: closed,
                  active_bar: prev.active_bar || tail,
                };
              });
            });
          }
        } else {
          exhaustedHistoryRef.current.add(pageSig);
        }
      } catch (e) {
        console.warn('Failed to load older granular history for custom frame:', e);
      } finally {
        isLoadingHistoryRef.current = false;
      }
      return;
    }

    const currentTfUs = snapshot.timeframe_us || 60_000_000;
    const histKey = `${symbol}_${currentTfUs}`;
    const oldestBar = snapshot.bars[0];
    const endMs = Math.max(1, Math.floor(oldestBar.bar_start_us / 1000) - 1);
    const pageSig = `${histKey}_${endMs}`;
    if (exhaustedHistoryRef.current.has(pageSig)) return;

    isLoadingHistoryRef.current = true;
    const activeInterval = timeframeUsToBybitInterval(currentTfUs);
    try {
      const olderBars = await liveFeedService.fetchRealHistoricalKlines(symbol, activeInterval, 1500, endMs);
      const strictlyOlder = olderBars.filter((b) => b.bar_start_us < oldestBar.bar_start_us);
      if (strictlyOlder.length > 0) {
        startTransition(() => {
          setSnapshot((prev) => {
            if (getBybitSymbol(prev.instrument_id) !== symbol) return prev;
            const merged = mergeBars(strictlyOlder, prev.bars).slice(-50_000);
            saveSymbolBars(histKey, merged);
            if (prev.active_bar) {
              dataPackService.updateHydratedSeries(symbol, currentTfUs, [...merged, prev.active_bar]);
            }
            return { ...prev, bars: merged };
          });
        });
      } else {
        exhaustedHistoryRef.current.add(pageSig);
      }
    } catch (e) {
      console.warn('Failed to load older historical bars:', e);
    } finally {
      isLoadingHistoryRef.current = false;
    }
  };

  const latestBar = snapshot.active_bar || (snapshot.bars.length > 0 ? snapshot.bars[snapshot.bars.length - 1] : null);
  const totalCvd = snapshot.bars.reduce((acc, b) => acc + (b.delta_units || 0), 0) + (snapshot.active_bar ? (snapshot.active_bar.delta_units || 0) : 0);

  const handleMt5ButtonClick = async () => {
    if (!checkOrPromptPrivilege('mt5_execution')) {
      return;
    }
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

  // Auth Gate Rendering: Login-Only Desktop Terminal
  if (!authChecked) {
    return (
      <div
        style={{
          height: '100vh',
          width: '100vw',
          background: '#090C11',
          color: '#94A3B8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '12px',
        }}
      >
        Initializing VluxChart Engine...
      </div>
    );
  }

  if (!authSession) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  const isSystemReady = systemReport === null || systemReport.all_core_ready;
  const localDataLabel = isSystemReady ? 'Hệ Thống' : 'Cài Hệ Thống';

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
        onOpenBacktest={() => {
          if (checkOrPromptPrivilege('backtester')) setIsBacktestOpen(true);
        }}
        onOpenZoneInspector={() => {
          if (checkOrPromptPrivilege('top7_zones')) setIsZoneInspectorOpen(true);
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenMt5Modal={handleMt5ButtonClick}
        onOpenCmeModal={() => {
          if (checkOrPromptPrivilege('mbo_l3')) setIsCmeModalOpen(true);
        }}
        cmeConnected={
          cmeStatus.configured ||
          cmeStatus.statusState === 'STREAMING' ||
          cmeStatus.statusState === 'FILE_LOADED'
        }
        onOpenIndicators={() => window.dispatchEvent(new CustomEvent('deepchart:open_indicators'))}
        onOpenOptionsBoard={() => {
          if (checkOrPromptPrivilege('options_gex')) setIsOptionsBoardOpen(true);
        }}
        onOpenScriptEditor={() => {
          if (checkOrPromptPrivilege('script_editor')) setIsScriptEditorOpen(true);
        }}
        onOpenInstrumentStudio={() => {
          if (checkOrPromptPrivilege('instrument_studio')) setIsInstrumentStudioOpen(true);
        }}
        onOpenRiskManager={() => {
          if (checkOrPromptPrivilege('risk_manager')) setIsRiskManagerOpen(true);
        }}
        onOpenDataManager={() => {
          setIsFirstRunSystemPrompt(false);
          setIsSystemModalOpen(true);
        }}
        localDataLabel={localDataLabel}
        hasLocalData={isSystemReady}
        authUserEmail={authSession.email}
        authUserTier={authSession.tier}
        activeFrame={activeFrame}
        onOpenPrivilegeModal={() => setPrivilegeModal({ open: true, featureKey: null })}
        onLogout={handleLogout}
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
        onMultiChartLayoutChange={(nextLayout) => {
          if (nextLayout !== '1x1' && !checkOrPromptPrivilege('multi_chart')) return;
          setMultiChartLayout(nextLayout);
        }}
      />

      {/* Main Terminal Workspace: Left Sidebar + Central Chart Panel + Right Dock / Options Panel */}
      <div style={{ flex: 1, display: 'flex', width: '100%', height: 'calc(100% - 36px - 28px)', overflow: 'hidden', position: 'relative' }}>
        {/* Left 36px DeepCharts Tools Sidebar */}
        <LeftToolsSidebar
          activeTool={activeDrawingTool}
          onSelectTool={(tool) => {
            if (tool === 'fixed_range_vp' && !checkOrPromptPrivilege('fixed_range_vp')) return;
            setActiveDrawingTool(tool);
          }}
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
              onLoadMoreHistory={handleLoadMoreHistory}
              footprintMode={workspaceConfig.footprintMode}
              heatmapPalette={workspaceConfig.heatmapPalette}
              whaleVolumeThreshold={workspaceConfig.whaleVolumeThreshold}
              userTier={authSession.tier}
              onRequirePrivilege={(fk) => checkOrPromptPrivilege(fk as FeatureEntitlementKey)}
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
          gap: '12px',
          fontSize: '10.5px',
          justifyContent: 'space-between',
          color: '#94A3B8',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          overflowX: 'auto',
          scrollbarWidth: 'none',
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
            <span style={{ color: '#089981' }}>///</span>
            <span>VLUXCHART</span>
          </div>

          {/* Active Workspace Profile Selector (Live Interactive Preset Switcher) */}
          <select
            value={layoutPreset}
            onChange={(e) => handleLayoutPresetChange(e.target.value as LayoutPreset)}
            aria-label="Chọn bố cục không gian làm việc"
            style={{
              background: '#181D27',
              border: '1px solid #2A3242',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '10px',
              color: '#E2E8F0',
              fontWeight: 600,
              cursor: 'pointer',
              outline: 'none',
            }}
            title="Chuyển nhanh Bố cục Không gian làm việc (Ctrl+1..4)"
          >
            <option value="order_flow_pro">001 · Order Flow Pro</option>
            <option value="pure_heatmap">002 · Pure Chart</option>
            <option value="options_confluence">003 · Options &amp; GEX</option>
            <option value="market_intel">004 · Zone Audit</option>
            <option value="standard">005 · Standard</option>
          </select>

          {/* Feed Connection Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#94A3B8', fontSize: '10.5px' }}>Feed</span>
            <button
              type="button"
              onClick={() => setIsLiveFeedActive(!isLiveFeedActive)}
              style={{
                background: snapshot.playback?.is_replay_mode
                  ? 'rgba(217, 119, 6, 0.2)'
                  : isLiveFeedActive
                  ? 'rgba(8, 153, 129, 0.16)'
                  : '#1E2430',
                color: snapshot.playback?.is_replay_mode
                  ? '#FBBF24'
                  : isLiveFeedActive
                  ? '#34D399'
                  : '#94A3B8',
                border: `1px solid ${
                  snapshot.playback?.is_replay_mode
                    ? 'rgba(245, 158, 11, 0.45)'
                    : isLiveFeedActive
                    ? 'rgba(16, 185, 129, 0.45)'
                    : '#2D3648'
                }`,
                padding: '1px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Bấm để Tạm dừng / Tiếp tục luồng dữ liệu thật trực tiếp"
            >
              {snapshot.playback?.is_replay_mode
                ? `● Market Replay (${snapshot.playback.speed_multiplier}x)`
                : isLiveFeedActive
                ? snapshot.instrument_id.startsWith('CME:')
                  ? cmeStatus.configured || cmeStatus.statusState === 'FILE_LOADED'
                    ? '● CME Globex Level-3 MBO'
                    : '● CME Globex (Public Live)'
                  : snapshot.instrument_id.startsWith('SYNTH:')
                  ? '● Multi-Leg Synthetic Live'
                  : snapshot.instrument_id.startsWith('MT5:')
                  ? '● MT5 Forex & Metals ECN'
                  : snapshot.instrument_id.startsWith('BINANCE:')
                  ? '● Binance USD-M Live'
                  : '● Bybit · Binance Live'
                : '○ Feed Paused'}
            </button>
          </div>
        </div>

        {/* Right: Exact Integer Volume Accounting Telemetry */}
        <div
          className="tabular-nums"
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
                  BUY: <strong style={{ color: '#089981' }}>{buyVol.toLocaleString()}</strong>
                </span>
                <span>
                  SELL: <strong style={{ color: '#F23645' }}>{sellVol.toLocaleString()}</strong>
                </span>
                {unknownVol > 0 && (
                  <span>
                    UNK: <strong style={{ color: '#94A3B8' }}>{unknownVol.toLocaleString()}</strong>
                  </span>
                )}
                <span>
                  Δ:{' '}
                  <strong style={{ color: deltaVol >= 0 ? '#089981' : '#F23645' }}>
                    {deltaVol >= 0 ? '+' : ''}{deltaVol.toLocaleString()}
                  </strong>
                </span>
                <span>
                  CVD: <strong style={{ color: '#38BDF8' }}>{totalCvd >= 0 ? '+' : ''}{totalCvd.toLocaleString()}</strong>
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

      {/* US Futures CME Globex Level-3 MBO Connector Modal (Databento GLBX.MDP3 / dxFeed / Rithmic) */}
      <CmeMboConnectionModal
        isOpen={isCmeModalOpen}
        onClose={() => setIsCmeModalOpen(false)}
        currentInstrumentId={snapshot.instrument_id}
        onSelectInstrument={(id, force) => handleInstrumentChange(id, force ?? true)}
      />

      {/* ATAS Options Board & Strategy Analyzer Modal */}
      <OptionsBoardModal
        isOpen={isOptionsBoardOpen}
        onClose={() => setIsOptionsBoardOpen(false)}
        instrumentId={snapshot.instrument_id}
        currentPriceTicks={snapshot.bars?.[snapshot.bars.length - 1]?.close_ticks || null}
      />

      {/* ATAS Script Editor NEW Modal */}
      <ScriptEditorModal
        isOpen={isScriptEditorOpen}
        onClose={() => setIsScriptEditorOpen(false)}
      />

      {/* ATAS Instrument Studio Modal */}
      <InstrumentStudioModal
        isOpen={isInstrumentStudioOpen}
        onClose={() => setIsInstrumentStudioOpen(false)}
        activeFrame={activeFrame}
        onApplySynthetic={(synthId) => {
          handleInstrumentChange(synthId, true);
        }}
        onSelectFrameType={(type, val) => {
          handleSelectCustomFrame(type, val);
        }}
      />

      {/* ATAS Risk Manager NEW Modal */}
      <RiskManagerModal
        isOpen={isRiskManagerOpen}
        onClose={() => setIsRiskManagerOpen(false)}
        instrumentId={snapshot.instrument_id}
      />

      {/* System & Runtime Compatibility Bootstrapper (Auto-Skip if Ready; 1-Click Setup if Missing) */}
      <SystemBootstrapModal
        isOpen={isSystemModalOpen}
        isFirstRunPrompt={isFirstRunSystemPrompt}
        initialReport={systemReport}
        dataManifest={dataManifest}
        userEmail={authSession.email}
        onClose={() => {
          setIsSystemModalOpen(false);
          setIsFirstRunSystemPrompt(false);
        }}
        onReportUpdated={(rep) => {
          setSystemReport(rep);
          if (rep.all_core_ready && snapshot.instrument_id.startsWith('MT5:')) {
            mt5BridgeService.syncFromRealMt5().catch(() => {});
          }
        }}
        onCacheCleared={(m) => setDataManifest(m)}
      />

      {/* 3-Tier Account Privileges & External Web Portal Upgrade Modal */}
      <UpgradePrivilegeModal
        isOpen={privilegeModal.open}
        onClose={() => setPrivilegeModal({ open: false, featureKey: null })}
        userEmail={authSession.email}
        userTier={authSession.tier}
        licenseId={authSession.license_id}
        lockedFeatureKey={privilegeModal.featureKey}
      />
    </div>
  );
}

export default App;
