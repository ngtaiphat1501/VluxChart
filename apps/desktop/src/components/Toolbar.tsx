import React from 'react';
import { ChartSnapshotDTO } from '../types';
import { getTierBadgeMeta } from '../utils/entitlements';
import {
  ActiveFrameConfig,
  formatCustomFrameBadge,
  listRegisteredSynthetics,
} from '../utils/customFrameAndSyntheticEngine';

interface ToolbarProps {
  snapshot: ChartSnapshotDTO;
  onInstrumentChange: (instrumentId: string) => void;
  onToggleReplay?: (enable: boolean) => void;
  onPlayReplay?: () => void;
  onPauseReplay?: () => void;
  onStepReplay?: () => void;
  onResetReplay?: () => void;
  onSpeedChange?: (speed: number) => void;
  onExportCSV?: () => void;
  onTimeframeChange?: (timeframeUs: number) => void;
  soundEnabled?: boolean;
  onToggleSound?: () => void;
  onOpenBacktest?: () => void;
  onOpenZoneInspector?: () => void;
  onOpenSettings?: () => void;
  layoutPreset?: string;
  onLayoutPresetChange?: (preset: any) => void;
  activeRightTab?: string | null;
  onToggleRightTab?: (tab: string) => void;
  isLiveFeedActive?: boolean;
  onToggleLiveFeed?: () => void;
  onLoadMoreHistory?: () => void;
  chartViewMode?: 'candlestick' | 'footprint' | 'hybrid';
  onChartViewModeChange?: (mode: 'candlestick' | 'footprint' | 'hybrid') => void;
  tickAggregation?: number | 'auto';
  onTickAggregationChange?: (mult: number | 'auto') => void;
  multiChartLayout?: '1x1' | '2v' | '2h' | '3L' | '2x2';
  onMultiChartLayoutChange?: (layout: '1x1' | '2v' | '2h' | '3L' | '2x2') => void;
  onOpenMt5Modal?: () => void;
  onOpenCmeModal?: () => void;
  cmeConnected?: boolean;
  onOpenIndicators?: () => void;
  onOpenOptionsBoard?: () => void;
  onOpenScriptEditor?: () => void;
  onOpenInstrumentStudio?: () => void;
  onOpenAiConnect?: () => void;
  onOpenRiskManager?: () => void;
  onOpenDataManager?: () => void;
  localDataLabel?: string;
  hasLocalData?: boolean;
  authUserEmail?: string;
  authUserTier?: string;
  activeFrame?: ActiveFrameConfig;
  onOpenPrivilegeModal?: () => void;
  onLogout?: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  snapshot,
  onInstrumentChange,
  onToggleReplay,
  onPlayReplay,
  onPauseReplay,
  onStepReplay,
  onResetReplay,
  onSpeedChange,
  onExportCSV,
  onTimeframeChange,
  soundEnabled = true,
  onToggleSound,
  onOpenBacktest,
  onOpenZoneInspector,
  onOpenSettings,
  layoutPreset = 'order_flow_pro',
  onLayoutPresetChange,
  activeRightTab = 'dom_tape',
  onToggleRightTab,
  isLiveFeedActive = true,
  onToggleLiveFeed,
  onLoadMoreHistory,
  chartViewMode = 'hybrid',
  onChartViewModeChange,
  tickAggregation = 'auto',
  onTickAggregationChange,
  multiChartLayout = '1x1',
  onMultiChartLayoutChange,
  onOpenMt5Modal,
  onOpenCmeModal,
  cmeConnected = false,
  onOpenIndicators,
  onOpenOptionsBoard,
  onOpenScriptEditor,
  onOpenInstrumentStudio,
  onOpenAiConnect,
  onOpenRiskManager,
  onOpenDataManager,
  localDataLabel = 'Data',
  hasLocalData = false,
  authUserEmail,
  authUserTier,
  activeFrame,
  onOpenPrivilegeModal,
  onLogout,
}) => {
  const tierMeta = getTierBadgeMeta(authUserTier);
  const customSynthetics = listRegisteredSynthetics();
  const isNonTimeFrame = Boolean(activeFrame && activeFrame.category !== 'time');
  const isReplayMode = !!snapshot.playback?.is_replay_mode;
  const isPlaying = snapshot.playback?.state === 'Playing';
  const speed = snapshot.playback?.speed_multiplier || 1;
  const progressPct = snapshot.playback?.progress_pct ?? 0;

  const timeframes = [
    { label: '1 Minute', short: '1m', value: 60000000 },
    { label: '3 Minutes', short: '3m', value: 180000000 },
    { label: '5 Minutes', short: '5m', value: 300000000 },
    { label: '15 Minutes', short: '15m', value: 900000000 },
    { label: '30 Minutes', short: '30m', value: 1800000000 },
    { label: '1 Hour', short: '1h', value: 3600000000 },
    { label: '4 Hours', short: '4h', value: 14400000000 },
    { label: '1 Day', short: '1d', value: 86400000000 },
  ];

  const iconBtnStyle: React.CSSProperties = {
    width: '24px',
    height: '26px',
    background: 'transparent',
    color: '#94A3B8',
    border: '1px solid transparent',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const centerSelectStyle: React.CSSProperties = {
    background: '#252830',
    color: '#E2E8F0',
    border: '1px solid #323642',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    outline: 'none',
    height: '26px',
    whiteSpace: 'nowrap',
    lineHeight: '20px',
  };

  return (
    <header
      style={{
        height: '38px',
        minHeight: '38px',
        background: '#12141B',
        borderBottom: '1px solid #232733',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 8px',
        gap: '5px',
        userSelect: 'none',
        zIndex: 20,
        overflowX: 'auto',
        scrollbarWidth: 'none',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* =====================================================================
          GROUP 1 (LEFT): ATAS Instrument, Quick MT5, Candles/Clusters, Timeframe
          ===================================================================== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
        {/* Workspace Menu */}
        <button
          onClick={() => onLayoutPresetChange?.('order_flow_pro')}
          style={{ ...iconBtnStyle, color: '#CBD5E1' }}
          title="Menu Không Gian Làm Việc (Reset Layout)"
        >
          ☰
        </button>

        {/* Instrument Selector */}
        <select
          value={snapshot.instrument_id}
          onChange={(e) => onInstrumentChange(e.target.value)}
          style={{
            ...centerSelectStyle,
            background: '#1B1F2A',
            border: '1px solid #2C3345',
            fontSize: '11px',
            maxWidth: '164px',
            padding: '2px 6px',
          }}
          title="Chọn Cặp Giao Dịch: MT5 Forex / Gold / Indices hoặc Crypto Perpetual"
        >
          <optgroup label="MT5 FOREX & KIM LOẠI (Exness / FTMO / IC Markets)">
            <option value="MT5:CFD:XAUUSD">XAUUSD · Vàng Spot (MT5)</option>
            <option value="MT5:FOREX:EURUSD">EURUSD · Euro / USD (MT5)</option>
            <option value="MT5:FOREX:GBPUSD">GBPUSD · Bảng Anh / USD (MT5)</option>
            <option value="MT5:FOREX:USDJPY">USDJPY · USD / Yên Nhật (MT5)</option>
            <option value="MT5:FOREX:AUDUSD">AUDUSD · AUD / USD (MT5)</option>
            <option value="MT5:FOREX:USDCAD">USDCAD · USD / CAD (MT5)</option>
            <option value="MT5:FOREX:GBPJPY">GBPJPY · GBP / JPY (MT5)</option>
            <option value="MT5:INDICES:NAS100">NAS100 · Nasdaq 100 (MT5)</option>
            <option value="MT5:INDICES:US30">US30 · Dow Jones (MT5)</option>
            <option value="MT5:CRYPTO:BTCUSD">BTCUSD · Bitcoin / USD (MT5)</option>
            <option value="MT5:CRYPTO:ETHUSD">ETHUSD · Ethereum / USD (MT5)</option>
          </optgroup>
          <optgroup label="US FUTURES — CME GLOBEX (Level-3 MBO)">
            <option value="CME:FUT:ES">ES · E-mini S&amp;P 500 (CME L3)</option>
            <option value="CME:FUT:NQ">NQ · E-mini Nasdaq-100 (CME L3)</option>
            <option value="CME:FUT:GC">GC · COMEX Gold Futures (CME L3)</option>
            <option value="CME:FUT:CL">CL · WTI Crude Oil (CME L3)</option>
            <option value="CME:FUT:6E">6E · Euro FX Futures (CME L3)</option>
          </optgroup>
          <optgroup label="CRYPTO FUTURES (Bybit / Binance)">
            <option value="BYBIT:LINEAR_PERP:BTCUSDT:PERP">BTCUSDT-PERP (Bybit)</option>
            <option value="BYBIT:LINEAR_PERP:ETHUSDT:PERP">ETHUSDT-PERP (Bybit)</option>
            <option value="BYBIT:LINEAR_PERP:XAUUSDT:PERP">XAUUSDT-GOLD (Bybit)</option>
            <option value="BINANCE:USDS_M_PERP:BTCUSDT:PERP">BTCUSDT-PERP (Binance)</option>
            <option value="BINANCE:USDS_M_PERP:ETHUSDT:PERP">ETHUSDT-PERP (Binance)</option>
            <option value="BINANCE:USDS_M_PERP:XAUUSDT:PERP">XAUUSDT-GOLD (Binance PAXG)</option>
            <option value="AGGREGATED:MULTI_PERP:BTCUSDT:COMBINED">BTCUSDT-AGG (Hợp Nhất)</option>
            <option value="AGGREGATED:MULTI_PERP:XAUUSDT:COMBINED">XAUUSDT-AGG (Hợp Nhất)</option>
          </optgroup>
          {customSynthetics.length > 0 && (
            <optgroup label="SYNTHETIC SPREADS (Cặp Lai Định Lượng)">
              {customSynthetics.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName} ({s.formula})
                </option>
              ))}
            </optgroup>
          )}
        </select>

        {/* 1-Click MT5 Connect Button */}
        <button
          onClick={onOpenMt5Modal}
          style={{
            background: snapshot.instrument_id.startsWith('MT5:')
              ? 'rgba(0, 180, 216, 0.16)'
              : '#1A1E27',
            color: snapshot.instrument_id.startsWith('MT5:') ? '#00E5FF' : '#94A3B8',
            border: snapshot.instrument_id.startsWith('MT5:')
              ? '1px solid #00E5FF'
              : '1px solid #282E3E',
            borderRadius: '4px',
            padding: '0 8px',
            height: '26px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
          title="Kết nối nhanh Tài khoản MetaTrader 5 (1-Click MT5 Bridge)"
        >
          <span style={{ color: '#089981', fontSize: '9px' }}>●</span>
          <span>MT5</span>
        </button>

        {/* 1-Click CME Globex Level-3 MBO Connector Button */}
        <button
          type="button"
          data-testid="toolbar-cme-mbo-btn"
          onClick={onOpenCmeModal}
          style={{
            background: snapshot.instrument_id.startsWith('CME:')
              ? 'rgba(16, 185, 129, 0.16)'
              : '#1A1E27',
            color: snapshot.instrument_id.startsWith('CME:') ? '#34D399' : '#94A3B8',
            border: snapshot.instrument_id.startsWith('CME:')
              ? '1px solid #10B981'
              : '1px solid #282E3E',
            borderRadius: '4px',
            padding: '0 8px',
            height: '26px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
          title="Đầu nối Hợp đồng tương lai Mỹ CME Globex Level-3 MBO (Databento GLBX.MDP3 / dxFeed / Rithmic)"
        >
          <span style={{ color: cmeConnected ? '#10B981' : '#F59E0B', fontSize: '9px' }}>●</span>
          <span>CME L3</span>
        </button>

        {/* Vertical Separator */}
        <div style={{ width: '1px', height: '18px', background: '#262A36', margin: '0 2px' }} />

        {/* Candles vs Clusters (Footprint) Switcher */}
        <div style={{ display: 'flex', background: '#181B23', border: '1px solid #282C38', borderRadius: '4px', padding: '1px' }}>
          <button
            onClick={() => onChartViewModeChange?.('candlestick')}
            style={{
              background: chartViewMode === 'candlestick' ? '#2A303F' : 'transparent',
              color: chartViewMode === 'candlestick' ? '#FFFFFF' : '#8E9BAE',
              border: 'none',
              borderRadius: '3px',
              padding: '2px 7px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Chế độ Nến Nhật tiêu chuẩn (Candles)"
          >
            Candles
          </button>
          <button
            onClick={() => onChartViewModeChange?.('footprint')}
            style={{
              background: chartViewMode === 'footprint' || chartViewMode === 'hybrid' ? '#089981' : 'transparent',
              color: chartViewMode === 'footprint' || chartViewMode === 'hybrid' ? '#FFFFFF' : '#8E9BAE',
              border: 'none',
              borderRadius: '3px',
              padding: '2px 7px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Chế độ Footprint Order Flow Clusters (ATAS Standard)"
          >
            Clusters
          </button>
        </div>

        {/* Timeframe Quick Switcher (Core 4 pills + dropdown + Non-Time Range/Volume/Tick indicator) */}
        <div style={{ display: 'flex', alignItems: 'center', background: '#181B23', border: '1px solid #282C38', borderRadius: '4px', padding: '1px', gap: '1px' }}>
          {timeframes
            .filter((tf) => ['1m', '5m', '15m', '1h'].includes(tf.short))
            .map((tf) => {
              const isSelected = !isNonTimeFrame && snapshot.timeframe_us === tf.value;
              return (
                <button
                  key={tf.value}
                  onClick={() => onTimeframeChange?.(tf.value)}
                  style={{
                    background: isSelected ? '#2A303F' : 'transparent',
                    color: isSelected ? '#38BDF8' : '#78889B',
                    border: 'none',
                    borderRadius: '3px',
                    padding: '2px 5px',
                    fontSize: '10.5px',
                    fontWeight: isSelected ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {tf.short}
                </button>
              );
            })}
          {isNonTimeFrame && activeFrame && (
            <button
              type="button"
              data-testid="toolbar-active-custom-frame-pill"
              onClick={onOpenInstrumentStudio}
              style={{
                background: 'rgba(245, 158, 11, 0.2)',
                color: '#FBBF24',
                border: '1px solid rgba(245, 158, 11, 0.55)',
                borderRadius: '3px',
                padding: '1px 6px',
                margin: '0 2px',
                fontSize: '10px',
                fontWeight: 800,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: 'pointer',
              }}
              title="Đang chạy Khung Nến Phi Thời Gian (Range / Volume / Tick) — Bấm để đổi thông số"
            >
              ● {formatCustomFrameBadge(activeFrame)}
            </button>
          )}
          <select
            value={snapshot.timeframe_us}
            onChange={(e) => onTimeframeChange?.(Number(e.target.value))}
            style={{
              background: '#1E2330',
              color: isNonTimeFrame ? '#64748B' : '#CBD5E1',
              border: 'none',
              borderRadius: '3px',
              padding: '2px 3px',
              fontSize: '10px',
              fontWeight: 700,
              cursor: 'pointer',
              outline: 'none',
            }}
            title="Chọn toàn bộ khung thời gian (1m - 1d) hoặc bấm Studio để chọn Range/Volume/Tick Bars"
          >
            {timeframes.map((tf) => (
              <option key={tf.value} value={tf.value}>
                {tf.short}
              </option>
            ))}
          </select>
        </div>

        {/* Load More History (+) */}
        {onLoadMoreHistory && (
          <button
            onClick={onLoadMoreHistory}
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '4px',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid #0284C7',
              color: '#38BDF8',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Nạp thêm nến lịch sử theo khung hiện tại"
          >
            +
          </button>
        )}

        {/* History / Tick Compression */}
        <select
          value={tickAggregation.toString()}
          onChange={(e) => {
            const val = e.target.value;
            onTickAggregationChange?.(val === 'auto' ? 'auto' : parseInt(val, 10));
          }}
          style={{ ...centerSelectStyle, background: '#181B23', border: '1px solid #282C38', fontSize: '10px', padding: '2px 4px' }}
          title="Độ sâu Lịch sử & Gom cụm Bước giá"
        >
          <option value="auto">Auto T</option>
          <option value="1">1T</option>
          <option value="2">2T</option>
          <option value="5">5T</option>
          <option value="10">10T</option>
        </select>
      </div>

      {/* =====================================================================
          GROUP 2 (CENTER): Indicators (Ctrl+I), Institutional Tools, Templates & Multi-Chart
          ===================================================================== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
        {/* Indicators Manager Button (ATAS Ctrl+I Standard) */}
        <button
          onClick={onOpenIndicators}
          style={{
            background: '#181B23',
            border: '1px solid #2E384D',
            borderRadius: '4px',
            color: '#38BDF8',
            padding: '2px 8px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            height: '26px',
          }}
          title="Quản lý Chỉ báo Order Flow & Định lượng (Phím tắt: Ctrl + I)"
        >
          <span>Chỉ báo</span>
        </button>

        {/* Institutional Suite Menu (Options, Studio, Script, Risk, Backtest) */}
        <select
          value=""
          onChange={(e) => {
            const act = e.target.value;
            if (act === 'options') onOpenOptionsBoard?.();
            else if (act === 'studio') onOpenInstrumentStudio?.();
            else if (act === 'script') onOpenScriptEditor?.();
            else if (act === 'risk') onOpenRiskManager?.();
            else if (act === 'backtest') onOpenBacktest?.();
          }}
          style={{ ...centerSelectStyle, background: '#181B23', border: '1px solid #282C38', color: '#CBD5E1', fontSize: '11px', padding: '2px 6px' }}
          title="Bộ công cụ định chế ATAS: Options Board, Studio, Script Editor, Risk Manager, Backtest"
        >
          <option value="" disabled>Công cụ ▾</option>
          <option value="options">
            Options Board (CBOE Gold · Deribit){tierMeta.shortBadge === 'PILOT' ? ' [PRO]' : ''}
          </option>
          <option value="risk">
            Risk Manager (Khóa lỗ){tierMeta.shortBadge === 'PILOT' ? ' [PRO]' : ''}
          </option>
          <option value="backtest">
            Backtest Chiến Lược ($){tierMeta.shortBadge !== 'QUANT' ? ' [QUANT]' : ''}
          </option>
          <option value="studio">
            Instrument Studio{tierMeta.shortBadge !== 'QUANT' ? ' [QUANT]' : ''}
          </option>
          <option value="script">
            Script Editor (&lt;/&gt;){tierMeta.shortBadge !== 'QUANT' ? ' [QUANT]' : ''}
          </option>
        </select>

        {/* Templates Selector */}
        <select
          onChange={(e) => {
            const val = e.target.value;
            if (val) {
              window.dispatchEvent(new CustomEvent('vluxchart:apply_preset', { detail: val }));
            }
          }}
          defaultValue=""
          style={{ ...centerSelectStyle, background: '#181B23', border: '1px solid #282C38', color: '#CBD5E1', fontSize: '11px', padding: '2px 6px' }}
          title="Mẫu Thiết Lập Biểu Đồ Chuẩn (Templates)"
        >
          <option value="" disabled>Mẫu ▾</option>
          <option value="atas_standard">ATAS Standard (Clusters + VP + HTF)</option>
          <option value="scalper_flow">Scalper Flow (Imbalances + Abs)</option>
          <option value="macro_institutional">Macro Institutional (Levels + VP)</option>
          <option value="clean_price">Clean Price Action</option>
        </select>

        {/* Multi-Chart Grid Switcher */}
        <div
          style={{
            display: 'flex',
            background: '#181B23',
            border: '1px solid #282C38',
            borderRadius: '4px',
            padding: '1px',
            gap: '1px',
          }}
          title="Mở nhiều biểu đồ đa khung thời gian song song"
        >
          {(
            [
              { id: '1x1', label: '1' },
              { id: '2v', label: '2V' },
              { id: '2h', label: '2H' },
              { id: '2x2', label: '4' },
            ] as const
          ).map((l) => {
            const isActive = multiChartLayout === l.id;
            return (
              <button
                key={l.id}
                onClick={() => onMultiChartLayoutChange?.(l.id)}
                style={{
                  background: isActive ? '#38BDF8' : 'transparent',
                  color: isActive ? '#090B10' : '#8E9BAE',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '2px 5px',
                  fontSize: '10px',
                  fontWeight: isActive ? 800 : 600,
                  cursor: 'pointer',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* =====================================================================
          GROUP 3 (RIGHT): ATAS [T] Chart Trader, [DOM], Replay, Data Pack & Account
          ===================================================================== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
        {/* ATAS [T] Chart Trader Toggle Button */}
        <button
          onClick={() => onToggleRightTab?.('trading')}
          style={{
            background: activeRightTab === 'trading' ? 'rgba(8, 153, 129, 0.22)' : '#181B23',
            color: activeRightTab === 'trading' ? '#089981' : '#CBD5E1',
            border: activeRightTab === 'trading' ? '1px solid #089981' : '1px solid #282C38',
            borderRadius: '4px',
            padding: '2px 7px',
            height: '26px',
            fontSize: '10.5px',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
          }}
          title="Bật/Tắt Bảng Đặt Lệnh Nhanh [T] (ATAS Chart Trader)"
        >
          <span>[T]</span>
        </button>

        {/* [DOM] Ladder Toggle Button */}
        <button
          onClick={() => onToggleRightTab?.('dom_tape')}
          style={{
            background: activeRightTab === 'dom_tape' || activeRightTab === 'dom' ? 'rgba(56, 189, 248, 0.22)' : '#181B23',
            color: activeRightTab === 'dom_tape' || activeRightTab === 'dom' ? '#38BDF8' : '#CBD5E1',
            border: activeRightTab === 'dom_tape' || activeRightTab === 'dom' ? '1px solid #38BDF8' : '1px solid #282C38',
            borderRadius: '4px',
            padding: '2px 6px',
            height: '26px',
            fontSize: '10.5px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          title="Bật/Tắt Sổ Lệnh Chuyên Sâu Depth of Market (DOM)"
        >
          DOM
        </button>

        {/* Market Replay Engine */}
        <button
          onClick={() => onToggleReplay?.(!isReplayMode)}
          style={{
            background: isReplayMode ? '#F59E0B' : '#181B23',
            color: isReplayMode ? '#0B0D12' : '#94A3B8',
            border: `1px solid ${isReplayMode ? '#F59E0B' : '#282C38'}`,
            padding: '2px 7px',
            borderRadius: '4px',
            fontSize: '10.5px',
            fontWeight: 700,
            cursor: 'pointer',
            height: '26px',
          }}
          title="Bật/Tắt Chế độ Tua Lại Lịch Sử (Market Replay)"
        >
          {isReplayMode ? '⏹ Exit' : 'Replay'}
        </button>

        {isReplayMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: '#181B23', padding: '1px 5px', borderRadius: '4px', border: '1px solid #F59E0B' }}>
            <button
              onClick={() => (isPlaying ? onPauseReplay?.() : onPlayReplay?.())}
              style={{
                background: isPlaying ? '#EF4444' : '#089981',
                color: '#FFF',
                border: 'none',
                borderRadius: '3px',
                padding: '1px 5px',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button
              onClick={() => onStepReplay?.()}
              style={{ background: '#2A303F', color: '#FFF', border: 'none', borderRadius: '3px', padding: '1px 4px', fontSize: '10px', cursor: 'pointer' }}
            >
              ⏭
            </button>
            <button
              onClick={() => onResetReplay?.()}
              style={{ background: '#2A303F', color: '#FFF', border: 'none', borderRadius: '3px', padding: '1px 4px', fontSize: '10px', cursor: 'pointer' }}
            >
              ⏮
            </button>
            <span style={{ fontSize: '9.5px', color: '#F59E0B', fontWeight: 700 }}>
              {speed}x·{progressPct.toFixed(0)}%
            </span>
          </div>
        )}

        {/* System & Runtime Compatibility Diagnostics Button */}
        {onOpenDataManager && (
          <button
            onClick={onOpenDataManager}
            data-testid="toolbar-system-bootstrap-btn"
            style={{
              background: hasLocalData ? 'rgba(8, 153, 129, 0.14)' : 'rgba(245, 158, 11, 0.14)',
              color: hasLocalData ? '#10B981' : '#F59E0B',
              border: hasLocalData ? '1px solid rgba(8, 153, 129, 0.5)' : '1px solid rgba(245, 158, 11, 0.5)',
              borderRadius: '4px',
              padding: '2px 8px',
              height: '26px',
              fontSize: '10.5px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontFamily: "'JetBrains Mono', monospace",
            }}
            title="Kiểm tra & Cài đặt tương thích hệ thống (System Runtime Bootstrapper)"
          >
            <span style={{ fontSize: '8px' }}>●</span>
            <span>{localDataLabel}</span>
          </button>
        )}

        {/* Settings Gear */}
        <button
          onClick={onOpenSettings}
          style={iconBtnStyle}
          title="Cài đặt Biểu đồ"
        >
          ⚙
        </button>

        {/* Sound Toggle (Crisp Typographic Pill — Zero Cartoon Emoji) */}
        <button
          onClick={onToggleSound}
          style={{
            ...iconBtnStyle,
            width: 'auto',
            padding: '0 6px',
            fontSize: '9.5px',
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            color: soundEnabled ? '#10B981' : '#64748B',
          }}
          title={soundEnabled ? 'Âm thanh cảnh báo: BẬT' : 'Âm thanh cảnh báo: TẮT'}
        >
          {soundEnabled ? 'SND' : 'MUTE'}
        </button>

        {/* Authenticated User Pill + Tier Privilege Badge + Sign Out */}
        {authUserEmail && onLogout && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              background: '#171C27',
              border: '1px solid #272F40',
              borderRadius: '4px',
              padding: '0 6px 0 6px',
              height: '26px',
            }}
          >
            <button
              onClick={() => onOpenPrivilegeModal?.()}
              data-testid="toolbar-tier-badge"
              style={{
                background: tierMeta.bgColor,
                color: tierMeta.textColor,
                border: `1px solid ${tierMeta.borderColor}`,
                borderRadius: '3px',
                padding: '1px 5px',
                fontSize: '9px',
                fontWeight: 800,
                cursor: 'pointer',
                fontFamily: "'JetBrains Mono', monospace",
              }}
              title={`Hạng tài khoản: ${tierMeta.displayName} — Click để xem Đặc Quyền & Nâng Cấp Gói`}
            >
              {tierMeta.shortBadge}
            </button>
            <span
              style={{
                fontSize: '10px',
                color: '#CBD5E1',
                fontWeight: 600,
                maxWidth: '58px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`${authUserEmail} (${tierMeta.displayName})`}
            >
              {authUserEmail.split('@')[0]}
            </span>
            <button
              onClick={onLogout}
              data-testid="toolbar-logout-btn"
              style={{
                background: '#242B3B',
                border: 'none',
                borderRadius: '3px',
                color: '#F87171',
                padding: '2px 6px',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Đăng xuất khỏi VluxChart Terminal"
            >
              Thoát
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
