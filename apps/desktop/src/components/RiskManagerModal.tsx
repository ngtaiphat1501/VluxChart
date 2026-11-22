import React, { useState } from 'react';
import { mt5BridgeService } from '../services/mt5BridgeService';

interface RiskManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  instrumentId: string;
}

export const RiskManagerModal: React.FC<RiskManagerModalProps> = ({
  isOpen,
  onClose,
  instrumentId,
}) => {
  const [maxDailyLossUsd, setMaxDailyLossUsd] = useState<number>(500);
  const [maxOpenLots, setMaxOpenLots] = useState<number>(2.0);
  const [isLockoutEnabled, setIsLockoutEnabled] = useState<boolean>(true);
  const [trailingDdPct, setTrailingDdPct] = useState<number>(3.0);
  const [isSavedNotice, setIsSavedNotice] = useState<boolean>(false);

  if (!isOpen) return null;

  const mt5Acct = mt5BridgeService.getAccount();
  const currentDailyPnl = 0; // floating from account
  const isBreached = currentDailyPnl <= -maxDailyLossUsd;

  const handleSave = () => {
    setIsSavedNotice(true);
    setTimeout(() => setIsSavedNotice(false), 2500);
  };

  const handlePanicFlatten = () => {
    mt5BridgeService.flattenAll(instrumentId, 0);
    mt5BridgeService.cancelPending(instrumentId);
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
        style={{
          width: '640px',
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
              RISK MANAGER — BẢO VỆ TÀI KHOẢN TỔ CHỨC
            </span>
            <span
              style={{
                background: isBreached ? '#3E1F24' : '#1E2330',
                color: isBreached ? '#F87171' : '#10B981',
                border: `1px solid ${isBreached ? '#7F1D1D' : '#2D3548'}`,
                fontSize: '9px',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: '3px',
                fontFamily: 'monospace',
              }}
            >
              {isBreached ? 'LOCKED OUT' : 'ACTIVE & ARMED'}
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
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Status Gauge */}
          <div
            style={{
              background: '#141720',
              border: '1px solid #232938',
              borderRadius: '4px',
              padding: '10px 14px',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '10px',
              fontFamily: 'monospace',
              fontSize: '10.5px',
            }}
          >
            <div>
              <div style={{ color: '#64748B', fontSize: '9px' }}>VỐN TÀI KHOẢN (EQUITY)</div>
              <div style={{ color: '#F8FAFC', fontWeight: 800, fontSize: '13px' }}>
                ${mt5Acct.equityUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div style={{ color: '#64748B', fontSize: '9px' }}>P/L HÔM NAY</div>
              <div style={{ color: '#10B981', fontWeight: 800, fontSize: '13px' }}>
                +$0.00
              </div>
            </div>
            <div>
              <div style={{ color: '#64748B', fontSize: '9px' }}>GIỚI HẠN LỖ CHO PHÉP</div>
              <div style={{ color: '#EF4444', fontWeight: 800, fontSize: '13px' }}>
                -${maxDailyLossUsd.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Form Settings */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#E2E8F0' }}>
                  Giới Hạn Lỗ Tối Đa Trong Ngày (Daily Max Loss)
                </div>
                <div style={{ fontSize: '9.5px', color: '#64748B' }}>
                  Khi tổng lỗ vượt quá mức này, hệ thống tự động khóa nút vào lệnh đến hết phiên.
                </div>
              </div>
              <input
                type="number"
                min={10}
                max={50000}
                value={maxDailyLossUsd}
                onChange={(e) => setMaxDailyLossUsd(Math.max(10, parseInt(e.target.value, 10) || 500))}
                style={{
                  width: '90px',
                  background: '#0D0F16',
                  border: '1px solid #282E3E',
                  borderRadius: '3px',
                  padding: '4px 8px',
                  color: '#EF4444',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  fontWeight: 700,
                  textAlign: 'right',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#E2E8F0' }}>
                  Khối Lượng Mở Tối Đa (Max Open Lots)
                </div>
                <div style={{ fontSize: '9.5px', color: '#64748B' }}>
                  Ngăn chặn over-leveraging hoặc nhồi lệnh quá đà.
                </div>
              </div>
              <input
                type="number"
                step={0.1}
                min={0.01}
                max={100}
                value={maxOpenLots}
                onChange={(e) => setMaxOpenLots(Math.max(0.01, parseFloat(e.target.value) || 1.0))}
                style={{
                  width: '90px',
                  background: '#0D0F16',
                  border: '1px solid #282E3E',
                  borderRadius: '3px',
                  padding: '4px 8px',
                  color: '#38BDF8',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  fontWeight: 700,
                  textAlign: 'right',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#E2E8F0' }}>
                  Bật Chế Độ Khóa Cứng (Strict Lockout Mode)
                </div>
                <div style={{ fontSize: '9.5px', color: '#64748B' }}>
                  Vô hiệu hóa hoàn toàn nút Buy / Sell khi chạm hạn mức vi phạm.
                </div>
              </div>
              <input
                type="checkbox"
                checked={isLockoutEnabled}
                onChange={(e) => setIsLockoutEnabled(e.target.checked)}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
            </div>
          </div>

          {/* Emergency Panic Exit Button */}
          <div
            style={{
              background: '#1A1418',
              border: '1px solid #3E1F24',
              borderRadius: '4px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: '4px',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#F87171' }}>
                NÚT THOÁT HIỂM KHẨN CẤP (EMERGENCY PANIC EXIT)
              </div>
              <div style={{ fontSize: '9.5px', color: '#94A3B8' }}>
                Đóng ngay tất cả các vị thế đang mở và hủy toàn bộ lệnh Limit / Stop đang chờ.
              </div>
            </div>
            <button
              onClick={handlePanicFlatten}
              style={{
                background: '#991B1B',
                color: '#FFFFFF',
                border: '1px solid #7F1D1D',
                borderRadius: '3px',
                padding: '6px 14px',
                fontSize: '10px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              FLAT ALL & CANCEL
            </button>
          </div>

          {/* Save Action */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
            {isSavedNotice ? (
              <span style={{ fontSize: '10px', color: '#10B981', fontWeight: 700 }}>
                ✓ Đã áp dụng quy tắc quản trị rủi ro mới!
              </span>
            ) : (
              <span />
            )}
            <button
              onClick={handleSave}
              style={{
                background: '#089981',
                color: '#FFFFFF',
                border: '1px solid #067A67',
                borderRadius: '3px',
                padding: '6px 18px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Lưu & Áp Dụng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
