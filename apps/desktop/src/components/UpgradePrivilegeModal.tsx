import React, { useEffect, useState } from 'react';
import { authService, DEFAULT_PORTAL_URLS, PortalUrlsDTO } from '../services/authService';
import {
  AccountTierId,
  FEATURE_ENTITLEMENTS,
  FeatureEntitlementKey,
  getTierBadgeMeta,
  getTierRank,
  normalizeAccountTier,
} from '../utils/entitlements';

interface UpgradePrivilegeModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
  userTier: string;
  licenseId?: string;
  lockedFeatureKey: FeatureEntitlementKey | null;
}

const TIER_COLUMNS: {
  tier: AccountTierId;
  subtitle: string;
  highlights: string[];
}[] = [
  {
    tier: 'STANDARD PILOT',
    subtitle: 'Gói cơ sở làm quen Order Flow',
    highlights: [
      'Biểu đồ Nến & Footprint cơ bản (OF-B/A, OF-VP)',
      'Session Volume Profile (D-VP) & VWAP tiêu chuẩn',
      'Cửa sổ phụ Volume & Cumulative Delta (CVD)',
      'Stacked Imbalances, Naked POC & HTF Prior Day',
      'Tải trọn bộ Gói Dữ Liệu Lịch Sử nén Gzip cục bộ',
    ],
  },
  {
    tier: 'INSTITUTIONAL PRO',
    subtitle: 'Chuẩn giao dịch thực chiến Vàng & Crypto',
    highlights: [
      'Toàn bộ tính năng gói Standard Pilot',
      'Gold Options Call/Put (OPRA/CBOE Rust Native) & OPT/GEX',
      'Top 7 Vùng Mua/Bán Định Lượng (Backtested XAUUSD)',
      'Fixed Range VP (FRVP), TPO Profile (IBH/IBL, Single Prints)',
      'ATAS Cluster Search & Unfinished Auction Detector',
      'Multi-Chart 4 khung (2V/2H/4), MT5 Live Bridge & Risk Manager',
    ],
  },
  {
    tier: 'QUANT DESK',
    subtitle: 'Mở khóa 100% công cụ Tổ chức & Quant',
    highlights: [
      'Toàn bộ tính năng gói Institutional Pro',
      'MBO Level-3 Suite (Icebergs, Stop Runs, HFT Sweeps)',
      'Order Flow Strategy Backtester & Parameter Optimizer',
      'Script Editor lập trình chỉ báo dòng lệnh riêng',
      'Instrument Studio & Xuất dữ liệu thô Footprint CSV',
    ],
  },
];

export const UpgradePrivilegeModal: React.FC<UpgradePrivilegeModalProps> = ({
  isOpen,
  onClose,
  userEmail,
  userTier,
  licenseId,
  lockedFeatureKey,
}) => {
  const [portalUrls, setPortalUrls] = useState<PortalUrlsDTO>(DEFAULT_PORTAL_URLS);

  useEffect(() => {
    if (!isOpen) return;
    authService.getPortalUrls().then(setPortalUrls).catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const currentTier = normalizeAccountTier(userTier);
  const currentRank = getTierRank(currentTier);
  const currentBadge = getTierBadgeMeta(currentTier);
  const lockedDef = lockedFeatureKey ? FEATURE_ENTITLEMENTS[lockedFeatureKey] : null;
  const requiredBadge = lockedDef ? getTierBadgeMeta(lockedDef.minTier) : null;

  const handleOpenUpgradePortal = () => {
    const url = `${portalUrls.license_docs_url}?account=${encodeURIComponent(userEmail)}&current=${encodeURIComponent(currentTier)}`;
    authService.openExternalPortal(url);
  };

  return (
    <div
      data-testid="upgrade-privilege-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6, 9, 14, 0.86)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100000,
        padding: '16px',
        userSelect: 'none',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '860px',
          maxWidth: '96vw',
          background: '#0D1119',
          border: '1px solid #242C3D',
          borderRadius: '6px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.82)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div
          style={{
            height: '46px',
            background: '#131824',
            borderBottom: '1px solid #242C3D',
            padding: '0 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: '#089981', fontWeight: 900, fontStyle: 'italic', fontSize: '13px' }}>///</span>
            <span style={{ color: '#F8FAFC', fontWeight: 800, fontSize: '12.5px', letterSpacing: '0.4px' }}>
              ĐẶC QUYỀN TÀI KHOẢN & PHÂN HẠNG LICENSE VLUXCHART
            </span>
            <span
              style={{
                background: currentBadge.bgColor,
                color: currentBadge.textColor,
                border: `1px solid ${currentBadge.borderColor}`,
                borderRadius: '3px',
                padding: '2px 7px',
                fontSize: '9.5px',
                fontWeight: 800,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              HIỆN TẠI: {currentBadge.displayName}
            </span>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94A3B8',
              fontSize: '14px',
              cursor: 'pointer',
              padding: '4px 6px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Locked Feature Banner (shown when triggered by clicking a higher-tier tool) */}
        {lockedDef && requiredBadge && (
          <div
            data-testid="locked-feature-banner"
            style={{
              margin: '14px 18px 0 18px',
              padding: '12px 14px',
              background: '#141B29',
              border: `1px solid ${requiredBadge.borderColor}`,
              borderRadius: '5px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#F8FAFC', marginBottom: '3px' }}>
                Tính năng đang khóa trên gói {currentBadge.displayName}:{' '}
                <span style={{ color: requiredBadge.textColor }}>{lockedDef.title}</span>
              </div>
              <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                {lockedDef.shortDesc} Yêu cầu tối thiểu hạng{' '}
                <strong style={{ color: requiredBadge.textColor }}>{requiredBadge.displayName}</strong>.
              </div>
            </div>
            <button
              onClick={handleOpenUpgradePortal}
              data-testid="upgrade-portal-cta-top"
              style={{
                background: '#089981',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '4px',
                padding: '8px 14px',
                fontSize: '11px',
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Nâng cấp tại Web Portal ↗
            </button>
          </div>
        )}

        {/* Current Account Telemetry Strip */}
        <div
          style={{
            padding: '12px 18px 4px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#94A3B8',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <span>
            Tài khoản: <strong style={{ color: '#E2E8F0' }}>{userEmail}</strong>
            {licenseId ? ` · Mã License: ${licenseId}` : ''}
          </span>
          <span>Quản lý thuê bao độc lập trên Web Portal (Desktop App không thu phí trực tiếp)</span>
        </div>

        {/* 3-Column Tier Matrix */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            padding: '12px 18px 16px 18px',
          }}
        >
          {TIER_COLUMNS.map((col) => {
            const meta = getTierBadgeMeta(col.tier);
            const colRank = getTierRank(col.tier);
            const isCurrent = col.tier === currentTier;
            const isRequiredTarget = lockedDef?.minTier === col.tier;

            return (
              <div
                key={col.tier}
                style={{
                  background: isCurrent ? '#141B28' : '#101520',
                  border: isRequiredTarget
                    ? `1.5px solid ${meta.textColor}`
                    : isCurrent
                    ? `1px solid ${meta.borderColor}`
                    : '1px solid #1F2636',
                  borderRadius: '5px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span
                      style={{
                        color: meta.textColor,
                        fontWeight: 800,
                        fontSize: '11.5px',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {meta.displayName}
                    </span>
                    {isCurrent && (
                      <span
                        style={{
                          background: meta.bgColor,
                          color: meta.textColor,
                          border: `1px solid ${meta.borderColor}`,
                          fontSize: '9px',
                          fontWeight: 800,
                          padding: '1px 5px',
                          borderRadius: '3px',
                        }}
                      >
                        ĐANG DÙNG
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '10.5px', color: '#64748B', marginBottom: '10px' }}>{col.subtitle}</div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {col.highlights.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          fontSize: '10.5px',
                          color: colRank <= currentRank ? '#E2E8F0' : '#94A3B8',
                          lineHeight: 1.4,
                          display: 'flex',
                          gap: '6px',
                        }}
                      >
                        <span style={{ color: colRank <= currentRank ? '#10B981' : meta.textColor, fontWeight: 800 }}>
                          {colRank <= currentRank ? '✓' : '•'}
                        </span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {colRank > currentRank ? (
                  <button
                    onClick={handleOpenUpgradePortal}
                    style={{
                      width: '100%',
                      background: col.tier === 'QUANT DESK' ? '#D97706' : '#089981',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '7px 10px',
                      fontSize: '10.5px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Nâng cấp lên {meta.shortBadge} tại Web ↗
                  </button>
                ) : (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '6px',
                      borderRadius: '4px',
                      background: '#161D2B',
                      border: '1px solid #242E42',
                      color: '#10B981',
                      fontSize: '10px',
                      fontWeight: 700,
                    }}
                  >
                    Đã mở khóa trên tài khoản của bạn
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            height: '44px',
            background: '#131824',
            borderTop: '1px solid #242C3D',
            padding: '0 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '10.5px',
            color: '#94A3B8',
          }}
        >
          <span>
            Sau khi nâng cấp trên Web Portal, đăng xuất và đăng nhập lại để cập nhật chữ ký HWID License mới.
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleOpenUpgradePortal}
              data-testid="upgrade-portal-cta-bottom"
              style={{
                background: '#1E2738',
                color: '#38BDF8',
                border: '1px solid #2D3B54',
                borderRadius: '4px',
                padding: '5px 12px',
                fontSize: '10.5px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Mở cổng {portalUrls.portal_base_url.replace(/^https?:\/\//, '')} ↗
            </button>
            <button
              onClick={onClose}
              style={{
                background: '#242C3D',
                color: '#E2E8F0',
                border: 'none',
                borderRadius: '4px',
                padding: '5px 12px',
                fontSize: '10.5px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
