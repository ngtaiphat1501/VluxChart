import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  BarDTO,
  ChartDrawing,
  DeltaDivergenceDTO,
  DrawingPoint,
  DrawingTool,
  FIBONACCI_LEVELS,
  HeatmapSliceDTO,
  IcebergOrderDTO,
  OptionsSummaryDTO,
  OrderBookSnapshotDTO,
  SessionVolumeProfileDTO,
  TradeEventDTO,
  VwapBandDTO,
} from '../types';
import {
  computeSessionVwap,
  computeBarStatistics,
  aggregateFootprintCells,
  computeNakedPocs,
  detectAbsorptionEvents,
  detectCvdDivergences,
  CalculatedOrderFlowBar,
  NakedPocDTO,
  AbsorptionEventDTO,
} from '../utils/orderFlowMath';
import {
  CANONICAL_INSTRUMENTS,
  getInstrumentMeta,
  formatInstrumentPrice,
  formatPriceDiffPips,
  computePositionPnlUsd,
} from '../utils/instrumentRegistry';
import { mt5BridgeService, Mt5OrderTicket } from '../services/mt5BridgeService';
import { optionsLiveService, LiveOptionsChainResult } from '../services/optionsLiveService';
import { IndicatorsModal, IndicatorConfigState } from './IndicatorsModal';

interface FootprintCanvasProps {
  bars: BarDTO[];
  activeBar: BarDTO | null;
  instrumentId: string;
  heatmapSlices?: HeatmapSliceDTO[];
  orderBook?: OrderBookSnapshotDTO;
  optionsSummary?: OptionsSummaryDTO;
  vwap?: VwapBandDTO;
  divergences?: DeltaDivergenceDTO[];
  volumeProfile?: SessionVolumeProfileDTO;
  icebergs?: IcebergOrderDTO[];
  recentTrades?: TradeEventDTO[];
  footprintMode?: 'bid_ask' | 'delta_gradient' | 'monochrome';
  heatmapPalette?: 'fire' | 'neon' | 'greyscale';
  whaleVolumeThreshold?: number;
  drawings?: ChartDrawing[];
  activeDrawingTool?: DrawingTool;
  drawingColor?: string;
  onDrawingCreated?: (drawing: ChartDrawing) => void;
  onDrawingUpdated?: (drawing: ChartDrawing) => void;
  onDrawingDeleted?: (drawingId: string) => void;
  drawingsVisible?: boolean;
  onPriceBoundsChange?: (bounds: { minPrice: number; maxPrice: number; chartHeight: number; panY: number }) => void;
  onSwitchToTradingView?: () => void;
  tickAggregation?: number | 'auto';
  onTickAggregationChange?: (mult: number | 'auto') => void;
  isTradingPanelOpen?: boolean;
  onToggleTradingPanel?: () => void;
  paneId?: string;
  hideBottomToolbar?: boolean;
  initialBottomSubPanel?: 'cot' | 'vol' | 'cvd' | 'none';
  forcedDisplayMode?: 'footprint_vp_ba' | 'footprint_vp' | 'footprint_delta' | 'candlestick';
  syncedCrosshair?: { priceTicks: number | null; timestampUs: number | null; sourcePaneId: string } | null;
  onCrosshairSync?: (state: { priceTicks: number | null; timestampUs: number | null; sourcePaneId: string }) => void;
  magnetEnabled?: boolean;
  isPickingPriceOnChart?: boolean;
  onPricePickedFromChart?: (priceTicks: number) => void;
}

export const FootprintCanvas: React.FC<FootprintCanvasProps> = ({
  bars,
  activeBar,
  instrumentId,
  heatmapSlices,
  orderBook,
  optionsSummary,
  vwap,
  divergences,
  volumeProfile,
  icebergs,
  recentTrades,
  footprintMode = 'bid_ask',
  heatmapPalette = 'fire',
  whaleVolumeThreshold = 500,
  drawings = [],
  activeDrawingTool = 'cursor',
  drawingColor = '#00E5FF',
  onDrawingCreated,
  onDrawingUpdated,
  onDrawingDeleted,
  drawingsVisible = true,
  onPriceBoundsChange,
  onSwitchToTradingView,
  tickAggregation: externalTickAgg,
  onTickAggregationChange,
  isTradingPanelOpen = false,
  onToggleTradingPanel,
  paneId = 'pane-1',
  hideBottomToolbar = false,
  initialBottomSubPanel = 'cot',
  forcedDisplayMode,
  syncedCrosshair,
  onCrosshairSync,
  magnetEnabled = false,
  isPickingPriceOnChart = false,
  onPricePickedFromChart,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Pan, Zoom and Price Scale viewport state
  const [zoom, setZoom] = useState<number>(1.0);
  const [panX, setPanX] = useState<number>(0);
  const [panY, setPanY] = useState<number>(0);
  const [priceScale, setPriceScale] = useState<number>(1.0);
  const [dragMode, setDragMode] = useState<'none' | 'chartPan' | 'priceScale' | 'timeScale'>('none');
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [initialPriceScale, setInitialPriceScale] = useState<number>(1.0);
  const [initialZoom, setInitialZoom] = useState<number>(1.0);
  const [initialPanX, setInitialPanX] = useState<number>(0);
  const [initialPanY, setInitialPanY] = useState<number>(0);
  const [cursorStyle, setCursorStyle] = useState<string>('crosshair');
  const [isPriceScaleHovered, setIsPriceScaleHovered] = useState<boolean>(false);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // ===========================================================================
  // AUTHENTIC DEEPCHART COMBINABLE ORDER FLOW LAYERS
  // Clean default state: OF-VP + OF-B/A active, mutually exclusive sub-panels
  // ===========================================================================
  const [showOfVp, setShowOfVp] = useState<boolean>(true); // OF-VP: Horizontal bar volume profile per candle
  const [showOfBa, setShowOfBa] = useState<boolean>(true); // OF-B/A: 2-column Bid x Ask numbers & Yellow POC box
  const [showOfDeltaP, setShowOfDeltaP] = useState<boolean>(false); // OF-ΔP: Bi-directional Delta profile per candle

  useEffect(() => {
    if (!forcedDisplayMode) return;
    if (forcedDisplayMode === 'footprint_vp_ba') {
      setShowOfVp(true);
      setShowOfBa(true);
      setShowOfDeltaP(false);
    } else if (forcedDisplayMode === 'footprint_vp') {
      setShowOfVp(true);
      setShowOfBa(false);
      setShowOfDeltaP(false);
    } else if (forcedDisplayMode === 'footprint_delta') {
      setShowOfVp(false);
      setShowOfBa(true);
      setShowOfDeltaP(true);
    } else if (forcedDisplayMode === 'candlestick') {
      setShowOfVp(false);
      setShowOfBa(false);
      setShowOfDeltaP(false);
    }
  }, [forcedDisplayMode]);

  const [colorTheme, setColorTheme] = useState<'deepchart' | 'atas'>('deepchart');
  const [internalTickAgg, setInternalTickAgg] = useState<number | 'auto'>('auto');
  const tickAggregation = externalTickAgg !== undefined ? externalTickAgg : internalTickAgg;
  const setTickAggregation = (val: number | 'auto') => {
    setInternalTickAgg(val);
    onTickAggregationChange?.(val);
  };

  // Session & Macro Indicators (Bottom Indicators Toolbar)
  const [showVolumeProfile, setShowVolumeProfile] = useState<boolean>(true); // D-VP (Right-anchored Royal Blue profile)
  const [showDeltaProfileSession, setShowDeltaProfileSession] = useState<boolean>(false); // D-DP (Session Delta Profile)
  const [showValueAreaLines, setShowValueAreaLines] = useState<boolean>(true); // D-VL (Session VAH/VAL/POC lines)
  const [showVwap, setShowVwap] = useState<boolean>(true); // VWAP / Developing Value line
  const [showNakedPoc, setShowNakedPoc] = useState<boolean>(false); // NPOC Rays
  // Independent ATAS-Style Indicator Sub-Panels (Stacked cleanly under main chart)
  const [showVolHistogram, setShowVolHistogram] = useState<boolean>(
    initialBottomSubPanel === 'vol' || initialBottomSubPanel === undefined
  );
  const [showCvdPanel, setShowCvdPanel] = useState<boolean>(initialBottomSubPanel === 'cvd');
  const [showCotGrid, setShowCotGrid] = useState<boolean>(initialBottomSubPanel === 'cot');
  const [isIndicatorsModalOpen, setIsIndicatorsModalOpen] = useState<boolean>(false);

  // Listen to Global "deepchart:open_indicators" or Ctrl+I shortcut
  useEffect(() => {
    const handleOpen = () => setIsIndicatorsModalOpen(true);
    window.addEventListener('deepchart:open_indicators', handleOpen);

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        setIsIndicatorsModalOpen((p) => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('deepchart:open_indicators', handleOpen);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const [showBarHeadStats, setShowBarHeadStats] = useState<boolean>(true); // Delta & Volume stacked above bar high wick
  const [showChartDom, setShowChartDom] = useState<boolean>(!hideBottomToolbar); // Chart DOM Trading strip next to price axis
  const [showSlClusters, setShowSlClusters] = useState<boolean>(false); // Stop-Loss Clusters & Liquidation Pools (BSL/SSL)
  const [showAbsorption, setShowAbsorption] = useState<boolean>(false); // Passive Limit Walls, Stacked Imbalances, Absorption & Unfinished Auction
  const [showSignals, setShowSignals] = useState<boolean>(true);
  const [showBubbles, setShowBubbles] = useState<boolean>(false);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [showOptions, setShowOptions] = useState<boolean>(false); // Options Strikes, GEX Gamma Exposure, Call/Put Walls & Zero Gamma Flip
  const [showIcebergs, setShowIcebergs] = useState<boolean>(false);
  const [showPriorDayLevels, setShowPriorDayLevels] = useState<boolean>(true); // HTF-PD: Prior Day High, Low, POC, VAH, VAL
  const [showStackedImbalances, setShowStackedImbalances] = useState<boolean>(true); // STK-IMB: Extended Stacked Imbalance Zones
  const [liveOptionsChain, setLiveOptionsChain] = useState<LiveOptionsChainResult | null>(null);
  const lastReportedBoundsRef = useRef<{ minPrice: number; maxPrice: number; chartHeight: number; panY: number } | null>(null);

  const handleApplyPreset = (presetName: 'atas_standard' | 'scalper_flow' | 'macro_institutional' | 'clean_price') => {
    if (presetName === 'atas_standard') {
      setShowOfBa(true);
      setShowOfVp(true);
      setShowOfDeltaP(false);
      setShowVolumeProfile(true);
      setShowValueAreaLines(true);
      setShowPriorDayLevels(true);
      setShowVwap(true);
      setShowVolHistogram(true);
      setShowCvdPanel(true);
      setShowCotGrid(false);
      setShowStackedImbalances(true);
      setShowAbsorption(false);
      setShowHeatmap(false);
      setShowOptions(false);
    } else if (presetName === 'scalper_flow') {
      setShowOfBa(true);
      setShowOfVp(false);
      setShowOfDeltaP(true);
      setShowStackedImbalances(true);
      setShowAbsorption(true);
      setShowChartDom(true);
      setShowVolHistogram(true);
      setShowCvdPanel(true);
      setShowCotGrid(false);
    } else if (presetName === 'macro_institutional') {
      setShowPriorDayLevels(true);
      setShowVolumeProfile(true);
      setShowValueAreaLines(true);
      setShowVwap(true);
      setShowNakedPoc(true);
      setShowCotGrid(true);
      setShowVolHistogram(true);
      setShowCvdPanel(true);
      setShowSlClusters(true);
    } else if (presetName === 'clean_price') {
      setShowOfBa(false);
      setShowOfVp(false);
      setShowOfDeltaP(false);
      setShowVolumeProfile(true);
      setShowValueAreaLines(false);
      setShowPriorDayLevels(false);
      setShowVwap(false);
      setShowNakedPoc(false);
      setShowStackedImbalances(false);
      setShowVolHistogram(false);
      setShowCvdPanel(false);
      setShowCotGrid(false);
      setShowSlClusters(false);
      setShowAbsorption(false);
      setShowHeatmap(false);
      setShowOptions(false);
    }
  };

  // Fetch 100% Real Deribit Options Chain when STRIKES overlay is active on BTC / ETH
  useEffect(() => {
    if (!showOptions) return;
    let cancelled = false;
    const loadOptions = async () => {
      const res = await optionsLiveService.getLiveOptionsChain(instrumentId, 'ALL', refPrice);
      if (!cancelled) setLiveOptionsChain(res);
    };
    loadOptions();
    const timer = setInterval(loadOptions, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [showOptions, instrumentId]);

  // Automatically reset viewport offset when switching instrument
  const prevInstrumentRef = useRef<string>(instrumentId);
  useEffect(() => {
    if (prevInstrumentRef.current !== instrumentId) {
      prevInstrumentRef.current = instrumentId;
      setPanX(0);
      setPanY(0);
      setPriceScale(1.0);
    }
  }, [instrumentId]);

  // Split historical closed bars vs single live forming bar so live ticks ONLY compute 1 bar (<0.02ms)
  const sanitizedClosedBars = useMemo(() => {
    return bars
      .filter((b) => b.close_ticks > 0 && b.bar_start_us > 0)
      .map((b) => {
        const open = b.open_ticks;
        const close = b.close_ticks;
        return {
          ...b,
          open_ticks: open,
          high_ticks: Math.max(b.high_ticks, open, close),
          low_ticks: Math.min(b.low_ticks, open, close),
          close_ticks: close,
        };
      });
  }, [bars]);

  const sanitizedActiveBar = useMemo(() => {
    if (!activeBar || activeBar.close_ticks <= 0 || activeBar.bar_start_us <= 0) return null;
    const open = activeBar.open_ticks;
    const close = activeBar.close_ticks;
    return {
      ...activeBar,
      open_ticks: open,
      high_ticks: Math.max(activeBar.high_ticks, open, close),
      low_ticks: Math.min(activeBar.low_ticks, open, close),
      close_ticks: close,
    };
  }, [activeBar]);

  const allBars = useMemo(() => {
    if (!sanitizedActiveBar) return sanitizedClosedBars;
    if (
      sanitizedClosedBars.length > 0 &&
      sanitizedClosedBars[sanitizedClosedBars.length - 1].bar_start_us === sanitizedActiveBar.bar_start_us
    ) {
      return [...sanitizedClosedBars.slice(0, -1), sanitizedActiveBar];
    }
    return [...sanitizedClosedBars, sanitizedActiveBar];
  }, [sanitizedClosedBars, sanitizedActiveBar]);

  const canonicalBasePrice = CANONICAL_INSTRUMENTS[instrumentId]?.basePriceTicks || 0;
  const refPrice = activeBar?.close_ticks || (allBars.length > 0 ? allBars[allBars.length - 1].close_ticks : canonicalBasePrice);

  const analyzedClosedBars: CalculatedOrderFlowBar[] = useMemo(() => {
    return computeBarStatistics(sanitizedClosedBars);
  }, [sanitizedClosedBars]);

  const analyzedActiveBar: CalculatedOrderFlowBar | null = useMemo(() => {
    if (!sanitizedActiveBar) return null;
    const computed = computeBarStatistics([sanitizedActiveBar])[0];
    if (!computed) return null;
    const prevCvd =
      analyzedClosedBars.length > 0
        ? analyzedClosedBars[analyzedClosedBars.length - 1].stats.cvd
        : 0;
    return {
      ...computed,
      stats: {
        ...computed.stats,
        cvd: prevCvd + computed.stats.delta,
      },
    };
  }, [sanitizedActiveBar, analyzedClosedBars]);

  const analyzedBars: CalculatedOrderFlowBar[] = useMemo(() => {
    if (!analyzedActiveBar) return analyzedClosedBars;
    if (
      analyzedClosedBars.length > 0 &&
      analyzedClosedBars[analyzedClosedBars.length - 1].bar_start_us === analyzedActiveBar.bar_start_us
    ) {
      return [...analyzedClosedBars.slice(0, -1), analyzedActiveBar];
    }
    return [...analyzedClosedBars, analyzedActiveBar];
  }, [analyzedClosedBars, analyzedActiveBar]);

  const nakedPocs: NakedPocDTO[] = useMemo(() => {
    if (!showNakedPoc) return [];
    const windowBars = analyzedBars.length > 180 ? analyzedBars.slice(-180) : analyzedBars;
    const offset = analyzedBars.length - windowBars.length;
    return computeNakedPocs(windowBars).map((np) => ({
      ...np,
      barIndex: np.barIndex + offset,
    }));
  }, [analyzedBars, showNakedPoc]);

  const absorptionEvents: AbsorptionEventDTO[] = useMemo(() => {
    if (!showAbsorption) return [];
    const windowBars = analyzedBars.length > 180 ? analyzedBars.slice(-180) : analyzedBars;
    const offset = analyzedBars.length - windowBars.length;
    return detectAbsorptionEvents(windowBars).map((ev) => ({
      ...ev,
      barIndex: ev.barIndex + offset,
    }));
  }, [analyzedBars, showAbsorption]);

  // =========================================================================
  // INSTITUTIONAL PRIOR DAY (HTF) REFERENCE LEVELS: PDH, PDL, PDPOC, PDVAH, PDVAL
  // =========================================================================
  const priorDayLevels = useMemo(() => {
    if (!allBars || allBars.length < 8) return null;

    // Group bars by calendar day (UTC)
    const dayMap = new Map<string, typeof allBars>();
    allBars.forEach((bar) => {
      const d = new Date(bar.bar_start_us / 1000);
      const dayKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      let list = dayMap.get(dayKey);
      if (!list) {
        list = [];
        dayMap.set(dayKey, list);
      }
      list.push(bar);
    });

    const dayKeys = Array.from(dayMap.keys()).sort();
    let targetBars: typeof allBars = [];

    if (dayKeys.length >= 2) {
      // Prior calendar day is the day right before the latest day
      const yesterdayKey = dayKeys[dayKeys.length - 2];
      targetBars = dayMap.get(yesterdayKey) || [];
    }

    if (targetBars.length === 0) {
      // Fallback: take the first half of all loaded bars as the prior reference baseline
      const half = Math.floor(allBars.length / 2);
      targetBars = allBars.slice(0, Math.max(half, 1));
    }

    if (targetBars.length === 0) return null;

    let pdh = -Infinity;
    let pdl = Infinity;
    const binMap = new Map<number, number>();
    let totalVol = 0;

    targetBars.forEach((b) => {
      if (b.high_ticks > pdh) pdh = b.high_ticks;
      if (b.low_ticks < pdl) pdl = b.low_ticks;
      if (b.footprint && b.footprint.length > 0) {
        b.footprint.forEach((c) => {
          totalVol += c.total_units;
          binMap.set(c.price_ticks, (binMap.get(c.price_ticks) || 0) + c.total_units);
        });
      } else {
        totalVol += b.total_units;
        binMap.set(b.poc_ticks || b.close_ticks, (binMap.get(b.poc_ticks || b.close_ticks) || 0) + b.total_units);
      }
    });

    if (!isFinite(pdh) || !isFinite(pdl)) return null;

    let pdPoc = targetBars[0].poc_ticks || Math.round((pdh + pdl) / 2);
    let maxVol = 0;
    binMap.forEach((v, p) => {
      if (v > maxVol) {
        maxVol = v;
        pdPoc = p;
      }
    });

    const sortedBins = Array.from(binMap.entries()).sort((a, b) => b[1] - a[1]);
    let acc = 0;
    let pdVah = pdPoc;
    let pdVal = pdPoc;
    for (const [p, v] of sortedBins) {
      acc += v;
      if (p > pdVah) pdVah = p;
      if (p < pdVal) pdVal = p;
      if (acc >= totalVol * 0.70) break;
    }

    return {
      pdh,
      pdl,
      pdPoc,
      pdVah: Math.max(pdVah, pdPoc),
      pdVal: Math.min(pdVal, pdPoc),
    };
  }, [allBars]);

  const [drawingDraft, setDrawingDraft] = useState<{ start: DrawingPoint; current: DrawingPoint } | null>(null);
  const [brushDraft, setBrushDraft] = useState<DrawingPoint[] | null>(null);
  const [shiftMeasureDraft, setShiftMeasureDraft] = useState<{ start: DrawingPoint; current: DrawingPoint } | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [hoveredDrawingId, setHoveredDrawingId] = useState<string | null>(null);
  const [dragHandle, setDragHandle] = useState<{ drawingId: string; handleKey: string } | null>(null);
  const [dragBody, setDragBody] = useState<{
    drawingId: string;
    startTimeUs: number;
    startPriceTicks: number;
    initialPoints: DrawingPoint[];
  } | null>(null);
  const [dragTicketLine, setDragTicketLine] = useState<{
    ticket: number;
    field: 'entry' | 'sl' | 'tp';
    currentPriceTicks: number;
  } | null>(null);
  const [snappedPoint, setSnappedPoint] = useState<{ x: number; y: number; priceTicks: number; label: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    priceTicks: number;
    timeUs: number;
  } | null>(null);
  const [showOneClickBar, setShowOneClickBar] = useState<boolean>(true);
  const [oneClickLots, setOneClickLots] = useState<number>(1.0);
  const [mt5Tickets, setMt5Tickets] = useState<Mt5OrderTicket[]>(() => mt5BridgeService.getTickets(instrumentId));

  useEffect(() => {
    setMt5Tickets(mt5BridgeService.getTickets(instrumentId));
    const unsub = mt5BridgeService.subscribe(() => {
      setMt5Tickets([...mt5BridgeService.getTickets(instrumentId)]);
    });
    return unsub;
  }, [instrumentId]);

  const instMeta = getInstrumentMeta(instrumentId);

  // Coordinate Conversion Helpers
  const getCoordinateHelpers = () => {
    const canvas = canvasRef.current;
    if (!canvas || allBars.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const timeAxisH = 20;
    const activeSubPanelsCount = (showCotGrid ? 1 : 0) + (showVolHistogram ? 1 : 0) + (showCvdPanel ? 1 : 0);
    const subH = activeSubPanelsCount === 1 ? 72 : activeSubPanelsCount === 2 ? 58 : 50;
    const cotRowH = Math.max(12, Math.floor(subH / 4));
    const cotTableH = showCotGrid ? cotRowH * 4 : 0;
    const volHistH = showVolHistogram ? subH : 0;
    const cvdPanelH = showCvdPanel ? subH : 0;
    const chartHeight = Math.max(150, height - timeAxisH - cotTableH - volHistH - cvdPanelH);

    const axisW = 72;
    const domStripW = showChartDom ? 52 : 0;
    const rightMargin = axisW + domStripW + 24;

    const barWidth = Math.max(84 * zoom, 2.0);
    const barSpacing = Math.max(14 * zoom, 1.0);
    const barPitch = barWidth + barSpacing;

    const maxPanLeft = Math.max(0, (allBars.length - 2) * barPitch);
    const maxPanRight = Math.max(200, width * 0.5);
    const clampedPanX = Math.max(-maxPanRight, Math.min(maxPanLeft, panX));

    const startX = width - rightMargin - barWidth + clampedPanX - (allBars.length - 1) * barPitch;

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let visibleCount = 0;

    allBars.forEach((bar, idx) => {
      const x = startX + idx * barPitch;
      if (x + barWidth >= -40 && x <= width - rightMargin + 30) {
        visibleCount++;
        if (bar.low_ticks < minPrice) minPrice = bar.low_ticks;
        if (bar.high_ticks > maxPrice) maxPrice = bar.high_ticks;
      }
    });

    if (visibleCount === 0 || !isFinite(minPrice)) {
      const recent = allBars.slice(-20);
      recent.forEach((bar) => {
        if (bar.low_ticks < minPrice) minPrice = bar.low_ticks;
        if (bar.high_ticks > maxPrice) maxPrice = bar.high_ticks;
      });
    }

    const minTickPad = Math.max(instMeta.tickSize * 6, 10);
    const paddingTicks = Math.max((maxPrice - minPrice) * 0.14, minTickPad);
    const baseMin = minPrice - paddingTicks;
    const baseMax = maxPrice + paddingTicks;
    const baseRange = Math.max(baseMax - baseMin, minTickPad);
    const midPrice = (baseMin + baseMax) / 2;

    const priceRange = baseRange / priceScale;
    const adjustedMin = midPrice - priceRange / 2;
    const adjustedMax = midPrice + priceRange / 2;

    const barInterval =
      allBars.length > 1
        ? (allBars[1].bar_start_us - allBars[0].bar_start_us) || 60000000
        : 60000000;
    const firstTime = allBars[0].bar_start_us;

    const yToPrice = (y: number) => {
      const normalized = (chartHeight - (y - panY)) / chartHeight;
      return Math.round(adjustedMin + normalized * priceRange);
    };

    const priceToY = (price: number) => {
      const normalized = (price - adjustedMin) / priceRange;
      return chartHeight - normalized * chartHeight + panY;
    };

    const xToTime = (x: number) => {
      const exactIndex = (x - startX - barWidth / 2) / barPitch;
      return Math.round(firstTime + exactIndex * barInterval);
    };

    const timeToX = (timeUs: number) => {
      const exactIndex = (timeUs - firstTime) / barInterval;
      return startX + exactIndex * barPitch + barWidth / 2;
    };

    return {
      rect,
      yToPrice,
      priceToY,
      xToTime,
      timeToX,
      barInterval,
      adjustedMin,
      adjustedMax,
      priceRange,
      chartHeight,
      barPitch,
      startX,
      barWidth,
      barSpacing,
      clampedPanX,
      axisW,
      domStripW,
      rightMargin,
      timeAxisH,
      cotRowH,
      cotTableH,
      volHistH,
      cvdPanelH,
    };
  };

  // TradingView Magnet Mode Helper: Snaps to nearest candle's High, Low, Open, Close, or POC
  const resolveDrawPoint = (
    mouseX: number,
    mouseY: number,
    helpers: NonNullable<ReturnType<typeof getCoordinateHelpers>>,
    forceSnap: boolean
  ): { point: DrawingPoint; snapInfo: { x: number; y: number; priceTicks: number; label: string } | null } => {
    const rawPrice = Math.round(helpers.yToPrice(mouseY) / instMeta.tickSize) * instMeta.tickSize;
    const rawTime = helpers.xToTime(mouseX);

    if (!magnetEnabled && !forceSnap) {
      return { point: { time_us: rawTime, price_ticks: rawPrice }, snapInfo: null };
    }

    const barIdx = Math.round((mouseX - helpers.startX - helpers.barWidth / 2) / helpers.barPitch);
    if (barIdx >= 0 && barIdx < allBars.length) {
      const bar = allBars[barIdx];
      const barCenterX = helpers.startX + barIdx * helpers.barPitch + helpers.barWidth / 2;
      const candidates = [
        { price: bar.high_ticks, lbl: 'H' },
        { price: bar.low_ticks, lbl: 'L' },
        { price: bar.open_ticks, lbl: 'O' },
        { price: bar.close_ticks, lbl: 'C' },
        ...(bar.poc_ticks ? [{ price: bar.poc_ticks, lbl: 'POC' }] : []),
      ];
      let best: { price: number; lbl: string; dist: number; y: number } | null = null;
      for (const c of candidates) {
        const cy = helpers.priceToY(c.price);
        const d = Math.abs(mouseY - cy);
        if (d <= 16 && (!best || d < best.dist)) {
          best = { price: c.price, lbl: c.lbl, dist: d, y: cy };
        }
      }
      if (best) {
        return {
          point: { time_us: bar.bar_start_us, price_ticks: best.price },
          snapInfo: { x: barCenterX, y: best.y, priceTicks: best.price, label: best.lbl },
        };
      }
    }

    return { point: { time_us: rawTime, price_ticks: rawPrice }, snapInfo: null };
  };

  // Distance from point (px, py) to segment (x0, y0) - (x1, y1)
  const distToSegment = (px: number, py: number, x0: number, y0: number, x1: number, y1: number) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x0, py - y0);
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  };

  // Full TradingView Hit-Tester for All 11 Drawing Tools (Handles + Whole-Body Move)
  const hitTestDrawing = (
    d: ChartDrawing,
    mouseX: number,
    mouseY: number,
    helpers: NonNullable<ReturnType<typeof getCoordinateHelpers>>
  ): { hitType: 'handle' | 'body'; handleKey?: string; cursor: string } | null => {
    if (!d.points || d.points.length === 0) return null;
    const chartRightX = helpers.rect.width - helpers.axisW - (showChartDom ? helpers.domStripW : 0);

    if (d.type === 'horizontal_line') {
      const y = helpers.priceToY(d.points[0].price_ticks);
      if (Math.abs(mouseY - y) <= 7 && mouseX <= chartRightX) {
        return { hitType: 'body', cursor: 'ns-resize' };
      }
      return null;
    }

    if (d.type === 'horizontal_ray') {
      const x0 = Math.max(helpers.timeToX(d.points[0].time_us), 0);
      const y = helpers.priceToY(d.points[0].price_ticks);
      if (Math.hypot(mouseX - x0, mouseY - y) <= 10) {
        return { hitType: 'handle', handleKey: 'p0', cursor: 'pointer' };
      }
      if (mouseX >= x0 && mouseX <= chartRightX && Math.abs(mouseY - y) <= 7) {
        return { hitType: 'body', cursor: 'move' };
      }
      return null;
    }

    if (d.type === 'text_note') {
      const x0 = helpers.timeToX(d.points[0].time_us);
      const y0 = helpers.priceToY(d.points[0].price_ticks);
      if (Math.abs(mouseX - x0) <= 55 && Math.abs(mouseY - y0) <= 16) {
        return { hitType: 'body', cursor: 'move' };
      }
      return null;
    }

    if (d.type === 'brush') {
      for (let i = 0; i < d.points.length - 1; i++) {
        const x0 = helpers.timeToX(d.points[i].time_us);
        const y0 = helpers.priceToY(d.points[i].price_ticks);
        const x1 = helpers.timeToX(d.points[i + 1].time_us);
        const y1 = helpers.priceToY(d.points[i + 1].price_ticks);
        if (distToSegment(mouseX, mouseY, x0, y0, x1, y1) <= 8) {
          return { hitType: 'body', cursor: 'move' };
        }
      }
      return null;
    }

    if ((d.type === 'trendline' || d.type === 'arrow') && d.points.length >= 2) {
      const x0 = helpers.timeToX(d.points[0].time_us);
      const y0 = helpers.priceToY(d.points[0].price_ticks);
      const x1 = helpers.timeToX(d.points[1].time_us);
      const y1 = helpers.priceToY(d.points[1].price_ticks);
      if (Math.hypot(mouseX - x0, mouseY - y0) <= 10) {
        return { hitType: 'handle', handleKey: 'p0', cursor: 'pointer' };
      }
      if (Math.hypot(mouseX - x1, mouseY - y1) <= 10) {
        return { hitType: 'handle', handleKey: 'p1', cursor: 'pointer' };
      }
      if (distToSegment(mouseX, mouseY, x0, y0, x1, y1) <= 8) {
        return { hitType: 'body', cursor: 'move' };
      }
      return null;
    }

    if ((d.type === 'imbalance_box' || d.type === 'price_range' || d.type === 'fibonacci') && d.points.length >= 2) {
      const x0 = helpers.timeToX(d.points[0].time_us);
      const y0 = helpers.priceToY(d.points[0].price_ticks);
      const x1 = d.extendRight ? chartRightX : helpers.timeToX(d.points[1].time_us);
      const rawX1 = helpers.timeToX(d.points[1].time_us);
      const y1 = helpers.priceToY(d.points[1].price_ticks);
      const midX = (x0 + rawX1) / 2;
      const midY = (y0 + y1) / 2;

      // 8-Point TradingView Handles: 4 corners + 4 mid-edges
      if (Math.hypot(mouseX - x0, mouseY - y0) <= 10) return { hitType: 'handle', handleKey: 'p0', cursor: 'nwse-resize' };
      if (Math.hypot(mouseX - rawX1, mouseY - y1) <= 10) return { hitType: 'handle', handleKey: 'p1', cursor: 'nwse-resize' };
      if (Math.hypot(mouseX - x0, mouseY - y1) <= 10) return { hitType: 'handle', handleKey: 'x0_y1', cursor: 'nesw-resize' };
      if (Math.hypot(mouseX - rawX1, mouseY - y0) <= 10) return { hitType: 'handle', handleKey: 'x1_y0', cursor: 'nesw-resize' };
      if (Math.hypot(mouseX - midX, mouseY - y0) <= 9) return { hitType: 'handle', handleKey: 'y0', cursor: 'ns-resize' };
      if (Math.hypot(mouseX - midX, mouseY - y1) <= 9) return { hitType: 'handle', handleKey: 'y1', cursor: 'ns-resize' };
      if (Math.hypot(mouseX - x0, mouseY - midY) <= 9) return { hitType: 'handle', handleKey: 'x0', cursor: 'ew-resize' };
      if (Math.hypot(mouseX - rawX1, mouseY - midY) <= 9) return { hitType: 'handle', handleKey: 'x1', cursor: 'ew-resize' };

      const left = Math.min(x0, x1);
      const right = Math.max(x0, x1);
      const top = Math.min(y0, y1);
      const bot = Math.max(y0, y1);
      if (mouseX >= left && mouseX <= right && mouseY >= top && mouseY <= bot) {
        return { hitType: 'body', cursor: 'move' };
      }
      return null;
    }

    if ((d.type === 'long_position' || d.type === 'short_position') && d.points.length >= 3) {
      const x0 = helpers.timeToX(d.points[0].time_us);
      const x1 = Math.max(helpers.timeToX(d.points[1].time_us), x0 + 130);
      const left = Math.min(x0, x1);
      const right = Math.max(x0, x1);
      const midX = (left + right) / 2;
      const yEntry = helpers.priceToY(d.points[0].price_ticks);
      const yTp = helpers.priceToY(d.points[1].price_ticks);
      const ySl = helpers.priceToY(d.points[2].price_ticks);

      // Right width resize handle
      if (Math.hypot(mouseX - right, mouseY - yEntry) <= 11 || Math.hypot(mouseX - right, mouseY - yTp) <= 11) {
        return { hitType: 'handle', handleKey: 'rr_width', cursor: 'ew-resize' };
      }
      // TP bar handle
      if (Math.hypot(mouseX - midX, mouseY - yTp) <= 12 || (mouseX >= left && mouseX <= right && Math.abs(mouseY - yTp) <= 7)) {
        return { hitType: 'handle', handleKey: 'rr_tp', cursor: 'ns-resize' };
      }
      // SL bar handle
      if (Math.hypot(mouseX - midX, mouseY - ySl) <= 12 || (mouseX >= left && mouseX <= right && Math.abs(mouseY - ySl) <= 7)) {
        return { hitType: 'handle', handleKey: 'rr_sl', cursor: 'ns-resize' };
      }
      // Left Entry handle (adjust Entry line independently)
      if (Math.hypot(mouseX - left, mouseY - yEntry) <= 12) {
        return { hitType: 'handle', handleKey: 'rr_entry', cursor: 'ns-resize' };
      }
      // Body inside Profit or Loss zone -> Move entire R:R box together!
      const topY = Math.min(yEntry, yTp, ySl);
      const botY = Math.max(yEntry, yTp, ySl);
      if (mouseX >= left && mouseX <= right && mouseY >= topY && mouseY <= botY) {
        return { hitType: 'body', cursor: 'move' };
      }
    }

    return null;
  };

  const buildPositionDrawing = (
    tool: 'long_position' | 'short_position',
    startPt: DrawingPoint,
    endPt: DrawingPoint,
    barIntervalUs: number
  ): ChartDrawing => {
    const isLong = tool === 'long_position';
    const entryTicks = startPt.price_ticks;
    const defaultTpDist = Math.max(instMeta.tickSize * 20, Math.abs(endPt.price_ticks - entryTicks));
    const tpTicks = isLong ? entryTicks + defaultTpDist : entryTicks - defaultTpDist;
    const slDist = Math.max(instMeta.tickSize * 6, Math.round(defaultTpDist / 2)); // Default 2.0R Risk/Reward
    const slTicks = isLong ? entryTicks - slDist : entryTicks + slDist;
    const endTimeUs =
      Math.abs(endPt.time_us - startPt.time_us) < barIntervalUs * 2
        ? startPt.time_us + barIntervalUs * 5
        : endPt.time_us;

    return {
      id: `draw-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: tool,
      instrument_id: instrumentId,
      points: [
        { time_us: startPt.time_us, price_ticks: entryTicks }, // [0] Entry
        { time_us: endTimeUs, price_ticks: tpTicks },          // [1] Target TP + Right X
        { time_us: endTimeUs, price_ticks: slTicks },          // [2] Stop Loss SL
      ],
      color: isLong ? '#089981' : '#F23645',
      lineWidth: 1.5,
      lotSize: oneClickLots || 1.0,
    };
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const helpers = getCoordinateHelpers();
    if (!helpers) return;

    const axisX = rect.width - helpers.axisW;

    if (mouseX >= axisX && mouseY <= helpers.chartHeight) {
      const delta = -e.deltaY;
      const scaleFactor = Math.exp(delta * 0.0018);
      setPriceScale((prev) => Math.max(0.15, Math.min(10.0, prev * scaleFactor)));
      return;
    }

    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const dx = e.deltaX !== 0 ? -e.deltaX : -e.deltaY;
      setPanX((prev) => prev + dx * 1.2);
      return;
    }

    const delta = -e.deltaY;
    const zoomFactor = Math.exp(delta * 0.0018);
    const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.025), 4.0);

    const currentBarPitch = helpers.barPitch;
    const currentStartX = helpers.startX;
    const barIndexUnderMouse = (mouseX - currentStartX) / currentBarPitch;

    const nextBarWidth = Math.max(84 * newZoom, 2.0);
    const nextBarSpacing = Math.max(14 * newZoom, 1.0);
    const nextBarPitch = nextBarWidth + nextBarSpacing;

    setZoom(newZoom);

    const isNearLiveEdge = mouseX >= rect.width - helpers.rightMargin - helpers.barWidth - 40 || Math.abs(panX) < 25;
    if (isNearLiveEdge) {
      setPanX(0);
    } else {
      const nextStartX = mouseX - barIndexUnderMouse * nextBarPitch;
      const N = allBars.length;
      const targetPanX = nextStartX - (rect.width - helpers.rightMargin - nextBarWidth - (N - 1) * nextBarPitch);
      setPanX(targetPanX);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const helpers = getCoordinateHelpers();
    if (!helpers) return;
    const mouseX = e.clientX - helpers.rect.left;
    const mouseY = e.clientY - helpers.rect.top;
    if (mouseY > helpers.chartHeight) return;
    const priceTicks = Math.round(helpers.yToPrice(mouseY) / instMeta.tickSize) * instMeta.tickSize;
    const timeUs = helpers.xToTime(mouseX);
    setContextMenu({ x: mouseX, y: mouseY, priceTicks, timeUs });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Close context menu on left click
    if (e.button === 0 && contextMenu) {
      setContextMenu(null);
    }
    if (e.button !== 0) return;

    const helpers = getCoordinateHelpers();
    if (!helpers) return;

    const mouseX = e.clientX - helpers.rect.left;
    const mouseY = e.clientY - helpers.rect.top;
    const axisX = helpers.rect.width - helpers.axisW;
    const domX = axisX - (showChartDom ? helpers.domStripW : 0);
    const chartHeight = helpers.chartHeight;

    // 0. If user clicked "Chọn trên Chart" in the Right Trading Panel, pick that exact price!
    if (isPickingPriceOnChart && mouseX < axisX && mouseY <= chartHeight) {
      const picked = Math.round(helpers.yToPrice(mouseY) / instMeta.tickSize) * instMeta.tickSize;
      onPricePickedFromChart?.(picked);
      return;
    }

    // 0B. Check if user clicked on Sub-panel Close Buttons "✕"
    if (mouseX >= domX - 26 && mouseX <= domX) {
      let curY = chartHeight;
      if (showVolHistogram && helpers.volHistH > 0) {
        if (mouseY >= curY && mouseY <= curY + 20) {
          setShowVolHistogram(false);
          return;
        }
        curY += helpers.volHistH;
      }
      if (showCvdPanel && helpers.cvdPanelH > 0) {
        if (mouseY >= curY && mouseY <= curY + 20) {
          setShowCvdPanel(false);
          return;
        }
        curY += helpers.cvdPanelH;
      }
      if (showCotGrid && helpers.cotTableH > 0) {
        if (mouseY >= curY && mouseY <= curY + 20) {
          setShowCotGrid(false);
          return;
        }
        curY += helpers.cotTableH;
      }
    }

    // 1. Check if user clicked the TradingView "+" Quick-Order button on the Price Axis
    if (mouseX >= axisX && mouseX <= axisX + 20 && mouseY <= chartHeight) {
      const priceTicks = Math.round(helpers.yToPrice(mouseY) / instMeta.tickSize) * instMeta.tickSize;
      setContextMenu({
        x: Math.max(20, axisX - 210),
        y: Math.min(mouseY, chartHeight - 190),
        priceTicks,
        timeUs: allBars[allBars.length - 1]?.bar_start_us || Date.now() * 1000,
      });
      return;
    }

    // 2. Check if user clicked inside the In-Chart DOM Trading Strip (ATAS / DeepChart Chart Trader)
    if (showChartDom && mouseX >= domX && mouseX < axisX && mouseY <= chartHeight) {
      const btnH = 15;
      const cancelY = chartHeight - btnH * 2 - 4;
      const flatY = chartHeight - btnH - 2;
      if (mouseY >= cancelY && mouseY <= cancelY + btnH) {
        mt5BridgeService.cancelPending(instrumentId);
        return;
      }
      if (mouseY >= flatY && mouseY <= flatY + btnH) {
        mt5BridgeService.flattenAll(instrumentId, refPrice);
        return;
      }
      if (mouseY > 20 && mouseY < cancelY - 2) {
        const clickedDomPrice = Math.round(helpers.yToPrice(mouseY) / instMeta.tickSize) * instMeta.tickSize;
        const isBidColumn = mouseX < domX + helpers.domStripW / 2;
        const pipStep = instMeta.pipTicks || instMeta.tickSize * 2;
        if (isBidColumn) {
          mt5BridgeService.placeOrder({
            instrumentId,
            side: 'Buy',
            orderType: clickedDomPrice <= refPrice ? 'LIMIT' : 'STOP',
            lots: oneClickLots,
            entryPriceTicks: clickedDomPrice,
            slTicks: clickedDomPrice - 20 * pipStep,
            tpTicks: clickedDomPrice + 40 * pipStep,
            comment: 'DOM-Click-Buy',
          });
        } else {
          mt5BridgeService.placeOrder({
            instrumentId,
            side: 'Sell',
            orderType: clickedDomPrice >= refPrice ? 'LIMIT' : 'STOP',
            lots: oneClickLots,
            entryPriceTicks: clickedDomPrice,
            slTicks: clickedDomPrice + 20 * pipStep,
            tpTicks: clickedDomPrice - 40 * pipStep,
            comment: 'DOM-Click-Sell',
          });
        }
        return;
      }
    }

    if (mouseX >= axisX && mouseY <= chartHeight) {
      setDragMode('priceScale');
      setDragStartPos({ x: e.clientX, y: e.clientY });
      setInitialPriceScale(priceScale);
      setInitialPanY(panY);
      return;
    }

    if (mouseY >= chartHeight && mouseY <= chartHeight + 35) {
      setDragMode('timeScale');
      setDragStartPos({ x: e.clientX, y: e.clientY });
      setInitialZoom(zoom);
      setInitialPanX(helpers.clampedPanX);
      return;
    }

    // 3. Check if user clicked on an interactive MT5 Ticket Line / Action Pill on the Chart (SL, TP, Entry, BE, Close ×)
    if (mt5Tickets && mt5Tickets.length > 0 && mouseX < domX && mouseY <= chartHeight) {
      for (let ti = mt5Tickets.length - 1; ti >= 0; ti--) {
        const tk = mt5Tickets[ti];
        const yEntry = helpers.priceToY(tk.entryPriceTicks);

        // Check SL line drag or [×] on SL
        if (tk.slTicks && tk.slTicks > 0) {
          const ySl = helpers.priceToY(tk.slTicks);
          if (Math.abs(mouseY - ySl) <= 7) {
            setDragTicketLine({ ticket: tk.ticket, field: 'sl', currentPriceTicks: tk.slTicks });
            return;
          }
        }

        // Check TP line drag
        if (tk.tpTicks && tk.tpTicks > 0) {
          const yTp = helpers.priceToY(tk.tpTicks);
          if (Math.abs(mouseY - yTp) <= 7) {
            setDragTicketLine({ ticket: tk.ticket, field: 'tp', currentPriceTicks: tk.tpTicks });
            return;
          }
        }

        // Check Entry pill buttons: [+TP] [+SL] [BE] [×] or Pending Entry drag
        if (Math.abs(mouseY - yEntry) <= 10) {
          // Pill is rendered starting at x = 14 with action buttons at the right end of the pill
          // Check if clicked on [×] Close button, [BE] button, [+SL] or [+TP] pull-out tabs
          const pillTag = (tk as any)._lastPillBounds as
            | { closeX: number; beX: number; slDragX: number; tpDragX: number; rightX: number }
            | undefined;
          if (pillTag) {
            if (mouseX >= pillTag.closeX && mouseX <= pillTag.rightX) {
              mt5BridgeService.closeTicket(tk.ticket, refPrice);
              return;
            }
            if (tk.status === 'OPEN' && mouseX >= pillTag.beX && mouseX < pillTag.closeX) {
              mt5BridgeService.setTicketBreakeven(tk.ticket);
              return;
            }
            if (mouseX >= pillTag.slDragX && mouseX < pillTag.beX) {
              setDragTicketLine({
                ticket: tk.ticket,
                field: 'sl',
                currentPriceTicks: tk.slTicks || tk.entryPriceTicks,
              });
              return;
            }
            if (mouseX >= pillTag.tpDragX && mouseX < pillTag.slDragX) {
              setDragTicketLine({
                ticket: tk.ticket,
                field: 'tp',
                currentPriceTicks: tk.tpTicks || tk.entryPriceTicks,
              });
              return;
            }
          }
          if (tk.status === 'PENDING') {
            setDragTicketLine({ ticket: tk.ticket, field: 'entry', currentPriceTicks: tk.entryPriceTicks });
            return;
          }
        }
      }
    }

    // 4. TradingView Shift + Click & Drag Instant Measure Ruler!
    if (e.shiftKey && (!activeDrawingTool || activeDrawingTool === 'cursor')) {
      const { point } = resolveDrawPoint(mouseX, mouseY, helpers, e.ctrlKey);
      setShiftMeasureDraft({ start: point, current: point });
      return;
    }

    // 5. Check if user clicked on an interactive handle or body of an existing drawing
    if (drawingsVisible && drawings.length > 0 && (!activeDrawingTool || activeDrawingTool === 'cursor' || !drawingDraft)) {
      for (let di = drawings.length - 1; di >= 0; di--) {
        const d = drawings[di];
        const hit = hitTestDrawing(d, mouseX, mouseY, helpers);
        if (hit) {
          setSelectedDrawingId(d.id);
          if (d.isLocked) return;
          if (hit.hitType === 'handle' && hit.handleKey) {
            setDragHandle({ drawingId: d.id, handleKey: hit.handleKey });
          } else {
            const { point } = resolveDrawPoint(mouseX, mouseY, helpers, false);
            setDragBody({
              drawingId: d.id,
              startTimeUs: point.time_us,
              startPriceTicks: point.price_ticks,
              initialPoints: d.points.map((p) => ({ ...p })),
            });
          }
          return;
        }
      }
    }

    if (!activeDrawingTool || activeDrawingTool === 'cursor') {
      setSelectedDrawingId(null);
      setShiftMeasureDraft(null);
      setDragMode('chartPan');
      setDragStartPos({ x: e.clientX, y: e.clientY });
      setInitialPanX(helpers.clampedPanX);
      setInitialPanY(panY);
      return;
    }

    const { point: resolvedPt } = resolveDrawPoint(mouseX, mouseY, helpers, e.ctrlKey);
    const clickedPrice = resolvedPt.price_ticks;
    const clickedTime = resolvedPt.time_us;

    // 1-Click Tools: Horizontal Line, Horizontal Ray, Text/SMC Callout
    if (activeDrawingTool === 'horizontal_line' || activeDrawingTool === 'horizontal_ray') {
      const newDrawing: ChartDrawing = {
        id: `draw-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: activeDrawingTool,
        instrument_id: instrumentId,
        points: [{ time_us: clickedTime, price_ticks: clickedPrice }],
        color: drawingColor || '#00E5FF',
        lineWidth: 1.8,
      };
      onDrawingCreated?.(newDrawing);
      setSelectedDrawingId(newDrawing.id);
      return;
    }

    if (activeDrawingTool === 'text_note') {
      const newDrawing: ChartDrawing = {
        id: `draw-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: 'text_note',
        instrument_id: instrumentId,
        points: [{ time_us: clickedTime, price_ticks: clickedPrice }],
        color: drawingColor || '#00E5FF',
        lineWidth: 1.5,
        text: 'BOS / OB Zone',
      };
      onDrawingCreated?.(newDrawing);
      setSelectedDrawingId(newDrawing.id);
      return;
    }

    // Freehand Brush Tool
    if (activeDrawingTool === 'brush') {
      setBrushDraft([{ time_us: clickedTime, price_ticks: clickedPrice }]);
      return;
    }

    // TradingView 1-Click Instant Placement for Long Position (B$) & Short Position (S$)
    if (activeDrawingTool === 'long_position' || activeDrawingTool === 'short_position') {
      const newDrawing = buildPositionDrawing(
        activeDrawingTool,
        { time_us: clickedTime, price_ticks: clickedPrice },
        { time_us: clickedTime + helpers.barInterval * 8, price_ticks: clickedPrice },
        helpers.barInterval
      );
      onDrawingCreated?.(newDrawing);
      setSelectedDrawingId(newDrawing.id);
      setDrawingDraft(null);
      return;
    }

    // 2-Point Tools: Trendline, Arrow, Order Block (imbalance_box), Fibonacci, Price Range Ruler
    if (['trendline', 'arrow', 'imbalance_box', 'fibonacci', 'price_range'].includes(activeDrawingTool)) {
      if (!drawingDraft) {
        setDragStartPos({ x: e.clientX, y: e.clientY });
        setDrawingDraft({
          start: { time_us: clickedTime, price_ticks: clickedPrice },
          current: { time_us: clickedTime, price_ticks: clickedPrice },
        });
      } else {
        const newDrawing: ChartDrawing = {
          id: `draw-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          type: activeDrawingTool,
          instrument_id: instrumentId,
          points: [
            drawingDraft.start,
            { time_us: clickedTime, price_ticks: clickedPrice },
          ],
          color: drawingColor || '#00E5FF',
          lineWidth: 1.8,
          fillColor: activeDrawingTool === 'imbalance_box' ? `${drawingColor || '#00E5FF'}28` : undefined,
        };
        onDrawingCreated?.(newDrawing);
        setSelectedDrawingId(newDrawing.id);
        setDrawingDraft(null);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const helpers = getCoordinateHelpers();
    if (!helpers) return;

    const mouseX = e.clientX - helpers.rect.left;
    const mouseY = e.clientY - helpers.rect.top;
    const axisX = helpers.rect.width - helpers.axisW;
    const chartHeight = helpers.chartHeight;

    setHoverPos({ x: mouseX, y: mouseY });
    if (onCrosshairSync && mouseX < axisX && mouseY <= chartHeight) {
      onCrosshairSync({
        priceTicks: Math.round(helpers.yToPrice(mouseY)),
        timestampUs: Math.round(helpers.xToTime(mouseX)),
        sourcePaneId: paneId,
      });
    }

    const { point: resolvedPt, snapInfo } = resolveDrawPoint(mouseX, mouseY, helpers, e.ctrlKey);
    setSnappedPoint((prev) => {
      if (!prev && !snapInfo) return null;
      if (prev && snapInfo && prev.priceTicks === snapInfo.priceTicks && prev.x === snapInfo.x) return prev;
      return snapInfo;
    });

    // 1. Live Dragging of MT5 Position / Pending Order Line (Entry / SL / TP)
    if (dragTicketLine) {
      setCursorStyle('ns-resize');
      const newTicks = Math.max(instMeta.tickSize, resolvedPt.price_ticks);
      setDragTicketLine((prev) => (prev ? { ...prev, currentPriceTicks: newTicks } : null));
      return;
    }

    // 2. Live Dragging of Shift + Click Instant Measure Ruler
    if (shiftMeasureDraft) {
      setCursorStyle('crosshair');
      setShiftMeasureDraft((prev) => (prev ? { ...prev, current: resolvedPt } : null));
      return;
    }

    // 3. Freehand Brush Drawing
    if (brushDraft) {
      setCursorStyle('crosshair');
      setBrushDraft((prev) => (prev ? [...prev, resolvedPt] : null));
      return;
    }

    // 4. Whole-Body Dragging of Any Drawing (Moves entire shape smoothly like TradingView!)
    if (dragBody) {
      setCursorStyle('move');
      const targetDrawing = drawings.find((d) => d.id === dragBody.drawingId);
      if (targetDrawing && !targetDrawing.isLocked) {
        const dt = resolvedPt.time_us - dragBody.startTimeUs;
        const dp = resolvedPt.price_ticks - dragBody.startPriceTicks;
        const updatedPoints = dragBody.initialPoints.map((pt) => ({
          time_us: pt.time_us + dt,
          price_ticks: Math.max(instMeta.tickSize, pt.price_ticks + dp),
        }));
        onDrawingUpdated?.({ ...targetDrawing, points: updatedPoints });
      }
      return;
    }

    // 5. Handle Dragging for All Drawing Types (8-point Rectangle, Long/Short R:R, Trendline, Fib, Ray)
    if (dragHandle) {
      const targetDrawing = drawings.find((d) => d.id === dragHandle.drawingId);
      if (targetDrawing && !targetDrawing.isLocked) {
        const newPrice = Math.max(instMeta.tickSize, resolvedPt.price_ticks);
        const newTime = resolvedPt.time_us;
        const hk = dragHandle.handleKey;
        const pts = targetDrawing.points.map((p) => ({ ...p }));

        if (targetDrawing.type === 'long_position' || targetDrawing.type === 'short_position') {
          if (hk === 'rr_tp') {
            pts[1].price_ticks = newPrice;
          } else if (hk === 'rr_sl') {
            pts[2].price_ticks = newPrice;
          } else if (hk === 'rr_entry') {
            pts[0].price_ticks = newPrice;
          } else if (hk === 'rr_width') {
            const clampedEnd = Math.max(newTime, pts[0].time_us + helpers.barInterval * 2);
            pts[1].time_us = clampedEnd;
            pts[2].time_us = clampedEnd;
          }
        } else if (pts.length >= 2) {
          if (hk === 'p0') {
            pts[0] = { time_us: newTime, price_ticks: newPrice };
          } else if (hk === 'p1') {
            pts[1] = { time_us: newTime, price_ticks: newPrice };
          } else if (hk === 'x0_y1') {
            pts[0].time_us = newTime;
            pts[1].price_ticks = newPrice;
          } else if (hk === 'x1_y0') {
            pts[1].time_us = newTime;
            pts[0].price_ticks = newPrice;
          } else if (hk === 'y0') {
            pts[0].price_ticks = newPrice;
          } else if (hk === 'y1') {
            pts[1].price_ticks = newPrice;
          } else if (hk === 'x0') {
            pts[0].time_us = newTime;
          } else if (hk === 'x1') {
            pts[1].time_us = newTime;
          }
        } else if (pts.length === 1) {
          pts[0] = { time_us: newTime, price_ticks: newPrice };
        }

        onDrawingUpdated?.({ ...targetDrawing, points: pts });
      }
      return;
    }

    if (dragMode === 'none') {
      if (mouseX >= axisX && mouseY <= chartHeight) {
        setIsPriceScaleHovered((prev) => (prev ? prev : true));
        const nextCur = mouseX <= axisX + 20 ? 'pointer' : 'ns-resize';
        setCursorStyle((prev) => (prev === nextCur ? prev : nextCur));
      } else {
        setIsPriceScaleHovered((prev) => (prev ? false : prev));
        if (mouseY >= chartHeight && mouseY <= chartHeight + 35) {
          setCursorStyle((prev) => (prev === 'ew-resize' ? prev : 'ew-resize'));
        } else if (isPickingPriceOnChart) {
          setCursorStyle((prev) => (prev === 'crosshair' ? prev : 'crosshair'));
        } else {
          // Hover detection over MT5 Ticket Lines or Drawings
          let customCursor = 'crosshair';
          let foundHoverDrawing: string | null = null;

          if (mt5Tickets && mt5Tickets.length > 0 && mouseX < axisX) {
            for (const tk of mt5Tickets) {
              const yE = helpers.priceToY(tk.entryPriceTicks);
              const yS = tk.slTicks ? helpers.priceToY(tk.slTicks) : -999;
              const yT = tk.tpTicks ? helpers.priceToY(tk.tpTicks) : -999;
              if (Math.abs(mouseY - yS) <= 6 || Math.abs(mouseY - yT) <= 6 || (tk.status === 'PENDING' && Math.abs(mouseY - yE) <= 6)) {
                customCursor = 'ns-resize';
                break;
              }
            }
          }

          if (customCursor === 'crosshair' && drawingsVisible && (!activeDrawingTool || activeDrawingTool === 'cursor')) {
            for (let di = drawings.length - 1; di >= 0; di--) {
              const hit = hitTestDrawing(drawings[di], mouseX, mouseY, helpers);
              if (hit) {
                foundHoverDrawing = drawings[di].id;
                customCursor = drawings[di].isLocked ? 'default' : hit.cursor;
                break;
              }
            }
          }

          setHoveredDrawingId((prev) => (prev === foundHoverDrawing ? prev : foundHoverDrawing));
          setCursorStyle((prev) => (prev === customCursor ? prev : customCursor));
        }
      }
    }

    if (dragMode === 'priceScale') {
      setCursorStyle('ns-resize');
      const dy = dragStartPos.y - e.clientY;
      const newScale = Math.max(0.15, Math.min(10.0, initialPriceScale * Math.exp(dy * 0.007)));
      setPriceScale(newScale);
      return;
    }

    if (dragMode === 'timeScale') {
      setCursorStyle('ew-resize');
      const dx = e.clientX - dragStartPos.x;
      const newZoom = Math.max(0.15, Math.min(4.0, initialZoom * Math.exp(dx * 0.006)));
      setZoom(newZoom);
      const zoomRatio = newZoom / initialZoom;
      const rightAnchorX = helpers.rect.width - helpers.rightMargin;
      setPanX(rightAnchorX - (rightAnchorX - initialPanX) * zoomRatio);
      return;
    }

    if (dragMode === 'chartPan') {
      setCursorStyle('grabbing');
      setPanX(initialPanX + (e.clientX - dragStartPos.x));
      setPanY(initialPanY + (e.clientY - dragStartPos.y));
      return;
    }

    if (drawingDraft) {
      setDrawingDraft((prev) =>
        prev
          ? {
              ...prev,
              current: resolvedPt,
            }
          : null
      );
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // 1. Commit MT5 Ticket Line Drag (Modify Entry / SL / TP on MT5!)
    if (dragTicketLine) {
      const { ticket, field, currentPriceTicks } = dragTicketLine;
      if (field === 'sl') {
        mt5BridgeService.modifyTicket(ticket, { slTicks: currentPriceTicks, slPriceTicks: currentPriceTicks });
      } else if (field === 'tp') {
        mt5BridgeService.modifyTicket(ticket, { tpTicks: currentPriceTicks, tpPriceTicks: currentPriceTicks });
      } else if (field === 'entry') {
        mt5BridgeService.modifyTicket(ticket, { entryPriceTicks: currentPriceTicks });
      }
      setDragTicketLine(null);
      return;
    }

    // 2. Commit Freehand Brush Stroke
    if (brushDraft && brushDraft.length >= 2) {
      const newDrawing: ChartDrawing = {
        id: `draw-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: 'brush',
        instrument_id: instrumentId,
        points: brushDraft,
        color: drawingColor || '#00E5FF',
        lineWidth: 2.2,
      };
      onDrawingCreated?.(newDrawing);
      setSelectedDrawingId(newDrawing.id);
      setBrushDraft(null);
      return;
    }
    setBrushDraft(null);

    // 3. If user click-and-dragged (> 12px) while drawing a 2-point tool, finish immediately on release!
    if (
      drawingDraft &&
      activeDrawingTool &&
      ['trendline', 'arrow', 'imbalance_box', 'fibonacci', 'price_range'].includes(activeDrawingTool)
    ) {
      const dist = Math.hypot(e.clientX - dragStartPos.x, e.clientY - dragStartPos.y);
      if (dist > 12) {
        const newDrawing: ChartDrawing = {
          id: `draw-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          type: activeDrawingTool,
          instrument_id: instrumentId,
          points: [drawingDraft.start, drawingDraft.current],
          color: drawingColor || '#00E5FF',
          lineWidth: 1.8,
          fillColor: activeDrawingTool === 'imbalance_box' ? `${drawingColor || '#00E5FF'}28` : undefined,
        };
        onDrawingCreated?.(newDrawing);
        setSelectedDrawingId(newDrawing.id);
        setDrawingDraft(null);
      }
    }
    setDragMode('none');
    setDragHandle(null);
    setDragBody(null);
  };

  const handleMouseLeave = () => {
    setDragMode('none');
    setHoverPos(null);
    if (onCrosshairSync) {
      onCrosshairSync({ priceTicks: null, timestampUs: null, sourcePaneId: paneId });
    }
  };

  const handleFitContent = () => {
    const canvas = canvasRef.current;
    if (!canvas || allBars.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const availableWidth = width - 150;
    const targetBars = Math.min(Math.max(allBars.length, 10), 14);
    const idealPitch = availableWidth / targetBars;
    const idealZoom = Math.max(0.55, Math.min(1.25, idealPitch / 98));
    setZoom(idealZoom);
    setPriceScale(1.0);
    setPanX(0);
    setPanY(0);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const helpers = getCoordinateHelpers();
    if (!helpers) return;

    const mouseX = e.clientX - helpers.rect.left;
    const axisX = helpers.rect.width - helpers.axisW;

    if (mouseX >= axisX) {
      setPriceScale(1.0);
      setPanY(0);
      return;
    }

    handleFitContent();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') {
        if (drawingDraft) setDrawingDraft(null);
        if (selectedDrawingId) setSelectedDrawingId(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
        onDrawingDeleted?.(selectedDrawingId);
        setSelectedDrawingId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawingDraft, selectedDrawingId, onDrawingDeleted]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // ─── DeepChart / ATAS Obsidian Theme Palette ───
    const isDeepChart = colorTheme === 'deepchart';
    const bgCanvas = isDeepChart ? '#0D0F14' : '#11151E';
    const gridColor = isDeepChart ? '#161A22' : '#1C222E';
    const bullPrimary = isDeepChart ? '#00E676' : '#089981';
    const bullBorder = isDeepChart ? '#69F0AE' : '#00E676';
    const bearPrimary = isDeepChart ? '#A855F7' : '#F23645';
    const bearBorder = isDeepChart ? '#C084FC' : '#FF5252';
    const buyImbTextCol = isDeepChart ? '#4ADE80' : '#00E5FF';
    const sellImbTextCol = isDeepChart ? '#F472B6' : '#FF5252';

    ctx.fillStyle = bgCanvas;
    ctx.fillRect(0, 0, width, height);

    if (allBars.length === 0) {
      ctx.fillStyle = '#8E9AA8';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Awaiting real-time Order Flow trade stream...', width / 2, height / 2);
      return;
    }

    const helpers = getCoordinateHelpers();
    if (!helpers) return;

    const {
      yToPrice,
      priceToY,
      adjustedMin,
      adjustedMax,
      priceRange,
      chartHeight,
      barPitch,
      startX,
      barWidth,
      barSpacing,
      axisW,
      domStripW,
      timeAxisH,
      cotRowH,
      cotTableH,
      volHistH,
      cvdPanelH,
    } = helpers;

    const axisX = width - axisW;
    const chartRightX = axisX - domStripW;

    if (onPriceBoundsChange) {
      const prevB = lastReportedBoundsRef.current;
      if (
        !prevB ||
        Math.abs(prevB.minPrice - adjustedMin) > 1 ||
        Math.abs(prevB.maxPrice - adjustedMax) > 1 ||
        prevB.chartHeight !== chartHeight ||
        prevB.panY !== panY
      ) {
        const nextB = { minPrice: adjustedMin, maxPrice: adjustedMax, chartHeight, panY };
        lastReportedBoundsRef.current = nextB;
        onPriceBoundsChange(nextB);
      }
    }

    const barInterval =
      allBars.length > 1
        ? (allBars[1].bar_start_us - allBars[0].bar_start_us) || 60000000
        : 60000000;
    const firstTime = allBars[0].bar_start_us;

    const timeToX = (time_us: number) => {
      const exactIndex = (time_us - firstTime) / barInterval;
      return startX + exactIndex * barPitch + barWidth / 2;
    };

    // Identify visible bars in current viewport for accurate local scaling
    const visibleBars: CalculatedOrderFlowBar[] = [];
    analyzedBars.forEach((b, idx) => {
      const bx = startX + idx * barPitch;
      if (bx + barWidth >= -20 && bx <= chartRightX + 20) {
        visibleBars.push(b);
      }
    });
    const activeViewportBars = visibleBars.length > 0 ? visibleBars : analyzedBars.slice(-20);

    // =========================================================================
    // MAIN CHART CLIPPED REGION
    // =========================================================================
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, chartRightX, chartHeight);
    ctx.clip();

    // 0. Resting L2 Liquidity Heatmap Layer (Subtle when Footprint numbers are active)
    const activeHeatmapSlices = (heatmapSlices && heatmapSlices.length > 0)
      ? heatmapSlices
      : (orderBook && (orderBook.bids?.length > 0 || orderBook.asks?.length > 0))
        ? [{
            timestamp_us: Date.now() * 1000,
            bids: orderBook.bids.map((b) => [b.price_ticks, b.quantity_units] as [number, number]),
            asks: orderBook.asks.map((a) => [a.price_ticks, a.quantity_units] as [number, number]),
          }]
        : [];

    if (showHeatmap && activeHeatmapSlices.length > 0) {
      const latestSlice = activeHeatmapSlices[activeHeatmapSlices.length - 1];
      let maxResting = 500;
      latestSlice.asks.forEach(([, q]) => { if (q > maxResting) maxResting = q; });
      latestSlice.bids.forEach(([, q]) => { if (q > maxResting) maxResting = q; });
      const maxAlpha = showOfBa ? 0.24 : 0.55;

      latestSlice.asks.forEach(([price, qty]) => {
        const y = priceToY(price);
        if (y < 0 || y > chartHeight) return;
        const intensity = Math.min(qty / maxResting, 1.0);
        const alpha = Math.min(intensity * maxAlpha + 0.05, maxAlpha);
        ctx.fillStyle = `rgba(255, 109, 0, ${alpha})`;
        ctx.fillRect(0, y - 2, chartRightX, 4);
      });

      latestSlice.bids.forEach(([price, qty]) => {
        const y = priceToY(price);
        if (y < 0 || y > chartHeight) return;
        const intensity = Math.min(qty / maxResting, 1.0);
        const alpha = Math.min(intensity * maxAlpha + 0.05, maxAlpha);
        ctx.fillStyle = `rgba(0, 229, 255, ${alpha})`;
        ctx.fillRect(0, y - 2, chartRightX, 4);
      });
    }

    // Subtle Grid Lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const y = (chartHeight / 8) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartRightX, y);
      ctx.stroke();
    }

    // =========================================================================
    // 1. RIGHT-ANCHORED SESSION VOLUME PROFILE (D-VP) & VALUE AREA LINES (D-VL)
    // Dynamically computed across visible session range so it ALWAYS aligns with
    // live market prices (Royal Blue #1E88E5 Profile + Bright Green #00E676 POC)
    // =========================================================================
    if (showVolumeProfile) {
      // Institutional True Daily Session Profile (Current 24h Trading Day)
      const latestBar = allBars.length > 0 ? allBars[allBars.length - 1] : null;
      let sessionBars = allBars;
      if (latestBar) {
        const latestDay = new Date(latestBar.bar_start_us / 1000).toISOString().slice(0, 10);
        const dayBars = allBars.filter(
          (b) => new Date(b.bar_start_us / 1000).toISOString().slice(0, 10) === latestDay
        );
        if (dayBars.length >= 8) {
          sessionBars = dayBars;
        } else {
          sessionBars = allBars.slice(-200);
        }
      }
      const profileSourceBars = sessionBars.length > 0 ? sessionBars : activeViewportBars;

      // Build 38-bin Visible Session Volume Profile directly from profileSourceBars
      const numBins = 38;
      const binStep = Math.max(10, Math.round(priceRange / numBins));
      const binMap = new Map<number, { price_ticks: number; buy_units: number; sell_units: number; total_units: number }>();

      profileSourceBars.forEach((b) => {
        if (b.footprint && b.footprint.length > 0) {
          b.footprint.forEach((c) => {
            const bucketP = Math.round(c.price_ticks / binStep) * binStep;
            const cur = binMap.get(bucketP);
            if (cur) {
              cur.buy_units += c.buy_units;
              cur.sell_units += c.sell_units;
              cur.total_units += c.total_units;
            } else {
              binMap.set(bucketP, {
                price_ticks: bucketP,
                buy_units: c.buy_units,
                sell_units: c.sell_units,
                total_units: c.total_units,
              });
            }
          });
        }
      });

      const computedBins = Array.from(binMap.values()).sort((a, b) => a.price_ticks - b.price_ticks);
      if (computedBins.length > 0) {
        const vpMaxWidth = Math.min(88, chartRightX * 0.14);
        let maxBinVol = 1;
        let sessionPocPrice = computedBins[0].price_ticks;
        let totalSessionVol = 0;

        computedBins.forEach((b) => {
          totalSessionVol += b.total_units;
          if (b.total_units > maxBinVol) {
            maxBinVol = b.total_units;
            sessionPocPrice = b.price_ticks;
          }
        });

        // Compute 70% Value Area (dVAH / dVAL) around sessionPocPrice
        const sortedByVol = [...computedBins].sort((a, b) => b.total_units - a.total_units);
        let accVol = 0;
        let vahPrice = sessionPocPrice;
        let valPrice = sessionPocPrice;
        for (const b of sortedByVol) {
          accVol += b.total_units;
          if (b.price_ticks > vahPrice) vahPrice = b.price_ticks;
          if (b.price_ticks < valPrice) valPrice = b.price_ticks;
          if (accVol >= totalSessionVol * 0.7) break;
        }

        const binPxH = Math.max(6, Math.min(14, Math.abs(priceToY(sessionPocPrice) - priceToY(sessionPocPrice + binStep)) - 1));

        computedBins.forEach((b) => {
          const binY = priceToY(b.price_ticks) - binPxH / 2;
          if (binY < -binPxH || binY > chartHeight + binPxH) return;

          const isSessionPoc = b.price_ticks === sessionPocPrice;
          const totalBinW = Math.max(3, (b.total_units / maxBinVol) * vpMaxWidth);

          if (showDeltaProfileSession) {
            const isNetBuy = b.buy_units >= b.sell_units;
            ctx.fillStyle = isNetBuy ? 'rgba(0, 230, 118, 0.58)' : 'rgba(168, 85, 247, 0.58)';
          } else if (isSessionPoc) {
            ctx.fillStyle = '#00E676'; // DeepChart Bright Green Session POC Bar (media_1794650904572_a0f8fcfc.jpg)
          } else {
            ctx.fillStyle = 'rgba(30, 136, 229, 0.72)'; // DeepChart Royal Blue Profile Bars
          }
          ctx.fillRect(chartRightX - totalBinW, binY, totalBinW, Math.max(binPxH - 1, 2));
        });

        if (showValueAreaLines) {
          const drawSessionLevel = (priceTicks: number, label: string, col: string, dash: number[]) => {
            if (!priceTicks || priceTicks <= 0) return;
            const y = priceToY(priceTicks);
            if (y < 0 || y > chartHeight) return;
            ctx.save();
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.2;
            if (dash.length > 0) ctx.setLineDash(dash);
            ctx.beginPath();
            ctx.moveTo(chartRightX - 180, y);
            ctx.lineTo(chartRightX, y);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = col;
            ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText(label, chartRightX - 4, y - 3);
            ctx.restore();
          };

          drawSessionLevel(sessionPocPrice, 'dPOC', '#FFD600', [3, 3]);
          if (vahPrice > 0) drawSessionLevel(vahPrice, 'dVAH', '#00E676', [4, 3]);
          if (valPrice > 0) drawSessionLevel(valPrice, 'dVAL', '#38BDF8', [4, 3]);
        }
      }
    }

    // =========================================================================
    // INSTITUTIONAL PRIOR DAY (HTF) REFERENCE LEVELS: PDH, PDL, PDPOC, PDVAH, PDVAL
    // ATAS & DeepChart Macro Framework
    // =========================================================================
    if (showPriorDayLevels && priorDayLevels) {
      const drawHtfLevel = (priceTicks: number, label: string, col: string, dash: number[]) => {
        if (!priceTicks || priceTicks <= 0) return;
        const y = priceToY(priceTicks);
        if (y < 0 || y > chartHeight) return;
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.3;
        if (dash.length > 0) ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartRightX, y);
        ctx.stroke();
        ctx.setLineDash([]);

        const text = `${label}: ${(priceTicks * instMeta.tickSize).toFixed(instMeta.priceDecimals)}`;
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        const tw = ctx.measureText(text).width + 8;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.fillRect(chartRightX - tw - 6, y - 8, tw, 15);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.strokeRect(chartRightX - tw - 6, y - 8, tw, 15);

        ctx.fillStyle = col;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, chartRightX - 10, y);
        ctx.restore();
      };

      drawHtfLevel(priorDayLevels.pdh, 'PDH', '#F87171', [5, 4]);
      drawHtfLevel(priorDayLevels.pdVah, 'PD-VAH', '#FB923C', [4, 4]);
      drawHtfLevel(priorDayLevels.pdPoc, 'PD-POC', '#FACC15', []);
      drawHtfLevel(priorDayLevels.pdVal, 'PD-VAL', '#38BDF8', [4, 4]);
      drawHtfLevel(priorDayLevels.pdl, 'PDL', '#34D399', [5, 4]);
    }

    // =========================================================================
    // 2. DEVELOPING VWAP / VALUE AREA CURVES ACROSS BARS
    // Matches smooth purple/green developing curves in media_1794650950575_011ab3f4.jpg
    // =========================================================================
    if (showVwap && analyzedBars.length > 1) {
      ctx.save();
      ctx.strokeStyle = isDeepChart ? 'rgba(168, 85, 247, 0.70)' : 'rgba(16, 185, 129, 0.70)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let started = false;
      let cumPV = 0;
      let cumV = 0;
      analyzedBars.forEach((b, idx) => {
        const typPrice = (b.high_ticks + b.low_ticks + b.close_ticks) / 3;
        cumPV += typPrice * Math.max(b.total_units, 1);
        cumV += Math.max(b.total_units, 1);
        const devVwap = cumPV / cumV;
        const x = startX + idx * barPitch + barWidth / 2;
        const y = priceToY(devVwap);
        if (x >= -50 && x <= chartRightX + 50) {
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
      });
      ctx.stroke();
      ctx.restore();
    }

    // =========================================================================
    // 3. RENDER BARS: LEFT CANDLESTICK SPINE + 2-TONE OF-VP + SHADOW-BACKED OF-B/A
    // Matches media_1794650950575_011ab3f4.jpg & media_1794650904572_a0f8fcfc.jpg 100%
    // =========================================================================
    analyzedBars.forEach((bar, idx) => {
      const x = startX + idx * barPitch;
      if (x + barWidth < -20 || x > chartRightX + 10) return; // Viewport Culling

      const isBullish = bar.close_ticks >= bar.open_ticks;
      const openY = priceToY(bar.open_ticks);
      const closeY = priceToY(bar.close_ticks);
      const highY = priceToY(bar.high_ticks);
      const lowY = priceToY(bar.low_ticks);

      const bodyTop = Math.min(openY, closeY);
      const bodyBottom = Math.max(openY, closeY);
      const minBodyH = barWidth < 6 ? 1.0 : 2.5;
      const bodyHeight = Math.max(bodyBottom - bodyTop, minBodyH);

      const barPrimaryCol = isBullish ? bullPrimary : bearPrimary;
      const barBorderCol = isBullish ? bullBorder : bearBorder;
      const hasFootprint = bar.footprint && bar.footprint.length > 0 && bar.completeness !== 'OHLCV_Only';
      const isFootprintDetailed = hasFootprint && barWidth >= 36 && (showOfVp || showOfBa || showOfDeltaP);

      let topMostCellY = highY;

      if (!isFootprintDetailed) {
        // ─── Standard Japanese Candlestick (When Zoomed Out or OF Modes Off) ───
        const centerX = x + barWidth / 2;
        ctx.strokeStyle = barPrimaryCol;
        ctx.lineWidth = barWidth < 6 ? 1.0 : 1.4;
        ctx.beginPath();
        ctx.moveTo(centerX, highY);
        ctx.lineTo(centerX, lowY);
        ctx.stroke();

        const cW = Math.max(barWidth > 6 ? barWidth - 2 : Math.max(barWidth, 1.2), 1.0);
        const candleX = centerX - cW / 2;
        ctx.fillStyle = barPrimaryCol;
        ctx.fillRect(candleX, bodyTop, cW, bodyHeight);
        if (barWidth >= 6) {
          ctx.strokeStyle = barBorderCol;
          ctx.lineWidth = 1;
          ctx.strokeRect(candleX, bodyTop, cW, bodyHeight);
        }
      } else {
        // ─── DeepChart Signature Left-Spine Candle + Right Footprint Profile & Numbers ───
        const spineW = 5;
        const spineX = x + 2;
        const spineCenterX = spineX + spineW / 2;

        // 1) Thin Vertical Wick Line from High to Low (Crisp Silver/Grey)
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(spineCenterX, highY);
        ctx.lineTo(spineCenterX, lowY);
        ctx.stroke();

        // 2) Solid Vertical Candlestick Body on Left Spine (Bright Neon Green or Purple/Red)
        ctx.fillStyle = barPrimaryCol;
        ctx.fillRect(spineX, bodyTop, spineW, bodyHeight);

        const fpStartX = spineX + spineW + 2;
        const fpWidth = Math.max(barWidth - (spineW + 6), 24);

        // Adaptive Tick Aggregation
        let minPriceDiff = Infinity;
        for (let fi = 1; fi < bar.footprint.length; fi++) {
          const diff = Math.abs(bar.footprint[fi].price_ticks - bar.footprint[fi - 1].price_ticks);
          if (diff > 0 && diff < minPriceDiff) minPriceDiff = diff;
        }
        if (!isFinite(minPriceDiff) || minPriceDiff === 0) minPriceDiff = 50;

        let activeMultiplier = 1;
        if (tickAggregation === 'auto') {
          const pxPerTick = chartHeight / Math.max(priceRange, 1);
          const pxPerStep = pxPerTick * minPriceDiff;
          const targetH = 15.5;
          const rawMult = Math.ceil(targetH / Math.max(pxPerStep, 0.001));
          const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
          activeMultiplier = steps.find((s) => s >= rawMult) || rawMult;
        } else {
          activeMultiplier = typeof tickAggregation === 'number' ? tickAggregation : 1;
        }

        const aggregatedCells = aggregateFootprintCells(bar.footprint, minPriceDiff, activeMultiplier);

        let maxCellVol = 1;
        let maxAbsDelta = 1;
        let aggregatedPocPrice = bar.poc_ticks;
        let bestAggVol = -1;

        aggregatedCells.forEach((c) => {
          if (c.total_units > maxCellVol) maxCellVol = c.total_units;
          if (c.total_units > bestAggVol) {
            bestAggVol = c.total_units;
            aggregatedPocPrice = c.price_ticks;
          }
          const absD = Math.abs(c.delta_units);
          if (absD > maxAbsDelta) maxAbsDelta = absD;
        });

        const effectiveTickStep = minPriceDiff * activeMultiplier;
        const tickStepY = Math.abs(priceToY(bar.open_ticks) - priceToY(bar.open_ticks + effectiveTickStep));
        const cellH = Math.max(Math.min(Math.round(tickStepY), 22), 13);
        const showNumbers = barWidth >= 42 && cellH >= 11;
        const fontSize = Math.min(Math.max(Math.floor(cellH * 0.64), 9), 10.5);

        // Compact 2-Column Number Alignment (Matches media_1794650950575_011ab3f4.jpg & media_1794650904572_a0f8fcfc.jpg)
        const bidRightX = fpStartX + Math.min(34, Math.max(24, Math.round(fpWidth * 0.38)));
        const askLeftX = bidRightX + 7;

        const formatVolText = (v: number) => {
          if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
          if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'K';
          return v.toString();
        };

        aggregatedCells.forEach((cell) => {
          const cellCenterY = priceToY(cell.price_ticks);
          const cellY = Math.round(cellCenterY - cellH / 2);
          if (cellY < topMostCellY) topMostCellY = cellY;
          if (cellY + cellH < 0 || cellY > chartHeight) return;

          const isPoc = aggregatedPocPrice !== null && cell.price_ticks === aggregatedPocPrice;
          const isBuyImb = bar.buyImbalancePrices.has(cell.price_ticks);
          const isSellImb = bar.sellImbalancePrices.has(cell.price_ticks);
          const volRatio = Math.min(cell.total_units / maxCellVol, 1.0);
          const totalBarW = Math.max(8, volRatio * (fpWidth - 3));

          // ─── LAYER A: OF-ΔP (Bi-Directional Delta Profile) ───
          if (showOfDeltaP) {
            const centerX = fpStartX + fpWidth / 2;
            const delta = cell.delta_units;
            const deltaW = Math.max(3, (Math.abs(delta) / maxAbsDelta) * (fpWidth / 2 - 2));
            if (delta > 0) {
              ctx.fillStyle = 'rgba(0, 230, 118, 0.52)';
              ctx.fillRect(centerX, cellY + 1, deltaW, cellH - 2);
            } else if (delta < 0) {
              ctx.fillStyle = isDeepChart ? 'rgba(168, 85, 247, 0.52)' : 'rgba(242, 54, 69, 0.52)';
              ctx.fillRect(centerX - deltaW, cellY + 1, deltaW, cellH - 2);
            }
          }

          // ─── LAYER B: OF-VP (Two-Tone Sell/Buy Horizontal Volume Profile Histogram per Bar) ───
          // Matches media_1794650950575_011ab3f4.jpg & media_1794650904572_a0f8fcfc.jpg 100%!
          if (showOfVp && !showOfDeltaP) {
            if (!showOfBa && isPoc) {
              ctx.fillStyle = '#FFD600';
              ctx.fillRect(fpStartX, cellY + 1, totalBarW, cellH - 2);
            } else {
              const sellFrac = cell.total_units > 0 ? cell.sell_units / cell.total_units : 0.5;
              const sellSegW = Math.round(totalBarW * sellFrac);
              const buySegW = Math.max(0, totalBarW - sellSegW);

              // Left Segment: Sell / Bid Volume (Soft Lavender-Purple in DeepChart, Soft Rose in ATAS)
              if (sellSegW > 0) {
                ctx.fillStyle = isDeepChart
                  ? `rgba(167, 139, 250, ${0.34 + volRatio * 0.24})`
                  : `rgba(244, 63, 94, ${0.34 + volRatio * 0.24})`;
                ctx.fillRect(fpStartX, cellY + 1, sellSegW, cellH - 2);
              }

              // Right Segment: Buy / Ask Volume (Vibrant Mint-Emerald Green)
              if (buySegW > 0) {
                ctx.fillStyle = `rgba(74, 222, 128, ${0.36 + volRatio * 0.26})`;
                ctx.fillRect(fpStartX + sellSegW, cellY + 1, buySegW, cellH - 2);
              }

              // Crisp 1px staircase row border around horizontal volume bar
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
              ctx.lineWidth = 0.75;
              ctx.strokeRect(fpStartX, cellY + 1, totalBarW, cellH - 2);
            }
          }

          // ─── LAYER C: OF-B/A (2-Column Bid × Ask Numbers & Yellow POC Outline) ───
          if (showOfBa) {
            if (!showOfVp && !showOfDeltaP) {
              const halfW = Math.min(36, fpWidth / 2);
              const sellRatio = Math.min(cell.sell_units / maxCellVol, 1.0);
              const buyRatio = Math.min(cell.buy_units / maxCellVol, 1.0);
              ctx.fillStyle = isDeepChart
                ? `rgba(156, 39, 176, ${0.18 + sellRatio * 0.35})`
                : `rgba(242, 54, 69, ${0.18 + sellRatio * 0.35})`;
              ctx.fillRect(fpStartX, cellY + 0.5, halfW - 0.5, cellH - 1);

              ctx.fillStyle = `rgba(0, 200, 83, ${0.18 + buyRatio * 0.35})`;
              ctx.fillRect(fpStartX + halfW + 0.5, cellY + 0.5, halfW - 0.5, cellH - 1);
            }

            if (showNumbers) {
              ctx.save();
              // Subtle dark halo behind text guarantees 100% contrast over any histogram color
              ctx.shadowColor = 'rgba(7, 9, 14, 0.95)';
              ctx.shadowBlur = 2.5;

              // Left Number Column: Bid Volume (Aggressive Sells)
              ctx.fillStyle = isSellImb ? sellImbTextCol : '#F8FAFC';
              ctx.font = isSellImb
                ? `bold ${fontSize}px "JetBrains Mono", monospace`
                : `600 ${fontSize}px "JetBrains Mono", monospace`;
              ctx.textAlign = 'right';
              ctx.fillText(
                formatVolText(cell.sell_units),
                bidRightX,
                cellY + cellH / 2 + fontSize * 0.35
              );

              // Right Number Column: Ask Volume (Aggressive Buys)
              ctx.fillStyle = isBuyImb ? buyImbTextCol : '#F8FAFC';
              ctx.font = isBuyImb
                ? `bold ${fontSize}px "JetBrains Mono", monospace`
                : `600 ${fontSize}px "JetBrains Mono", monospace`;
              ctx.textAlign = 'left';
              ctx.fillText(
                formatVolText(cell.buy_units),
                askLeftX,
                cellY + cellH / 2 + fontSize * 0.35
              );
              ctx.restore();
            }

            // Crisp Bright Yellow POC Rectangle (Matches media_1794650950575_011ab3f4.jpg)
            if (isPoc) {
              const pocBoxW = Math.max(totalBarW + 2, Math.min(fpWidth - 2, askLeftX - fpStartX + 34));
              ctx.strokeStyle = '#FFEA00';
              ctx.lineWidth = 1.8;
              ctx.strokeRect(fpStartX, cellY + 0.5, pocBoxW, cellH - 1);
            }
          }
        });

        // Per-bar Value Area (VAH-VAL) subtle bracket on right edge when D-VL is enabled
        if (showValueAreaLines && bar.value_area) {
          const vahY = priceToY(bar.value_area.vah_ticks);
          const valY = priceToY(bar.value_area.val_ticks);
          const vaTop = Math.min(vahY, valY);
          const vaBot = Math.max(vahY, valY);
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(fpStartX + fpWidth - 4, vaTop);
          ctx.lineTo(fpStartX + fpWidth - 1, vaTop);
          ctx.lineTo(fpStartX + fpWidth - 1, vaBot);
          ctx.lineTo(fpStartX + fpWidth - 4, vaBot);
          ctx.stroke();
        }
      }

      // =======================================================================
      // BAR HEAD SUMMARY STATS ABOVE HIGH WICK (Delta on top, Volume below)
      // Positioned above topMostCellY so it NEVER overlaps footprint rows!
      // =======================================================================
      const topSafeY = Math.min(highY, topMostCellY) - 4;
      if (showBarHeadStats && barWidth >= 42 && topSafeY > 24) {
        const centerX = x + barWidth / 2;
        const deltaVal = bar.stats.delta;
        const volVal = bar.stats.totalVolume;
        const fmtCompact = (n: number) => {
          const abs = Math.abs(n);
          const sign = n < 0 ? '-' : '';
          if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(1)}M`;
          if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
          return `${sign}${abs}`;
        };

        ctx.save();
        ctx.fillStyle = 'rgba(13, 15, 20, 0.82)';
        ctx.fillRect(centerX - 22, topSafeY - 22, 44, 22);

        ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = deltaVal >= 0 ? bullPrimary : bearBorder;
        ctx.fillText(fmtCompact(deltaVal), centerX, topSafeY - 12);

        ctx.font = '600 9px "JetBrains Mono", monospace';
        ctx.fillStyle = '#F8FAFC';
        ctx.fillText(fmtCompact(volVal), centerX, topSafeY - 2);
        ctx.restore();
      }
    });

    // =========================================================================
    // 4. NAKED POCs, ABSORPTION, OPTIONS LEVELS, BUBBLES & USER DRAWINGS
    // =========================================================================
    if (showNakedPoc && nakedPocs && nakedPocs.length > 0) {
      nakedPocs.forEach((npoc) => {
        if (npoc.isMitigated) return;
        const y = priceToY(npoc.priceTicks);
        if (y < 0 || y > chartHeight) return;
        const startBarX = startX + npoc.barIndex * barPitch + barWidth / 2;
        ctx.save();
        ctx.strokeStyle = '#FFD600';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(Math.max(0, startBarX), y);
        ctx.lineTo(chartRightX, y);
        ctx.stroke();
        ctx.restore();
      });
    }

    if (showAbsorption) {
      // A. Absorption Events (Aggressive Market Orders Absorbed by Passive Limit Orders)
      if (absorptionEvents && absorptionEvents.length > 0) {
        absorptionEvents.forEach((ev) => {
          const bar = analyzedBars[ev.barIndex];
          if (!bar) return;
          const barX = startX + ev.barIndex * barPitch + barWidth / 2;
          if (barX < 0 || barX > chartRightX - 40) return;
          const isBull = ev.type === 'BullishAbsorption';
          const anchorY = isBull ? priceToY(bar.low_ticks) + 14 : priceToY(bar.high_ticks) - 28;
          if (anchorY < 10 || anchorY > chartHeight - 10) return;

          ctx.save();
          const badgeText = isBull ? '🧊 ▲ BUY ABSORPTION' : '🧊 ▼ SELL ABSORPTION';
          ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
          const tw = ctx.measureText(badgeText).width + 8;
          ctx.fillStyle = isBull ? 'rgba(0, 230, 118, 0.18)' : 'rgba(244, 63, 94, 0.18)';
          ctx.fillRect(barX - tw / 2, anchorY - 9, tw, 13);
          ctx.strokeStyle = isBull ? bullPrimary : '#FB7185';
          ctx.lineWidth = 1;
          ctx.strokeRect(barX - tw / 2, anchorY - 9, tw, 13);
          ctx.fillStyle = isBull ? bullPrimary : '#FDA4AF';
          ctx.textAlign = 'center';
          ctx.fillText(badgeText, barX, anchorY);
          ctx.restore();
        });
      }

      // B. ATAS Unfinished Auction Detector: High or Low cell has BOTH Bid > 0 and Ask > 0 (unmitigated)
      const recentStartIdx = Math.max(0, analyzedBars.length - 28);
      for (let bIdx = recentStartIdx; bIdx < analyzedBars.length; bIdx++) {
        const b = analyzedBars[bIdx];
        const bx = startX + bIdx * barPitch;
        if (bx + barWidth < 0 || bx > chartRightX) continue;

        if (b.footprint && b.footprint.length >= 2 && bIdx >= analyzedBars.length - 12) {
          const lowCell = b.footprint[0];
          const highCell = b.footprint[b.footprint.length - 1];
          // Check if subsequent bars have already revisited this high/low
          let highMitigated = false;
          let lowMitigated = false;
          for (let k = bIdx + 1; k < analyzedBars.length; k++) {
            if (analyzedBars[k].high_ticks > b.high_ticks) highMitigated = true;
            if (analyzedBars[k].low_ticks < b.low_ticks) lowMitigated = true;
          }
          if (!highMitigated && highCell.buy_units > 5 && highCell.sell_units > 5) {
            const hy = priceToY(b.high_ticks);
            if (hy > 12 && hy < chartHeight - 12) {
              ctx.save();
              ctx.strokeStyle = '#F59E0B';
              ctx.lineWidth = 1.1;
              ctx.setLineDash([2, 2]);
              ctx.beginPath();
              ctx.moveTo(bx + barWidth / 2, hy);
              ctx.lineTo(chartRightX, hy);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = '#FBBF24';
              ctx.font = 'bold 8px "JetBrains Mono", monospace';
              ctx.textAlign = 'right';
              ctx.fillText('⚠️ UNFINISHED AUCTION (HIGH)', chartRightX - 8, hy - 3);
              ctx.restore();
            }
          }
          if (!lowMitigated && lowCell.buy_units > 5 && lowCell.sell_units > 5) {
            const ly = priceToY(b.low_ticks);
            if (ly > 12 && ly < chartHeight - 12) {
              ctx.save();
              ctx.strokeStyle = '#F59E0B';
              ctx.lineWidth = 1.1;
              ctx.setLineDash([2, 2]);
              ctx.beginPath();
              ctx.moveTo(bx + barWidth / 2, ly);
              ctx.lineTo(chartRightX, ly);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = '#FBBF24';
              ctx.font = 'bold 8px "JetBrains Mono", monospace';
              ctx.textAlign = 'right';
              ctx.fillText('⚠️ UNFINISHED AUCTION (LOW)', chartRightX - 8, ly + 9);
              ctx.restore();
            }
          }
        }
      }

      // C. Whale Passive Limit Order Walls on L2 DOM (Top Resting Bid & Ask Walls)
      if (orderBook) {
        const isLiveL2 = !instrumentId.startsWith('MT5:') && !['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'GBPJPY', 'XAUUSD', 'NAS100', 'US30'].includes(instrumentId);
        const topAsks = [...(orderBook.asks || [])]
          .sort((a, b) => b.quantity_units - a.quantity_units)
          .slice(0, 2);
        const topBids = [...(orderBook.bids || [])]
          .sort((a, b) => b.quantity_units - a.quantity_units)
          .slice(0, 2);

        topAsks.forEach((w, wi) => {
          const y = priceToY(w.price_ticks);
          if (y < 14 || y > chartHeight - 14) return;
          ctx.save();
          ctx.fillStyle = wi === 0 ? 'rgba(239, 68, 68, 0.22)' : 'rgba(239, 68, 68, 0.12)';
          ctx.fillRect(chartRightX - 270, y - 6, 270, 12);
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = wi === 0 ? 1.5 : 1;
          ctx.beginPath();
          ctx.moveTo(chartRightX - 270, y);
          ctx.lineTo(chartRightX, y);
          ctx.stroke();
          ctx.fillStyle = '#FCA5A5';
          ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'right';
          ctx.fillText(
            `🧱 SELL LIMIT WALL [${isLiveL2 ? 'L2 DOM THẬT' : 'ECN TICK'}]: ${w.quantity_units.toLocaleString()} @ ${formatInstrumentPrice(w.price_ticks, instrumentId)}`,
            chartRightX - 6,
            y - 2
          );
          ctx.restore();
        });

        topBids.forEach((w, wi) => {
          const y = priceToY(w.price_ticks);
          if (y < 14 || y > chartHeight - 14) return;
          ctx.save();
          ctx.fillStyle = wi === 0 ? 'rgba(16, 185, 129, 0.22)' : 'rgba(16, 185, 129, 0.12)';
          ctx.fillRect(chartRightX - 270, y - 6, 270, 12);
          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = wi === 0 ? 1.5 : 1;
          ctx.beginPath();
          ctx.moveTo(chartRightX - 270, y);
          ctx.lineTo(chartRightX, y);
          ctx.stroke();
          ctx.fillStyle = '#6EE7B7';
          ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'right';
          ctx.fillText(
            `🧱 BUY LIMIT WALL [${isLiveL2 ? 'L2 DOM THẬT' : 'ECN TICK'}]: ${w.quantity_units.toLocaleString()} @ ${formatInstrumentPrice(w.price_ticks, instrumentId)}`,
            chartRightX - 6,
            y - 2
          );
          ctx.restore();
        });
      }
    }

    // =========================================================================
    // 4A. EXTENDED STACKED IMBALANCE ZONES (≥ 3 CONSECUTIVE 300% DIAGONAL IMBALANCES)
    // Institutional Support & Resistance Extended Supply/Demand Zones (ATAS Pro)
    // =========================================================================
    if (showStackedImbalances) {
      const lookbackStart = Math.max(0, analyzedBars.length - 120);
      for (let bIdx = lookbackStart; bIdx < analyzedBars.length; bIdx++) {
        const b = analyzedBars[bIdx];
        const bx = startX + bIdx * barPitch;
        if (!b.stacked_imbalances || b.stacked_imbalances.length === 0) continue;

        b.stacked_imbalances.forEach((st) => {
          const isBuySt = st.side?.toLowerCase() === 'buy';
          const yTop = priceToY(st.end_price_ticks);
          const yBot = priceToY(st.start_price_ticks);
          const zoneTop = Math.min(yTop, yBot) - 3;
          const zoneH = Math.max(Math.abs(yBot - yTop) + 6, 8);
          if (zoneTop < -50 || zoneTop > chartHeight + 50) return;

          // Check mitigation across subsequent bars
          let mitigatedX = chartRightX;
          const minP = Math.min(st.start_price_ticks, st.end_price_ticks);
          const maxP = Math.max(st.start_price_ticks, st.end_price_ticks);
          for (let k = bIdx + 1; k < analyzedBars.length; k++) {
            const kb = analyzedBars[k];
            if (isBuySt) {
              if (kb.low_ticks <= minP) {
                mitigatedX = Math.min(chartRightX, startX + k * barPitch + barWidth / 2);
                break;
              }
            } else {
              if (kb.high_ticks >= maxP) {
                mitigatedX = Math.min(chartRightX, startX + k * barPitch + barWidth / 2);
                break;
              }
            }
          }

          const zoneStartX = Math.max(0, bx);
          const zoneWidth = mitigatedX - zoneStartX;
          if (zoneWidth <= 2) return;

          ctx.save();
          ctx.fillStyle = isBuySt ? 'rgba(0, 230, 118, 0.12)' : 'rgba(244, 63, 94, 0.12)';
          ctx.fillRect(zoneStartX, zoneTop, zoneWidth, zoneH);
          ctx.strokeStyle = isBuySt ? 'rgba(0, 230, 118, 0.65)' : 'rgba(244, 63, 94, 0.65)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(zoneStartX, zoneTop, zoneWidth, zoneH);
          ctx.setLineDash([]);

          ctx.fillStyle = isBuySt ? '#4ADE80' : '#FDA4AF';
          ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            `⚡ ${st.levels_count}x ${isBuySt ? 'BUY' : 'SELL'} IMBALANCE`,
            zoneStartX + 4,
            zoneTop + zoneH / 2
          );
          ctx.restore();
        });
      }
    }

    // =========================================================================
    // 4B. PROPRIETARY STOP-LOSS CLUSTERS & LIQUIDATION POOLS (SL/LIQ)
    // Algorithmic Liquidity Estimation Model (Swing High/Low + Leverage Math)
    // =========================================================================
    if (showSlClusters && analyzedBars.length >= 5) {
      const swingHighPools: { barIdx: number; priceTicks: number; vol: number; swept: boolean }[] = [];
      const swingLowPools: { barIdx: number; priceTicks: number; vol: number; swept: boolean }[] = [];
      const lookbackStart = Math.max(2, analyzedBars.length - 45);

      for (let i = lookbackStart; i < analyzedBars.length - 2; i++) {
        const cur = analyzedBars[i];
        const isSwingH =
          cur.high_ticks >= analyzedBars[i - 1].high_ticks &&
          cur.high_ticks >= analyzedBars[i - 2].high_ticks &&
          cur.high_ticks >= analyzedBars[i + 1].high_ticks &&
          cur.high_ticks >= analyzedBars[i + 2].high_ticks;
        const isSwingL =
          cur.low_ticks <= analyzedBars[i - 1].low_ticks &&
          cur.low_ticks <= analyzedBars[i - 2].low_ticks &&
          cur.low_ticks <= analyzedBars[i + 1].low_ticks &&
          cur.low_ticks <= analyzedBars[i + 2].low_ticks;

        if (isSwingH) {
          let mitigated = false;
          let sweptOnLast = false;
          for (let k = i + 2; k < analyzedBars.length; k++) {
            if (analyzedBars[k].close_ticks > cur.high_ticks) {
              mitigated = true;
              break;
            }
            if (k >= analyzedBars.length - 3 && analyzedBars[k].high_ticks > cur.high_ticks && analyzedBars[k].close_ticks <= cur.high_ticks) {
              sweptOnLast = true;
            }
          }
          if (!mitigated) {
            swingHighPools.push({
              barIdx: i,
              priceTicks: cur.high_ticks,
              vol: cur.stats.totalVolume + (analyzedBars[i - 1]?.stats.totalVolume || 0),
              swept: sweptOnLast,
            });
          }
        }

        if (isSwingL) {
          let mitigated = false;
          let sweptOnLast = false;
          for (let k = i + 2; k < analyzedBars.length; k++) {
            if (analyzedBars[k].close_ticks < cur.low_ticks) {
              mitigated = true;
              break;
            }
            if (k >= analyzedBars.length - 3 && analyzedBars[k].low_ticks < cur.low_ticks && analyzedBars[k].close_ticks >= cur.low_ticks) {
              sweptOnLast = true;
            }
          }
          if (!mitigated) {
            swingLowPools.push({
              barIdx: i,
              priceTicks: cur.low_ticks,
              vol: cur.stats.totalVolume + (analyzedBars[i - 1]?.stats.totalVolume || 0),
              swept: sweptOnLast,
            });
          }
        }
      }

      // Render top 3 Short Stop-Loss / BSL Liquidation Clusters above unmitigated Swing Highs
      swingHighPools.slice(-3).forEach((pool) => {
        const yBase = priceToY(pool.priceTicks);
        const bandH = 14;
        const yTop = yBase - bandH;
        if (yBase < 10 || yTop > chartHeight - 10) return;
        const xStart = Math.max(0, startX + pool.barIdx * barPitch + barWidth / 2);

        ctx.save();
        const grad = ctx.createLinearGradient(xStart, yTop, chartRightX, yTop);
        grad.addColorStop(0, 'rgba(245, 158, 11, 0.08)');
        grad.addColorStop(1, 'rgba(239, 68, 68, 0.28)');
        ctx.fillStyle = grad;
        ctx.fillRect(xStart, yTop, chartRightX - xStart, bandH);

        ctx.strokeStyle = pool.swept ? '#00E676' : '#F59E0B';
        ctx.lineWidth = 1.3;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(xStart, yBase);
        ctx.lineTo(chartRightX, yBase);
        ctx.stroke();
        ctx.setLineDash([]);

        const estStopVol = Math.round(pool.vol * 0.65);
        const label = pool.swept
          ? `⚡ BSL STOP-HUNT SWEPT! (${formatInstrumentPrice(pool.priceTicks, instrumentId)})`
          : `🔥 [MÔ HÌNH ƯỚC TÍNH] VÙNG TỤ SL SHORT / LIQ 50x-100x (BSL @ ${formatInstrumentPrice(pool.priceTicks, instrumentId)} · ~${estStopVol.toLocaleString()} Vol)`;
        ctx.fillStyle = pool.swept ? '#4ADE80' : '#FBBF24';
        ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(label, chartRightX - 8, yBase - 3);
        ctx.restore();
      });

      // Render top 3 Long Stop-Loss / SSL Liquidation Clusters below unmitigated Swing Lows
      swingLowPools.slice(-3).forEach((pool) => {
        const yBase = priceToY(pool.priceTicks);
        const bandH = 14;
        if (yBase < 10 || yBase > chartHeight - 10) return;
        const xStart = Math.max(0, startX + pool.barIdx * barPitch + barWidth / 2);

        ctx.save();
        const grad = ctx.createLinearGradient(xStart, yBase, chartRightX, yBase);
        grad.addColorStop(0, 'rgba(6, 182, 212, 0.08)');
        grad.addColorStop(1, 'rgba(56, 189, 248, 0.28)');
        ctx.fillStyle = grad;
        ctx.fillRect(xStart, yBase, chartRightX - xStart, bandH);

        ctx.strokeStyle = pool.swept ? '#00E676' : '#38BDF8';
        ctx.lineWidth = 1.3;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(xStart, yBase);
        ctx.lineTo(chartRightX, yBase);
        ctx.stroke();
        ctx.setLineDash([]);

        const estStopVol = Math.round(pool.vol * 0.65);
        const label = pool.swept
          ? `⚡ SSL STOP-HUNT SWEPT! (${formatInstrumentPrice(pool.priceTicks, instrumentId)})`
          : `🔥 [MÔ HÌNH ƯỚC TÍNH] VÙNG TỤ SL LONG / LIQ 50x-100x (SSL @ ${formatInstrumentPrice(pool.priceTicks, instrumentId)} · ~${estStopVol.toLocaleString()} Vol)`;
        ctx.fillStyle = pool.swept ? '#4ADE80' : '#38BDF8';
        ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(label, chartRightX - 8, yBase + 10);
        ctx.restore();
      });
    }

    // =========================================================================
    // 4C. OPTIONS STRIKES & GAMMA EXPOSURE (GEX) OVERLAY (STRIKES)
    // Uses 100% REAL Deribit Live Options Chain for BTC/ETH; labeled fallback for Forex
    // =========================================================================
    if (showOptions) {
      if (liveOptionsChain && liveOptionsChain.isRealData && liveOptionsChain.strikes.length > 0) {
        const levels = liveOptionsChain.strikes;
        const maxAbsGex = Math.max(...levels.map((l) => Math.abs(l.net_gex_usd)), 1);
        const callWallUsd = Math.round(liveOptionsChain.callWallStrikeTicks / 100);
        const putWallUsd = Math.round(liveOptionsChain.putWallStrikeTicks / 100);
        const zeroGammaUsd = Math.round(liveOptionsChain.zeroGammaStrikeTicks / 100);
        const maxPainUsd = Math.round(liveOptionsChain.maxPainStrikeTicks / 100);

        const venueTag = liveOptionsChain.currency === 'XAU' ? 'CBOE GOLD' : 'DERIBIT LIVE';
        // Top HUD Banner showing 100% Real Options Telemetry (even if walls are outside 1m zoom!)
        ctx.save();
        const hudText = `🟢 ${venueTag} OPTIONS (${liveOptionsChain.totalContractsCount} HĐ) · CALL WALL: $${callWallUsd.toLocaleString()} · PUT WALL: $${putWallUsd.toLocaleString()} · ZERO γ: $${zeroGammaUsd.toLocaleString()} · MAX PAIN: $${maxPainUsd.toLocaleString()}`;
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        const hudW = ctx.measureText(hudText).width + 18;
        ctx.fillStyle = 'rgba(11, 15, 25, 0.92)';
        ctx.fillRect(14, 34, hudW, 20);
        ctx.strokeStyle = '#10B981';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(14, 34, hudW, 20);
        ctx.fillStyle = '#34D399';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(hudText, 23, 44);
        ctx.restore();

        levels.forEach((lvl) => {
          const st = lvl.strike_ticks;
          const y = priceToY(st);
          if (y < 14 || y > chartHeight - 14) return;

          const strikeUsd = Math.round(st / 100);
          const isCallWall = st === liveOptionsChain.callWallStrikeTicks;
          const isPutWall = st === liveOptionsChain.putWallStrikeTicks;
          const isZeroGamma = st === liveOptionsChain.zeroGammaStrikeTicks;
          const isMaxPain = st === liveOptionsChain.maxPainStrikeTicks;
          const isPositiveGamma = lvl.net_gex_usd >= 0;
          const gexMillions = (lvl.net_gex_usd / 1_000_000).toFixed(2);
          const gexBarW = Math.max(8, Math.round((Math.abs(lvl.net_gex_usd) / maxAbsGex) * 110));

          ctx.save();
          ctx.fillStyle = isPositiveGamma ? 'rgba(16, 185, 129, 0.30)' : 'rgba(168, 85, 247, 0.30)';
          ctx.fillRect(chartRightX - gexBarW, y - 4, gexBarW, 8);

          if (isCallWall || isPutWall || isZeroGamma || isMaxPain) {
            const col = isCallWall
              ? '#00E676'
              : isPutWall
              ? '#F43F5E'
              : isZeroGamma
              ? '#FFD600'
              : '#A855F7';
            ctx.strokeStyle = col;
            ctx.lineWidth = isCallWall || isPutWall ? 1.8 : 1.3;
            ctx.setLineDash(isCallWall || isPutWall ? [] : [6, 4]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(chartRightX, y);
            ctx.stroke();
            ctx.setLineDash([]);

            const title = isCallWall
              ? `🧱 [DERIBIT LIVE] CALL WALL @ $${strikeUsd.toLocaleString()} (Call OI: ${lvl.call_oi.toLocaleString()} · Put OI: ${lvl.put_oi.toLocaleString()} · +$${gexMillions}M GEX)`
              : isPutWall
              ? `🛡 [DERIBIT LIVE] PUT WALL @ $${strikeUsd.toLocaleString()} (Put OI: ${lvl.put_oi.toLocaleString()} · Call OI: ${lvl.call_oi.toLocaleString()} · $${gexMillions}M GEX)`
              : isZeroGamma
              ? `⚡ [DERIBIT LIVE] ZERO GAMMA FLIP @ $${strikeUsd.toLocaleString()} (OI: ${(lvl.call_oi + lvl.put_oi).toLocaleString()})`
              : `🎯 [DERIBIT LIVE] MAX PAIN STRIKE @ $${strikeUsd.toLocaleString()} (OI: ${(lvl.call_oi + lvl.put_oi).toLocaleString()})`;

            ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
            const tw = ctx.measureText(title).width + 12;
            ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
            ctx.fillRect(16, y - 9, tw, 17);
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.2;
            ctx.strokeRect(16, y - 9, tw, 17);
            ctx.fillStyle = col;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(title, 22, y);
          } else {
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(chartRightX - 210, y);
            ctx.lineTo(chartRightX, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#E2E8F0';
            ctx.font = 'bold 8px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText(
              `[DERIBIT] STRIKE $${strikeUsd.toLocaleString()} · C:${lvl.call_oi.toLocaleString()} P:${lvl.put_oi.toLocaleString()} (${isPositiveGamma ? '+' : ''}$${gexMillions}M γ)`,
              chartRightX - 4,
              y - 5
            );
          }
          ctx.restore();
        });
      } else {
        // MT5 Forex / Metals have no public Options chain -> Show honest notice banner
        ctx.save();
        const noticeText = `⚠️ MT5 FOREX/GOLD KHÔNG CÓ DỮ LIỆU OPTIONS CÔNG KHAI (CHỈ HỖ TRỢ DERIBIT LIVE CHO BTC & ETH)`;
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        const nw = ctx.measureText(noticeText).width + 18;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.fillRect(14, 34, nw, 20);
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(14, 34, nw, 20);
        ctx.fillStyle = '#FBBF24';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(noticeText, 23, 44);
        ctx.restore();
      }
    }

    if (showBubbles) {
      analyzedBars.forEach((bar, bIdx) => {
        const bx = startX + bIdx * barPitch + barWidth / 2;
        if (bx < 0 || bx > chartRightX) return;
        bar.footprint?.forEach((cell) => {
          if (cell.total_units >= whaleVolumeThreshold * 0.25) {
            const y = priceToY(cell.price_ticks);
            if (y < 0 || y > chartHeight) return;
            const radius = Math.min(18, Math.max(5, Math.sqrt(cell.total_units / 50) * 6));
            const isBuyDom = cell.delta_units >= 0;
            ctx.beginPath();
            ctx.arc(bx, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = isBuyDom ? 'rgba(0, 230, 118, 0.28)' : 'rgba(168, 85, 247, 0.28)';
            ctx.fill();
            ctx.strokeStyle = isBuyDom ? bullPrimary : bearBorder;
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        });
      });
    }

    // Helper to render any ChartDrawing (both saved drawings and live drawingDraft preview)
    const renderChartDrawing = (drawing: ChartDrawing, isSelected: boolean, isDraft: boolean = false) => {
      if (!drawing.points || drawing.points.length === 0) return;
      const isHovered = drawing.id === hoveredDrawingId;
      ctx.save();
      if (isDraft) ctx.globalAlpha = 0.88;

      const applyLineDash = () => {
        if (drawing.lineStyle === 'dashed') ctx.setLineDash([6, 4]);
        else if (drawing.lineStyle === 'dotted') ctx.setLineDash([2, 3]);
        else ctx.setLineDash([]);
      };

      const drawHandleCircle = (cx: number, cy: number, strokeCol: string) => {
        if (!isSelected && !isHovered && !isDraft) return;
        ctx.save();
        ctx.setLineDash([]);
        if (isSelected) {
          ctx.fillStyle = `${strokeCol}33`;
          ctx.beginPath();
          ctx.arc(cx, cy, 8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };

      const drawBadgePill = (
        text: string,
        bx: number,
        by: number,
        bgCol: string,
        borderCol: string,
        textCol: string = '#FFFFFF'
      ) => {
        ctx.save();
        ctx.setLineDash([]);
        ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
        const padX = 7;
        const tw = ctx.measureText(text).width + padX * 2;
        const th = 18;
        const clampedX = Math.max(8, Math.min(bx - tw / 2, chartRightX - tw - 6));
        const clampedY = Math.max(18, Math.min(by - th / 2, chartHeight - th - 4));
        ctx.fillStyle = bgCol;
        ctx.fillRect(clampedX, clampedY, tw, th);
        ctx.strokeStyle = borderCol;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(clampedX, clampedY, tw, th);
        ctx.fillStyle = textCol;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, clampedX + tw / 2, clampedY + th / 2);
        ctx.restore();
      };

      if (drawing.type === 'horizontal_line') {
        const pt = drawing.points[0];
        const y = priceToY(pt.price_ticks);
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = isSelected || isHovered ? 2.4 : drawing.lineWidth || 1.6;
        applyLineDash();
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartRightX, y);
        ctx.stroke();
        ctx.setLineDash([]);
        drawHandleCircle(chartRightX / 2, y, drawing.color);
        const lbl = drawing.text ? `${drawing.text} · ` : '';
        drawBadgePill(
          `${lbl}${formatInstrumentPrice(pt.price_ticks, instrumentId)}`,
          chartRightX - 75,
          y - 11,
          'rgba(15, 23, 42, 0.94)',
          drawing.color,
          drawing.color
        );
      } else if (drawing.type === 'horizontal_ray') {
        const pt = drawing.points[0];
        const x0 = Math.max(timeToX(pt.time_us), 0);
        const y = priceToY(pt.price_ticks);
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = isSelected || isHovered ? 2.4 : drawing.lineWidth || 1.6;
        if (!drawing.lineStyle) ctx.setLineDash([5, 3]);
        else applyLineDash();
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(chartRightX, y);
        ctx.stroke();
        ctx.setLineDash([]);
        drawHandleCircle(x0, y, drawing.color);
        const lbl = drawing.text || 'RAY';
        drawBadgePill(
          `${lbl} ${formatInstrumentPrice(pt.price_ticks, instrumentId)}`,
          chartRightX - 75,
          y - 11,
          'rgba(15, 23, 42, 0.94)',
          drawing.color,
          drawing.color
        );
      } else if ((drawing.type === 'trendline' || drawing.type === 'arrow') && drawing.points.length >= 2) {
        const p0 = drawing.points[0];
        const p1 = drawing.points[1];
        const x0 = timeToX(p0.time_us);
        const y0 = priceToY(p0.price_ticks);
        const x1 = timeToX(p1.time_us);
        const y1 = priceToY(p1.price_ticks);
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = isSelected || isHovered ? 2.6 : drawing.lineWidth || 1.8;
        applyLineDash();
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw Arrowhead if type === 'arrow'
        if (drawing.type === 'arrow') {
          const angle = Math.atan2(y1 - y0, x1 - x0);
          const headLen = 11;
          ctx.fillStyle = drawing.color;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 6), y1 - headLen * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 6), y1 - headLen * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
        }

        drawHandleCircle(x0, y0, drawing.color);
        drawHandleCircle(x1, y1, drawing.color);

        const diffTicks = p1.price_ticks - p0.price_ticks;
        const pct = p0.price_ticks > 0 ? ((diffTicks / p0.price_ticks) * 100).toFixed(2) : '0.00';
        const customTag = drawing.text ? `${drawing.text} · ` : '';
        drawBadgePill(
          `${customTag}${formatPriceDiffPips(diffTicks, instrumentId)} (${diffTicks >= 0 ? '+' : ''}${pct}%)`,
          (x0 + x1) / 2,
          (y0 + y1) / 2 - 14,
          'rgba(15, 23, 42, 0.94)',
          drawing.color,
          '#F8FAFC'
        );
      } else if (drawing.type === 'imbalance_box' && drawing.points.length >= 2) {
        // TradingView 8-Handle Order Block / Supply-Demand / FVG Zone Box
        const p0 = drawing.points[0];
        const p1 = drawing.points[1];
        const x0 = timeToX(p0.time_us);
        const y0 = priceToY(p0.price_ticks);
        const rawX1 = timeToX(p1.time_us);
        const x1 = drawing.extendRight ? chartRightX : rawX1;
        const y1 = priceToY(p1.price_ticks);
        const left = Math.min(x0, x1);
        const top = Math.min(y0, y1);
        const boxW = Math.max(Math.abs(x1 - x0), 24);
        const boxH = Math.max(Math.abs(y1 - y0), 8);

        ctx.fillStyle = drawing.fillColor || `${drawing.color}28`;
        ctx.fillRect(left, top, boxW, boxH);
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = isSelected || isHovered ? 2.2 : drawing.lineWidth || 1.5;
        applyLineDash();
        ctx.strokeRect(left, top, boxW, boxH);
        ctx.setLineDash([]);

        // TradingView 50% Equilibrium Midline inside Order Block
        const midY = top + boxH / 2;
        const midPrice = Math.round((p0.price_ticks + p1.price_ticks) / 2);
        ctx.save();
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(left, midY);
        ctx.lineTo(left + boxW, midY);
        ctx.stroke();
        ctx.restore();

        const spanTicks = Math.abs(p1.price_ticks - p0.price_ticks);
        const zoneTitle = drawing.text || 'OB ZONE';
        ctx.fillStyle = drawing.color;
        ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(
          `${zoneTitle} · 50%: ${formatInstrumentPrice(midPrice, instrumentId)} (${formatPriceDiffPips(spanTicks, instrumentId)})`,
          left + 6,
          top + 12
        );

        // 8 TradingView Handles (4 corners + 4 midpoints)
        const midHandleX = (x0 + rawX1) / 2;
        drawHandleCircle(x0, y0, drawing.color);
        drawHandleCircle(rawX1, y1, drawing.color);
        drawHandleCircle(x0, y1, drawing.color);
        drawHandleCircle(rawX1, y0, drawing.color);
        drawHandleCircle(midHandleX, y0, drawing.color);
        drawHandleCircle(midHandleX, y1, drawing.color);
        drawHandleCircle(x0, midY, drawing.color);
        drawHandleCircle(rawX1, midY, drawing.color);
      } else if (drawing.type === 'price_range' && drawing.points.length >= 2) {
        // TradingView Price & Order Flow Range Ruler (Measure Tool)
        const p0 = drawing.points[0];
        const p1 = drawing.points[1];
        const x0 = timeToX(p0.time_us);
        const y0 = priceToY(p0.price_ticks);
        const x1 = timeToX(p1.time_us);
        const y1 = priceToY(p1.price_ticks);
        const left = Math.min(x0, x1);
        const right = Math.max(x0, x1);
        const top = Math.min(y0, y1);
        const bot = Math.max(y0, y1);
        const boxW = Math.max(right - left, 20);
        const boxH = Math.max(bot - top, 10);
        const diffTicks = p1.price_ticks - p0.price_ticks;
        const isUp = diffTicks >= 0;
        const col = isUp ? '#38BDF8' : '#F43F5E';

        ctx.fillStyle = isUp ? 'rgba(56, 189, 248, 0.18)' : 'rgba(244, 63, 94, 0.18)';
        ctx.fillRect(left, top, boxW, boxH);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(left, top, boxW, boxH);

        // Cross arrows inside ruler box
        const cx = left + boxW / 2;
        const cy = top + boxH / 2;
        ctx.beginPath();
        ctx.moveTo(cx, top);
        ctx.lineTo(cx, bot);
        ctx.moveTo(left, cy);
        ctx.lineTo(right, cy);
        ctx.stroke();

        // Compute bars count & total Order Flow volume/delta in range
        const tMin = Math.min(p0.time_us, p1.time_us);
        const tMax = Math.max(p0.time_us, p1.time_us);
        const barsInRange = analyzedBars.filter((b) => b.bar_start_us >= tMin && b.bar_start_us <= tMax);
        const barCount = Math.max(1, barsInRange.length);
        const rangeVol = barsInRange.reduce((s, b) => s + b.stats.totalVolume, 0);
        const rangeDelta = barsInRange.reduce((s, b) => s + b.stats.delta, 0);
        const pct = p0.price_ticks > 0 ? ((diffTicks / p0.price_ticks) * 100).toFixed(2) : '0.00';

        drawBadgePill(
          `📏 ${formatPriceDiffPips(diffTicks, instrumentId)} (${isUp ? '+' : ''}${pct}%) · ${barCount} nến · ΣV: ${rangeVol.toLocaleString()} · Δ: ${rangeDelta >= 0 ? '+' : ''}${rangeDelta.toLocaleString()}`,
          cx,
          isUp ? top - 13 : bot + 13,
          '#0F172A',
          col,
          '#F8FAFC'
        );
        drawHandleCircle(x0, y0, col);
        drawHandleCircle(x1, y1, col);
      } else if (drawing.type === 'brush' && drawing.points.length >= 2) {
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = isSelected || isHovered ? 3.0 : drawing.lineWidth || 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        drawing.points.forEach((pt, idx) => {
          const px = timeToX(pt.time_us);
          const py = priceToY(pt.price_ticks);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        const first = drawing.points[0];
        const last = drawing.points[drawing.points.length - 1];
        drawHandleCircle(timeToX(first.time_us), priceToY(first.price_ticks), drawing.color);
        drawHandleCircle(timeToX(last.time_us), priceToY(last.price_ticks), drawing.color);
      } else if (drawing.type === 'text_note' && drawing.points.length >= 1) {
        const pt = drawing.points[0];
        const px = timeToX(pt.time_us);
        const py = priceToY(pt.price_ticks);
        const noteText = drawing.text || 'BOS / OB';
        drawBadgePill(
          noteText,
          px,
          py,
          'rgba(15, 23, 42, 0.95)',
          isSelected ? '#FFFFFF' : drawing.color,
          drawing.color
        );
        drawHandleCircle(px, py, drawing.color);
      } else if (drawing.type === 'fibonacci' && drawing.points.length >= 2) {
        const p0 = drawing.points[0];
        const p1 = drawing.points[1];
        const x0 = timeToX(p0.time_us);
        const x1 = timeToX(p1.time_us);
        const basePrice = p0.price_ticks;
        const priceDiff = p1.price_ticks - p0.price_ticks;
        const leftBound = Math.min(x0, x1);
        const rightBound = drawing.extendRight ? chartRightX : Math.max(x0, x1, leftBound + 180);

        // Shaded bands between Fibonacci levels like TradingView
        for (let fi = 0; fi < FIBONACCI_LEVELS.length - 1; fi++) {
          const curLvl = FIBONACCI_LEVELS[fi];
          const nxtLvl = FIBONACCI_LEVELS[fi + 1];
          const yA = priceToY(basePrice + priceDiff * curLvl.ratio);
          const yB = priceToY(basePrice + priceDiff * nxtLvl.ratio);
          ctx.fillStyle = `${curLvl.color}16`;
          ctx.fillRect(leftBound, Math.min(yA, yB), Math.max(rightBound - leftBound, 20), Math.abs(yB - yA));
        }

        // Diagonal dashed swing anchor line
        ctx.save();
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x0, priceToY(p0.price_ticks));
        ctx.lineTo(x1, priceToY(p1.price_ticks));
        ctx.stroke();
        ctx.restore();

        FIBONACCI_LEVELS.forEach((lvl) => {
          const lvlPrice = Math.round(basePrice + priceDiff * lvl.ratio);
          const lvlY = priceToY(lvlPrice);
          ctx.strokeStyle = lvl.color;
          ctx.lineWidth = lvl.ratio === 0.5 || lvl.ratio === 0.618 ? 1.7 : 1.1;
          ctx.beginPath();
          ctx.moveTo(leftBound, lvlY);
          ctx.lineTo(rightBound, lvlY);
          ctx.stroke();

          ctx.fillStyle = lvl.color;
          ctx.font = 'bold 9px "JetBrains Mono", monospace';
          ctx.textAlign = 'right';
          ctx.fillText(
            `${lvl.label} (${formatInstrumentPrice(lvlPrice, instrumentId)})`,
            rightBound - 6,
            lvlY - 4
          );
        });
        drawHandleCircle(x0, priceToY(p0.price_ticks), '#00E5FF');
        drawHandleCircle(x1, priceToY(p1.price_ticks), '#00E5FF');
      } else if ((drawing.type === 'long_position' || drawing.type === 'short_position') && drawing.points.length >= 3) {
        // =====================================================================
        // TRADINGVIEW LONG / SHORT RISK:REWARD POSITION TOOL (100% Authentic)
        // points[0] = Entry, points[1] = Target TP + Right X, points[2] = Stop SL
        // =====================================================================
        const isLong = drawing.type === 'long_position';
        const pEntry = drawing.points[0];
        const pTp = drawing.points[1];
        const pSl = drawing.points[2];
        const lots = drawing.lotSize || 1.0;

        const xLeft = Math.min(timeToX(pEntry.time_us), timeToX(pTp.time_us));
        const xRight = Math.max(timeToX(pEntry.time_us), timeToX(pTp.time_us), xLeft + 130);
        const boxW = xRight - xLeft;
        const midX = xLeft + boxW / 2;

        const yEntry = priceToY(pEntry.price_ticks);
        const yTp = priceToY(pTp.price_ticks);
        const ySl = priceToY(pSl.price_ticks);

        // 1. Profit Zone (TradingView Teal Green #089981)
        const tpTop = Math.min(yEntry, yTp);
        const tpH = Math.max(Math.abs(yTp - yEntry), 2);
        ctx.fillStyle = isSelected || isHovered ? 'rgba(8, 153, 129, 0.34)' : 'rgba(8, 153, 129, 0.25)';
        ctx.fillRect(xLeft, tpTop, boxW, tpH);
        ctx.strokeStyle = '#089981';
        ctx.lineWidth = isSelected || isHovered ? 2.2 : 1.5;
        ctx.strokeRect(xLeft, tpTop, boxW, tpH);

        // 2. Stop Loss Zone (TradingView Crimson Red #F23645)
        const slTop = Math.min(yEntry, ySl);
        const slH = Math.max(Math.abs(ySl - yEntry), 2);
        ctx.fillStyle = isSelected || isHovered ? 'rgba(242, 54, 69, 0.34)' : 'rgba(242, 54, 69, 0.25)';
        ctx.fillRect(xLeft, slTop, boxW, slH);
        ctx.strokeStyle = '#F23645';
        ctx.lineWidth = isSelected || isHovered ? 2.2 : 1.5;
        ctx.strokeRect(xLeft, slTop, boxW, slH);

        // 3. Entry Center Line (Crisp White/Silver Dashed Line)
        ctx.save();
        ctx.strokeStyle = '#F8FAFC';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(xLeft, yEntry);
        ctx.lineTo(xRight, yEntry);
        ctx.stroke();
        ctx.restore();

        // 4. Compute TradingView Telemetry (R:R Ratio, Pips, %, USD P&L)
        const rewardTicks = Math.abs(pTp.price_ticks - pEntry.price_ticks);
        const riskTicks = Math.max(1, Math.abs(pEntry.price_ticks - pSl.price_ticks));
        const rrRatio = (rewardTicks / riskTicks).toFixed(2);
        const tpPct = pEntry.price_ticks > 0 ? ((rewardTicks / pEntry.price_ticks) * 100).toFixed(2) : '0.00';
        const slPct = pEntry.price_ticks > 0 ? ((riskTicks / pEntry.price_ticks) * 100).toFixed(2) : '0.00';
        const tpUsd = Math.abs(
          computePositionPnlUsd(isLong ? 'Buy' : 'Sell', pEntry.price_ticks, pTp.price_ticks, lots, instrumentId)
        );
        const slUsd = Math.abs(
          computePositionPnlUsd(isLong ? 'Buy' : 'Sell', pEntry.price_ticks, pSl.price_ticks, lots, instrumentId)
        );

        // Target Pill Badge
        const tpBadgeY = isLong ? yTp - 12 : yTp + 12;
        drawBadgePill(
          `Target: ${formatInstrumentPrice(pTp.price_ticks, instrumentId)} (${formatPriceDiffPips(rewardTicks, instrumentId)} / +${tpPct}%) · +$${tpUsd.toFixed(2)}`,
          midX,
          tpBadgeY,
          '#089981',
          '#10B981',
          '#FFFFFF'
        );

        // Stop Loss Pill Badge
        const slBadgeY = isLong ? ySl + 12 : ySl - 12;
        drawBadgePill(
          `Stop: ${formatInstrumentPrice(pSl.price_ticks, instrumentId)} (-${formatPriceDiffPips(riskTicks, instrumentId).replace('+', '')} / -${slPct}%) · -$${slUsd.toFixed(2)}`,
          midX,
          slBadgeY,
          '#F23645',
          '#F87171',
          '#FFFFFF'
        );

        // Center Entry & R/R Pill Badge
        drawBadgePill(
          `${isLong ? 'LONG' : 'SHORT'} · R/R: 1:${rrRatio} · ${lots.toFixed(2)}L @ ${formatInstrumentPrice(pEntry.price_ticks, instrumentId)}`,
          midX,
          yEntry,
          '#131722',
          isLong ? '#089981' : '#F23645',
          '#F8FAFC'
        );

        // Interactive Drag Handles (○) on Entry, TP, SL, and Right Width
        drawHandleCircle(xLeft, yEntry, '#38BDF8');
        drawHandleCircle(midX, yTp, '#089981');
        drawHandleCircle(midX, ySl, '#F23645');
        drawHandleCircle(xRight, yEntry, '#38BDF8');
      }

      ctx.restore();
    };

    if (drawingsVisible && drawings && drawings.length > 0) {
      drawings.forEach((drawing) => {
        renderChartDrawing(drawing, drawing.id === selectedDrawingId, false);
      });
    }

    // Live Preview of 2-Point Drawing Draft While Moving Mouse!
    if (drawingDraft && activeDrawingTool && activeDrawingTool !== 'cursor') {
      let draftObj: ChartDrawing;
      if (activeDrawingTool === 'long_position' || activeDrawingTool === 'short_position') {
        draftObj = buildPositionDrawing(activeDrawingTool, drawingDraft.start, drawingDraft.current, barInterval);
      } else {
        draftObj = {
          id: 'draft-preview',
          type: activeDrawingTool,
          instrument_id: instrumentId,
          points: [drawingDraft.start, drawingDraft.current],
          color: drawingColor || '#00E5FF',
          lineWidth: 1.8,
          fillColor: activeDrawingTool === 'imbalance_box' ? `${drawingColor || '#00E5FF'}28` : undefined,
        };
      }
      renderChartDrawing(draftObj, true, true);
    }

    // Live Preview of Freehand Brush Draft
    if (brushDraft && brushDraft.length >= 2) {
      renderChartDrawing(
        {
          id: 'brush-preview',
          type: 'brush',
          instrument_id: instrumentId,
          points: brushDraft,
          color: drawingColor || '#00E5FF',
          lineWidth: 2.2,
        },
        true,
        true
      );
    }

    // Live Preview of Shift + Click Instant Measure Ruler
    if (shiftMeasureDraft) {
      renderChartDrawing(
        {
          id: 'shift-measure-preview',
          type: 'price_range',
          instrument_id: instrumentId,
          points: [shiftMeasureDraft.start, shiftMeasureDraft.current],
          color: '#38BDF8',
          lineWidth: 1.5,
        },
        true,
        true
      );
    }

    // Magnet Snap Indicator Ring (◎) when snapped to candle OHLC/POC
    if (snappedPoint) {
      ctx.save();
      ctx.strokeStyle = '#00E5FF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(snappedPoint.x, snappedPoint.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#00E5FF';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`🧲 ${snappedPoint.label}`, snappedPoint.x + 9, snappedPoint.y - 4);
      ctx.restore();
    }

    // =========================================================================
    // 4B. INTERACTIVE METATRADER 5 (MT5) POSITIONS & WORKING ORDERS ON CHART
    // Supports direct mouse dragging of Entry, SL, TP + [+TP] [+SL] [BE] [×]
    // =========================================================================
    if (mt5Tickets && mt5Tickets.length > 0) {
      const liveCloseTicks = activeBar
        ? activeBar.close_ticks
        : allBars.length > 0
        ? allBars[allBars.length - 1].close_ticks
        : instMeta.basePriceTicks;

      mt5Tickets.forEach((tk) => {
        const isDraggingThis = dragTicketLine && dragTicketLine.ticket === tk.ticket;
        const effectiveEntryTicks =
          isDraggingThis && dragTicketLine.field === 'entry' ? dragTicketLine.currentPriceTicks : tk.entryPriceTicks;
        const effectiveSlTicks =
          isDraggingThis && dragTicketLine.field === 'sl' ? dragTicketLine.currentPriceTicks : tk.slTicks;
        const effectiveTpTicks =
          isDraggingThis && dragTicketLine.field === 'tp' ? dragTicketLine.currentPriceTicks : tk.tpTicks;

        const yEntry = priceToY(effectiveEntryTicks);
        const isBuy = tk.side === 'Buy';
        const mainCol = isBuy ? '#00E676' : '#FF4081';
        const pnlUsd =
          tk.status === 'OPEN'
            ? typeof tk.profitUsd === 'number' && !isDraggingThis
              ? tk.profitUsd
              : computePositionPnlUsd(tk.side, effectiveEntryTicks, liveCloseTicks, tk.lots, instrumentId)
            : 0;

        // Draw Entry Line + TradingView Interactive Pill ([ Ticket | P/L | +TP | +SL | BE | × ])
        if (yEntry >= 0 && yEntry <= chartHeight) {
          ctx.save();
          ctx.strokeStyle = mainCol;
          ctx.lineWidth = isDraggingThis && dragTicketLine.field === 'entry' ? 2.4 : 1.6;
          ctx.setLineDash(tk.status === 'PENDING' ? [6, 4] : [2, 2]);
          ctx.beginPath();
          ctx.moveTo(0, yEntry);
          ctx.lineTo(chartRightX, yEntry);
          ctx.stroke();
          ctx.setLineDash([]);

          const pnlStr =
            tk.status === 'OPEN'
              ? ` | ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)}`
              : ` (${tk.orderType})`;
          const baseText = `${tk.side.toUpperCase()} ${tk.lots.toFixed(2)}L @ ${formatInstrumentPrice(effectiveEntryTicks, instrumentId)}${pnlStr}`;
          ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
          const baseW = ctx.measureText(baseText).width + 12;
          const btnW = 24;
          const closeW = 20;
          const totalW = baseW + btnW * 3 + closeW;
          const th = 19;
          const bx = 14;
          const by = Math.max(26, Math.min(yEntry - th / 2, chartHeight - th - 4));

          // Save hit-test coordinates on ticket object for 1-click [+TP] [+SL] [BE] [×]
          (tk as any)._lastPillBounds = {
            tpDragX: bx + baseW,
            slDragX: bx + baseW + btnW,
            beX: bx + baseW + btnW * 2,
            closeX: bx + baseW + btnW * 3,
            rightX: bx + totalW,
          };

          // Main body
          ctx.fillStyle = '#111622';
          ctx.fillRect(bx, by, totalW, th);
          ctx.strokeStyle = mainCol;
          ctx.lineWidth = 1.4;
          ctx.strokeRect(bx, by, totalW, th);
          ctx.fillStyle = mainCol;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(baseText, bx + 6, by + th / 2);

          // [+TP] pull-out tab
          ctx.fillStyle = 'rgba(8, 153, 129, 0.28)';
          ctx.fillRect(bx + baseW, by + 1, btnW - 1, th - 2);
          ctx.fillStyle = '#34D399';
          ctx.textAlign = 'center';
          ctx.fillText('TP', bx + baseW + btnW / 2, by + th / 2);

          // [+SL] pull-out tab
          ctx.fillStyle = 'rgba(242, 54, 69, 0.28)';
          ctx.fillRect(bx + baseW + btnW, by + 1, btnW - 1, th - 2);
          ctx.fillStyle = '#F87171';
          ctx.fillText('SL', bx + baseW + btnW + btnW / 2, by + th / 2);

          // [BE] Breakeven button
          ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
          ctx.fillRect(bx + baseW + btnW * 2, by + 1, btnW - 1, th - 2);
          ctx.fillStyle = '#38BDF8';
          ctx.fillText('BE', bx + baseW + btnW * 2 + btnW / 2, by + th / 2);

          // [×] Close button
          ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
          ctx.fillRect(bx + baseW + btnW * 3, by + 1, closeW - 1, th - 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText('×', bx + baseW + btnW * 3 + closeW / 2, by + th / 2);

          ctx.restore();
        }

        // Draw Stop Loss Line (Draggable on Chart!)
        if (effectiveSlTicks && effectiveSlTicks > 0) {
          const ySl = priceToY(effectiveSlTicks);
          if (ySl >= 0 && ySl <= chartHeight) {
            const slUsd = computePositionPnlUsd(tk.side, effectiveEntryTicks, effectiveSlTicks, tk.lots, instrumentId);
            const slPipsDiff = formatPriceDiffPips(effectiveSlTicks - effectiveEntryTicks, instrumentId);
            ctx.save();
            ctx.strokeStyle = '#F23645';
            ctx.lineWidth = isDraggingThis && dragTicketLine.field === 'sl' ? 2.4 : 1.4;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, ySl);
            ctx.lineTo(chartRightX, ySl);
            ctx.stroke();
            ctx.setLineDash([]);

            const slText = `↕ SL #${tk.ticket} @ ${formatInstrumentPrice(effectiveSlTicks, instrumentId)} (${slPipsDiff} | ${slUsd >= 0 ? '+' : ''}$${slUsd.toFixed(2)})`;
            ctx.font = 'bold 9px "JetBrains Mono", monospace';
            const tw = ctx.measureText(slText).width + 14;
            ctx.fillStyle = '#F23645';
            ctx.fillRect(14, ySl - 9, tw, 18);
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(slText, 21, ySl);
            ctx.restore();
          }
        }

        // Draw Take Profit Line (Draggable on Chart!)
        if (effectiveTpTicks && effectiveTpTicks > 0) {
          const yTp = priceToY(effectiveTpTicks);
          if (yTp >= 0 && yTp <= chartHeight) {
            const tpUsd = computePositionPnlUsd(tk.side, effectiveEntryTicks, effectiveTpTicks, tk.lots, instrumentId);
            const tpPipsDiff = formatPriceDiffPips(effectiveTpTicks - effectiveEntryTicks, instrumentId);
            ctx.save();
            ctx.strokeStyle = '#089981';
            ctx.lineWidth = isDraggingThis && dragTicketLine.field === 'tp' ? 2.4 : 1.4;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, yTp);
            ctx.lineTo(chartRightX, yTp);
            ctx.stroke();
            ctx.setLineDash([]);

            const tpText = `↕ TP #${tk.ticket} @ ${formatInstrumentPrice(effectiveTpTicks, instrumentId)} (${tpPipsDiff} | ${tpUsd >= 0 ? '+' : ''}$${tpUsd.toFixed(2)})`;
            ctx.font = 'bold 9px "JetBrains Mono", monospace';
            const tw = ctx.measureText(tpText).width + 14;
            ctx.fillStyle = '#089981';
            ctx.fillRect(14, yTp - 9, tw, 18);
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(tpText, 21, yTp);
            ctx.restore();
          }
        }
      });
    }

    // =========================================================================
    // 5. TOP-LEFT DEEPCHART LIVE OHLCV + %V + ΣV + ΔV TELEMETRY HEADER
    // Matches media_1794650904572_a0f8fcfc.jpg & media_1794650941668_c8f4497c.jpg
    // =========================================================================
    let inspectedBar = analyzedBars[analyzedBars.length - 1];
    if (hoverPos && hoverPos.x < chartRightX && hoverPos.y < chartHeight) {
      const hoveredIdx = Math.floor((hoverPos.x - startX) / barPitch);
      if (hoveredIdx >= 0 && hoveredIdx < analyzedBars.length) {
        inspectedBar = analyzedBars[hoveredIdx];
      }
    }

    if (inspectedBar) {
      const o = formatInstrumentPrice(inspectedBar.open_ticks, instrumentId);
      const h = formatInstrumentPrice(inspectedBar.high_ticks, instrumentId);
      const l = formatInstrumentPrice(inspectedBar.low_ticks, instrumentId);
      const c = formatInstrumentPrice(inspectedBar.close_ticks, instrumentId);
      const pctChange =
        inspectedBar.open_ticks > 0
          ? (((inspectedBar.close_ticks - inspectedBar.open_ticks) / inspectedBar.open_ticks) * 100).toFixed(2)
          : '0.00';
      const isUpBar = inspectedBar.close_ticks >= inspectedBar.open_ticks;
      const valCol = isUpBar ? '#00E676' : '#EF4444';

      ctx.save();
      ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      let cursorX = 10;
      const drawMetric = (label: string, val: string, color: string) => {
        ctx.fillStyle = '#94A3B8';
        ctx.fillText(label, cursorX, 14);
        cursorX += ctx.measureText(label).width + 2;
        ctx.fillStyle = color;
        ctx.fillText(val, cursorX, 14);
        cursorX += ctx.measureText(val).width + 10;
      };

      drawMetric('O:', o, valCol);
      drawMetric('H:', h, valCol);
      drawMetric('L:', l, valCol);
      drawMetric('C:', c, valCol);
      drawMetric('%V:', `${isUpBar ? '+' : ''}${pctChange}%`, valCol);
      drawMetric('ΣV:', inspectedBar.stats.totalVolume.toLocaleString(), '#E2E8F0');
      drawMetric(
        'ΔV:',
        `${inspectedBar.stats.delta >= 0 ? '+' : ''}${inspectedBar.stats.delta.toLocaleString()}`,
        inspectedBar.stats.delta >= 0 ? '#00E676' : '#EF4444'
      );

      if (instMeta.venue === 'MT5') {
        const mt5Acct = mt5BridgeService.getAccount();
        const isMarketOpen = mt5Acct.marketOpen !== false;
        const statusText = isMarketOpen
          ? `● MT5 LIVE (#${mt5Acct.login})`
          : `⏸ MT5 ĐÓNG CỬA CUỐI TUẦN (Giá chốt Thứ 6)`;
        const statusCol = isMarketOpen ? '#00E676' : '#F59E0B';
        ctx.fillStyle = statusCol;
        ctx.fillText(statusText, cursorX + 4, 14);
      }
      ctx.restore();
    }

    // Bottom-Left Institutional Watermark
    ctx.save();
    ctx.font = '600 11px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(203, 213, 225, 0.55)';
    ctx.textAlign = 'left';
    ctx.fillText(
      instMeta.venue === 'MT5'
        ? `Deepchart® - MT5 ${instMeta.symbol} (${mt5BridgeService.getAccount().server})`
        : 'Deepchart® - Live Feed',
      10,
      chartHeight - 8
    );
    ctx.restore();

    // End of main chart clipped region
    ctx.restore();

    // =========================================================================
    // 6. IN-CHART DOM TRADING STRIP (Between Chart & Price Axis)
    // Matches Right Side of media_1794650941668_c8f4497c.jpg 100%!
    // =========================================================================
    if (showChartDom && domStripW > 0) {
      const domX = chartRightX;
      const halfDomW = domStripW / 2;

      ctx.save();
      // Left Column: Resting Bids (Dark Emerald Green Strip)
      ctx.fillStyle = '#143328';
      ctx.fillRect(domX, 0, halfDomW, chartHeight);

      // Right Column: Resting Asks (Dark Maroon Red Strip)
      ctx.fillStyle = '#3A181C';
      ctx.fillRect(domX + halfDomW, 0, halfDomW, chartHeight);

      // Borders
      ctx.strokeStyle = '#262932';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(domX, 0);
      ctx.lineTo(domX, chartHeight);
      ctx.moveTo(domX + halfDomW, 0);
      ctx.lineTo(domX + halfDomW, chartHeight);
      ctx.stroke();

      // Render Live L2 OrderBook Resting Quantities Aligned with Chart Y-Coordinates
      if (orderBook) {
        ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';

        orderBook.bids?.slice(0, 25).forEach((b) => {
          const y = priceToY(b.price_ticks);
          if (y > 22 && y < chartHeight - 36) {
            ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
            ctx.fillRect(domX + 1, y - 6, halfDomW - 2, 12);
            ctx.fillStyle = '#6EE7B7';
            ctx.textAlign = 'center';
            const qStr = b.quantity_units >= 1000 ? `${(b.quantity_units / 1000).toFixed(0)}K` : b.quantity_units.toString();
            ctx.fillText(qStr, domX + halfDomW / 2, y);
          }
        });

        orderBook.asks?.slice(0, 25).forEach((a) => {
          const y = priceToY(a.price_ticks);
          if (y > 22 && y < chartHeight - 36) {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
            ctx.fillRect(domX + halfDomW + 1, y - 6, halfDomW - 2, 12);
            ctx.fillStyle = '#FCA5A5';
            ctx.textAlign = 'center';
            const qStr = a.quantity_units >= 1000 ? `${(a.quantity_units / 1000).toFixed(0)}K` : a.quantity_units.toString();
            ctx.fillText(qStr, domX + halfDomW + halfDomW / 2, y);
          }
        });
      }

      // Top P/L Header Box on In-Chart DOM Strip ("D: 0.00 $")
      ctx.fillStyle = '#1E222D';
      ctx.fillRect(domX + 1, 2, domStripW - 2, 16);
      ctx.strokeStyle = '#94A3B8';
      ctx.strokeRect(domX + 1, 2, domStripW - 2, 16);
      ctx.fillStyle = '#E2E8F0';
      ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('D: 0.00 $', domX + domStripW / 2, 10);

      // Bottom CANCEL ALL & FLAT ALL Buttons inside In-Chart DOM Strip
      const btnH = 15;
      const cancelY = chartHeight - btnH * 2 - 4;
      const flatY = chartHeight - btnH - 2;

      ctx.fillStyle = '#1E222D';
      ctx.fillRect(domX + 1, cancelY, domStripW - 2, btnH);
      ctx.strokeStyle = '#F97316';
      ctx.strokeRect(domX + 1, cancelY, domStripW - 2, btnH);
      ctx.fillStyle = '#F8FAFC';
      ctx.font = 'bold 7.5px sans-serif';
      ctx.fillText('CANCEL ALL', domX + domStripW / 2, cancelY + btnH / 2);

      ctx.fillStyle = '#F97316';
      ctx.fillRect(domX + 1, flatY, domStripW - 2, btnH);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 7.5px sans-serif';
      ctx.fillText('FLAT ALL', domX + domStripW / 2, flatY + btnH / 2);

      ctx.restore();
    }

    // =========================================================================
    // 7. SUB-PANEL A: DEEPCHART VOLUME HISTOGRAM (media_1794650904572_a0f8fcfc.jpg)
    // Normalized strictly to activeViewportBars so visible bars fill the panel!
    // =========================================================================
    let currentBottomY = chartHeight;

    if (showVolHistogram && volHistH > 0) {
      const volTop = currentBottomY;
      const volBottom = volTop + volHistH;
      currentBottomY = volBottom;

      ctx.fillStyle = bgCanvas;
      ctx.fillRect(0, volTop, width, volHistH);
      ctx.strokeStyle = '#262932';
      ctx.beginPath();
      ctx.moveTo(0, volTop);
      ctx.lineTo(width, volTop);
      ctx.stroke();

      let maxBarVol = 1;
      activeViewportBars.forEach((b) => {
        if (b.stats.totalVolume > maxBarVol) maxBarVol = b.stats.totalVolume;
      });

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, volTop, chartRightX, volHistH);
      ctx.clip();

      analyzedBars.forEach((b, idx) => {
        const x = startX + idx * barPitch;
        if (x + barWidth < 0 || x > chartRightX) return;

        const isUp = b.close_ticks >= b.open_ticks;
        const hRatio = Math.min(b.stats.totalVolume / maxBarVol, 1.0);
        const bH = Math.max(12, hRatio * (volHistH - 14));
        const bY = volBottom - bH - 1;

        ctx.fillStyle = isUp ? '#00FF33' : isDeepChart ? '#9D00FF' : '#EF4444';
        ctx.fillRect(x + 2, bY, Math.max(barWidth - 4, 4), bH);

        if (barWidth >= 32) {
          const vStr =
            b.stats.totalVolume >= 1000
              ? `${(b.stats.totalVolume / 1000).toFixed(b.stats.totalVolume >= 10000 ? 0 : 1)}K`
              : b.stats.totalVolume.toString();
          ctx.fillStyle = isUp ? '#07090E' : '#FFFFFF';
          ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(vStr, x + barWidth / 2, volBottom - 4);
        }
      });

      // Sub-panel Title & Live Value Header (ATAS Style)
      const latestBarVol = analyzedBars[analyzedBars.length - 1];
      const latestVol = latestBarVol ? latestBarVol.stats.totalVolume : 0;
      ctx.fillStyle = '#F8FAFC';
      ctx.font = 'bold 10px "Inter", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`📊 VOLUME  ·  Live: ${latestVol.toLocaleString()}`, 8, volTop + 13);

      // Close Button "✕" on Right edge of Sub-panel Header
      ctx.fillStyle = '#1E2430';
      ctx.fillRect(chartRightX - 22, volTop + 2, 18, 14);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.strokeRect(chartRightX - 22, volTop + 2, 18, 14);
      ctx.fillStyle = '#94A3B8';
      ctx.font = 'bold 9.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✕', chartRightX - 13, volTop + 12);
      ctx.restore();

      // Right-axis Volume Scale labels (0, Mid, Max) matching media_1794650904572_a0f8fcfc.jpg
      ctx.save();
      ctx.fillStyle = '#CBD5E1';
      ctx.font = '9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      const fmtScale = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}K` : `${Math.round(v)}`);
      ctx.fillText(fmtScale(maxBarVol), width - 8, volTop + 12);
      ctx.fillText(fmtScale(maxBarVol / 2), width - 8, volTop + volHistH / 2 + 3);
      ctx.fillText('0', width - 8, volBottom - 4);
      ctx.restore();
    }

    // =========================================================================
    // 8. SUB-PANEL B: CVD CURVE PANEL (Normalized to Visible Range)
    // =========================================================================
    if (showCvdPanel && cvdPanelH > 0) {
      const cvdTop = currentBottomY;
      const cvdBottom = cvdTop + cvdPanelH;
      currentBottomY = cvdBottom;

      ctx.fillStyle = '#090B10';
      ctx.fillRect(0, cvdTop, width, cvdPanelH);
      ctx.strokeStyle = '#262932';
      ctx.beginPath();
      ctx.moveTo(0, cvdTop);
      ctx.lineTo(width, cvdTop);
      ctx.stroke();

      let minVisCvd = Infinity;
      let maxVisCvd = -Infinity;
      activeViewportBars.forEach((b) => {
        if (b.stats.cvd < minVisCvd) minVisCvd = b.stats.cvd;
        if (b.stats.cvd > maxVisCvd) maxVisCvd = b.stats.cvd;
      });
      if (!isFinite(minVisCvd) || !isFinite(maxVisCvd)) {
        minVisCvd = -100;
        maxVisCvd = 100;
      }
      const cvdSpan = Math.max(maxVisCvd - minVisCvd, 50);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, cvdTop, chartRightX, cvdPanelH);
      ctx.clip();

      const cvdToY = (val: number) => {
        const norm = (val - minVisCvd) / cvdSpan;
        return cvdBottom - 10 - norm * (cvdPanelH - 22);
      };

      const grad = ctx.createLinearGradient(0, cvdTop, 0, cvdBottom);
      grad.addColorStop(0, 'rgba(0, 229, 255, 0.25)');
      grad.addColorStop(1, 'rgba(0, 229, 255, 0.02)');

      ctx.strokeStyle = '#00E5FF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      let firstX = 0;
      let lastX = 0;
      let started = false;
      analyzedBars.forEach((b, idx) => {
        const x = startX + idx * barPitch + barWidth / 2;
        const y = cvdToY(b.stats.cvd);
        if (x >= -50 && x <= chartRightX + 50) {
          if (!started) {
            ctx.moveTo(x, y);
            firstX = x;
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
          lastX = x;
        }
      });
      ctx.stroke();

      if (started) {
        ctx.lineTo(lastX, cvdBottom);
        ctx.lineTo(firstX, cvdBottom);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Sub-panel Title & Live Value Header (ATAS Style)
      const latestCvd = analyzedBars[analyzedBars.length - 1]?.stats.cvd || 0;
      ctx.fillStyle = '#00E5FF';
      ctx.font = 'bold 10px "Inter", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`📈 CVD  ·  Net: ${latestCvd >= 0 ? '+' : ''}${latestCvd.toLocaleString()}`, 8, cvdTop + 13);

      // Close Button "✕" on Right edge of CVD Header
      ctx.fillStyle = '#1E2430';
      ctx.fillRect(chartRightX - 22, cvdTop + 2, 18, 14);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.strokeRect(chartRightX - 22, cvdTop + 2, 18, 14);
      ctx.fillStyle = '#94A3B8';
      ctx.font = 'bold 9.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✕', chartRightX - 13, cvdTop + 12);
      ctx.restore();

      // Right-axis CVD Scale labels
      ctx.save();
      ctx.fillStyle = '#00E5FF';
      ctx.font = '9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      const fmtCvd = (v: number) => {
        const s = v >= 0 ? '+' : '';
        return Math.abs(v) >= 1000 ? `${s}${Math.round(v / 1000)}K` : `${s}${Math.round(v)}`;
      };
      ctx.fillText(fmtCvd(maxVisCvd), width - 8, cvdTop + 12);
      if (minVisCvd <= 0 && maxVisCvd >= 0) {
        ctx.fillText('0', width - 8, cvdToY(0) + 3);
      }
      ctx.fillText(fmtCvd(minVisCvd), width - 8, cvdBottom - 4);
      ctx.restore();
    }

    // =========================================================================
    // 9. SUB-PANEL C: DEEPCHART / ATAS 4-ROW HEAT-SHADED COT & DELTA TABLE
    // Matches Bottom Grid of media_1794650941668_c8f4497c.jpg 100%!
    // Uses OPAQUE high-contrast cells + Jet Black #07090E bold text (Zero Collision!)
    // Rows: COT Bar | Δ Qty. | Δ % | Δ V
    // =========================================================================
    if (showCotGrid && cotTableH > 0) {
      const cotTop = currentBottomY;
      currentBottomY = cotTop + cotTableH;

      let maxVisAbsDelta = 1;
      let maxVisVol = 1;
      activeViewportBars.forEach((b) => {
        const ad = Math.abs(b.stats.delta);
        if (ad > maxVisAbsDelta) maxVisAbsDelta = ad;
        if (b.stats.totalVolume > maxVisVol) maxVisVol = b.stats.totalVolume;
      });

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, cotTop, chartRightX, cotTableH);
      ctx.clip();

      // Opaque high-contrast color steps matching media_1794650941668_c8f4497c.jpg
      const getGreenCellColor = (intensity: number) => {
        if (intensity > 0.7) return '#22C55E'; // Vibrant Emerald
        if (intensity > 0.35) return '#4ADE80'; // Medium Bright Green
        return '#86EFAC'; // Pastel Mint Green
      };

      const getRedCellColor = (intensity: number) => {
        if (intensity > 0.7) return '#EF4444'; // Vibrant Red
        if (intensity > 0.35) return '#F87171'; // Medium Coral Red
        return '#FCA5A5'; // Pastel Salmon Pink
      };

      analyzedBars.forEach((bar, idx) => {
        const x = startX + idx * barPitch;
        if (x + barWidth < -20 || x > chartRightX) return;

        const cellLeft = x - barSpacing / 2;
        const cellW = barPitch;
        const centerX = x + barWidth / 2;
        const delta = bar.stats.delta;
        const cotVal = bar.stats.maxDelta || delta;
        const deltaInt = Math.min(Math.abs(delta) / maxVisAbsDelta, 1.0);
        const cotInt = Math.min(Math.abs(cotVal) / maxVisAbsDelta, 1.0);
        const pctInt = Math.min(Math.abs(bar.stats.deltaPct) / 40, 1.0);

        // Row 0: COT Bar
        const r0Y = cotTop;
        ctx.fillStyle = cotVal >= 0 ? getGreenCellColor(cotInt) : getRedCellColor(cotInt);
        ctx.fillRect(cellLeft, r0Y, cellW, cotRowH);

        // Row 1: Δ Qty. (Total Bar Volume shaded pastel green/pink)
        const r1Y = cotTop + cotRowH;
        ctx.fillStyle = delta >= 0 ? '#A7F3D0' : '#FECACA';
        ctx.fillRect(cellLeft, r1Y, cellW, cotRowH);

        // Row 2: Δ % (Delta Percentage)
        const r2Y = cotTop + cotRowH * 2;
        ctx.fillStyle = delta >= 0 ? getGreenCellColor(pctInt) : getRedCellColor(pctInt);
        ctx.fillRect(cellLeft, r2Y, cellW, cotRowH);

        // Row 3: Δ V (Net Delta Volume)
        const r3Y = cotTop + cotRowH * 3;
        ctx.fillStyle = delta >= 0 ? getGreenCellColor(deltaInt) : getRedCellColor(deltaInt);
        ctx.fillRect(cellLeft, r3Y, cellW, cotRowH);

        // Crisp Cell Borders
        ctx.strokeStyle = '#0B0D12';
        ctx.lineWidth = 1;
        ctx.strokeRect(cellLeft, cotTop, cellW, cotTableH);

        if (barWidth >= 32) {
          const fmtNum = (n: number) => {
            const abs = Math.abs(n);
            const s = n < 0 ? '-' : '';
            if (abs >= 1000) return `${s}${(abs / 1000).toFixed(1)}K`;
            return `${s}${abs}`;
          };

          ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // High-Contrast Jet Black Text (#07090E) on Opaque Pastel/Bright Cells (10:1 Contrast!)
          ctx.fillStyle = '#07090E';
          ctx.fillText(fmtNum(cotVal), centerX, r0Y + cotRowH / 2);
          ctx.fillText(fmtNum(bar.stats.totalVolume), centerX, r1Y + cotRowH / 2);
          ctx.fillText(`${bar.stats.deltaPct}%`, centerX, r2Y + cotRowH / 2);
          ctx.fillText(fmtNum(delta), centerX, r3Y + cotRowH / 2);
        }
      });

      // Horizontal row dividers
      ctx.strokeStyle = '#0B0D12';
      for (let r = 0; r <= 4; r++) {
        ctx.beginPath();
        ctx.moveTo(0, cotTop + r * cotRowH);
        ctx.lineTo(chartRightX, cotTop + r * cotRowH);
        ctx.stroke();
      }
      ctx.restore();

      // Right-Side Row Labels ("COT Bar", "Δ Qty.", "Δ %", "Δ V") matching media_1794650941668_c8f4497c.jpg!
      const cotLabels = ['COT Bar', 'Δ Qty.', 'Δ %', 'Δ V'];
      ctx.fillStyle = bgCanvas;
      ctx.fillRect(chartRightX, cotTop, width - chartRightX, cotTableH);
      ctx.font = 'bold 9px "Inter", sans-serif';
      ctx.fillStyle = '#E2E8F0';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      cotLabels.forEach((lbl, li) => {
        ctx.fillText(lbl, chartRightX + 6, cotTop + li * cotRowH + cotRowH / 2);
      });

      // Close Button "✕" on Right edge of COT header
      ctx.fillStyle = '#1E2430';
      ctx.fillRect(width - 24, cotTop + 2, 18, 14);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.strokeRect(width - 24, cotTop + 2, 18, 14);
      ctx.fillStyle = '#94A3B8';
      ctx.font = 'bold 9.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✕', width - 15, cotTop + 12);
    }

    // =========================================================================
    // 10. BOTTOM TIME AXIS BAR (15:05  15:10  15:15  15:20...)
    // =========================================================================
    const timeTop = height - timeAxisH;
    ctx.fillStyle = bgCanvas;
    ctx.fillRect(0, timeTop, width, timeAxisH);
    ctx.strokeStyle = '#262932';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, timeTop);
    ctx.lineTo(width, timeTop);
    ctx.stroke();

    ctx.font = '600 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#CBD5E1';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const timeLabelStep = Math.max(1, Math.ceil(55 / barPitch));
    analyzedBars.forEach((bar, idx) => {
      const centerX = startX + idx * barPitch + barWidth / 2;
      if (centerX >= 25 && centerX <= chartRightX - 15) {
        if (idx % timeLabelStep === 0) {
          const date = new Date(bar.bar_start_us / 1000);
          const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
          ctx.fillText(timeStr, centerX, timeTop + timeAxisH / 2);
        }
      }
    });

    // =========================================================================
    // 11. INTERACTIVE RIGHT PRICE SCALE & LIVE PRICE BADGE (5-Dec Forex & 2-Dec Crypto)
    // =========================================================================
    ctx.save();
    ctx.fillStyle = isPriceScaleHovered || dragMode === 'priceScale' ? '#161A24' : bgCanvas;
    ctx.fillRect(axisX, 0, axisW, chartHeight);

    ctx.strokeStyle = dragMode === 'priceScale' ? '#00E676' : '#262932';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX, 0);
    ctx.lineTo(axisX, chartHeight);
    ctx.stroke();

    const priceTickCount = 8;
    for (let i = 0; i <= priceTickCount; i++) {
      const y = (chartHeight / priceTickCount) * i;
      const priceVal = yToPrice(y);

      ctx.fillStyle = '#E2E8F0';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatInstrumentPrice(priceVal, instrumentId), width - 5, y);
    }

    // Draw Colored Price Pills on Right Y-Axis for Horizontal Lines & Rays (TradingView Standard)
    if (drawingsVisible && drawings.length > 0) {
      drawings.forEach((d) => {
        if ((d.type === 'horizontal_line' || d.type === 'horizontal_ray') && d.points.length > 0) {
          const py = priceToY(d.points[0].price_ticks);
          if (py >= 8 && py <= chartHeight - 8) {
            ctx.fillStyle = d.color || '#00E5FF';
            ctx.fillRect(axisX + 1, py - 8, axisW - 2, 16);
            ctx.fillStyle = '#090B10';
            ctx.font = 'bold 9px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(formatInstrumentPrice(d.points[0].price_ticks, instrumentId), axisX + axisW / 2, py);
          }
        }
      });
    }
    ctx.restore();

    // Live Price Dashed Line & Right Price Pill
    const currentPriceTicks = activeBar
      ? activeBar.close_ticks
      : allBars.length > 0
      ? allBars[allBars.length - 1].close_ticks
      : null;

    if (currentPriceTicks !== null) {
      const curY = priceToY(currentPriceTicks);
      const isBull = activeBar ? activeBar.close_ticks >= activeBar.open_ticks : true;
      const lineBadgeColor = isBull ? '#00E676' : '#EF4444';

      if (curY >= 0 && curY <= chartHeight) {
        ctx.save();
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1.1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, curY);
        ctx.lineTo(axisX, curY);
        ctx.stroke();
        ctx.setLineDash([]);

        const priceStr = formatInstrumentPrice(currentPriceTicks, instrumentId);
        const badgeH = 18;
        ctx.fillStyle = lineBadgeColor;
        ctx.fillRect(axisX + 1, curY - badgeH / 2, axisW - 2, badgeH);
        ctx.fillStyle = isBull ? '#0B0D12' : '#FFFFFF';
        ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(priceStr, axisX + axisW / 2, curY);
        ctx.restore();
      }
    }

    // =========================================================================
    // 12. INTERACTIVE CROSSHAIR, "+" QUICK-ORDER BUTTON & MULTI-CHART SYNC
    // =========================================================================
    if (hoverPos && hoverPos.x < axisX + 22 && hoverPos.y < chartHeight) {
      ctx.save();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      ctx.moveTo(0, hoverPos.y);
      ctx.lineTo(axisX, hoverPos.y);
      ctx.stroke();

      if (hoverPos.x < chartRightX) {
        ctx.beginPath();
        ctx.moveTo(hoverPos.x, 0);
        ctx.lineTo(hoverPos.x, height - timeAxisH);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      const hoverPrice = yToPrice(hoverPos.y);
      const hoverPriceStr = formatInstrumentPrice(hoverPrice, instrumentId);

      // TradingView "[+]" Quick-Order Button on the left edge of the Y-Axis!
      ctx.fillStyle = '#089981';
      ctx.fillRect(axisX + 1, hoverPos.y - 9, 15, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', axisX + 8.5, hoverPos.y);

      // Crosshair Price Pill
      ctx.fillStyle = '#2D323E';
      ctx.fillRect(axisX + 16, hoverPos.y - 9, axisW - 17, 18);
      ctx.strokeStyle = '#94A3B8';
      ctx.strokeRect(axisX + 1, hoverPos.y - 9, axisW - 2, 18);
      ctx.fillStyle = '#F8FAFC';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hoverPriceStr, axisX + 16 + (axisW - 17) / 2, hoverPos.y);
      ctx.restore();
    } else if (
      syncedCrosshair &&
      syncedCrosshair.sourcePaneId !== paneId &&
      syncedCrosshair.priceTicks !== null
    ) {
      const syncY = priceToY(syncedCrosshair.priceTicks);
      if (syncY >= 0 && syncY <= chartHeight) {
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(0, syncY);
        ctx.lineTo(axisX, syncY);
        ctx.stroke();

        if (syncedCrosshair.timestampUs !== null) {
          const syncX = timeToX(syncedCrosshair.timestampUs);
          if (syncX >= 0 && syncX <= chartRightX) {
            ctx.beginPath();
            ctx.moveTo(syncX, 0);
            ctx.lineTo(syncX, height - timeAxisH);
            ctx.stroke();
          }
        }
        ctx.setLineDash([]);

        const syncPriceStr = formatInstrumentPrice(syncedCrosshair.priceTicks, instrumentId);
        ctx.fillStyle = '#0284C7';
        ctx.fillRect(axisX + 1, syncY - 9, axisW - 2, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(syncPriceStr, axisX + axisW / 2, syncY);
        ctx.restore();
      }
    }
  }, [
    allBars,
    zoom,
    panX,
    panY,
    priceScale,
    dragMode,
    isPriceScaleHovered,
    hoverPos,
    syncedCrosshair,
    paneId,
    colorTheme,
    showOfVp,
    showOfBa,
    showOfDeltaP,
    showVolumeProfile,
    showDeltaProfileSession,
    showValueAreaLines,
    showVwap,
    showNakedPoc,
    showVolHistogram,
    showCvdPanel,
    showCotGrid,
    showBarHeadStats,
    showChartDom,
    showSlClusters,
    showAbsorption,
    showSignals,
    showBubbles,
    showHeatmap,
    showOptions,
    showIcebergs,
    showPriorDayLevels,
    showStackedImbalances,
    tickAggregation,
    showHeatmap ? heatmapSlices : null,
    showChartDom || showAbsorption ? orderBook : null,
    showOptions ? optionsSummary : null,
    showOptions ? liveOptionsChain : null,
    vwap,
    divergences,
    volumeProfile,
    showIcebergs ? icebergs : null,
    footprintMode,
    heatmapPalette,
    whaleVolumeThreshold,
    drawings,
    activeDrawingTool,
    drawingColor,
    drawingsVisible,
    drawingDraft,
    brushDraft,
    shiftMeasureDraft,
    snappedPoint,
    selectedDrawingId,
    hoveredDrawingId,
    dragTicketLine,
    mt5Tickets,
    instrumentId,
  ]);

  const [templateIdx, setTemplateIdx] = useState<number>(0);
  const applyPresetTemplate = () => {
    const next = (templateIdx + 1) % 4;
    setTemplateIdx(next);
    if (next === 0) {
      // DeepChart Classic: OF-VP + OF-B/A + D-VP + COT/Δ
      setShowOfVp(true);
      setShowOfBa(true);
      setShowOfDeltaP(false);
      setShowVolumeProfile(true);
      setShowValueAreaLines(true);
      setShowCotGrid(true);
      setShowVolHistogram(false);
      setShowCvdPanel(false);
      setShowBubbles(false);
      setShowHeatmap(false);
    } else if (next === 1) {
      // DeepChart Volume Profile: OF-VP + OF-B/A + D-VP + Volume Histogram
      setShowOfVp(true);
      setShowOfBa(true);
      setShowOfDeltaP(false);
      setShowVolumeProfile(true);
      setShowVolHistogram(true);
      setShowCvdPanel(false);
      setShowCotGrid(false);
      setShowBubbles(false);
      setShowHeatmap(false);
    } else if (next === 2) {
      // ATAS Delta Profile: OF-ΔP + OF-B/A + CVD
      setShowOfVp(false);
      setShowOfBa(true);
      setShowOfDeltaP(true);
      setShowVolumeProfile(true);
      setShowCvdPanel(true);
      setShowVolHistogram(true);
      setShowCotGrid(false);
      setShowBubbles(false);
      setShowHeatmap(false);
    } else {
      // Clean Candlestick + Session Volume Profile + VWAP
      setShowOfVp(false);
      setShowOfBa(false);
      setShowOfDeltaP(false);
      setShowVolumeProfile(true);
      setShowValueAreaLines(true);
      setShowVwap(true);
      setShowVolHistogram(true);
      setShowCvdPanel(false);
      setShowCotGrid(false);
    }
    handleFitContent();
  };

  const radioPill = (label: string, active: boolean, onClick: () => void, title: string) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        background: 'transparent',
        color: active ? '#E2E8F0' : '#8E9BAE',
        border: 'none',
        padding: '2px 6px',
        fontSize: '10.5px',
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        whiteSpace: 'nowrap',
      }}
      title={title}
    >
      <span
        style={{
          width: '9px',
          height: '9px',
          borderRadius: '50%',
          border: `1.5px solid ${active ? '#22C55E' : '#64748B'}`,
          background: active ? '#22C55E' : 'transparent',
          display: 'inline-block',
        }}
      />
      <span>{label}</span>
    </button>
  );

  const pipStep = instMeta.pipTicks || instMeta.tickSize * 2;
  const bestBidTicks = orderBook?.bids?.[0]?.price_ticks || (refPrice - instMeta.tickSize);
  const bestAskTicks = orderBook?.asks?.[0]?.price_ticks || (refPrice + instMeta.tickSize);

  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#0D0F14',
        overflow: 'hidden',
      }}
    >
      {/* Main Chart Canvas Viewport */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          width: '100%',
          position: 'relative',
          cursor: cursorStyle,
          overflow: 'hidden',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

        {/* =====================================================================
            ON-CHART ONE-CLICK TRADING WIDGET (Top-Left, MT5 Alt+T & TradingView Standard)
            ===================================================================== */}
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '24px',
            left: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            zIndex: 16,
            userSelect: 'none',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          <button
            onClick={() => setShowOneClickBar((p) => !p)}
            style={{
              background: '#1A1E29',
              color: '#94A3B8',
              border: '1px solid #2E3444',
              borderRadius: '4px',
              padding: '3px 5px',
              fontSize: '9.5px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
            title="Ẩn/Hiện Thanh Vào Lệnh Nhanh 1-Click (Giống MT5 Alt+T & TradingView)"
          >
            {showOneClickBar ? '▾' : '▸ 1-Click'}
          </button>

          {showOneClickBar && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'rgba(19, 23, 34, 0.92)',
                border: '1px solid #2A3040',
                borderRadius: '5px',
                padding: '2px',
                gap: '2px',
                boxShadow: '0 4px 14px rgba(0,0,0,0.55)',
              }}
            >
              {/* SELL MARKET BUTTON */}
              <button
                onClick={() => {
                  mt5BridgeService.placeOrder({
                    instrumentId,
                    side: 'Sell',
                    orderType: 'MARKET',
                    lots: oneClickLots,
                    entryPriceTicks: bestBidTicks,
                    slTicks: bestBidTicks + 20 * pipStep,
                    tpTicks: bestBidTicks - 40 * pipStep,
                    comment: 'Chart-1Click-Sell',
                  });
                }}
                style={{
                  background: '#F23645',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '3px 8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                title="One-Click SELL Market (Kèm SL 20p / TP 40p)"
              >
                <span style={{ fontSize: '9px', fontWeight: 800, opacity: 0.9 }}>SELL</span>
                <span style={{ fontSize: '10.5px', fontWeight: 900, fontFamily: '"JetBrains Mono", monospace' }}>
                  {formatInstrumentPrice(bestBidTicks, instrumentId)}
                </span>
              </button>

              {/* LOT STEPPER */}
              <div style={{ display: 'flex', alignItems: 'center', background: '#11141C', borderRadius: '3px', padding: '0 2px' }}>
                <button
                  onClick={() => setOneClickLots((l) => Math.max(0.01, Number((l - 0.1).toFixed(2))))}
                  style={{
                    background: 'transparent',
                    color: '#94A3B8',
                    border: 'none',
                    padding: '2px 4px',
                    fontSize: '10px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  −
                </button>
                <input
                  type="number"
                  step={0.01}
                  min={0.01}
                  max={100}
                  value={oneClickLots}
                  onChange={(e) => setOneClickLots(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                  style={{
                    width: '42px',
                    background: 'transparent',
                    border: 'none',
                    color: '#F8FAFC',
                    textAlign: 'center',
                    fontSize: '10.5px',
                    fontWeight: 800,
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => setOneClickLots((l) => Number((l + 0.1).toFixed(2)))}
                  style={{
                    background: 'transparent',
                    color: '#94A3B8',
                    border: 'none',
                    padding: '2px 4px',
                    fontSize: '10px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  +
                </button>
              </div>

              {/* BUY MARKET BUTTON */}
              <button
                onClick={() => {
                  mt5BridgeService.placeOrder({
                    instrumentId,
                    side: 'Buy',
                    orderType: 'MARKET',
                    lots: oneClickLots,
                    entryPriceTicks: bestAskTicks,
                    slTicks: bestAskTicks - 20 * pipStep,
                    tpTicks: bestAskTicks + 40 * pipStep,
                    comment: 'Chart-1Click-Buy',
                  });
                }}
                style={{
                  background: '#089981',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '3px 8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                title="One-Click BUY Market (Kèm SL 20p / TP 40p)"
              >
                <span style={{ fontSize: '9px', fontWeight: 800, opacity: 0.9 }}>BUY</span>
                <span style={{ fontSize: '10.5px', fontWeight: 900, fontFamily: '"JetBrains Mono", monospace' }}>
                  {formatInstrumentPrice(bestAskTicks, instrumentId)}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* =====================================================================
            TRADINGVIEW RIGHT-CLICK & "[+]" AXIS QUICK ORDER / DRAWING MENU
            ===================================================================== */}
        {contextMenu && (() => {
          const pTicks = contextMenu.priceTicks;
          const pStr = formatInstrumentPrice(pTicks, instrumentId);
          const isAbove = pTicks > refPrice;
          const helpers = getCoordinateHelpers();
          const barInt = helpers?.barInterval || 60000000;

          const menuBtnStyle: React.CSSProperties = {
            width: '100%',
            background: 'transparent',
            color: '#E2E8F0',
            border: 'none',
            borderRadius: '4px',
            padding: '5px 8px',
            fontSize: '10.5px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            textAlign: 'left',
          };

          return (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                left: `${Math.min(contextMenu.x, (containerRef.current?.clientWidth || 800) - 245)}px`,
                top: `${Math.min(contextMenu.y, (containerRef.current?.clientHeight || 500) - 230)}px`,
                width: '235px',
                background: '#161A25',
                border: '1px solid #32394A',
                borderRadius: '6px',
                padding: '5px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                zIndex: 35,
                boxShadow: '0 10px 30px rgba(0,0,0,0.85)',
                fontFamily: "'Inter', sans-serif",
              }}
            >
              <div
                style={{
                  padding: '3px 7px',
                  fontSize: '9.5px',
                  fontWeight: 800,
                  color: '#94A3B8',
                  borderBottom: '1px solid #262B38',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>MỨC GIÁ ĐÃ CHỌN</span>
                <span style={{ color: '#00E5FF', fontFamily: 'monospace' }}>@{pStr}</span>
              </div>

              {isAbove ? (
                <>
                  <button
                    onClick={() => {
                      mt5BridgeService.placeOrder({
                        instrumentId,
                        side: 'Sell',
                        orderType: 'LIMIT',
                        lots: oneClickLots,
                        entryPriceTicks: pTicks,
                        slTicks: pTicks + 20 * pipStep,
                        tpTicks: pTicks - 40 * pipStep,
                        comment: 'TV-Menu-SellLimit',
                      });
                      setContextMenu(null);
                    }}
                    style={{ ...menuBtnStyle, color: '#FCA5A5' }}
                  >
                    <span>🔴 Đặt Sell Limit {oneClickLots}L</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '9.5px' }}>@{pStr}</span>
                  </button>
                  <button
                    onClick={() => {
                      mt5BridgeService.placeOrder({
                        instrumentId,
                        side: 'Buy',
                        orderType: 'STOP',
                        lots: oneClickLots,
                        entryPriceTicks: pTicks,
                        slTicks: pTicks - 20 * pipStep,
                        tpTicks: pTicks + 40 * pipStep,
                        comment: 'TV-Menu-BuyStop',
                      });
                      setContextMenu(null);
                    }}
                    style={{ ...menuBtnStyle, color: '#6EE7B7' }}
                  >
                    <span>🟢 Đặt Buy Stop {oneClickLots}L</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '9.5px' }}>@{pStr}</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      mt5BridgeService.placeOrder({
                        instrumentId,
                        side: 'Buy',
                        orderType: 'LIMIT',
                        lots: oneClickLots,
                        entryPriceTicks: pTicks,
                        slTicks: pTicks - 20 * pipStep,
                        tpTicks: pTicks + 40 * pipStep,
                        comment: 'TV-Menu-BuyLimit',
                      });
                      setContextMenu(null);
                    }}
                    style={{ ...menuBtnStyle, color: '#6EE7B7' }}
                  >
                    <span>🟢 Đặt Buy Limit {oneClickLots}L</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '9.5px' }}>@{pStr}</span>
                  </button>
                  <button
                    onClick={() => {
                      mt5BridgeService.placeOrder({
                        instrumentId,
                        side: 'Sell',
                        orderType: 'STOP',
                        lots: oneClickLots,
                        entryPriceTicks: pTicks,
                        slTicks: pTicks + 20 * pipStep,
                        tpTicks: pTicks - 40 * pipStep,
                        comment: 'TV-Menu-SellStop',
                      });
                      setContextMenu(null);
                    }}
                    style={{ ...menuBtnStyle, color: '#FCA5A5' }}
                  >
                    <span>🔴 Đặt Sell Stop {oneClickLots}L</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '9.5px' }}>@{pStr}</span>
                  </button>
                </>
              )}

              <div style={{ height: '1px', background: '#262B38', margin: '2px 0' }} />

              <button
                onClick={() => {
                  const d = buildPositionDrawing(
                    'long_position',
                    { time_us: contextMenu.timeUs, price_ticks: pTicks },
                    { time_us: contextMenu.timeUs + barInt * 8, price_ticks: pTicks },
                    barInt
                  );
                  onDrawingCreated?.(d);
                  setSelectedDrawingId(d.id);
                  setContextMenu(null);
                }}
                style={menuBtnStyle}
              >
                <span>📈 Đặt Khung Mua Long R:R (B$)</span>
                <span style={{ color: '#00E676', fontSize: '9.5px' }}>1:2 R</span>
              </button>

              <button
                onClick={() => {
                  const d = buildPositionDrawing(
                    'short_position',
                    { time_us: contextMenu.timeUs, price_ticks: pTicks },
                    { time_us: contextMenu.timeUs + barInt * 8, price_ticks: pTicks },
                    barInt
                  );
                  onDrawingCreated?.(d);
                  setSelectedDrawingId(d.id);
                  setContextMenu(null);
                }}
                style={menuBtnStyle}
              >
                <span>📉 Đặt Khung Bán Short R:R (S$)</span>
                <span style={{ color: '#FF4081', fontSize: '9.5px' }}>1:2 R</span>
              </button>

              <button
                onClick={() => {
                  const d: ChartDrawing = {
                    id: `draw-${Date.now()}`,
                    type: 'horizontal_line',
                    instrument_id: instrumentId,
                    points: [{ time_us: contextMenu.timeUs, price_ticks: pTicks }],
                    color: '#FFD600',
                    lineWidth: 1.8,
                  };
                  onDrawingCreated?.(d);
                  setSelectedDrawingId(d.id);
                  setContextMenu(null);
                }}
                style={menuBtnStyle}
              >
                <span>━ Kẻ Đường Ngang (Alt+H)</span>
                <span style={{ color: '#FFD600', fontFamily: 'monospace', fontSize: '9.5px' }}>@{pStr}</span>
              </button>
            </div>
          );
        })()}

        {/* =====================================================================
            TRADINGVIEW FLOATING ACTION TOOLBAR FOR SELECTED DRAWING
            Supports Color, Line Style, Extend Right, SMC Tags, R:R Presets,
            Market & Limit/Stop MT5 Execution, Lock, Clone & Delete!
            ===================================================================== */}
        {selectedDrawingId && drawings.some((d) => d.id === selectedDrawingId) && (() => {
          const sel = drawings.find((d) => d.id === selectedDrawingId)!;
          const isPos = sel.type === 'long_position' || sel.type === 'short_position';
          const isLong = sel.type === 'long_position';
          const lots = sel.lotSize || 1.0;

          return (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: '54px',
                left: '12px',
                background: 'rgba(19, 23, 34, 0.97)',
                border: `1px solid ${isPos ? (isLong ? '#089981' : '#F23645') : '#38BDF8'}`,
                borderRadius: '6px',
                padding: '5px 8px',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '6px',
                zIndex: 25,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.8)',
                fontFamily: 'Inter, sans-serif',
                maxWidth: 'calc(100% - 110px)',
              }}
            >
              {/* Tool Title Badge */}
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  color: isPos ? (isLong ? '#00E676' : '#FF4081') : '#38BDF8',
                  paddingRight: '5px',
                  borderRight: '1px solid #2A3244',
                }}
              >
                {sel.type === 'long_position'
                  ? '📈 LONG R:R'
                  : sel.type === 'short_position'
                  ? '📉 SHORT R:R'
                  : sel.type === 'imbalance_box'
                  ? '▭ ORDER BLOCK'
                  : sel.type === 'horizontal_line'
                  ? '━ HORIZ LINE'
                  : sel.type === 'price_range'
                  ? '📏 RULER'
                  : sel.type.toUpperCase()}
              </span>

              {/* Quick Color Swatches for Non-R:R Drawings */}
              {!isPos && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', paddingRight: '5px', borderRight: '1px solid #2A3244' }}>
                  {['#00E676', '#00E5FF', '#FFD600', '#FF4081', '#A855F7', '#F97316', '#FFFFFF'].map((c) => (
                    <button
                      key={c}
                      onClick={() =>
                        onDrawingUpdated?.({
                          ...sel,
                          color: c,
                          fillColor: sel.type === 'imbalance_box' ? `${c}28` : sel.fillColor,
                        })
                      }
                      style={{
                        width: '13px',
                        height: '13px',
                        borderRadius: '3px',
                        background: c,
                        border: sel.color === c ? '2px solid #FFFFFF' : '1px solid #262B38',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                      title="Đổi màu hình vẽ"
                    />
                  ))}
                </div>
              )}

              {/* Line Style & Extend Right Toggle */}
              {['imbalance_box', 'trendline', 'arrow', 'horizontal_line', 'horizontal_ray', 'fibonacci'].includes(sel.type) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', paddingRight: '5px', borderRight: '1px solid #2A3244' }}>
                  <button
                    onClick={() =>
                      onDrawingUpdated?.({
                        ...sel,
                        lineStyle: sel.lineStyle === 'dashed' ? 'solid' : 'dashed',
                      })
                    }
                    style={{
                      background: sel.lineStyle === 'dashed' ? '#2A3449' : '#1B202C',
                      color: '#CBD5E1',
                      border: '1px solid #32394A',
                      borderRadius: '3px',
                      padding: '2px 5px',
                      fontSize: '9.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                    title="Đổi Nét liền ⇄ Nét đứt"
                  >
                    {sel.lineStyle === 'dashed' ? '┄ Đứt' : '━ Liền'}
                  </button>

                  {['imbalance_box', 'fibonacci'].includes(sel.type) && (
                    <button
                      onClick={() => onDrawingUpdated?.({ ...sel, extendRight: !sel.extendRight })}
                      style={{
                        background: sel.extendRight ? 'rgba(0, 229, 255, 0.2)' : '#1B202C',
                        color: sel.extendRight ? '#00E5FF' : '#94A3B8',
                        border: sel.extendRight ? '1px solid #00E5FF' : '1px solid #32394A',
                        borderRadius: '3px',
                        padding: '2px 6px',
                        fontSize: '9.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                      title="Kéo dài vùng Order Block / Fibonacci sang phải (Extend Right)"
                    >
                      → Kéo dài phải
                    </button>
                  )}
                </div>
              )}

              {/* Quick SMC / ICT Label Presets for Boxes, Lines, Arrows & Text */}
              {['imbalance_box', 'horizontal_line', 'horizontal_ray', 'trendline', 'arrow', 'text_note'].includes(sel.type) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', paddingRight: '5px', borderRight: '1px solid #2A3244' }}>
                  {['OB', 'FVG', 'BOS', 'CHoCH', 'BSL $$$', 'SSL $$$'].map((tag) => (
                    <button
                      key={tag}
                      onClick={() => onDrawingUpdated?.({ ...sel, text: tag })}
                      style={{
                        background: sel.text === tag ? '#2A3449' : 'transparent',
                        color: sel.text === tag ? '#00E5FF' : '#94A3B8',
                        border: '1px solid #262B38',
                        borderRadius: '3px',
                        padding: '1px 5px',
                        fontSize: '9px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                      title={`Gắn nhãn cấu trúc ${tag}`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}

              {/* Long / Short R:R Position Controls: Lot Presets, R:R Multiplier & Direct MT5 Market + Limit/Stop Execution */}
              {isPos && sel.points.length >= 3 && (
                <>
                  {/* Lot Presets */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    {[0.01, 0.1, 0.5, 1.0, 2.0].map((lVal) => (
                      <button
                        key={lVal}
                        onClick={() => onDrawingUpdated?.({ ...sel, lotSize: lVal })}
                        style={{
                          background: lots === lVal ? '#2A3449' : 'transparent',
                          color: lots === lVal ? '#00E5FF' : '#94A3B8',
                          border: lots === lVal ? '1px solid #00E5FF' : '1px solid #262B38',
                          borderRadius: '3px',
                          padding: '2px 5px',
                          fontSize: '9.5px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {lVal}L
                      </button>
                    ))}
                  </div>

                  {/* Quick R:R Target Ratio Presets (1:1, 1:2, 1:3, 1:5) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px', paddingLeft: '4px', borderLeft: '1px solid #2A3244' }}>
                    {[1, 2, 3, 5].map((rr) => (
                      <button
                        key={rr}
                        onClick={() => {
                          const entryP = sel.points[0].price_ticks;
                          const slP = sel.points[2].price_ticks;
                          const riskDist = Math.max(instMeta.tickSize * 4, Math.abs(entryP - slP));
                          const newTp = isLong ? entryP + riskDist * rr : entryP - riskDist * rr;
                          const nextPts = sel.points.map((p, i) => (i === 1 ? { ...p, price_ticks: newTp } : p));
                          onDrawingUpdated?.({ ...sel, points: nextPts });
                        }}
                        style={{
                          background: '#1E2432',
                          color: '#34D399',
                          border: '1px solid #2A3449',
                          borderRadius: '3px',
                          padding: '2px 5px',
                          fontSize: '9px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                        title={`Tự động căn Chốt lời (TP) gấp ${rr} lần Cắt lỗ (SL)`}
                      >
                        1:{rr}R
                      </button>
                    ))}
                  </div>

                  {/* 1. Execute MARKET Order with this R:R Box's SL & TP */}
                  <button
                    onClick={() => {
                      const tpTicks = sel.points[1].price_ticks;
                      const slTicks = sel.points[2].price_ticks;
                      mt5BridgeService.placeOrder({
                        instrumentId,
                        side: isLong ? 'Buy' : 'Sell',
                        orderType: 'MARKET',
                        lots,
                        entryPriceTicks: isLong ? bestAskTicks : bestBidTicks,
                        slTicks,
                        tpTicks,
                        comment: `TV-${isLong ? 'LONG' : 'SHORT'}-MKT`,
                      });
                    }}
                    style={{
                      background: isLong ? '#089981' : '#F23645',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 8px',
                      fontSize: '9.5px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                    title="Khớp lệnh Thị trường (Market) ngay lập tức kèm SL & TP của khung vẽ này"
                  >
                    ⚡ Vào Market ({lots}L)
                  </button>

                  {/* 2. Place Pending LIMIT / STOP Order at the Box's Exact Entry Line! */}
                  <button
                    onClick={() => {
                      const entryTicks = sel.points[0].price_ticks;
                      const tpTicks = sel.points[1].price_ticks;
                      const slTicks = sel.points[2].price_ticks;
                      const pendingType: 'LIMIT' | 'STOP' = isLong
                        ? entryTicks <= refPrice
                          ? 'LIMIT'
                          : 'STOP'
                        : entryTicks >= refPrice
                        ? 'LIMIT'
                        : 'STOP';
                      mt5BridgeService.placeOrder({
                        instrumentId,
                        side: isLong ? 'Buy' : 'Sell',
                        orderType: pendingType,
                        lots,
                        entryPriceTicks: entryTicks,
                        slTicks,
                        tpTicks,
                        comment: `TV-${isLong ? 'BUY' : 'SELL'}-${pendingType}`,
                      });
                    }}
                    style={{
                      background: '#1E293B',
                      color: '#38BDF8',
                      border: '1px solid #0284C7',
                      borderRadius: '4px',
                      padding: '3px 8px',
                      fontSize: '9.5px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                    title="Đặt Lệnh Chờ (Limit / Stop) tại đúng vạch Entry + SL + TP của khung vẽ này"
                  >
                    ⏳ Đặt {isLong ? (sel.points[0].price_ticks <= refPrice ? 'Buy Limit' : 'Buy Stop') : (sel.points[0].price_ticks >= refPrice ? 'Sell Limit' : 'Sell Stop')} @ Entry
                  </button>
                </>
              )}

              {/* Lock Position Toggle */}
              <button
                onClick={() => onDrawingUpdated?.({ ...sel, isLocked: !sel.isLocked })}
                style={{
                  background: sel.isLocked ? 'rgba(245, 158, 11, 0.2)' : '#1E2534',
                  color: sel.isLocked ? '#FBBF24' : '#94A3B8',
                  border: '1px solid #32394A',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '9.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Khóa / Mở khóa vị trí hình vẽ (Không sợ kéo nhầm)"
              >
                {sel.isLocked ? '🔒 Đã khóa' : '🔓 Khóa'}
              </button>

              {/* Clone Drawing Button */}
              <button
                onClick={() => {
                  const helpers = getCoordinateHelpers();
                  const shiftT = (helpers?.barInterval || 60000000) * 2;
                  const shiftP = instMeta.tickSize * 6;
                  const cloned: ChartDrawing = {
                    ...sel,
                    id: `draw-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                    isLocked: false,
                    points: sel.points.map((pt) => ({
                      time_us: pt.time_us + shiftT,
                      price_ticks: pt.price_ticks + shiftP,
                    })),
                  };
                  onDrawingCreated?.(cloned);
                  setSelectedDrawingId(cloned.id);
                }}
                style={{
                  background: '#1E2534',
                  color: '#CBD5E1',
                  border: '1px solid #32394A',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '9.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Nhân bản hình vẽ này (Clone)"
              >
                ❐ Nhân bản
              </button>

              {/* Delete Drawing Button */}
              <button
                onClick={() => {
                  onDrawingDeleted?.(sel.id);
                  setSelectedDrawingId(null);
                }}
                style={{
                  background: '#2C1A21',
                  color: '#FCA5A5',
                  border: '1px solid #4C2330',
                  borderRadius: '4px',
                  padding: '2px 7px',
                  fontSize: '9.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Xóa hình vẽ đang chọn (Phím Delete)"
              >
                🗑 Xóa
              </button>
            </div>
          );
        })()}

        {/* Jump-to-Live Button when panned away */}
        {(Math.abs(panX) > 40 || Math.abs(panY) > 40 || priceScale !== 1.0) && (
          <button
            onClick={() => {
              setPanX(0);
              setPanY(0);
              setPriceScale(1.0);
            }}
            style={{
              position: 'absolute',
              bottom: '95px',
              right: '140px',
              background: 'rgba(22, 24, 29, 0.95)',
              border: '1px solid #00E676',
              borderRadius: '4px',
              color: '#00E676',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              zIndex: 10,
            }}
          >
            ❯| Live Candle
          </button>
        )}
      </div>

      {/* =====================================================================
          AUTHENTIC DEEPCHART BOTTOM INDICATORS TOOLBAR DOCK
          100% Match to media_1794650950575_011ab3f4.jpg & media_1794650941668_c8f4497c.jpg
          ===================================================================== */}
      {!hideBottomToolbar && (
        <div
          style={{
            height: '28px',
            minHeight: '28px',
            background: '#16181D',
            borderTop: '1px solid #262932',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 10px',
            gap: '8px',
            userSelect: 'none',
            zIndex: 15,
          }}
        >
          {/* Left: Templates Button + DeepChart Indicator Radio/Checkbox Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflowX: 'auto' }}>
            <button
              onClick={applyPresetTemplate}
              style={{
                background: '#4ADE80',
                color: '#0B0D12',
                border: 'none',
                borderRadius: '3px',
                padding: '2px 6px',
                fontSize: '10px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginRight: '2px',
              }}
              title="Chuyển đổi nhanh bộ mẫu hiển thị chuẩn DeepCharts / ATAS & Auto-Fit"
            >
              <span>▤</span>
              <span>Templates</span>
            </button>

            {/* ATAS Indicators Manager Dialog Button (Ctrl + I) */}
            <button
              onClick={() => setIsIndicatorsModalOpen(true)}
              style={{
                background: '#1E293B',
                color: '#38BDF8',
                border: '1px solid #38BDF8',
                borderRadius: '3px',
                padding: '2px 7px',
                fontSize: '10px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginRight: '4px',
              }}
              title="Mở Thư Viện Quản Lý Chỉ Báo Định Lượng & Order Flow (Ctrl + I)"
            >
              <span>📈</span>
              <span>Chỉ Báo (Ctrl+I)</span>
            </button>

            {radioPill(
              'OF-VP',
              showOfVp,
              () => {
                const next = !showOfVp;
                setShowOfVp(next);
                if (next) setShowOfDeltaP(false);
              },
              'Order Flow Volume Profile Histogram per Bar (Tím/Xanh 2 nửa)'
            )}
            {radioPill('OF-B/A', showOfBa, () => setShowOfBa(!showOfBa), 'Order Flow Bid × Ask Numbers & Yellow POC Box')}
            {radioPill(
              'OF-ΔP',
              showOfDeltaP,
              () => {
                const next = !showOfDeltaP;
                setShowOfDeltaP(next);
                if (next) setShowOfVp(false);
              },
              'Order Flow Bi-Directional Delta Profile'
            )}
            {radioPill('D-VP', showVolumeProfile, () => setShowVolumeProfile(!showVolumeProfile), 'Session Volume Profile (Right-Anchored Royal Blue)')}
            {radioPill('D-DP', showDeltaProfileSession, () => setShowDeltaProfileSession(!showDeltaProfileSession), 'Session Delta Profile')}
            {radioPill('D-VL', showValueAreaLines, () => setShowValueAreaLines(!showValueAreaLines), 'Session Value Area Lines (dPOC, dVAH, dVAL)')}
            {radioPill('VWAP', showVwap, () => setShowVwap(!showVwap), 'Developing Session VWAP Curve')}
            {radioPill('NPOC', showNakedPoc, () => setShowNakedPoc(!showNakedPoc), 'Naked Unmitigated POC Rays')}
            {radioPill('HTF-PD', showPriorDayLevels, () => setShowPriorDayLevels(!showPriorDayLevels), 'Mốc Khung Lớn Ngày Hôm Qua (PDH, PDL, PDPOC, PDVAH, PDVAL)')}
            {radioPill('STK-IMB', showStackedImbalances, () => setShowStackedImbalances(!showStackedImbalances), 'Vùng Mất Cân Bằng Xếp Chồng Kéo Dài (ATAS Stacked Imbalance Zones)')}
            {radioPill(
              'VOL',
              showVolHistogram,
              () => setShowVolHistogram(!showVolHistogram),
              'Cửa sổ phụ Volume Histogram dưới chân biểu đồ (ATAS Pane)'
            )}
            {radioPill(
              'CVD',
              showCvdPanel,
              () => setShowCvdPanel(!showCvdPanel),
              'Cửa sổ phụ Cumulative Volume Delta (CVD) dưới chân biểu đồ'
            )}
            {radioPill(
              'COT/Δ',
              showCotGrid,
              () => setShowCotGrid(!showCotGrid),
              'Cửa sổ phụ Lưới nhiệt 4 hàng COT Bar / Δ Qty. / Δ % / Δ V'
            )}
            {radioPill('HEAD Δ/V', showBarHeadStats, () => setShowBarHeadStats(!showBarHeadStats), 'Bar Delta & Volume Summary Above High Wick')}
            {radioPill('SL/LIQ', showSlClusters, () => setShowSlClusters(!showSlClusters), 'Bản đồ Vùng Tụ Cắt Lỗ (Stop-Loss Clusters) & Thanh Lý 50x-100x (BSL/SSL Pools)')}
            {radioPill('LIMIT/ABS', showAbsorption, () => setShowAbsorption(!showAbsorption), 'Tường Lệnh Chờ Limit Cá Mập (L2 Limit Walls), Hấp Thụ (Absorption), Mất Cân Bằng Chồng Tầng & Đấu Giá Chưa Hoàn Tất')}
            {radioPill('STRIKES', showOptions, () => setShowOptions(!showOptions), 'Các Mốc Strike Quyền Chọn & Gamma Exposure (Call Wall, Put Wall, Zero Gamma Flip, Max Pain)')}
            {radioPill('BUBBLES', showBubbles, () => setShowBubbles(!showBubbles), 'Large Trade Volume Bubbles')}
            {radioPill('HEATMAP', showHeatmap, () => setShowHeatmap(!showHeatmap), 'Resting L2 Liquidity Heatmap')}

            {/* Color Theme Quick Toggle */}
            <button
              onClick={() => setColorTheme((p) => (p === 'deepchart' ? 'atas' : 'deepchart'))}
              style={{
                background: '#222631',
                color: colorTheme === 'deepchart' ? '#C084FC' : '#00E676',
                border: '1px solid #323642',
                borderRadius: '3px',
                padding: '1px 6px',
                fontSize: '9.5px',
                fontWeight: 700,
                cursor: 'pointer',
                marginLeft: '4px',
              }}
              title="Đổi bảng màu: DeepChart (Xanh/Tím) ⇄ ATAS (Xanh/Đỏ)"
            >
              {colorTheme === 'deepchart' ? 'G/Purple' : 'G/Red'}
            </button>
          </div>

          {/* Right: Chart DOM Trading Radio + Trading Panel Toggle Switch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            {radioPill(
              'DOM Trading',
              showChartDom,
              () => setShowChartDom(!showChartDom),
              'Hiển thị cột khớp lệnh nhanh DOM ngay cạnh trục giá (Chart DOM Trading)'
            )}

            <div
              onClick={() => onToggleTradingPanel?.()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontSize: '10.5px',
                color: isTradingPanelOpen ? '#E2E8F0' : '#8E9BAE',
                fontWeight: 600,
              }}
              title="Mở / Đóng Bảng Đặt Lệnh Bên Phải (Trading Panel)"
            >
              <span>Trading panel</span>
              <div
                style={{
                  width: '32px',
                  height: '16px',
                  borderRadius: '10px',
                  background: isTradingPanelOpen ? '#10B981' : '#334155',
                  position: 'relative',
                  transition: 'background 0.15s',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: isTradingPanelOpen ? '17px' : '2px',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: '#FFFFFF',
                    transition: 'left 0.15s',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Institutional ATAS Indicators Manager Modal */}
      <IndicatorsModal
        isOpen={isIndicatorsModalOpen}
        onClose={() => setIsIndicatorsModalOpen(false)}
        config={{
          showVolHistogram,
          showCvdPanel,
          showCotGrid,
          showOfBa,
          showOfVp,
          showOfDeltaP,
          showBarHeadStats,
          showPriorDayLevels,
          showVolumeProfile,
          showValueAreaLines,
          showVwap,
          showNakedPoc,
          showStackedImbalances,
          showSlClusters,
          showAbsorption,
          showOptions,
          showBubbles,
          showHeatmap,
          showChartDom,
        }}
        onChangeConfig={(updates) => {
          if (updates.showVolHistogram !== undefined) setShowVolHistogram(updates.showVolHistogram);
          if (updates.showCvdPanel !== undefined) setShowCvdPanel(updates.showCvdPanel);
          if (updates.showCotGrid !== undefined) setShowCotGrid(updates.showCotGrid);
          if (updates.showOfBa !== undefined) setShowOfBa(updates.showOfBa);
          if (updates.showOfVp !== undefined) setShowOfVp(updates.showOfVp);
          if (updates.showOfDeltaP !== undefined) setShowOfDeltaP(updates.showOfDeltaP);
          if (updates.showBarHeadStats !== undefined) setShowBarHeadStats(updates.showBarHeadStats);
          if (updates.showPriorDayLevels !== undefined) setShowPriorDayLevels(updates.showPriorDayLevels);
          if (updates.showVolumeProfile !== undefined) setShowVolumeProfile(updates.showVolumeProfile);
          if (updates.showValueAreaLines !== undefined) setShowValueAreaLines(updates.showValueAreaLines);
          if (updates.showVwap !== undefined) setShowVwap(updates.showVwap);
          if (updates.showNakedPoc !== undefined) setShowNakedPoc(updates.showNakedPoc);
          if (updates.showStackedImbalances !== undefined) setShowStackedImbalances(updates.showStackedImbalances);
          if (updates.showSlClusters !== undefined) setShowSlClusters(updates.showSlClusters);
          if (updates.showAbsorption !== undefined) setShowAbsorption(updates.showAbsorption);
          if (updates.showOptions !== undefined) setShowOptions(updates.showOptions);
          if (updates.showBubbles !== undefined) setShowBubbles(updates.showBubbles);
          if (updates.showHeatmap !== undefined) setShowHeatmap(updates.showHeatmap);
          if (updates.showChartDom !== undefined) setShowChartDom(updates.showChartDom);
        }}
        onApplyPreset={handleApplyPreset}
      />
    </div>
  );
};
