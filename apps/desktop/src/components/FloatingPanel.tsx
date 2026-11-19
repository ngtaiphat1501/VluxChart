import React, { useState, useRef, useEffect } from 'react';

interface FloatingPanelProps {
  title: string;
  initialX?: number;
  initialY?: number;
  initialWidth?: number;
  initialHeight?: number;
  minWidth?: number;
  minHeight?: number;
  onClose: () => void;
  onDock?: () => void;
  zIndex?: number;
  children: React.ReactNode;
}

export const FloatingPanel: React.FC<FloatingPanelProps> = ({
  title,
  initialX = 100,
  initialY = 80,
  initialWidth = 320,
  initialHeight = 450,
  minWidth = 240,
  minHeight = 200,
  onClose,
  onDock,
  zIndex = 50,
  children,
}) => {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag from header, ignore buttons
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newX = Math.max(10, Math.min(window.innerWidth - size.width - 10, e.clientX - dragOffset.x));
      const newY = Math.max(40, Math.min(window.innerHeight - size.height - 10, e.clientY - dragOffset.y));
      setPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, size]);

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
        minWidth: `${minWidth}px`,
        minHeight: `${minHeight}px`,
        zIndex,
        background: '#161920',
        border: '1px solid #3F4656',
        borderRadius: '6px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.75)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: isDragging ? 'none' : 'auto',
      }}
    >
      {/* Draggable Window Header */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          height: '30px',
          background: '#20242D',
          borderBottom: '1px solid #2B303C',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#E1E4EA', letterSpacing: '0.3px' }}>
          {title}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {onDock && (
            <button
              onClick={onDock}
              title="Dock into Sidebar"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8E9AA8',
                cursor: 'pointer',
                fontSize: '11px',
                padding: '2px 5px',
                borderRadius: '3px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#FFF')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#8E9AA8')}
            >
              📌
            </button>
          )}
          <button
            onClick={onClose}
            title="Close Panel"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8E9AA8',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '2px 5px',
              borderRadius: '3px',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#FF5252')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#8E9AA8')}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Panel Body Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
};
