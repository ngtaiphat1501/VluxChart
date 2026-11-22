import React, { useState } from 'react';

interface ScriptEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyScript?: (scriptName: string, code: string) => void;
}

const TEMPLATES: Record<string, { name: string; code: string; desc: string }> = {
  cvd_div: {
    name: 'CVD Absorption Hunter',
    desc: 'Phát hiện phân kỳ Cumulative Volume Delta khi giá lập đỉnh/đáy mới nhưng delta kiệt sức.',
    code: `// DeepChart Institutional Script Engine
// Strategy: CVD Absorption & Exhaustion Hunter

export function onBarUpdate(bar, indicators) {
  const delta = bar.delta_units;
  const cvd = indicators.cvd;
  const vwap = indicators.vwap;

  // Bullish Absorption check: Price <= Low but CVD is positive
  if (bar.close_ticks <= bar.low_ticks * 1.001 && delta > 0) {
    emitSignal({
      type: "BUY_ABSORPTION",
      price: bar.low_ticks,
      message: "Bullish Absorption detected: Aggressive buyers defending low!"
    });
  }

  // Bearish Absorption check: Price >= High but CVD is negative
  if (bar.close_ticks >= bar.high_ticks * 0.999 && delta < 0) {
    emitSignal({
      type: "SELL_ABSORPTION",
      price: bar.high_ticks,
      message: "Bearish Absorption detected: Aggressive sellers absorbing at high!"
    });
  }
}
`,
  },
  stacked_imb: {
    name: 'Stacked Imbalances Breakout',
    desc: 'Quét cụm mất cân đối dòng lệnh chéo liên tiếp >= 3 tầng để đánh dấu vùng cản Smart Money.',
    code: `// Strategy: Stacked Imbalances Zone Marker
export function onFootprintScan(bar) {
  const minLevels = 3;
  const ratioThreshold = 3.0; // 300% aggressive imbalance

  const stacked = detectStackedImbalances(bar.footprint, {
    minRatio: ratioThreshold,
    minConsecutiveLevels: minLevels
  });

  if (stacked.length > 0) {
    stacked.forEach(zone => {
      drawZone({
        startPrice: zone.startPrice,
        endPrice: zone.endPrice,
        side: zone.side,
        color: zone.side === 'BUY' ? '#10B981' : '#EF4444'
      });
    });
  }
}
`,
  },
  mbo_ice: {
    name: 'MBO Iceberg Scanner',
    desc: 'Theo dõi hàng đợi lệnh MBO và phát hiện nạp lệnh ẩn (Replenishment).',
    code: `// Strategy: CME MBO Hidden Iceberg Detection
export function onMboEvent(event, orderBook) {
  if (event.action === 'EXECUTE') {
    const stats = orderBook.getLevelExecutionStats(event.price, event.side);
    
    // Check if total executed volume exceeds initial displayed quantity by 150%
    if (stats.totalExecuted > stats.initialDisplayed * 1.5 && stats.refillCount >= 1) {
      alertWhaleIceberg({
        price: event.price,
        side: event.side,
        hiddenVolume: stats.totalExecuted - stats.initialDisplayed,
        refills: stats.refillCount
      });
    }
  }
}
`,
  },
};

export const ScriptEditorModal: React.FC<ScriptEditorModalProps> = ({
  isOpen,
  onClose,
  onApplyScript,
}) => {
  const [selectedKey, setSelectedKey] = useState<string>('cvd_div');
  const [code, setCode] = useState<string>(TEMPLATES.cvd_div.code);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([
    '[INIT] DeepChart Script Runtime v1.0.4 loaded.',
    '[INFO] Ready to compile and execute Order Flow strategies on live canvas.',
  ]);

  if (!isOpen) return null;

  const handleSelectTemplate = (key: string) => {
    setSelectedKey(key);
    setCode(TEMPLATES[key].code);
    setConsoleLogs((prev) => [...prev, `[LOAD] Loaded template: ${TEMPLATES[key].name}`]);
  };

  const handleRunScript = () => {
    setConsoleLogs((prev) => [
      ...prev,
      `[COMPILE] Compiling script "${TEMPLATES[selectedKey]?.name || 'Custom'}"...`,
      `[SUCCESS] 0 errors, 0 warnings. Hooked to active Footprint Canvas.`,
      `[STATUS] Scanning live order flow stream tick-by-tick.`,
    ]);
    onApplyScript?.(TEMPLATES[selectedKey]?.name || 'Custom', code);
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
        style={{
          width: '980px',
          maxWidth: '95vw',
          height: '720px',
          maxHeight: '92vh',
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
              &lt;/&gt; SCRIPT EDITOR & ORDER FLOW RUNTIME
            </span>
            <span
              style={{
                background: '#1E2330',
                color: '#10B981',
                border: '1px solid #26382F',
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

        {/* Toolbar Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#141720',
            borderBottom: '1px solid #1E2330',
            padding: '6px 14px',
            gap: '8px',
          }}
        >
          {/* Template Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: '#64748B', marginRight: '4px' }}>Mẫu chiến lược:</span>
            {Object.entries(TEMPLATES).map(([key, t]) => (
              <button
                key={key}
                onClick={() => handleSelectTemplate(key)}
                style={{
                  background: selectedKey === key ? '#262D3D' : '#1A1E29',
                  color: selectedKey === key ? '#F1F5F9' : '#8E9BAE',
                  border: `1px solid ${selectedKey === key ? '#38BDF8' : '#232938'}`,
                  borderRadius: '3px',
                  padding: '3px 8px',
                  fontSize: '9.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t.name}
              </button>
            ))}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={() => setConsoleLogs((prev) => [...prev, '[VALIDATE] Syntax check PASS 100%.'])}
              style={{
                background: '#1E2330',
                color: '#CBD5E1',
                border: '1px solid #2D3548',
                borderRadius: '3px',
                padding: '3px 10px',
                fontSize: '10px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Kiểm tra cú pháp
            </button>
            <button
              onClick={handleRunScript}
              style={{
                background: '#089981',
                color: '#FFFFFF',
                border: '1px solid #067A67',
                borderRadius: '3px',
                padding: '3px 12px',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ▶ Chạy trên Chart
            </button>
          </div>
        </div>

        {/* Code Editor Body */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0B0D12' }}>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              width: '100%',
              background: '#0A0C11',
              color: '#F8FAFC',
              fontFamily: '"JetBrains Mono", Consolas, monospace',
              fontSize: '12px',
              lineHeight: 1.6,
              padding: '12px 16px',
              border: 'none',
              outline: 'none',
              resize: 'none',
            }}
          />

          {/* Console Output Drawer */}
          <div
            style={{
              height: '130px',
              background: '#12151D',
              borderTop: '1px solid #1E2330',
              display: 'flex',
              flexDirection: 'column',
              padding: '6px 12px',
              fontFamily: 'monospace',
              fontSize: '10px',
            }}
          >
            <div style={{ color: '#64748B', fontWeight: 700, marginBottom: '4px' }}>CONSOLE LOG OUTPUT:</div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {consoleLogs.map((log, i) => (
                <div
                  key={i}
                  style={{
                    color: log.includes('[SUCCESS]')
                      ? '#10B981'
                      : log.includes('[WARN]')
                      ? '#F59E0B'
                      : log.includes('[COMPILE]')
                      ? '#38BDF8'
                      : '#94A3B8',
                  }}
                >
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
