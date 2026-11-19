import React, { useState } from 'react';
import { DrawingTool } from '../types/drawings';

interface LeftToolsSidebarProps {
  activeTool: DrawingTool;
  onSelectTool: (tool: DrawingTool) => void;
  currentColor: string;
  onSelectColor: (color: string) => void;
  onClearAll: () => void;
  onUndoLast?: () => void;
  onFitView?: () => void;
  drawingsVisible: boolean;
  onToggleVisibility: () => void;
  drawingCount: number;
  magnetEnabled?: boolean;
  onToggleMagnet?: () => void;
}

const COLOR_PALETTE = ['#00E676', '#00E5FF', '#FFD600', '#FF4081', '#A855F7', '#F97316', '#38BDF8', '#FFFFFF'];

export const LeftToolsSidebar: React.FC<LeftToolsSidebarProps> = ({
  activeTool,
  onSelectTool,
  currentColor,
  onSelectColor,
  onClearAll,
  onUndoLast,
  onFitView,
  drawingsVisible,
  onToggleVisibility,
  drawingCount,
  magnetEnabled = false,
  onToggleMagnet,
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);

  const btnStyle = (isActive: boolean): React.CSSProperties => ({
    width: '26px',
    height: '25px',
    background: isActive ? '#4ADE80' : 'transparent',
    color: isActive ? '#0B0D12' : '#94A3B8',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12.5px',
    fontWeight: isActive ? 800 : 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.12s ease',
  });

  return (
    <nav
      style={{
        width: '36px',
        height: '100%',
        background: '#16181D',
        borderRight: '1px solid #262932',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '5px 0',
        zIndex: 15,
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Top & Middle TradingView Drawing Tools Group */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
        {/* 1. Pointer / Crosshair Cursor (TradingView Default) */}
        <button
          onClick={() => onSelectTool('cursor')}
          style={btnStyle(activeTool === 'cursor')}
          title="Con trỏ chọn / kéo di chuyển hình vẽ & biểu đồ (Esc)"
        >
          ✚
        </button>

        {/* 2. Auto-Fit Chart */}
        <button
          onClick={() => onFitView?.()}
          style={btnStyle(false)}
          title="Tự động căn chỉnh khung nhìn (Double-click biểu đồ)"
        >
          🔍
        </button>

        {/* 3. Undo Last Drawing */}
        <button
          onClick={() => onUndoLast?.()}
          style={btnStyle(false)}
          title="Hoàn tác nét vẽ gần nhất (Ctrl+Z)"
        >
          ↺
        </button>

        <div style={{ width: '20px', height: '1px', background: '#262932', margin: '2px 0' }} />

        {/* 4. Horizontal Line (Full-Width TradingView Alt+H) */}
        <button
          onClick={() => onSelectTool('horizontal_line')}
          style={btnStyle(activeTool === 'horizontal_line')}
          title="Đường Ngang Toàn Biểu Đồ kèm Nhãn Giá Trục Y (Horizontal Line - Alt+H)"
        >
          ━
        </button>

        {/* 5. Horizontal Ray (Alt+R) */}
        <button
          onClick={() => onSelectTool('horizontal_ray')}
          style={btnStyle(activeTool === 'horizontal_ray')}
          title="Tia Giá Ngang (Horizontal Price Ray - Alt+R)"
        >
          ─
        </button>

        {/* 6. Trendline */}
        <button
          onClick={() => onSelectTool('trendline')}
          style={btnStyle(activeTool === 'trendline')}
          title="Đường Xu Hướng (Trendline - Click 2 điểm hoặc giữ kéo)"
        >
          ╱
        </button>

        {/* 7. Trend Arrow / Path */}
        <button
          onClick={() => onSelectTool('arrow')}
          style={btnStyle(activeTool === 'arrow')}
          title="Mũi Tên Xu Hướng / Kịch Bản Đường Đi Giá (Arrow Marker)"
        >
          ↗
        </button>

        {/* 8. Order Block / Supply-Demand Rectangle */}
        <button
          onClick={() => onSelectTool('imbalance_box')}
          style={btnStyle(activeTool === 'imbalance_box')}
          title="Khối Order Block / Vùng Cung Cầu / FVG (Rectangle Box 8 điểm kéo + 50% Equilibrium)"
        >
          ▭
        </button>

        {/* 9. Fibonacci Retracement */}
        <button
          onClick={() => onSelectTool('fibonacci')}
          style={btnStyle(activeTool === 'fibonacci')}
          title="Fibonacci Retracement chuẩn TradingView (0, 0.236, 0.382, 0.5, 0.618, 0.786, 1)"
        >
          ☷
        </button>

        {/* 10. Freehand Brush */}
        <button
          onClick={() => onSelectTool('brush')}
          style={btnStyle(activeTool === 'brush')}
          title="Bút Vẽ Tự Do (Freehand Highlighter Brush)"
        >
          ✎
        </button>

        {/* 11. Text / SMC Callout Label */}
        <button
          onClick={() => onSelectTool('text_note')}
          style={{
            ...btnStyle(activeTool === 'text_note'),
            fontFamily: 'serif',
            fontWeight: 900,
          }}
          title="Ghi Chú Văn Bản & Nhãn Cấu Trúc SMC/ICT (BOS, CHoCH, OB, FVG, Liquidity)"
        >
          T
        </button>

        {/* 12. TradingView Price & Volume Range Ruler */}
        <button
          onClick={() => onSelectTool('price_range')}
          style={btnStyle(activeTool === 'price_range')}
          title="Thước Đo Biên Độ Giá, Pips, %, Số Nến & Tổng Volume/Delta (Hoặc giữ Shift + Click trên chart)"
        >
          📏
        </button>

        <div style={{ width: '20px', height: '1px', background: '#262932', margin: '2px 0' }} />

        {/* 13. TradingView Long Position Risk/Reward Tool (B$) */}
        <button
          onClick={() => {
            onSelectColor('#089981');
            onSelectTool('long_position');
          }}
          style={{
            ...btnStyle(activeTool === 'long_position'),
            fontSize: '10px',
            fontWeight: 900,
            color: activeTool === 'long_position' ? '#07090E' : '#00E676',
            border: activeTool === 'long_position' ? '1px solid #00E676' : '1px solid rgba(0,230,118,0.28)',
          }}
          title="Khung Lệnh Mua Long Position R:R chuẩn TradingView (Click 1 phát đặt ngay, kéo TP/SL/Entry, đẩy lệnh sang MT5)"
        >
          B$
        </button>

        {/* 14. TradingView Short Position Risk/Reward Tool (S$) */}
        <button
          onClick={() => {
            onSelectColor('#F23645');
            onSelectTool('short_position');
          }}
          style={{
            ...btnStyle(activeTool === 'short_position'),
            fontSize: '10px',
            fontWeight: 900,
            color: activeTool === 'short_position' ? '#07090E' : '#FF4081',
            border: activeTool === 'short_position' ? '1px solid #FF4081' : '1px solid rgba(255,64,129,0.28)',
          }}
          title="Khung Lệnh Bán Short Position R:R chuẩn TradingView (Click 1 phát đặt ngay, kéo TP/SL/Entry, đẩy lệnh sang MT5)"
        >
          S$
        </button>
      </div>

      {/* Bottom Utility Group: Color, Eye Visibility, Magnet, Trash */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
        <div style={{ width: '20px', height: '1px', background: '#262932', margin: '1px 0' }} />

        {/* Color Swatch Picker */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowColorPicker((prev) => !prev)}
            style={{
              width: '26px',
              height: '22px',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Chọn màu công cụ vẽ"
          >
            <div
              style={{
                width: '15px',
                height: '15px',
                borderRadius: '3px',
                background: currentColor,
                border: '1px solid #323642',
              }}
            />
          </button>

          {showColorPicker && (
            <div
              style={{
                position: 'absolute',
                left: '36px',
                bottom: '0px',
                background: '#16181D',
                border: '1px solid #323642',
                borderRadius: '6px',
                padding: '6px',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '6px',
                zIndex: 50,
                boxShadow: '0 8px 24px rgba(0,0,0,0.8)',
              }}
            >
              {COLOR_PALETTE.map((c) => (
                <div
                  key={c}
                  onClick={() => {
                    onSelectColor(c);
                    setShowColorPicker(false);
                  }}
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '3px',
                    background: c,
                    cursor: 'pointer',
                    border: currentColor === c ? '2px solid #FFF' : '1px solid #283241',
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Magnet Mode Toggle (Snaps to Candle OHLC / POC when active or holding Ctrl) */}
        <button
          onClick={() => onToggleMagnet?.()}
          style={btnStyle(magnetEnabled)}
          title="Chế độ Nam Châm bắt dính đỉnh/đáy OHLC & POC của nến (Hoặc giữ phím Ctrl khi vẽ)"
        >
          🧲
        </button>

        {/* Eye Visibility Toggle */}
        <button
          onClick={onToggleVisibility}
          style={{ ...btnStyle(drawingsVisible), position: 'relative' }}
          title={drawingsVisible ? 'Ẩn tất cả nét vẽ (Hide Drawings)' : 'Hiện tất cả nét vẽ (Show Drawings)'}
        >
          👁
          {drawingCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: '-2px',
                right: '-2px',
                background: '#00E5FF',
                color: '#0B0D12',
                fontSize: '8px',
                fontWeight: 800,
                borderRadius: '6px',
                padding: '0 3px',
                lineHeight: '10px',
              }}
            >
              {drawingCount}
            </span>
          )}
        </button>

        {/* Trash Clear All */}
        <button
          onClick={onClearAll}
          disabled={drawingCount === 0}
          style={{
            ...btnStyle(false),
            color: drawingCount > 0 ? '#EF4444' : '#475569',
            opacity: drawingCount > 0 ? 1 : 0.4,
          }}
          title="Xóa toàn bộ nét vẽ trên biểu đồ"
        >
          🗑
        </button>
      </div>
    </nav>
  );
};
