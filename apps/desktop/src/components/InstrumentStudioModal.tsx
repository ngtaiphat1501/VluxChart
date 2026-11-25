import React, { useMemo, useState } from 'react';
import {
  ActiveFrameConfig,
  CustomFrameCategory,
  listRegisteredSynthetics,
  parseSyntheticFormula,
  registerSyntheticInstrument,
} from '../utils/customFrameAndSyntheticEngine';

interface InstrumentStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeFrame?: ActiveFrameConfig;
  onApplySynthetic?: (syntheticInstrumentId: string, formula: string) => void;
  onSelectFrameType?: (type: CustomFrameCategory, value: number) => void;
}

export const InstrumentStudioModal: React.FC<InstrumentStudioModalProps> = ({
  isOpen,
  onClose,
  activeFrame,
  onApplySynthetic,
  onSelectFrameType,
}) => {
  const [synthName, setSynthName] = useState<string>('SYNTH:XAUEUR_GOLD');
  const [formula, setFormula] = useState<string>('XAUUSD / EURUSD');
  const [selectedFrameCategory, setSelectedFrameCategory] = useState<CustomFrameCategory>(
    activeFrame?.category || 'range'
  );
  const [customInputVal, setCustomInputVal] = useState<string>('12');
  const [formError, setFormError] = useState<string | null>(null);

  const liveValidation = useMemo(() => {
    try {
      const spec = parseSyntheticFormula(synthName, formula);
      return { ok: true as const, spec, error: null };
    } catch (e: any) {
      return { ok: false as const, spec: null, error: e?.message || String(e) };
    }
  }, [synthName, formula]);

  if (!isOpen) return null;

  const savedSynthetics = listRegisteredSynthetics();

  const PRESETS = [
    { id: 'SYNTH:XAUEUR_GOLD', name: 'Gold / Euro (XAUEUR)', formula: 'XAUUSD / EURUSD' },
    { id: 'SYNTH:GOLD_BASIS', name: 'Gold Basis (MT5 - Perp)', formula: 'XAUUSD - XAUUSDT' },
    { id: 'SYNTH:BTC_GOLD_OZ', name: 'BTC / Gold Ratio (Oz)', formula: 'BTCUSDT / XAUUSD' },
    { id: 'SYNTH:BTC_ETH_ARB', name: 'BTC - 25×ETH Spread', formula: 'BTCUSDT - 25 * ETHUSDT' },
    { id: 'SYNTH:NQ_YM_RATIO', name: 'Nasdaq / Dow Ratio', formula: 'NAS100 / US30' },
  ];

  const handleCreateAndOpenSynthetic = () => {
    setFormError(null);
    try {
      const spec = parseSyntheticFormula(synthName, formula);
      registerSyntheticInstrument(spec);
      onApplySynthetic?.(spec.id, spec.formula);
      onClose();
    } catch (err: any) {
      setFormError(err?.message || String(err));
    }
  };

  const handleApplyCustomFrameNumber = () => {
    const num = parseInt(customInputVal, 10);
    if (!Number.isFinite(num) || num <= 0) return;
    if (selectedFrameCategory === 'time') {
      onSelectFrameType?.('time', num * 60_000_000);
    } else {
      onSelectFrameType?.(selectedFrameCategory, num);
    }
    onClose();
  };

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
        data-testid="instrument-studio-modal"
        style={{
          width: '860px',
          maxWidth: '95vw',
          maxHeight: '92vh',
          background: '#0F121A',
          border: '1px solid #232938',
          borderRadius: '6px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.78)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div
          style={{
            height: '44px',
            background: '#161922',
            borderBottom: '1px solid #232938',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#F1F5F9', letterSpacing: '0.4px' }}>
              INSTRUMENT STUDIO · RANGE / VOLUME / TICK BARS &amp; SYNTHETIC ENGINE
            </span>
            <span
              style={{
                background: 'rgba(16, 185, 129, 0.14)',
                color: '#10B981',
                border: '1px solid rgba(16, 185, 129, 0.45)',
                fontSize: '9.5px',
                fontWeight: 700,
                padding: '1px 7px',
                borderRadius: '3px',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              100% REAL MARKET ENGINE
            </span>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid #283042',
              borderRadius: '4px',
              color: '#94A3B8',
              cursor: 'pointer',
              fontSize: '13px',
              width: '26px',
              height: '26px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* SECTION 1: REAL MULTI-LEG SYNTHETIC INSTRUMENTS BUILDER */}
          <div
            style={{
              background: '#141720',
              border: '1px solid #232938',
              borderRadius: '5px',
              padding: '13px 15px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#38BDF8' }}>
                1. TỔNG HỢP CẶP LAI TỪ DỮ LIỆU THẬT ĐA SÀN (REAL MULTI-LEG SYNTHETIC FORMULA)
              </div>
              <span style={{ fontSize: '10px', color: '#64748B', fontFamily: "'JetBrains Mono', monospace" }}>
                Toán tử: +  -  *  /  ( )
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: 1.45 }}>
              Đồng bộ trực tiếp nến thật &amp; luồng tick Realtime của tất cả các chân tài sản thành phần (MT5 ECN + Bybit/Binance) để dựng biểu đồ chênh lệch giá (Basis/Spread) và tỷ giá chéo theo thời gian thực.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '10px', color: '#8E9BAE', display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                  MÃ CẶP LAI (SYNTHETIC ID)
                </label>
                <input
                  type="text"
                  data-testid="input-synth-name"
                  value={synthName}
                  onChange={(e) => {
                    setSynthName(e.target.value);
                    setFormError(null);
                  }}
                  style={{
                    width: '100%',
                    background: '#0D0F16',
                    border: '1px solid #282E3E',
                    borderRadius: '4px',
                    padding: '6px 9px',
                    color: '#F8FAFC',
                    fontSize: '11.5px',
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '10px', color: '#8E9BAE', display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                  BIỂU THỨC TÍNH TỪ MÃ THẬT (VD: XAUUSD / EURUSD, XAUUSD - XAUUSDT)
                </label>
                <input
                  type="text"
                  data-testid="input-synth-formula"
                  value={formula}
                  onChange={(e) => {
                    setFormula(e.target.value);
                    setFormError(null);
                  }}
                  style={{
                    width: '100%',
                    background: '#0D0F16',
                    border: `1px solid ${liveValidation.ok ? '#10B981' : '#EF4444'}`,
                    borderRadius: '4px',
                    padding: '6px 9px',
                    color: '#10B981',
                    fontSize: '11.5px',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 700,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Live AST Validation Telemetry */}
            <div
              style={{
                fontSize: '10.5px',
                fontFamily: "'JetBrains Mono', monospace",
                padding: '5px 9px',
                borderRadius: '4px',
                background: liveValidation.ok ? 'rgba(16, 185, 129, 0.09)' : 'rgba(239, 68, 68, 0.12)',
                border: liveValidation.ok ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.4)',
                color: liveValidation.ok ? '#34D399' : '#FCA5A5',
              }}
            >
              {formError ||
                (liveValidation.ok
                  ? `✓ Chân dữ liệu thật (${liveValidation.spec.legInstrumentIds.length}): ${liveValidation.spec.legInstrumentIds.join('  +  ')}`
                  : `⚠ ${liveValidation.error}`)}
            </div>

            {/* Presets */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: '#8E9BAE', fontWeight: 600 }}>Mẫu định lượng:</span>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSynthName(p.id);
                    setFormula(p.formula);
                    setFormError(null);
                  }}
                  style={{
                    background: formula === p.formula ? '#1F2B3E' : '#1A1E29',
                    color: formula === p.formula ? '#38BDF8' : '#CBD5E1',
                    border: `1px solid ${formula === p.formula ? '#38BDF8' : '#2D3548'}`,
                    borderRadius: '3px',
                    padding: '3px 8px',
                    fontSize: '10px',
                    cursor: 'pointer',
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {savedSynthetics.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '10px', color: '#64748B' }}>Đã lưu gần đây:</span>
                {savedSynthetics.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      onApplySynthetic?.(s.id, s.formula);
                      onClose();
                    }}
                    style={{
                      background: '#111622',
                      color: '#10B981',
                      border: '1px solid #223530',
                      borderRadius: '3px',
                      padding: '2px 7px',
                      fontSize: '10px',
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: 'pointer',
                    }}
                    title={s.formula}
                  >
                    {s.displayName}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
              <button
                type="button"
                data-testid="btn-apply-synthetic"
                disabled={!liveValidation.ok}
                onClick={handleCreateAndOpenSynthetic}
                style={{
                  background: liveValidation.ok ? '#089981' : '#1E293B',
                  color: liveValidation.ok ? '#FFFFFF' : '#64748B',
                  border: `1px solid ${liveValidation.ok ? '#10B981' : '#334155'}`,
                  borderRadius: '4px',
                  padding: '6px 16px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: liveValidation.ok ? 'pointer' : 'not-allowed',
                }}
              >
                ✓ Tạo &amp; Mở Biểu Đồ Cặp Lai Realtime
              </button>
            </div>
          </div>

          {/* SECTION 2: NON-TIME ORDER FLOW BAR FRAMES (RANGE / VOLUME / TICK / TIME) */}
          <div
            style={{
              background: '#141720',
              border: '1px solid #232938',
              borderRadius: '5px',
              padding: '13px 15px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#38BDF8' }}>
                2. KHUNG NẾN PHI THỜI GIAN CHUẨN ATAS (RANGE BARS · VOLUME BARS · TICK BARS)
              </div>
              {activeFrame && (
                <span
                  style={{
                    fontSize: '10px',
                    fontFamily: "'JetBrains Mono', monospace",
                    color: '#FBBF24',
                    background: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    padding: '2px 7px',
                    borderRadius: '3px',
                    fontWeight: 700,
                  }}
                >
                  Đang bật: {activeFrame.category.toUpperCase()} ({activeFrame.category === 'time' ? `${Math.round(activeFrame.value / 60_000_000)}m` : activeFrame.value})
                </span>
              )}
            </div>
            <div style={{ fontSize: '11px', color: '#94A3B8' }}>
              Đóng nến dựa trên biến động thực tế của dòng lệnh thay vì đồng hồ thời gian — lọc bỏ hoàn toàn nhiễu đi ngang (sideway) và giữ nguyên 100% Footprint Bid×Ask.
            </div>

            {/* Frame Category Tabs */}
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              {(
                [
                  { id: 'range', label: 'Range Bars (Biên độ Pips/Giá)', defaultCustom: '12' },
                  { id: 'volume', label: 'Volume Bars (Khối lượng khớp)', defaultCustom: '750' },
                  { id: 'tick', label: 'Tick Bars (Số lệnh khớp)', defaultCustom: '300' },
                  { id: 'time', label: 'Time Bars (Phút / Giờ chuẩn)', defaultCustom: '5' },
                ] as const
              ).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedFrameCategory(c.id);
                    setCustomInputVal(c.defaultCustom);
                  }}
                  style={{
                    background: selectedFrameCategory === c.id ? '#222A3A' : '#1A1E29',
                    color: selectedFrameCategory === c.id ? '#FFFFFF' : '#8E9BAE',
                    border: `1px solid ${selectedFrameCategory === c.id ? '#38BDF8' : '#232938'}`,
                    borderRadius: '4px',
                    padding: '5px 10px',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Presets Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '7px' }}>
              {selectedFrameCategory === 'range' &&
                [
                  { lbl: '5 Range (5R)', val: 5 },
                  { lbl: '10 Range (10R)', val: 10 },
                  { lbl: '20 Range (20R)', val: 20 },
                  { lbl: '50 Range (50R)', val: 50 },
                  { lbl: '100 Range (100R)', val: 100 },
                ].map((f) => {
                  const isAct = activeFrame?.category === 'range' && activeFrame.value === f.val;
                  return (
                    <button
                      key={f.lbl}
                      type="button"
                      data-testid={`frame-range-${f.val}`}
                      onClick={() => {
                        onSelectFrameType?.('range', f.val);
                        onClose();
                      }}
                      style={{
                        background: isAct ? 'rgba(251, 191, 36, 0.18)' : '#1A1E29',
                        color: '#FBBF24',
                        border: `1px solid ${isAct ? '#FBBF24' : '#282E3E'}`,
                        borderRadius: '4px',
                        padding: '7px 4px',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {f.lbl}
                    </button>
                  );
                })}

              {selectedFrameCategory === 'volume' &&
                [
                  { lbl: '500 Volume', val: 500 },
                  { lbl: '1,000 Volume', val: 1000 },
                  { lbl: '2,500 Volume', val: 2500 },
                  { lbl: '5,000 Volume', val: 5000 },
                  { lbl: '10,000 Volume', val: 10000 },
                ].map((f) => {
                  const isAct = activeFrame?.category === 'volume' && activeFrame.value === f.val;
                  return (
                    <button
                      key={f.lbl}
                      type="button"
                      data-testid={`frame-volume-${f.val}`}
                      onClick={() => {
                        onSelectFrameType?.('volume', f.val);
                        onClose();
                      }}
                      style={{
                        background: isAct ? 'rgba(52, 211, 153, 0.18)' : '#1A1E29',
                        color: '#34D399',
                        border: `1px solid ${isAct ? '#34D399' : '#282E3E'}`,
                        borderRadius: '4px',
                        padding: '7px 4px',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {f.lbl}
                    </button>
                  );
                })}

              {selectedFrameCategory === 'tick' &&
                [
                  { lbl: '100 Ticks', val: 100 },
                  { lbl: '250 Ticks', val: 250 },
                  { lbl: '500 Ticks', val: 500 },
                  { lbl: '1,000 Ticks', val: 1000 },
                  { lbl: '2,000 Ticks', val: 2000 },
                ].map((f) => {
                  const isAct = activeFrame?.category === 'tick' && activeFrame.value === f.val;
                  return (
                    <button
                      key={f.lbl}
                      type="button"
                      data-testid={`frame-tick-${f.val}`}
                      onClick={() => {
                        onSelectFrameType?.('tick', f.val);
                        onClose();
                      }}
                      style={{
                        background: isAct ? 'rgba(56, 189, 248, 0.18)' : '#1A1E29',
                        color: '#38BDF8',
                        border: `1px solid ${isAct ? '#38BDF8' : '#282E3E'}`,
                        borderRadius: '4px',
                        padding: '7px 4px',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {f.lbl}
                    </button>
                  );
                })}

              {selectedFrameCategory === 'time' &&
                [
                  { lbl: '1 Phút (1m)', val: 60_000_000 },
                  { lbl: '3 Phút (3m)', val: 180_000_000 },
                  { lbl: '5 Phút (5m)', val: 300_000_000 },
                  { lbl: '15 Phút (15m)', val: 900_000_000 },
                  { lbl: '1 Giờ (1h)', val: 3_600_000_000 },
                ].map((f) => {
                  const isAct = activeFrame?.category === 'time' && activeFrame.value === f.val;
                  return (
                    <button
                      key={f.lbl}
                      type="button"
                      onClick={() => {
                        onSelectFrameType?.('time', f.val);
                        onClose();
                      }}
                      style={{
                        background: isAct ? '#262F42' : '#1A1E29',
                        color: '#CBD5E1',
                        border: `1px solid ${isAct ? '#38BDF8' : '#282E3E'}`,
                        borderRadius: '4px',
                        padding: '7px 4px',
                        fontSize: '10.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {f.lbl}
                    </button>
                  );
                })}
            </div>

            {/* Custom Parameter Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                background: '#0D0F16',
                border: '1px solid #222838',
                borderRadius: '4px',
                padding: '7px 10px',
              }}
            >
              <span style={{ fontSize: '10.5px', color: '#94A3B8' }}>
                Thông số tùy chỉnh ({selectedFrameCategory === 'range' ? 'Số Pips/Points mỗi nến' : selectedFrameCategory === 'volume' ? 'Đơn vị Volume mỗi nến' : selectedFrameCategory === 'tick' ? 'Số Tick khớp mỗi nến' : 'Số Phút mỗi nến'}):
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={customInputVal}
                  onChange={(e) => setCustomInputVal(e.target.value)}
                  style={{
                    width: '90px',
                    background: '#161B26',
                    border: '1px solid #2D3648',
                    borderRadius: '3px',
                    padding: '4px 7px',
                    color: '#F8FAFC',
                    fontSize: '11px',
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  data-testid="btn-apply-custom-frame-value"
                  onClick={handleApplyCustomFrameNumber}
                  style={{
                    background: '#0284C7',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '3px',
                    padding: '5px 12px',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Áp Dụng Khung Này
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
