import React, { useState } from 'react';

interface InstrumentStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplySynthetic?: (symbolName: string, formula: string) => void;
  onSelectFrameType?: (type: string, value: number) => void;
}

export const InstrumentStudioModal: React.FC<InstrumentStudioModalProps> = ({
  isOpen,
  onClose,
  onApplySynthetic,
  onSelectFrameType,
}) => {
  const [synthName, setSynthName] = useState<string>('SYNTH:BTC_ETH_SPREAD');
  const [formula, setFormula] = useState<string>('BTCUSDT - 30 * ETHUSDT');
  const [selectedFrameCategory, setSelectedFrameCategory] = useState<'time' | 'volume' | 'tick' | 'range'>('time');

  if (!isOpen) return null;

  const PRESETS = [
    { name: 'BTC / ETH Spread', formula: 'BTCUSDT - 30 * ETHUSDT' },
    { name: 'Gold Euro Cross', formula: 'XAUUSD / EURUSD' },
    { name: 'Crypto Dominance Ratio', formula: 'BTCUSDT / (ETHUSDT * 30)' },
    { name: 'S&P 500 / Nasdaq Ratio', formula: 'SP500 / NAS100' },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(5, 7, 12, 0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '16px',
        userSelect: 'none',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '840px',
          maxWidth: '95vw',
          background: '#0F121A',
          border: '1px solid #232938',
          borderRadius: '6px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.75)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div
          style={{
            height: '42px',
            background: '#161922',
            borderBottom: '1px solid #232938',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#F1F5F9', letterSpacing: '0.4px' }}>
              INSTRUMENT STUDIO & CUSTOM FRAME TYPES
            </span>
            <span
              style={{
                background: '#1E2330',
                color: '#38BDF8',
                border: '1px solid #2D3548',
                fontSize: '9px',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: '3px',
                fontFamily: 'monospace',
              }}
            >
              ATAS COMPLIANT
            </span>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748B',
              cursor: 'pointer',
              fontSize: '13px',
              padding: '2px 6px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* SECTION 1: SYNTHETIC INSTRUMENTS BUILDER */}
          <div
            style={{
              background: '#141720',
              border: '1px solid #232938',
              borderRadius: '4px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#38BDF8' }}>
              1. TỔNG HỢP CẶP LAI ĐỊNH CHẾ (SYNTHETIC INSTRUMENT STUDIO)
            </div>
            <div style={{ fontSize: '10px', color: '#94A3B8', lineHeight: 1.5 }}>
              Tạo cặp tài sản tổng hợp dựa trên phép toán số học giữa các cặp tiền tệ, hợp đồng Futures hoặc kim loại. Phục vụ phân tích chênh lệch giá (Spread Trading) và tương quan dòng tiền.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '9.5px', color: '#64748B', display: 'block', marginBottom: '3px' }}>
                  TÊN TÀI SẢN MỚI
                </label>
                <input
                  type="text"
                  value={synthName}
                  onChange={(e) => setSynthName(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#0D0F16',
                    border: '1px solid #282E3E',
                    borderRadius: '3px',
                    padding: '5px 8px',
                    color: '#F8FAFC',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '9.5px', color: '#64748B', display: 'block', marginBottom: '3px' }}>
                  BIỂU THỨC TÍNH TOÁN (FORMULA)
                </label>
                <input
                  type="text"
                  value={formula}
                  onChange={(e) => setFormula(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#0D0F16',
                    border: '1px solid #282E3E',
                    borderRadius: '3px',
                    padding: '5px 8px',
                    color: '#10B981',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Presets */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '9.5px', color: '#64748B' }}>Mẫu có sẵn:</span>
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    setSynthName(`SYNTH:${p.name.replace(/\s+/g, '_').toUpperCase()}`);
                    setFormula(p.formula);
                  }}
                  style={{
                    background: '#1E2330',
                    color: '#CBD5E1',
                    border: '1px solid #2D3548',
                    borderRadius: '3px',
                    padding: '2px 6px',
                    fontSize: '9px',
                    cursor: 'pointer',
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button
                onClick={() => {
                  onApplySynthetic?.(synthName, formula);
                  onClose();
                }}
                style={{
                  background: '#089981',
                  color: '#FFFFFF',
                  border: '1px solid #067A67',
                  borderRadius: '3px',
                  padding: '5px 14px',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✓ Tạo & Xem Cặp Lai Này
              </button>
            </div>
          </div>

          {/* SECTION 2: ALL STANDARD, UNIQUE & CUSTOM FRAME TYPES */}
          <div
            style={{
              background: '#141720',
              border: '1px solid #232938',
              borderRadius: '4px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#38BDF8' }}>
              2. TOÀN BỘ KHUNG NẾN ĐỊNH LƯỢNG (ALL STANDARD & CUSTOM FRAME TYPES)
            </div>
            <div style={{ fontSize: '10px', color: '#94A3B8' }}>
              Lựa chọn phương thức đóng nến theo Thời gian (Time), Khối lượng (Volume), Số lượng lệnh (Tick) hoặc Biên độ giá (Range).
            </div>

            {/* Frame Category Tabs */}
            <div style={{ display: 'flex', gap: '4px' }}>
              {[
                { id: 'time' as const, label: 'Thời Gian (Minutes/Hours)' },
                { id: 'volume' as const, label: 'Volume Bars (Khối lượng)' },
                { id: 'tick' as const, label: 'Tick Bars (Số nhịp khớp)' },
                { id: 'range' as const, label: 'Range Bars (Biên độ Pips)' },
              ].map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedFrameCategory(c.id)}
                  style={{
                    background: selectedFrameCategory === c.id ? '#262D3D' : '#1A1E29',
                    color: selectedFrameCategory === c.id ? '#FFFFFF' : '#8E9BAE',
                    border: `1px solid ${selectedFrameCategory === c.id ? '#38BDF8' : '#232938'}`,
                    borderRadius: '3px',
                    padding: '4px 8px',
                    fontSize: '9.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Presets Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
              {selectedFrameCategory === 'time' &&
                [
                  { lbl: '1 Phút (1m)', val: 60000000 },
                  { lbl: '3 Phút (3m)', val: 180000000 },
                  { lbl: '5 Phút (5m)', val: 300000000 },
                  { lbl: '15 Phút (15m)', val: 900000000 },
                  { lbl: '1 Giờ (1h)', val: 3600000000 },
                ].map((f) => (
                  <button
                    key={f.lbl}
                    onClick={() => {
                      onSelectFrameType?.('time', f.val);
                      onClose();
                    }}
                    style={{
                      background: '#1A1E29',
                      color: '#CBD5E1',
                      border: '1px solid #282E3E',
                      borderRadius: '3px',
                      padding: '6px 4px',
                      fontSize: '10px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {f.lbl}
                  </button>
                ))}

              {selectedFrameCategory === 'volume' &&
                [
                  { lbl: '500 Volume', val: 500 },
                  { lbl: '1,000 Volume', val: 1000 },
                  { lbl: '2,500 Volume', val: 2500 },
                  { lbl: '5,000 Volume', val: 5000 },
                  { lbl: '10,000 Volume', val: 10000 },
                ].map((f) => (
                  <button
                    key={f.lbl}
                    onClick={() => {
                      onSelectFrameType?.('volume', f.val);
                      onClose();
                    }}
                    style={{
                      background: '#1A1E29',
                      color: '#34D399',
                      border: '1px solid #282E3E',
                      borderRadius: '3px',
                      padding: '6px 4px',
                      fontSize: '10px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {f.lbl}
                  </button>
                ))}

              {selectedFrameCategory === 'tick' &&
                [
                  { lbl: '100 Ticks', val: 100 },
                  { lbl: '250 Ticks', val: 250 },
                  { lbl: '500 Ticks', val: 500 },
                  { lbl: '1,000 Ticks', val: 1000 },
                  { lbl: '2,000 Ticks', val: 2000 },
                ].map((f) => (
                  <button
                    key={f.lbl}
                    onClick={() => {
                      onSelectFrameType?.('tick', f.val);
                      onClose();
                    }}
                    style={{
                      background: '#1A1E29',
                      color: '#38BDF8',
                      border: '1px solid #282E3E',
                      borderRadius: '3px',
                      padding: '6px 4px',
                      fontSize: '10px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {f.lbl}
                  </button>
                ))}

              {selectedFrameCategory === 'range' &&
                [
                  { lbl: '5 Range (5R)', val: 5 },
                  { lbl: '10 Range (10R)', val: 10 },
                  { lbl: '20 Range (20R)', val: 20 },
                  { lbl: '50 Range (50R)', val: 50 },
                  { lbl: '100 Range (100R)', val: 100 },
                ].map((f) => (
                  <button
                    key={f.lbl}
                    onClick={() => {
                      onSelectFrameType?.('range', f.val);
                      onClose();
                    }}
                    style={{
                      background: '#1A1E29',
                      color: '#FBBF24',
                      border: '1px solid #282E3E',
                      borderRadius: '3px',
                      padding: '6px 4px',
                      fontSize: '10px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {f.lbl}
                  </button>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
