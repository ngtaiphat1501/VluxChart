import React, { useState, useEffect } from 'react';
import { mt5BridgeService, Mt5AccountConfig, Mt5BrokerPreset } from '../services/mt5BridgeService';
import { CANONICAL_INSTRUMENTS, formatInstrumentPrice } from '../utils/instrumentRegistry';
import { getForexMarketSessionState } from '../services/liveFeedService';

interface Mt5ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentInstrumentId: string;
  onSelectInstrument: (instrumentId: string) => void;
}

const BROKER_SERVERS: Record<string, string[]> = {
  Exness: [
    'Exness-MT5Trial8',
    'Exness-MT5Trial7',
    'Exness-MT5Trial9',
    'Exness-MT5Trial10',
    'Exness-MT5Real9',
    'Exness-MT5Real14',
    'Exness-MT5Real15',
    'Exness-MT5Real20',
  ],
  FTMO: ['FTMO-Server', 'FTMO-Server2', 'FTMO-Server3', 'FTMO-Demo'],
  ICMarkets: ['ICMarketsSC-MT5-4', 'ICMarketsSC-MT5-2', 'ICMarketsSC-Demo02'],
  Pepperstone: ['Pepperstone-MT5-Live01', 'Pepperstone-MT5-Edge02', 'Pepperstone-Demo01'],
  XM: ['XMGlobal-MT5 4', 'XMGlobal-MT5 2'],
  MetaQuotes: ['MetaQuotes-Demo'],
};

export const Mt5ConnectionModal: React.FC<Mt5ConnectionModalProps> = ({
  isOpen,
  onClose,
  currentInstrumentId,
  onSelectInstrument,
}) => {
  const [account, setAccount] = useState<Mt5AccountConfig>(() => mt5BridgeService.getAccount());
  const [loginInput, setLoginInput] = useState<string>(() => mt5BridgeService.getAccount().login);
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [serverInput, setServerInput] = useState<string>(() => mt5BridgeService.getAccount().server);
  const [brokerInput, setBrokerInput] = useState<Mt5BrokerPreset>(() => mt5BridgeService.getAccount().broker || 'Exness');
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [ticketCount, setTicketCount] = useState<number>(() => mt5BridgeService.getTickets().length);

  useEffect(() => {
    const unsub = mt5BridgeService.subscribe(() => {
      const next = mt5BridgeService.getAccount();
      setAccount({ ...next });
      setTicketCount(mt5BridgeService.getTickets().length);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (isOpen) {
      mt5BridgeService.syncFromRealMt5().then((res) => {
        const latest = mt5BridgeService.getAccount();
        setAccount({ ...latest });
        setLoginInput(latest.login);
        setServerInput(latest.server);
        setTicketCount(mt5BridgeService.getTickets().length);
        if (res.ok) {
          setStatusMessage({
            ok: true,
            text: `Đã đồng bộ trực tiếp với phần mềm MetaTrader 5 trên máy: #${latest.login} (${latest.server}) · ${mt5BridgeService.getTickets().length} vị thế đang mở.`,
          });
        }
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const mt5Instruments = Object.values(CANONICAL_INSTRUMENTS).filter((i) => i.venue === 'MT5');

  const handleSyncActiveTerminal = async () => {
    setIsConnecting(true);
    setStatusMessage({ ok: true, text: 'Đang đọc tài khoản từ phần mềm MetaTrader 5 đang mở trên Windows...' });
    const res = await mt5BridgeService.syncFromRealMt5();
    setIsConnecting(false);
    const latest = mt5BridgeService.getAccount();
    setLoginInput(latest.login);
    setServerInput(latest.server);
    if (res.ok) {
      setStatusMessage({
        ok: true,
        text: `Kết nối thành công tới MT5 #${latest.login} (${latest.server}) — Chủ TK: ${latest.accountName} · Số dư: $${latest.balanceUsd.toLocaleString()} · Đang mở biểu đồ...`,
      });
      setTimeout(() => {
        if (!currentInstrumentId.startsWith('MT5:')) {
          onSelectInstrument('MT5:CFD:XAUUSD');
        }
        onClose();
      }, 600);
    } else {
      setStatusMessage({
        ok: false,
        text: res.error || 'Không tìm thấy MetaTrader 5 đang chạy trên máy. Vui lòng mở MT5 trên máy tính của bạn trước.',
      });
    }
  };

  const handleLoginWithCredentials = async () => {
    if (!loginInput.trim() || !serverInput.trim()) {
      setStatusMessage({ ok: false, text: 'Vui lòng nhập Số tài khoản (Login ID) và Máy chủ (Server).' });
      return;
    }
    setIsConnecting(true);
    setStatusMessage({
      ok: true,
      text: passwordInput.trim()
        ? `Đang đăng nhập tài khoản #${loginInput} trên máy chủ ${serverInput} qua MetaTrader 5...`
        : `Đang đồng bộ tài khoản #${loginInput} từ MetaTrader 5...`,
    });
    const res = await mt5BridgeService.loginMt5Account({
      login: loginInput.trim(),
      password: passwordInput.trim(),
      server: serverInput.trim(),
      broker: brokerInput,
    });
    setIsConnecting(false);
    const latest = mt5BridgeService.getAccount();
    if (res.ok) {
      setPasswordInput('');
      setStatusMessage({
        ok: true,
        text: `Đã kết nối trực tiếp tài khoản MT5 #${latest.login} (${latest.server}) · Số dư: $${latest.balanceUsd.toLocaleString()} · Equity: $${latest.equityUsd.toLocaleString()}`,
      });
    } else {
      setStatusMessage({
        ok: false,
        text: res.error || 'Đăng nhập MT5 thất bại. Nếu đổi sang tài khoản khác, vui lòng nhập đúng Mật khẩu MT5.',
      });
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(5, 7, 11, 0.84)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '720px',
          maxWidth: '95vw',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: '#11151F',
          border: '1px solid #2A344A',
          borderRadius: '10px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.85)',
          color: '#E2E8F0',
          padding: '20px 24px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #1E2534',
            paddingBottom: '14px',
            marginBottom: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #00B4D8 0%, #0077B6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 900,
                fontSize: '13px',
                color: '#FFF',
                boxShadow: '0 0 14px rgba(0, 180, 216, 0.4)',
              }}
            >
              MT5
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Kết Nối Trực Tiếp MetaTrader 5 (MT5) & Giao Dịch Thật
                <span
                  style={{
                    fontSize: '10px',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    background: account.isRealMt5Terminal ? 'rgba(0, 230, 118, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                    color: account.isRealMt5Terminal ? '#00E676' : '#F59E0B',
                    border: `1px solid ${account.isRealMt5Terminal ? '#00E676' : '#F59E0B'}`,
                    fontWeight: 800,
                  }}
                >
                  {account.isRealMt5Terminal ? `● LIVE MT5 TERMINAL (#${account.login})` : '○ CHƯA ĐỒNG BỘ MT5'}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#8E9BAE', marginTop: '2px' }}>
                Đồng bộ dữ liệu nến thật, số dư thật và thực thi lệnh trực tiếp với phần mềm MetaTrader 5 trên Windows của bạn
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#1C2230',
              border: '1px solid #2D3748',
              color: '#94A3B8',
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 800,
            }}
          >
            ✕
          </button>
        </div>

        {/* Live Connected Account Telemetry Card */}
        <div
          style={{
            background: 'linear-gradient(90deg, rgba(0, 230, 118, 0.08) 0%, rgba(0, 180, 216, 0.08) 100%)',
            border: '1px solid rgba(0, 230, 118, 0.35)',
            borderRadius: '8px',
            padding: '12px 14px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div>
            <div style={{ fontSize: '10px', color: '#94A3B8', fontWeight: 700 }}>TÀI KHOẢN MT5 ĐANG ĐỒNG BỘ TRỰC TIẾP</div>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#F8FAFC', marginTop: '2px' }}>
              #{account.login} · <span style={{ color: '#00E5FF' }}>{account.server}</span> · {account.accountName}
            </div>
            <div style={{ fontSize: '11px', color: '#CBD5E1', marginTop: '4px', fontFamily: 'JetBrains Mono, monospace' }}>
              Balance: <strong style={{ color: '#F8FAFC' }}>${account.balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
              {'  |  '}
              Equity: <strong style={{ color: '#00E676' }}>${account.equityUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
              {'  |  '}
              Floating P/L:{' '}
              <strong style={{ color: (account.floatingPnlUsd || 0) >= 0 ? '#00E676' : '#FF4081' }}>
                {(account.floatingPnlUsd || 0) >= 0 ? '+' : ''}${(account.floatingPnlUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </strong>
              {'  |  '}
              Vị thế mở: <strong style={{ color: '#FFD600' }}>{ticketCount} lệnh</strong>
            </div>
          </div>

          <button
            onClick={handleSyncActiveTerminal}
            disabled={isConnecting}
            style={{
              background: '#00E676',
              color: '#07090E',
              border: 'none',
              borderRadius: '6px',
              padding: '9px 16px',
              fontSize: '12px',
              fontWeight: 900,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(0, 230, 118, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>⚡</span>
            <span>TỰ ĐỘNG KẾT NỐI & VÀO BIỂU ĐỒ (1-Click)</span>
          </button>
        </div>

        {/* Section 1: Quick Switch to MT5 Symbols (showing real Weekend Closed vs 24/7 Open status) */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 800, color: '#00E5FF', letterSpacing: '0.5px', marginBottom: '8px' }}>
            1. CHỌN SYMBOL TRÊN MT5 (DỮ LIỆU NẾN THẬT TỪ MT5 · FOREX NGHỈ CUỐI TUẦN, BTCUSD CHẠY 24/7)
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '7px',
            }}
          >
            {mt5Instruments.map((inst) => {
              const isSelected = currentInstrumentId === inst.id;
              const session = getForexMarketSessionState(inst.id);
              const isClosed = session.isClosedWeekend;
              return (
                <button
                  key={inst.id}
                  onClick={() => {
                    onSelectInstrument(inst.id);
                    setStatusMessage({
                      ok: true,
                      text: `Đã chuyển sang ${inst.symbol} (${inst.priceDecimals} số lẻ) — Dữ liệu lịch sử lấy trực tiếp từ MetaTrader 5.`,
                    });
                  }}
                  style={{
                    background: isSelected ? 'rgba(0, 229, 255, 0.14)' : '#161B26',
                    border: isSelected ? '1px solid #00E5FF' : '1px solid #252D3D',
                    borderRadius: '6px',
                    padding: '7px 10px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '3px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', fontWeight: 800, color: isSelected ? '#00E5FF' : '#F8FAFC' }}>
                      {inst.symbol}
                    </span>
                    <span
                      style={{
                        fontSize: '8.5px',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        background: isClosed ? 'rgba(245, 158, 11, 0.16)' : 'rgba(0, 230, 118, 0.16)',
                        color: isClosed ? '#F59E0B' : '#00E676',
                        fontWeight: 800,
                      }}
                    >
                      {isClosed ? '⏸ Đóng cửa cuối tuần' : '🟢 Đang mở (Live)'}
                    </span>
                  </div>
                  <div style={{ fontSize: '10.5px', fontFamily: 'JetBrains Mono, monospace', color: '#CBD5E1', fontWeight: 600 }}>
                    {inst.assetClass} · {formatInstrumentPrice(inst.basePriceTicks, inst.id)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 2: Switch / Login to Another MT5 Account */}
        <div
          style={{
            background: '#161B26',
            border: '1px solid #242C3D',
            borderRadius: '8px',
            padding: '14px',
            marginBottom: '14px',
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 800, color: '#FFD600', letterSpacing: '0.5px', marginBottom: '10px' }}>
            2. ĐĂNG NHẬP / CHUYỂN ĐỔI TÀI KHOẢN MT5 (HOẶC ĐỂ TRỐNG MẬT KHẨU ĐỂ DÙNG TK ĐANG MỞ TRONG MT5)
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr 1fr', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '10px', color: '#94A3B8', display: 'block', marginBottom: '4px' }}>Sàn (Broker)</label>
              <select
                value={brokerInput}
                onChange={(e) => {
                  const b = e.target.value as Mt5BrokerPreset;
                  setBrokerInput(b);
                  if (BROKER_SERVERS[b]?.[0]) {
                    setServerInput(BROKER_SERVERS[b][0]);
                  }
                }}
                style={{
                  width: '100%',
                  background: '#0D1119',
                  color: '#F8FAFC',
                  border: '1px solid #2D3748',
                  borderRadius: '5px',
                  padding: '6px 8px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                }}
              >
                <option value="Exness">Exness MT5</option>
                <option value="FTMO">FTMO</option>
                <option value="ICMarkets">IC Markets</option>
                <option value="Pepperstone">Pepperstone</option>
                <option value="XM">XM Global</option>
                <option value="MetaQuotes">MetaQuotes</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '10px', color: '#94A3B8', display: 'block', marginBottom: '4px' }}>Máy chủ (MT5 Server)</label>
              <input
                type="text"
                list="mt5-servers-list"
                value={serverInput}
                onChange={(e) => setServerInput(e.target.value)}
                placeholder="VD: Exness-MT5Trial8"
                style={{
                  width: '100%',
                  background: '#0D1119',
                  color: '#F8FAFC',
                  border: '1px solid #2D3748',
                  borderRadius: '5px',
                  padding: '6px 8px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  boxSizing: 'border-box',
                }}
              />
              <datalist id="mt5-servers-list">
                {(BROKER_SERVERS[brokerInput] || BROKER_SERVERS.Exness).map((srv) => (
                  <option key={srv} value={srv} />
                ))}
              </datalist>
            </div>

            <div>
              <label style={{ fontSize: '10px', color: '#94A3B8', display: 'block', marginBottom: '4px' }}>Số TK (MT5 Login ID)</label>
              <input
                type="text"
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                placeholder="VD: 279650659"
                style={{
                  width: '100%',
                  background: '#0D1119',
                  color: '#00E676',
                  border: '1px solid #2D3748',
                  borderRadius: '5px',
                  padding: '6px 8px',
                  fontSize: '11.5px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 700,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '10px', color: '#94A3B8', display: 'block', marginBottom: '4px' }}>Mật khẩu MT5 (Nếu đổi TK)</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Để trống nếu đã login ở MT5"
                style={{
                  width: '100%',
                  background: '#0D1119',
                  color: '#F8FAFC',
                  border: '1px solid #2D3748',
                  borderRadius: '5px',
                  padding: '6px 8px',
                  fontSize: '11.5px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </div>

        {statusMessage && (
          <div
            style={{
              background: statusMessage.ok ? 'rgba(0, 230, 118, 0.12)' : 'rgba(242, 54, 69, 0.14)',
              border: `1px solid ${statusMessage.ok ? '#00E676' : '#F23645'}`,
              color: statusMessage.ok ? '#00E676' : '#FF8A80',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '11.5px',
              fontWeight: 700,
              marginBottom: '14px',
            }}
          >
            {statusMessage.ok ? '✓ ' : '⚠️ '}
            {statusMessage.text}
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <div style={{ fontSize: '10.5px', color: '#94A3B8' }}>
            💡 Khi đặt lệnh trên DeepChart, lệnh sẽ gửi thẳng vào phần mềm <b>MetaTrader 5</b> của bạn qua kết nối trực tiếp.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onClose}
              style={{
                background: '#1E2534',
                border: '1px solid #2D3748',
                color: '#CBD5E1',
                borderRadius: '6px',
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Đóng
            </button>
            <button
              onClick={handleLoginWithCredentials}
              disabled={isConnecting}
              style={{
                background: 'linear-gradient(135deg, #00E676 0%, #00B4D8 100%)',
                border: 'none',
                color: '#07090E',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: 900,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(0, 230, 118, 0.35)',
              }}
            >
              {isConnecting ? 'Đang kết nối MT5...' : '⚡ Kết nối & Đồng bộ Tài khoản MT5'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
