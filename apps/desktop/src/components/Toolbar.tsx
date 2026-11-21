import React from 'react';
import { ChartSnapshotDTO } from '../types';

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
  onOpenIndicators?: () => void;
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
  onOpenIndicators,
}) => {
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
    width: '28px',
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
    padding: '3px 10px',
    borderRadius: '4px',
    fontSize: '11.5px',
    fontWeight: 600,
    cursor: 'pointer',
    outline: 'none',
    height: '26px',
  };

  return (
    <header
      style={{
        height: '36px',
        minHeight: '36px',
        background: '#16181D',
        borderBottom: '1px solid #262932',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 10px',
        gap: '8px',
        userSelect: 'none',
        zIndex: 20,
      }}
    >
      {/* =====================================================================
          LEFT GROUP: DeepCharts 6 Action Icons (Menu, Candle/FP, Indicators, Settings, $, Camera)
          Matches media_1794650950575_011ab3f4.jpg & media_1794650978772_5f668108.png
          ===================================================================== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
        {/* 1. Workspace Menu / Reset Icon */}
        <button
          onClick={() => onLayoutPresetChange?.('order_flow_pro')}
          style={{ ...iconBtnStyle, color: '#CBD5E1' }}
          title="DeepChart Workspace Menu (Reset to Default Order Flow Layout)"
        >
          ☰
        </button>

        {/* 2. Chart Bar Type Switcher Icon (Candlestick / Footprint / Hybrid) */}
        <div style={{ display: 'flex', background: '#1F2229', border: '1px solid #2D313B', borderRadius: '4px', padding: '1px' }}>
          <button
            onClick={() => onChartViewModeChange?.('candlestick')}
            style={{
              background: chartViewMode === 'candlestick' ? '#2D323E' : 'transparent',
              color: chartViewMode === 'candlestick' ? '#00E676' : '#8E9BAE',
              border: 'none',
              borderRadius: '3px',
              padding: '2px 6px',
              fontSize: '10.5px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Chế độ Nến Nhật tiêu chuẩn (TradingView Candlestick)"
          >
            🕯 Candle
          </button>
          <button
            onClick={() => onChartViewModeChange?.('footprint')}
            style={{
              background: chartViewMode === 'footprint' || chartViewMode === 'hybrid' ? '#2D323E' : 'transparent',
              color: chartViewMode === 'footprint' || chartViewMode === 'hybrid' ? '#00E676' : '#8E9BAE',
              border: 'none',
              borderRadius: '3px',
              padding: '2px 6px',
              fontSize: '10.5px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Chế độ Order Flow Footprint & Volume Profile (ATAS / DeepChart)"
          >
            📊 Footprint
          </button>
        </div>

        {/* 2B. Indicators Manager Button (ATAS Ctrl+I Standard) */}
        <button
          onClick={onOpenIndicators}
          style={{
            background: '#1F2229',
            border: '1px solid #323A4D',
            borderRadius: '4px',
            color: '#38BDF8',
            padding: '2px 7px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            height: '26px',
          }}
          title="Mở Thư Viện Quản Lý Chỉ Báo Định Lượng & Order Flow (Ctrl + I)"
        >
          <span>📈</span>
          <span>Chỉ báo</span>
        </button>

        {/* 3. Zone & Volume Profile Inspector Icon */}
        <button
          onClick={onOpenZoneInspector}
          style={iconBtnStyle}
          title="Mở Zone Inspector & Phân tích Vùng Thanh khoản (Market Intelligence)"
        >
          llı
        </button>

        {/* 4. Settings Gear Icon */}
        <button
          onClick={onOpenSettings}
          style={iconBtnStyle}
          title="Cấu hình Biểu đồ & Giao diện (Chart & Footprint Settings)"
        >
          ⚙
        </button>

        {/* 5. $ Strategy Backtester & Execution Icon */}
        <button
          onClick={onOpenBacktest}
          style={{ ...iconBtnStyle, color: '#00E676', fontWeight: 700 }}
          title="Chiến lược Order Flow & Backtester ($)"
        >
          $
        </button>

        {/* 6. Camera / CSV Snapshot Export Icon */}
        <button
          onClick={onExportCSV}
          style={iconBtnStyle}
          title="Xuất dữ liệu Nến & Order Flow ra CSV (Snapshot Export)"
        >
          📷
        </button>
      </div>

      {/* =====================================================================
          CENTER GROUP: 3 Signature DeepCharts Dropdown Pills
          [ Instrument ▾ ]  [ 10D - BT (Tick Aggregation) ▾ ]  [ 5 Minute ▾ ]
          ===================================================================== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        {/* Pill 1: Instrument Selector (MT5 Forex/Gold/Indices + Crypto Perpetuals) */}
        <select
          value={snapshot.instrument_id}
          onChange={(e) => onInstrumentChange(e.target.value)}
          style={centerSelectStyle}
          title="Chọn Cặp Giao Dịch: MT5 Forex / Gold / Indices hoặc Crypto Perpetual"
        >
          <optgroup label="🌍 MT5 FOREX, METALS & INDICES (Exness / FTMO / IC Markets)">
            <option value="MT5:FOREX:EURUSD">EURUSD · Euro / US Dollar (MT5 Forex)</option>
            <option value="MT5:FOREX:GBPUSD">GBPUSD · British Pound / USD (MT5 Forex)</option>
            <option value="MT5:FOREX:USDJPY">USDJPY · US Dollar / Yen (MT5 Forex)</option>
            <option value="MT5:FOREX:AUDUSD">AUDUSD · Australian Dollar / USD (MT5 Forex)</option>
            <option value="MT5:FOREX:USDCAD">USDCAD · US Dollar / CAD (MT5 Forex)</option>
            <option value="MT5:FOREX:GBPJPY">GBPJPY · Pound / Japanese Yen (MT5 Forex)</option>
            <option value="MT5:CFD:XAUUSD">XAUUSD · Gold Spot / USD (MT5 Metals)</option>
            <option value="MT5:INDICES:NAS100">NAS100 · Nasdaq 100 / USTEC (MT5 Index)</option>
            <option value="MT5:INDICES:US30">US30 · Wall Street 30 / DJ30 (MT5 Index)</option>
            <option value="MT5:CRYPTO:BTCUSD">BTCUSD · Bitcoin / USD (MT5 Live 24/7)</option>
            <option value="MT5:CRYPTO:ETHUSD">ETHUSD · Ethereum / USD (MT5 Live 24/7)</option>
          </optgroup>
          <optgroup label="⚡ CRYPTO PERPETUAL (Bybit / Binance)">
            <option value="BYBIT:LINEAR_PERP:BTCUSDT:PERP">BTCUSDT-PERP (Bybit)</option>
            <option value="BYBIT:LINEAR_PERP:ETHUSDT:PERP">ETHUSDT-PERP (Bybit)</option>
            <option value="BYBIT:LINEAR_PERP:XAUUSDT:PERP">XAUUSDT-GOLD (Bybit)</option>
            <option value="BINANCE:USDS_M_PERP:BTCUSDT:PERP">BTCUSDT-PERP (Binance)</option>
            <option value="BINANCE:USDS_M_PERP:ETHUSDT:PERP">ETHUSDT-PERP (Binance)</option>
            <option value="BINANCE:USDS_M_PERP:XAUUSDT:PERP">XAUUSDT-GOLD (Binance PAXG)</option>
            <option value="AGGREGATED:MULTI_PERP:BTCUSDT:COMBINED">BTCUSDT-AGG (Combined)</option>
            <option value="AGGREGATED:MULTI_PERP:XAUUSDT:COMBINED">XAUUSDT-AGG (Gold Multi-Crypto Combined)</option>
          </optgroup>
        </select>

        {/* MT5 Account Connection Button */}
        <button
          onClick={onOpenMt5Modal}
          style={{
            background: snapshot.instrument_id.startsWith('MT5:')
              ? 'rgba(0, 180, 216, 0.22)'
              : '#1F2430',
            color: snapshot.instrument_id.startsWith('MT5:') ? '#00E5FF' : '#CBD5E1',
            border: snapshot.instrument_id.startsWith('MT5:')
              ? '1px solid #00E5FF'
              : '1px solid #323642',
            borderRadius: '4px',
            padding: '0 8px',
            height: '26px',
            fontSize: '10.5px',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
          title="Kết nối Tài khoản MetaTrader 5 (Exness, FTMO, IC Markets) & Chọn Symbol Forex"
        >
          <span style={{ color: '#00E676' }}>●</span>
          <span>MT5 Forex</span>
        </button>

        {/* Pill 2: History Depth & Tick Compression (10D - BT) */}
        <select
          value={tickAggregation.toString()}
          onChange={(e) => {
            const val = e.target.value;
            onTickAggregationChange?.(val === 'auto' ? 'auto' : parseInt(val, 10));
          }}
          style={centerSelectStyle}
          title="Độ sâu Lịch sử & Gom cụm Bước giá (Days - Tick Compression BT)"
        >
          <option value="auto">10D - Auto BT</option>
          <option value="1">10D - 1T</option>
          <option value="2">10D - 2T</option>
          <option value="5">10D - 5T</option>
          <option value="10">10D - 10T</option>
        </select>

        {/* Pill 3: Timeframe Selector (1 Minute, 5 Minute, 15 Minute...) */}
        <select
          value={snapshot.timeframe_us}
          onChange={(e) => onTimeframeChange?.(parseInt(e.target.value, 10))}
          style={centerSelectStyle}
          title="Khung thời gian (Timeframe Interval)"
        >
          {timeframes.map((tf) => (
            <option key={tf.value} value={tf.value}>
              {tf.label}
            </option>
          ))}
        </select>

        {/* Quick Timeframe Pills for 1-click switching */}
        <div style={{ display: 'flex', background: '#1E2028', border: '1px solid #2D313B', borderRadius: '4px', padding: '1px' }}>
          {timeframes.map((tf) => {
            const isSelected = snapshot.timeframe_us === tf.value;
            return (
              <button
                key={tf.value}
                onClick={() => onTimeframeChange?.(tf.value)}
                style={{
                  background: isSelected ? '#2D323E' : 'transparent',
                  color: isSelected ? '#00E676' : '#78889B',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '2px 6px',
                  fontSize: '10.5px',
                  fontWeight: isSelected ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {tf.short}
              </button>
            );
          })}
        </div>

        {/* + Load More Historical Bars Button (Matches green + icon next to timeframe in DeepChart) */}
        {onLoadMoreHistory && (
          <button
            onClick={onLoadMoreHistory}
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: 'rgba(0, 230, 118, 0.15)',
              border: '1px solid #00E676',
              color: '#00E676',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Nạp thêm +200 nến lịch sử từ sàn (Load More Historical Bars)"
          >
            +
          </button>
        )}
      </div>

      {/* =====================================================================
          RIGHT GROUP: Multi-Chart Layout Switcher, 4 Workspaces & Replay
          ===================================================================== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        {/* Multi-Chart Grid Layout Switcher (Matches ATAS / DeepChart Multi-Chart Icon in Top-Right) */}
        <div
          style={{
            display: 'flex',
            background: '#1E2028',
            border: '1px solid #2D313B',
            borderRadius: '4px',
            padding: '1px',
            gap: '1px',
          }}
          title="Chế độ mở nhiều biểu đồ cùng lúc & đa khung thời gian (Multi-Chart Split Layout)"
        >
          {(
            [
              { id: '1x1', label: '▢ 1', tip: '1 Biểu đồ toàn màn hình' },
              { id: '2v', label: '◫ 2V', tip: '2 Biểu đồ chia dọc (VD: Trái 5m Footprint | Phải 15m Structure)' },
              { id: '2h', label: '⊟ 2H', tip: '2 Biểu đồ chia ngang (Trên / Dưới)' },
              { id: '3L', label: '◰ 3', tip: '3 Biểu đồ (1 Lớn bên trái + 2 Nhỏ bên phải)' },
              { id: '2x2', label: '⊞ 4', tip: '4 Biểu đồ Lưới 2×2 (1m, 5m, 15m, 1h chạy song song)' },
            ] as const
          ).map((l) => {
            const isActive = multiChartLayout === l.id;
            return (
              <button
                key={l.id}
                onClick={() => onMultiChartLayoutChange?.(l.id)}
                style={{
                  background: isActive ? '#00E676' : 'transparent',
                  color: isActive ? '#090B10' : '#94A3B8',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '2px 6px',
                  fontSize: '10px',
                  fontWeight: isActive ? 800 : 600,
                  cursor: 'pointer',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
                title={l.tip}
              >
                {l.label}
              </button>
            );
          })}
        </div>

        {/* 4 Workspaces Switcher */}
        <div style={{ display: 'flex', background: '#1E2028', border: '1px solid #2D313B', borderRadius: '4px', padding: '1px', gap: '1px' }}>
          {[
            { id: 'order_flow_pro', label: 'Order Flow', color: '#00E676' },
            { id: 'options_confluence', label: 'Options GEX', color: '#C084FC' },
            { id: 'pure_heatmap', label: 'Heatmap', color: '#00E5FF' },
            { id: 'market_intel', label: 'Zones', color: '#FDB022' },
          ].map((ws) => {
            const active = layoutPreset === ws.id || (ws.id === 'order_flow_pro' && layoutPreset === 'standard');
            return (
              <button
                key={ws.id}
                onClick={() => onLayoutPresetChange?.(ws.id)}
                style={{
                  background: active ? '#2D323E' : 'transparent',
                  color: active ? ws.color : '#8E9BAE',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '2px 7px',
                  fontSize: '10.5px',
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {ws.label}
              </button>
            );
          })}
        </div>

        {/* Replay Engine Toggle */}
        <button
          onClick={() => onToggleReplay?.(!isReplayMode)}
          style={{
            background: isReplayMode ? '#FDB022' : '#252830',
            color: isReplayMode ? '#0B0D12' : '#94A3B8',
            border: `1px solid ${isReplayMode ? '#FDB022' : '#323642'}`,
            padding: '2px 7px',
            borderRadius: '4px',
            fontSize: '10.5px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          title="Bật/Tắt Chế độ Tua Lại Lịch Sử (Market Replay)"
        >
          {isReplayMode ? '⏹ Exit Replay' : '⏱ Replay'}
        </button>

        {isReplayMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: '#1E2028', padding: '1px 5px', borderRadius: '4px', border: '1px solid #FDB022' }}>
            <button
              onClick={() => (isPlaying ? onPauseReplay?.() : onPlayReplay?.())}
              style={{
                background: isPlaying ? '#EF4444' : '#00E676',
                color: '#0B0D12',
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
              style={{ background: '#2D323E', color: '#FFF', border: 'none', borderRadius: '3px', padding: '1px 4px', fontSize: '10px', cursor: 'pointer' }}
            >
              ⏭
            </button>
            <button
              onClick={() => onResetReplay?.()}
              style={{ background: '#2D323E', color: '#FFF', border: 'none', borderRadius: '3px', padding: '1px 4px', fontSize: '10px', cursor: 'pointer' }}
            >
              ⏮
            </button>
            <span style={{ fontSize: '9.5px', color: '#FDB022', fontWeight: 700 }}>
              {speed}x·{progressPct.toFixed(0)}%
            </span>
          </div>
        )}

        {/* Sound Toggle */}
        <button
          onClick={onToggleSound}
          style={{
            ...iconBtnStyle,
            color: soundEnabled ? '#00E676' : '#64748B',
          }}
          title={soundEnabled ? 'Âm thanh cảnh báo: BẬT' : 'Âm thanh cảnh báo: TẮT'}
        >
          {soundEnabled ? '🔊' : '🔇'}
        </button>
      </div>
    </header>
  );
};
