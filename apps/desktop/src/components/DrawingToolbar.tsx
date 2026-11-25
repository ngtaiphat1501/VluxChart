import React, { useState } from 'react';
import { DrawingTool } from '../types/drawings';

interface DrawingToolbarProps {
  activeTool: DrawingTool;
  onSelectTool: (tool: DrawingTool) => void;
  currentColor: string;
  onSelectColor: (color: string) => void;
  onClearAll: () => void;
  drawingsVisible: boolean;
  onToggleVisibility: () => void;
  drawingCount: number;
}

const COLOR_PALETTE = ['#00E5FF', '#00E676', '#FFD600', '#FF4081', '#E040FB', '#FFFFFF'];

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  activeTool,
  onSelectTool,
  currentColor,
  onSelectColor,
  onClearAll,
  drawingsVisible,
  onToggleVisibility,
  drawingCount,
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);

  const tools: { id: DrawingTool; icon: string; label: string; tooltip: string }[] = [
    { id: 'cursor', icon: '↖', label: 'Pointer', tooltip: 'Pointer / Pan & Zoom (Default)' },
    { id: 'trendline', icon: '╱', label: 'Trendline', tooltip: 'Draw Order Flow Trendline (Click start & end points)' },
    { id: 'horizontal_ray', icon: '⟶', label: 'Horiz Ray', tooltip: 'Draw Horizontal Support/Resistance Price Ray' },
    { id: 'imbalance_box', icon: '▭', label: 'Box', tooltip: 'Draw Order Flow Imbalance / Consolidation Box' },
    { id: 'fibonacci', icon: '☷', label: 'Fibonacci', tooltip: 'Draw Fibonacci Retracement Levels (0% to 100%)' },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        left: '12px',
        top: '60px',
        zIndex: 25,
        background: 'rgba(22, 25, 32, 0.92)',
        backdropFilter: 'blur(8px)',
        border: '1px solid #2B303C',
        borderRadius: '6px',
        display: 'flex',
        flexDirection: 'column',
        padding: '4px',
        gap: '4px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
      }}
    >
      {/* Tool Buttons */}
      {tools.map((t) => {
        const isActive = activeTool === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onSelectTool(t.id)}
            style={{
              width: '32px',
              height: '32px',
              background: isActive ? '#00E5FF' : 'transparent',
              color: isActive ? '#121418' : '#8E9AA8',
              border: 'none',
              borderRadius: '4px',
              fontSize: '15px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            title={`${t.label}: ${t.tooltip}`}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.color = '#FFF';
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.color = '#8E9AA8';
            }}
          >
            {t.icon}
          </button>
        );
      })}

      <div style={{ height: '1px', background: '#2B303C', margin: '2px 0' }} />

      {/* Active Color Preview & Picker Trigger */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowColorPicker((prev) => !prev)}
          style={{
            width: '32px',
            height: '24px',
            background: 'transparent',
            border: 'none',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          title="Choose Drawing Color"
        >
          <span
            style={{
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              background: currentColor,
              boxShadow: `0 0 6px ${currentColor}`,
            }}
          />
        </button>

        {showColorPicker && (
          <div
            style={{
              position: 'absolute',
              left: '38px',
              top: '0',
              background: '#1D212A',
              border: '1px solid #3F4656',
              borderRadius: '6px',
              padding: '6px',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '6px',
              boxShadow: '0 6px 20px rgba(0,0,0,0.7)',
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
                  borderRadius: '50%',
                  background: c,
                  cursor: 'pointer',
                  border: c === currentColor ? '2px solid #FFF' : '1px solid rgba(255,255,255,0.2)',
                  boxShadow: c === currentColor ? `0 0 8px ${c}` : 'none',
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ height: '1px', background: '#2B303C', margin: '2px 0' }} />

      {/* Visibility Toggle */}
      <button
        onClick={onToggleVisibility}
        style={{
          width: '32px',
          height: '28px',
          background: 'transparent',
          color: drawingsVisible ? '#00E676' : '#546E7A',
          border: 'none',
          borderRadius: '4px',
          fontSize: '13px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={drawingsVisible ? 'Hide Annotations' : 'Show Annotations'}
      >
        {drawingsVisible ? '👁' : '🚫'}
      </button>

      {/* Clear All Drawings */}
      {drawingCount > 0 && (
        <button
          onClick={() => {
            if (window.confirm(`Clear all ${drawingCount} drawings on this chart?`)) {
              onClearAll();
            }
          }}
          style={{
            width: '32px',
            height: '28px',
            background: 'transparent',
            color: '#FF5252',
            border: 'none',
            borderRadius: '4px',
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title={`Clear ${drawingCount} Annotations`}
        >
          🗑
        </button>
      )}
    </div>
  );
};
