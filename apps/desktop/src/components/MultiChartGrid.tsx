import React, { useState, useEffect, useMemo } from 'react';
import { BarDTO, ChartDrawing, ChartSnapshotDTO, DrawingTool } from '../types';
import { FootprintCanvas } from './FootprintCanvas';
import {
  TIMEFRAME_OPTIONS,
  adaptSnapshotToTimeframe,
  formatTimeframeShort,
} from '../utils/multiTimeframeAggregator';
import { liveFeedService, timeframeUsToBybitInterval } from '../services/liveFeedService';
import { getInstrumentMeta } from '../utils/instrumentRegistry';

export type MultiChartLayout = '1x1' | '2v' | '2h' | '3L' | '2x2';

export interface ChartPaneConfig {
  id: string;
  title: string;
  timeframeUs: number;
  displayMode: 'footprint_vp_ba' | 'footprint_vp' | 'footprint_delta' | 'candlestick';
  tickAggregation: number | 'auto';
  subPanel: 'cot' | 'vol' | 'cvd' | 'none';
}

interface MultiChartGridProps {
  layout: MultiChartLayout;
  snapshot: ChartSnapshotDTO;
  drawings: ChartDrawing[];
  activeDrawingTool: DrawingTool;
  drawingColor: string;
  drawingsVisible: boolean;
  onDrawingCreated: (d: ChartDrawing) => void;
  onDrawingUpdated?: (d: ChartDrawing) => void;
  onDrawingDeleted?: (id: string) => void;
  onPriceBoundsChange?: (bounds: { minPrice: number; maxPrice: number; chartHeight: number; panY: number }) => void;
  onSwitchToTradingView?: () => void;
  tickAggregation: number | 'auto';
  onTickAggregationChange: (val: number | 'auto') => void;
  isTradingPanelOpen: boolean;
  onToggleTradingPanel: () => void;
  onPrimaryTimeframeChange?: (timeframeUs: number) => void;
  magnetEnabled?: boolean;
  isPickingPriceOnChart?: boolean;
  onPricePickedFromChart?: (priceTicks: number) => void;
}

function getBybitSymbolFromId(instrumentId: string): string {
  if (instrumentId.startsWith('MT5:')) return instrumentId;
  if (instrumentId.includes('ETH')) return 'ETHUSDT';
  if (instrumentId.includes('XAU')) return 'XAUUSDT';
  return 'BTCUSDT';
}

export const MultiChartGrid: React.FC<MultiChartGridProps> = ({
  layout,
  snapshot,
  drawings,
  activeDrawingTool,
  drawingColor,
  drawingsVisible,
  onDrawingCreated,
  onDrawingUpdated,
  onDrawingDeleted,
  onPriceBoundsChange,
  onSwitchToTradingView,
  tickAggregation,
  onTickAggregationChange,
  isTradingPanelOpen,
  onToggleTradingPanel,
  onPrimaryTimeframeChange,
  magnetEnabled,
  isPickingPriceOnChart,
  onPricePickedFromChart,
}) => {
  const [activePaneId, setActivePaneId] = useState<string>('pane-1');
  const [maximizedPaneId, setMaximizedPaneId] = useState<string | null>(null);
  const [crosshairSyncEnabled, setCrosshairSyncEnabled] = useState<boolean>(true);
  const [syncedCrosshair, setSyncedCrosshair] = useState<{
    priceTicks: number | null;
    timestampUs: number | null;
    sourcePaneId: string;
  } | null>(null);

  const [panes, setPanes] = useState<ChartPaneConfig[]>([
    {
      id: 'pane-1',
      title: 'EXECUTION FLOW',
      timeframeUs: snapshot.timeframe_us || 300_000_000, // 5m
      displayMode: 'footprint_vp_ba',
      tickAggregation: 'auto',
      subPanel: 'cot',
    },
    {
      id: 'pane-2',
      title: 'HTF STRUCTURE',
      timeframeUs: 900_000_000, // 15m
      displayMode: 'footprint_vp_ba',
      tickAggregation: 'auto',
      subPanel: 'vol',
    },
    {
      id: 'pane-3',
      title: 'MACRO PROFILE',
      timeframeUs: 3_600_000_000, // 1h
      displayMode: 'candlestick',
      tickAggregation: 'auto',
      subPanel: 'cvd',
    },
    {
      id: 'pane-4',
      title: 'MICRO TAPE FLOW',
      timeframeUs: 60_000_000, // 1m
      displayMode: 'footprint_delta',
      tickAggregation: 'auto',
      subPanel: 'cot',
    },
  ]);

  // Keep Pane 1 synced with primary top-bar timeframe & tick aggregation
  useEffect(() => {
    setPanes((prev) =>
      prev.map((p) =>
        p.id === 'pane-1'
          ? { ...p, timeframeUs: snapshot.timeframe_us, tickAggregation }
          : p
      )
    );
  }, [snapshot.timeframe_us, tickAggregation]);

  // Reset maximize if layout changes to 1x1
  useEffect(() => {
    if (layout === '1x1') {
      setMaximizedPaneId(null);
    }
  }, [layout]);

  // Dedicated per-timeframe historical kline cache for secondary panes
  const [timeframeBarsCache, setTimeframeBarsCache] = useState<Record<string, BarDTO[]>>({});

  useEffect(() => {
    if (layout === '1x1') return;
    const symbol = getBybitSymbolFromId(snapshot.instrument_id);
    const visiblePanes =
      layout === '2v' || layout === '2h'
        ? panes.slice(0, 2)
        : layout === '3L'
        ? panes.slice(0, 3)
        : panes;

    visiblePanes.forEach((pane) => {
      if (pane.id === 'pane-1' || pane.timeframeUs === snapshot.timeframe_us) return;
      const cacheKey = `${symbol}_${pane.timeframeUs}`;
      if (timeframeBarsCache[cacheKey] && timeframeBarsCache[cacheKey].length > 0) return;

      const bybitInterval = timeframeUsToBybitInterval(pane.timeframeUs);
      liveFeedService
        .fetchRealHistoricalKlines(symbol, bybitInterval, 180)
        .then((fetchedBars) => {
          if (fetchedBars && fetchedBars.length > 0) {
            setTimeframeBarsCache((prev) => ({
              ...prev,
              [cacheKey]: fetchedBars,
            }));
          }
        })
        .catch(() => {
          // Graceful fallback to deterministic multi-timeframe aggregation
        });
    });
  }, [layout, panes, snapshot.instrument_id, snapshot.timeframe_us]);

  const updatePane = (paneId: string, patch: Partial<ChartPaneConfig>) => {
    setPanes((prev) => prev.map((p) => (p.id === paneId ? { ...p, ...patch } : p)));
    if (paneId === 'pane-1') {
      if (patch.timeframeUs && onPrimaryTimeframeChange) {
        onPrimaryTimeframeChange(patch.timeframeUs);
      }
      if (patch.tickAggregation !== undefined) {
        onTickAggregationChange(patch.tickAggregation);
      }
    }
  };

  const symbol = getBybitSymbolFromId(snapshot.instrument_id);
  const displaySymbol = getInstrumentMeta(snapshot.instrument_id).symbol;

  // If 1x1 single-chart mode is active, render clean full-viewport FootprintCanvas directly
  if (layout === '1x1') {
    const mainPane = panes[0];
    return (
      <FootprintCanvas
        paneId="pane-1"
        bars={snapshot.bars}
        activeBar={snapshot.active_bar}
        instrumentId={snapshot.instrument_id}
        heatmapSlices={snapshot.heatmap_slices}
        orderBook={snapshot.order_book}
        optionsSummary={snapshot.options_summary}
        vwap={snapshot.vwap}
        divergences={snapshot.divergences}
        volumeProfile={snapshot.volume_profile}
        icebergs={snapshot.icebergs}
        recentTrades={snapshot.recent_trades}
        drawings={drawings}
        activeDrawingTool={activeDrawingTool}
        drawingColor={drawingColor}
        onDrawingCreated={onDrawingCreated}
        onDrawingUpdated={onDrawingUpdated}
        onDrawingDeleted={onDrawingDeleted}
        drawingsVisible={drawingsVisible}
        onPriceBoundsChange={onPriceBoundsChange}
        onSwitchToTradingView={onSwitchToTradingView}
        tickAggregation={tickAggregation}
        onTickAggregationChange={onTickAggregationChange}
        isTradingPanelOpen={isTradingPanelOpen}
        onToggleTradingPanel={onToggleTradingPanel}
        forcedDisplayMode={mainPane.displayMode}
        magnetEnabled={magnetEnabled}
        isPickingPriceOnChart={isPickingPriceOnChart}
        onPricePickedFromChart={onPricePickedFromChart}
      />
    );
  }

  const renderSinglePane = (pane: ChartPaneConfig, isMultiPane: boolean) => {
    const isFocused = activePaneId === pane.id;
    const cacheKey = `${symbol}_${pane.timeframeUs}`;
    const cachedBars =
      pane.timeframeUs === snapshot.timeframe_us ? null : timeframeBarsCache[cacheKey] || null;
    const paneSnapshot = adaptSnapshotToTimeframe(snapshot, pane.timeframeUs, cachedBars);

    return (
      <div
        key={pane.id}
        onMouseDown={() => setActivePaneId(pane.id)}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          background: '#0D0F14',
          border: isFocused ? '1px solid #00E676' : '1px solid #262932',
          borderRadius: '2px',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* ===================================================================
            INSTITUTIONAL PANE HEADER BAR (ATAS / DeepCharts Multi-Chart Style)
            Allows independent Timeframe, Chart Mode, Tick Compression & Sync
            =================================================================== */}
        <div
          style={{
            height: '26px',
            minHeight: '26px',
            background: isFocused ? '#181C24' : '#13161C',
            borderBottom: '1px solid #262932',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px',
            gap: '6px',
            userSelect: 'none',
          }}
        >
          {/* Left: Active Focus Dot + Symbol + Quick Timeframe Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflowX: 'auto' }}>
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: isFocused ? '#00E676' : '#475569',
                boxShadow: isFocused ? '0 0 6px #00E676' : 'none',
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 800,
                color: isFocused ? '#F8FAFC' : '#94A3B8',
                fontFamily: '"JetBrains Mono", monospace',
                marginRight: '4px',
                whiteSpace: 'nowrap',
              }}
            >
              {displaySymbol} · {formatTimeframeShort(pane.timeframeUs)}
            </span>

            {/* Independent Timeframe Selector Buttons */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1px',
                background: '#0D0F14',
                padding: '1px',
                borderRadius: '3px',
                border: '1px solid #262932',
              }}
            >
              {TIMEFRAME_OPTIONS.map((tf) => {
                const isTfActive = pane.timeframeUs === tf.us;
                return (
                  <button
                    key={tf.shortLabel}
                    onClick={(e) => {
                      e.stopPropagation();
                      updatePane(pane.id, { timeframeUs: tf.us });
                    }}
                    style={{
                      background: isTfActive ? '#00E676' : 'transparent',
                      color: isTfActive ? '#090B10' : '#94A3B8',
                      border: 'none',
                      borderRadius: '2px',
                      padding: '1px 4px',
                      fontSize: '9.5px',
                      fontWeight: isTfActive ? 800 : 600,
                      cursor: 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                    title={`Đổi khung thời gian biểu đồ này sang ${tf.label}`}
                  >
                    {tf.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Display Mode + Tick Aggregation + Sync + Maximize */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            {/* Display Mode Switcher */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1px',
                background: '#0D0F14',
                padding: '1px',
                borderRadius: '3px',
                border: '1px solid #262932',
              }}
            >
              {(
                [
                  { id: 'footprint_vp_ba', label: 'VP+B/A', tip: 'Footprint Volume Profile + Bid×Ask Numbers' },
                  { id: 'footprint_vp', label: 'OF-VP', tip: 'Footprint Volume Profile Histogram' },
                  { id: 'footprint_delta', label: 'OF-ΔP', tip: 'Footprint Delta Profile + Bid×Ask' },
                  { id: 'candlestick', label: 'Candle', tip: 'Nến Nhật + Volume Profile Phiên (D-VP)' },
                ] as const
              ).map((m) => {
                const isModeActive = pane.displayMode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      updatePane(pane.id, { displayMode: m.id });
                    }}
                    style={{
                      background: isModeActive ? '#222631' : 'transparent',
                      color: isModeActive ? '#4ADE80' : '#8E9BAE',
                      border: isModeActive ? '1px solid #4ADE80' : '1px solid transparent',
                      borderRadius: '2px',
                      padding: '1px 5px',
                      fontSize: '9px',
                      fontWeight: isModeActive ? 700 : 500,
                      cursor: 'pointer',
                    }}
                    title={m.tip}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>

            {/* Tick Compression Selector per Pane */}
            <select
              value={pane.tickAggregation}
              onChange={(e) => {
                const val = e.target.value;
                updatePane(pane.id, {
                  tickAggregation: val === 'auto' ? 'auto' : parseInt(val, 10),
                });
              }}
              style={{
                background: '#0D0F14',
                color: '#CBD5E1',
                border: '1px solid #262932',
                borderRadius: '3px',
                padding: '1px 4px',
                fontSize: '9.5px',
                fontWeight: 700,
                cursor: 'pointer',
                outline: 'none',
              }}
              title="Mức gộp bước giá (Tick Compression) cho biểu đồ này"
            >
              <option value="auto">Auto BT</option>
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="5">5x</option>
              <option value="10">10x</option>
              <option value="25">25x</option>
            </select>

            {/* Crosshair Sync Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCrosshairSyncEnabled((p) => !p);
              }}
              style={{
                background: crosshairSyncEnabled ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: crosshairSyncEnabled ? '#38BDF8' : '#64748B',
                border: `1px solid ${crosshairSyncEnabled ? '#0284C7' : '#262932'}`,
                borderRadius: '3px',
                padding: '1px 5px',
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Đồng bộ tâm ngắm giá & thời gian giữa các biểu đồ (Crosshair Sync)"
            >
              🔗 Sync
            </button>

            {/* Maximize / Restore Pane */}
            {isMultiPane && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMaximizedPaneId((prev) => (prev === pane.id ? null : pane.id));
                }}
                style={{
                  background: maximizedPaneId === pane.id ? '#00E676' : '#222631',
                  color: maximizedPaneId === pane.id ? '#090B10' : '#CBD5E1',
                  border: '1px solid #323642',
                  borderRadius: '3px',
                  padding: '1px 5px',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title={maximizedPaneId === pane.id ? 'Thu nhỏ về lưới đa biểu đồ' : 'Phóng toàn màn hình biểu đồ này'}
              >
                {maximizedPaneId === pane.id ? '❐' : '⛶'}
              </button>
            )}
          </div>
        </div>

        {/* Pane Canvas */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <FootprintCanvas
            paneId={pane.id}
            bars={paneSnapshot.bars}
            activeBar={paneSnapshot.active_bar}
            instrumentId={paneSnapshot.instrument_id}
            heatmapSlices={paneSnapshot.heatmap_slices}
            orderBook={paneSnapshot.order_book}
            optionsSummary={paneSnapshot.options_summary}
            vwap={paneSnapshot.vwap}
            divergences={paneSnapshot.divergences}
            volumeProfile={paneSnapshot.volume_profile}
            icebergs={paneSnapshot.icebergs}
            recentTrades={paneSnapshot.recent_trades}
            drawings={drawings}
            activeDrawingTool={activeDrawingTool}
            drawingColor={drawingColor}
            onDrawingCreated={onDrawingCreated}
            onDrawingUpdated={onDrawingUpdated}
            onDrawingDeleted={onDrawingDeleted}
            drawingsVisible={drawingsVisible}
            onPriceBoundsChange={pane.id === 'pane-1' ? onPriceBoundsChange : undefined}
            tickAggregation={pane.tickAggregation}
            onTickAggregationChange={(val) => updatePane(pane.id, { tickAggregation: val })}
            isTradingPanelOpen={isTradingPanelOpen}
            onToggleTradingPanel={onToggleTradingPanel}
            hideBottomToolbar={pane.id !== activePaneId && layout === '2x2'}
            initialBottomSubPanel={pane.subPanel}
            forcedDisplayMode={pane.displayMode}
            syncedCrosshair={crosshairSyncEnabled ? syncedCrosshair : null}
            onCrosshairSync={crosshairSyncEnabled ? setSyncedCrosshair : undefined}
            magnetEnabled={magnetEnabled}
            isPickingPriceOnChart={isPickingPriceOnChart}
            onPricePickedFromChart={onPricePickedFromChart}
          />
        </div>
      </div>
    );
  };

  if (maximizedPaneId) {
    const target = panes.find((p) => p.id === maximizedPaneId) || panes[0];
    return (
      <div style={{ flex: 1, width: '100%', height: '100%', display: 'flex', overflow: 'hidden' }}>
        {renderSinglePane(target, true)}
      </div>
    );
  }

  if (layout === '2v') {
    return (
      <div
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '2px',
          background: '#1E222D',
          overflow: 'hidden',
        }}
      >
        {renderSinglePane(panes[0], true)}
        {renderSinglePane(panes[1], true)}
      </div>
    );
  }

  if (layout === '2h') {
    return (
      <div
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          display: 'grid',
          gridTemplateRows: '1fr 1fr',
          gap: '2px',
          background: '#1E222D',
          overflow: 'hidden',
        }}
      >
        {renderSinglePane(panes[0], true)}
        {renderSinglePane(panes[1], true)}
      </div>
    );
  }

  if (layout === '3L') {
    return (
      <div
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          display: 'grid',
          gridTemplateColumns: '1.25fr 1fr',
          gap: '2px',
          background: '#1E222D',
          overflow: 'hidden',
        }}
      >
        {renderSinglePane(panes[0], true)}
        <div
          style={{
            display: 'grid',
            gridTemplateRows: '1fr 1fr',
            gap: '2px',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {renderSinglePane(panes[1], true)}
          {renderSinglePane(panes[2], true)}
        </div>
      </div>
    );
  }

  // 2x2 Quad Grid
  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: '2px',
        background: '#1E222D',
        overflow: 'hidden',
      }}
    >
      {renderSinglePane(panes[0], true)}
      {renderSinglePane(panes[1], true)}
      {renderSinglePane(panes[2], true)}
      {renderSinglePane(panes[3], true)}
    </div>
  );
};
