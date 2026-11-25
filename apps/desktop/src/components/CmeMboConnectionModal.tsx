import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  CmeConnectionStatusDTO,
  CmeMboPollSnapshotDTO,
  CmeProviderKind,
  cmeMboService,
} from '../services/cmeMboService';

interface CmeMboConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentInstrumentId: string;
  onSelectInstrument: (instrumentId: string, forceReload?: boolean) => void;
  onMboFileImported?: (snap: CmeMboPollSnapshotDTO) => void;
}

const CME_FUTURES_LIST = [
  { id: 'CME:FUT:ES', code: 'ES.c.0', label: 'ES · E-mini S&P 500', tick: '$0.25 ($12.50)' },
  { id: 'CME:FUT:NQ', code: 'NQ.c.0', label: 'NQ · E-mini Nasdaq-100', tick: '$0.25 ($5.00)' },
  { id: 'CME:FUT:GC', code: 'GC.c.0', label: 'GC · COMEX Gold Futures', tick: '$0.10 ($10.00)' },
  { id: 'CME:FUT:CL', code: 'CL.c.0', label: 'CL · NYMEX WTI Crude', tick: '$0.01 ($10.00)' },
  { id: 'CME:FUT:6E', code: '6E.c.0', label: '6E · CME Euro FX', tick: '0.00005 ($6.25)' },
];

export const CmeMboConnectionModal: React.FC<CmeMboConnectionModalProps> = ({
  isOpen,
  onClose,
  currentInstrumentId,
  onSelectInstrument,
  onMboFileImported,
}) => {
  const [status, setStatus] = useState<CmeConnectionStatusDTO>(() =>
    cmeMboService.getCachedStatus()
  );
  const [provider, setProvider] = useState<CmeProviderKind>('databento');
  const [databentoCred, setDatabentoCred] = useState<string>('');
  const [dxfeedUrl, setDxfeedUrl] = useState<string>('wss://demo.dxfeed.com/dxlink-ws');
  const [dxfeedCode, setDxfeedCode] = useState<string>('');
  const [rithmicUri, setRithmicUri] = useState<string>('127.0.0.1:3010');
  const [rithmicUser, setRithmicUser] = useState<string>('');
  const [rithmicSystem, setRithmicSystem] = useState<string>('Rithmic Paper Trading');
  const [targetCmeId, setTargetCmeId] = useState<string>(
    currentInstrumentId.startsWith('CME:') ? currentInstrumentId : 'CME:FUT:ES'
  );
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setFeedback(null);
    if (currentInstrumentId.startsWith('CME:')) {
      setTargetCmeId(currentInstrumentId);
    }
    cmeMboService.getStatus().then((st) => {
      setStatus(st);
      setProvider(st.provider || 'databento');
      if (st.dxfeedWsUrl) setDxfeedUrl(st.dxfeedWsUrl);
      if (st.rithmicGatewayUri) setRithmicUri(st.rithmicGatewayUri);
      if (st.rithmicUser) setRithmicUser(st.rithmicUser);
      if (st.rithmicSystem) setRithmicSystem(st.rithmicSystem);
    });
  }, [isOpen, currentInstrumentId]);

  if (!isOpen) return null;

  const handleOpenExternal = (url: string) => {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      invoke('open_external_url', { url }).catch(() => {});
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSaveAndConnect = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const updated = await cmeMboService.saveAndVerifyConfig({
        provider,
        databentoCredential: databentoCred.trim() || undefined,
        dxfeedWsUrl: dxfeedUrl.trim(),
        dxfeedAccessCode: dxfeedCode.trim() || undefined,
        rithmicGatewayUri: rithmicUri.trim(),
        rithmicUser: rithmicUser.trim(),
        rithmicSystem: rithmicSystem.trim(),
      });
      setStatus(updated);
      setDatabentoCred('');
      setDxfeedCode('');
      setFeedback({ ok: true, text: updated.statusMessage });
      onSelectInstrument(targetCmeId, true);
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : e?.message || 'Không thể xác thực cổng CME MBO';
      setFeedback({ ok: false, text: msg });
    } finally {
      setBusy(false);
    }
  };

  const handleClearKey = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const cleared = await cmeMboService.clearConfig();
      setStatus(cleared);
      setDatabentoCred('');
      setFeedback({ ok: true, text: 'Đã xóa khóa kết nối CME MBO khỏi máy trạm.' });
    } finally {
      setBusy(false);
    }
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setFeedback(null);
    try {
      const snap = await cmeMboService.importBrowserFileObject(file, targetCmeId);
      const nextSt = await cmeMboService.getStatus();
      setStatus(nextSt);
      setFeedback({ ok: true, text: snap.statusMessage });
      onMboFileImported?.(snap);
      onSelectInstrument(targetCmeId, true);
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Lỗi đọc tệp CME MBO';
      setFeedback({ ok: false, text: msg });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const stateBadgeColor =
    status.statusState === 'STREAMING' || status.statusState === 'FILE_LOADED'
      ? { bg: 'rgba(16, 185, 129, 0.14)', fg: '#34D399', bd: 'rgba(16, 185, 129, 0.45)' }
      : status.statusState === 'PUBLIC_LIVE' || status.statusState === 'READY'
      ? { bg: 'rgba(56, 189, 248, 0.14)', fg: '#38BDF8', bd: 'rgba(56, 189, 248, 0.45)' }
      : status.statusState === 'ERROR'
      ? { bg: 'rgba(239, 68, 68, 0.14)', fg: '#F87171', bd: 'rgba(239, 68, 68, 0.45)' }
      : { bg: '#161B26', fg: '#94A3B8', bd: '#2A3244' };

  return (
    <div
      data-testid="cme-mbo-connection-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6, 9, 14, 0.86)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '16px',
        userSelect: 'none',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '720px',
          maxWidth: '96vw',
          maxHeight: '90vh',
          background: '#0D1118',
          border: '1px solid #232B3B',
          borderRadius: '6px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.78)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            height: '44px',
            background: '#131823',
            borderBottom: '1px solid #22293A',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 800,
                color: '#F1F5F9',
                letterSpacing: '0.3px',
              }}
            >
              CME GLOBEX LEVEL-3 MBO CONNECTOR
            </span>
            <span
              style={{
                background: stateBadgeColor.bg,
                color: stateBadgeColor.fg,
                border: `1px solid ${stateBadgeColor.bd}`,
                fontSize: '9.5px',
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: '3px',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {status.statusState}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748B',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '2px 6px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: '16px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {/* BYOK Architecture Notice */}
          <div
            style={{
              background: '#121722',
              border: '1px solid #1E2738',
              borderRadius: '4px',
              padding: '10px 12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: 1.45 }}>
              <strong style={{ color: '#38BDF8' }}>Cơ chế 2 Tầng Thông Minh:</strong>{' '}
              <strong style={{ color: '#E2E8F0' }}>Tầng 1 (Miễn phí 100%):</strong> Nến &amp; Khối lượng CME (ES=F, NQ=F, GC=F, CL=F, 6E=F) tự động chạy ngay không cần khóa.{' '}
              <strong style={{ color: '#34D399' }}>Tầng 2:</strong> Nhập khóa Databento ($125 miễn phí) / Rithmic để mở khóa thêm Sổ lệnh hàng đợi FIFO từng lô (L3 MBO) &amp; Iceberg gốc trên thang DOM.
            </div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '10px',
                color: '#38BDF8',
                whiteSpace: 'nowrap',
                textAlign: 'right',
              }}
            >
              <div>Events: {status.totalMboEventsProcessed.toLocaleString()}</div>
              <div>FIFO Queue: {status.restingOrdersCount.toLocaleString()} ord</div>
            </div>
          </div>

          {/* Target CME Contract Selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#CBD5E1' }}>
              1. HỢP ĐỒNG TƯƠNG LAI MỸ CME GLOBEX (CONTINUOUS FRONT-MONTH)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
              {CME_FUTURES_LIST.map((item) => {
                const isSelected = targetCmeId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`cme-contract-${item.code}`}
                    onClick={() => {
                      setTargetCmeId(item.id);
                      if (status.configured || status.statusState === 'FILE_LOADED') {
                        onSelectInstrument(item.id, true);
                      }
                    }}
                    style={{
                      background: isSelected ? 'rgba(14, 165, 233, 0.16)' : '#141924',
                      border: `1px solid ${isSelected ? '#38BDF8' : '#232B3D'}`,
                      borderRadius: '4px',
                      padding: '7px 6px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 800,
                        color: isSelected ? '#F8FAFC' : '#CBD5E1',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {item.code}
                    </span>
                    <span style={{ fontSize: '9.5px', color: '#64748B' }}>{item.tick}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Gateway Provider Tabs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#CBD5E1' }}>
              2. CHỌN CỔNG DỮ LIỆU GỐC CME LEVEL-3 MBO
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {(
                [
                  {
                    id: 'databento',
                    title: 'Databento GLBX.MDP3',
                    sub: 'Khuyên dùng · Live TCP + REST + File',
                  },
                  {
                    id: 'dxfeed',
                    title: 'dxFeed (dxLink)',
                    sub: 'Cổng WebSocket CME / Quỹ Mỹ',
                  },
                  {
                    id: 'rithmic',
                    title: 'Rithmic R|Protocol',
                    sub: 'Apex · Topstep · Bulenox Local Plant',
                  },
                ] as const
              ).map((tab) => {
                const active = provider === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    data-testid={`cme-provider-${tab.id}`}
                    onClick={() => setProvider(tab.id)}
                    style={{
                      background: active ? '#192231' : '#121620',
                      border: `1px solid ${active ? '#10B981' : '#22293A'}`,
                      borderRadius: '4px',
                      padding: '8px 10px',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: active ? '#F8FAFC' : '#94A3B8',
                      }}
                    >
                      {tab.title}
                    </div>
                    <div style={{ fontSize: '9.5px', color: '#64748B', marginTop: '2px' }}>
                      {tab.sub}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Provider Specific Configuration Form */}
          {provider === 'databento' && (
            <div
              style={{
                background: '#121722',
                border: '1px solid #222B3C',
                borderRadius: '5px',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#E2E8F0' }}>
                  Khóa truy cập Databento (GLBX.MDP3 · Schema mbo &amp; ohlcv-1m)
                </span>
                <button
                  type="button"
                  onClick={() => handleOpenExternal('https://databento.com/signup')}
                  style={{
                    background: 'transparent',
                    border: '1px solid #2A364B',
                    color: '#38BDF8',
                    borderRadius: '3px',
                    padding: '2px 8px',
                    fontSize: '10px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Lấy khóa Databento ($125 Credit CME miễn phí) ↗
                </button>
              </div>

              <input
                type="password"
                data-testid="input-databento-credential"
                value={databentoCred}
                onChange={(e) => setDatabentoCred(e.target.value)}
                placeholder={
                  status.configured && status.provider === 'databento'
                    ? `Đã lưu trên máy: ${status.maskedCredential} (Nhập mới để ghi đè)`
                    : 'Nhập khóa db-xxxxxxxxxxxxxxxxxxxxxxxxxxxx (Lưu cục bộ an toàn trên máy bạn)'
                }
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: '#0B0E15',
                  border: '1px solid #2B3548',
                  borderRadius: '4px',
                  padding: '8px 10px',
                  color: '#F8FAFC',
                  fontSize: '11.5px',
                  fontFamily: "'JetBrains Mono', monospace",
                  outline: 'none',
                }}
              />

              <div style={{ fontSize: '10px', color: '#64748B', lineHeight: 1.4 }}>
                • Live Stream: Kết nối TCP trực tiếp tới{' '}
                <code style={{ color: '#94A3B8' }}>glbx-mdp3.lsg.databento.com:13000</code> (CRAM-SHA256 +{' '}
                <code style={{ color: '#94A3B8' }}>snapshot=1</code> nạp toàn bộ sổ lệnh chờ FIFO).
                <br />• Lịch sử nến: Đồng bộ trực tiếp từ{' '}
                <code style={{ color: '#94A3B8' }}>hist.databento.com/v0/timeseries.get_range</code>.
              </div>

              {/* Offline / Weekend Real Databento Capture File Loader */}
              <div
                style={{
                  borderTop: '1px solid #1E2636',
                  paddingTop: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <div style={{ fontSize: '10.5px', color: '#94A3B8' }}>
                  <strong style={{ color: '#CBD5E1' }}>Nạp tệp gói lệnh CME MBO thật từ ổ cứng:</strong>{' '}
                  Hỗ trợ tệp <code style={{ color: '#38BDF8' }}>.mbo.json</code>,{' '}
                  <code style={{ color: '#38BDF8' }}>.ndjson</code>,{' '}
                  <code style={{ color: '#38BDF8' }}>.csv</code>,{' '}
                  <code style={{ color: '#38BDF8' }}>.gz</code> xuất từ Databento để phân tích hàng đợi L3 ngoài giờ phiên Mỹ.
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.ndjson,.csv,.gz"
                  onChange={handleFilePicked}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  data-testid="btn-import-cme-mbo-file"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    background: '#1A2232',
                    color: '#E2E8F0',
                    border: '1px solid #334155',
                    borderRadius: '4px',
                    padding: '6px 11px',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  Nạp File MBO (.json/.csv)
                </button>
              </div>
            </div>
          )}

          {provider === 'dxfeed' && (
            <div
              style={{
                background: '#121722',
                border: '1px solid #222B3C',
                borderRadius: '5px',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <label style={{ fontSize: '10.5px', color: '#CBD5E1', fontWeight: 700 }}>
                dxFeed dxLink WebSocket Endpoint (CME Globex Entitlement)
              </label>
              <input
                type="text"
                value={dxfeedUrl}
                onChange={(e) => setDxfeedUrl(e.target.value)}
                placeholder="wss://..."
                style={{
                  background: '#0B0E15',
                  border: '1px solid #2B3548',
                  borderRadius: '4px',
                  padding: '7px 10px',
                  color: '#F8FAFC',
                  fontSize: '11px',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              />
              <label style={{ fontSize: '10.5px', color: '#CBD5E1', fontWeight: 700 }}>
                dxLink Authorization Token (BYOK)
              </label>
              <input
                type="password"
                value={dxfeedCode}
                onChange={(e) => setDxfeedCode(e.target.value)}
                placeholder="Nhập Bearer / dxLink Token của tài khoản dxFeed CME..."
                style={{
                  background: '#0B0E15',
                  border: '1px solid #2B3548',
                  borderRadius: '4px',
                  padding: '7px 10px',
                  color: '#F8FAFC',
                  fontSize: '11px',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              />
            </div>
          )}

          {provider === 'rithmic' && (
            <div
              style={{
                background: '#121722',
                border: '1px solid #222B3C',
                borderRadius: '5px',
                padding: '12px 14px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10.5px', color: '#CBD5E1', fontWeight: 700 }}>
                  R|Trader Pro Local Plant URI
                </label>
                <input
                  type="text"
                  value={rithmicUri}
                  onChange={(e) => setRithmicUri(e.target.value)}
                  placeholder="127.0.0.1:3010"
                  style={{
                    background: '#0B0E15',
                    border: '1px solid #2B3548',
                    borderRadius: '4px',
                    padding: '7px 10px',
                    color: '#F8FAFC',
                    fontSize: '11px',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10.5px', color: '#CBD5E1', fontWeight: 700 }}>
                  Rithmic System / Prop Firm
                </label>
                <select
                  value={rithmicSystem}
                  onChange={(e) => setRithmicSystem(e.target.value)}
                  style={{
                    background: '#0B0E15',
                    border: '1px solid #2B3548',
                    borderRadius: '4px',
                    padding: '7px 10px',
                    color: '#F8FAFC',
                    fontSize: '11px',
                  }}
                >
                  <option value="Rithmic Paper Trading">Rithmic Paper Trading</option>
                  <option value="Rithmic 01">Rithmic 01 (Chicago Live)</option>
                  <option value="Apex">Apex Trader Funding</option>
                  <option value="TopstepTrader">TopstepTrader</option>
                  <option value="Bulenox">Bulenox</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10.5px', color: '#CBD5E1', fontWeight: 700 }}>
                  Rithmic User ID (Bật chế độ &quot;Allow Plugins&quot; trên R|Trader Pro trước khi kết nối)
                </label>
                <input
                  type="text"
                  value={rithmicUser}
                  onChange={(e) => setRithmicUser(e.target.value)}
                  placeholder="Ví dụ: APEX-149201-01"
                  style={{
                    background: '#0B0E15',
                    border: '1px solid #2B3548',
                    borderRadius: '4px',
                    padding: '7px 10px',
                    color: '#F8FAFC',
                    fontSize: '11px',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                />
              </div>
            </div>
          )}

          {/* Live Status / Error Feedback */}
          {(feedback || status.statusMessage) && (
            <div
              style={{
                background: feedback
                  ? feedback.ok
                    ? 'rgba(16, 185, 129, 0.1)'
                    : 'rgba(239, 68, 68, 0.12)'
                  : '#11151E',
                border: `1px solid ${
                  feedback
                    ? feedback.ok
                      ? 'rgba(16, 185, 129, 0.4)'
                      : 'rgba(239, 68, 68, 0.4)'
                    : '#202737'
                }`,
                borderRadius: '4px',
                padding: '8px 11px',
                fontSize: '11px',
                color: feedback ? (feedback.ok ? '#34D399' : '#FCA5A5') : '#94A3B8',
              }}
            >
              {feedback ? feedback.text : status.statusMessage}
            </div>
          )}

          {/* Action Footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '2px',
            }}
          >
            <button
              type="button"
              disabled={busy || (!status.configured && status.statusState === 'UNCONFIGURED')}
              onClick={handleClearKey}
              style={{
                background: 'transparent',
                color: '#94A3B8',
                border: '1px solid #273042',
                borderRadius: '4px',
                padding: '6px 12px',
                fontSize: '10.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Xóa Khóa Trên Máy
            </button>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: '#181E2B',
                  color: '#CBD5E1',
                  border: '1px solid #2B3448',
                  borderRadius: '4px',
                  padding: '7px 14px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Đóng
              </button>
              <button
                type="button"
                data-testid="btn-save-verify-cme-mbo"
                disabled={busy}
                onClick={handleSaveAndConnect}
                style={{
                  background: '#089981',
                  color: '#FFFFFF',
                  border: '1px solid #10B981',
                  borderRadius: '4px',
                  padding: '7px 16px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >
                {busy ? 'Đang xác thực cổng CME...' : '✓ Xác Thực & Mở Biểu Đồ CME L3'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
