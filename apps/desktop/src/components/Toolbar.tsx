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
        height: '38px',
        minHeight: '38px',
        background: '#12141B',
        borderBottom: '1px solid #232733',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 10px',
        gap: '8px',
        userSelect: 'none',
        zIndex: 20,
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
            maxWidth: '170px',
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

        {/* Timeframe Quick Switcher */}
        <div style={{ display: 'flex', background: '#181B23', border: '1px solid #282C38', borderRadius: '4px', padding: '1px' }}>
          {timeframes.map((tf) => {
            const isSelected = snapshot.timeframe_us === tf.value;
            return (
              <button
                key={tf.value}
                onClick={() => onTimeframeChange?.(tf.value)}
                style={{
                  background: isSelected ? '#2A303F' : 'transparent',
                  color: isSelected ? '#38BDF8' : '#78889B',
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
            title="Nạp thêm 200 nến lịch sử từ sàn"
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
          style={{ ...centerSelectStyle, background: '#181B23', border: '1px solid #282C38', fontSize: '10.5px', padding: '2px 6px' }}
          title="Độ sâu Lịch sử & Gom cụm Bước giá"
        >
          <option value="auto">10D - Auto BT</option>
          <option value="1">10D - 1T</option>
          <option value="2">10D - 2T</option>
          <option value="5">10D - 5T</option>
          <option value="10">10D - 10T</option>
        </select>
      </div>

      {/* =====================================================================
          GROUP 2 (CENTER): Indicators (Ctrl+I), Templates & Multi-Chart
          ===================================================================== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        {/* Indicators Manager Button (ATAS Ctrl+I Standard) */}
        <button
          onClick={onOpenIndicators}
          style={{
            background: '#181B23',
            border: '1px solid #2E384D',
            borderRadius: '4px',
            color: '#38BDF8',
            padding: '2px 9px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            height: '26px',
          }}
          title="Quản lý Chỉ báo Order Flow & Định lượng (Ctrl + I)"
        >
          <span>Chỉ báo (Ctrl+I)</span>
        </button>

        {/* Templates Selector */}
        <select
          onChange={(e) => {
            const val = e.target.value;
            if (val) {
              window.dispatchEvent(new CustomEvent('vluxchart:apply_preset', { detail: val }));
            }
          }}
          defaultValue=""
          style={{ ...centerSelectStyle, background: '#181B23', border: '1px solid #282C38', color: '#CBD5E1', fontSize: '11px', padding: '2px 8px' }}
          title="Mẫu Thiết Lập Biểu Đồ Chuẩn (Templates)"
        >
          <option value="" disabled>Mẫu Biểu Đồ ▾</option>
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
                  padding: '2px 6px',
                  fontSize: '10.5px',
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
          GROUP 3 (RIGHT): ATAS [T] Chart Trader, [DOM], Replay & Controls
          ===================================================================== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        {/* ATAS [T] Chart Trader Toggle Button */}
        <button
          onClick={() => onToggleRightTab?.('trading')}
          style={{
            background: activeRightTab === 'trading' ? 'rgba(8, 153, 129, 0.22)' : '#181B23',
            color: activeRightTab === 'trading' ? '#089981' : '#CBD5E1',
            border: activeRightTab === 'trading' ? '1px solid #089981' : '1px solid #282C38',
            borderRadius: '4px',
            padding: '2px 8px',
            height: '26px',
            fontSize: '11px',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title="Bật/Tắt Bảng Đặt Lệnh Nhanh [T] (ATAS Chart Trader)"
        >
          <span style={{ color: activeRightTab === 'trading' ? '#089981' : '#94A3B8' }}>[T]</span>
          <span>Trader</span>
        </button>

        {/* [DOM] Ladder Toggle Button */}
        <button
          onClick={() => onToggleRightTab?.('dom_tape')}
          style={{
            background: activeRightTab === 'dom_tape' || activeRightTab === 'dom' ? 'rgba(56, 189, 248, 0.22)' : '#181B23',
            color: activeRightTab === 'dom_tape' || activeRightTab === 'dom' ? '#38BDF8' : '#CBD5E1',
            border: activeRightTab === 'dom_tape' || activeRightTab === 'dom' ? '1px solid #38BDF8' : '1px solid #282C38',
            borderRadius: '4px',
            padding: '2px 8px',
            height: '26px',
            fontSize: '11px',
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
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            height: '26px',
          }}
          title="Bật/Tắt Chế độ Tua Lại Lịch Sử (Market Replay)"
        >
          {isReplayMode ? '⏹ Exit' : '⏱ Replay'}
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

        {/* Backtest Strategy Icon */}
        <button
          onClick={onOpenBacktest}
          style={{ ...iconBtnStyle, color: '#089981', fontWeight: 700 }}
          title="Kiểm thử Chiến lược Order Flow (Backtest $)"
        >
          $
        </button>

        {/* Settings Gear */}
        <button
          onClick={onOpenSettings}
          style={iconBtnStyle}
          title="Cài đặt Biểu đồ"
        >
          ⚙
        </button>

        {/* Sound Toggle */}
        <button
          onClick={onToggleSound}
          style={{
            ...iconBtnStyle,
            color: soundEnabled ? '#089981' : '#64748B',
          }}
          title={soundEnabled ? 'Âm thanh cảnh báo: BẬT' : 'Âm thanh cảnh báo: TẮT'}
        >
          {soundEnabled ? '🔊' : '🔇'}
        </button>
      </div>
    </header>
  );
};
