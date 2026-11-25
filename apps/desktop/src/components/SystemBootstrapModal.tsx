import React, { useEffect, useState } from 'react';
import {
  SystemComponentDTO,
  SystemEnvironmentReportDTO,
  systemBootstrapService,
} from '../services/systemBootstrapService';
import { DataManifestDTO, dataPackService, formatBytes } from '../services/dataPackService';
import { authService } from '../services/authService';

interface SystemBootstrapModalProps {
  isOpen: boolean;
  isFirstRunPrompt?: boolean;
  initialReport?: SystemEnvironmentReportDTO | null;
  dataManifest?: DataManifestDTO | null;
  userEmail?: string;
  onClose: () => void;
  onReportUpdated: (report: SystemEnvironmentReportDTO) => void;
  onCacheCleared?: (manifest: DataManifestDTO) => void;
}

function getStatusMeta(status: SystemComponentDTO['status']) {
  if (status === 'READY') {
    return {
      label: 'ĐÃ SẴN SÀNG',
      dot: '#10B981',
      text: '#10B981',
      bg: 'rgba(16, 185, 129, 0.12)',
      border: 'rgba(16, 185, 129, 0.42)',
    };
  }
  if (status === 'MISSING') {
    return {
      label: 'CHƯA CÓ · CẦN CÀI',
      dot: '#F59E0B',
      text: '#FBBF24',
      bg: 'rgba(245, 158, 11, 0.14)',
      border: 'rgba(245, 158, 11, 0.48)',
    };
  }
  if (status === 'WARNING') {
    return {
      label: 'CẢNH BÁO MẠNG',
      dot: '#EF4444',
      text: '#F87171',
      bg: 'rgba(239, 68, 68, 0.12)',
      border: 'rgba(239, 68, 68, 0.42)',
    };
  }
  return {
    label: 'TÙY CHỌN / CHỜ',
    dot: '#38BDF8',
    text: '#38BDF8',
    bg: 'rgba(56, 189, 248, 0.12)',
    border: 'rgba(56, 189, 248, 0.35)',
  };
}

export const SystemBootstrapModal: React.FC<SystemBootstrapModalProps> = ({
  isOpen,
  isFirstRunPrompt = false,
  initialReport = null,
  dataManifest = null,
  userEmail,
  onClose,
  onReportUpdated,
  onCacheCleared,
}) => {
  const [report, setReport] = useState<SystemEnvironmentReportDTO | null>(initialReport);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (initialReport) {
      setReport(initialReport);
    }
  }, [initialReport]);

  useEffect(() => {
    if (isOpen && !initialReport) {
      handleRecheck();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRecheck = async () => {
    if (isChecking || isInstalling) return;
    setIsChecking(true);
    setBanner(null);
    try {
      const fresh = await systemBootstrapService.checkEnvironment();
      setReport(fresh);
      onReportUpdated(fresh);
      if (fresh.all_core_ready) {
        setBanner({
          ok: true,
          text: 'Kiểm định hoàn tất: Máy tính đã đáp ứng 100% thư viện & môi trường vận hành.',
        });
      }
    } catch (e) {
      setBanner({ ok: false, text: `Lỗi kiểm tra môi trường: ${String(e)}` });
    } finally {
      setIsChecking(false);
    }
  };

  const handleAutoSetup = async () => {
    if (isInstalling) return;
    setIsInstalling(true);
    setBanner(null);
    setInstallLogs([
      'Đang kiểm tra các thư viện còn thiếu trên máy...',
      'Đang kết nối máy chủ phân phối Runtime chính thức (Microsoft / Python.org / PyPI)...',
    ]);
    try {
      const res = await systemBootstrapService.autoInstallRuntimes();
      setInstallLogs(res.logs || []);
      setReport(res.report);
      onReportUpdated(res.report);
      if (res.ok) {
        setBanner({
          ok: true,
          text:
            res.installed_items.length > 0
              ? `Đã cài đặt ngầm thành công: ${res.installed_items.join(', ')}. Hệ thống đã sẵn sàng 100%!`
              : 'Môi trường trên máy đã đầy đủ 100%, không cần cài đặt thêm.',
        });
      } else {
        setBanner({
          ok: false,
          text: res.error || 'Chưa hoàn tất cài đặt tự động. Vui lòng kiểm tra kết nối mạng và thử lại.',
        });
      }
    } catch (e) {
      setBanner({ ok: false, text: `Lỗi trình cài đặt tự động: ${String(e)}` });
    } finally {
      setIsInstalling(false);
    }
  };

  const handleLaunchMt5 = async () => {
    const res = await systemBootstrapService.launchMt5Terminal();
    if (res.ok) {
      setBanner({
        ok: true,
        text: `Đã gửi lệnh khởi động MetaTrader 5 (${res.path}). Chờ 3–5 giây rồi bấm 'Kiểm Tra Lại'.`,
      });
      setTimeout(() => {
        handleRecheck();
      }, 3500);
    } else {
      setBanner({ ok: false, text: res.error || 'Không thể mở MetaTrader 5.' });
    }
  };

  const handleSkipOptional = () => {
    systemBootstrapService.markSkippedForSession();
    onClose();
  };

  const handleClearLocalCache = async () => {
    if (isInstalling) return;
    const m = await dataPackService.clearAll();
    onCacheCleared?.(m);
    setBanner({
      ok: true,
      text: 'Đã làm sạch bộ nhớ đệm lịch sử cục bộ. Biểu đồ sẽ tự đồng bộ mới từ luồng Realtime.',
    });
  };

  const allReady = Boolean(report?.all_core_ready);
  const canLaunchMt5 = Boolean(report?.mt5_terminal_path && !report?.mt5_running);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(6, 9, 14, 0.88)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99990,
        padding: '20px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        userSelect: 'none',
      }}
      onClick={() => {
        if (!isInstalling && !isFirstRunPrompt) onClose();
      }}
    >
      <div
        data-testid="system-bootstrap-modal"
        style={{
          width: '820px',
          maxWidth: '96vw',
          maxHeight: '92vh',
          backgroundColor: '#0E121A',
          border: '1px solid #242C3D',
          borderRadius: '6px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#E2E8F0',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            backgroundColor: '#131823',
            borderBottom: '1px solid #222938',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '10px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 800,
                  color: allReady ? '#10B981' : '#F59E0B',
                  backgroundColor: allReady ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.14)',
                  border: allReady ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid rgba(245, 158, 11, 0.45)',
                  padding: '2px 7px',
                  borderRadius: '3px',
                }}
              >
                {allReady ? 'SYSTEM COMPATIBILITY · READY (AUTO-SKIP)' : 'SYSTEM RUNTIME BOOTSTRAPPER'}
              </span>
              {userEmail && (
                <span style={{ fontSize: '11px', color: '#8E9BAE', fontFamily: "'JetBrains Mono', monospace" }}>
                  {userEmail}
                </span>
              )}
            </div>
            <h2 style={{ margin: '6px 0 2px 0', fontSize: '16px', fontWeight: 700, color: '#F8FAFC' }}>
              Trình Kiểm Tra &amp; Cài Đặt Tương Thích Hệ Thống
            </h2>
            <p style={{ margin: 0, fontSize: '11.5px', color: '#8E9BAE' }}>
              Tự động kiểm định thư viện nền trên máy khách: nếu đã có sẵn sẽ tự động bỏ qua (Skip), nếu thiếu sẽ hỗ trợ tải &amp; cài ngầm cô lập 1-Click.
            </p>
          </div>

          {!isInstalling && (
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid #283042',
                borderRadius: '4px',
                color: '#94A3B8',
                width: '28px',
                height: '28px',
                cursor: 'pointer',
                fontSize: '13px',
              }}
              title="Đóng"
            >
              ✕
            </button>
          )}
        </div>

        {/* Workstation Telemetry Strip */}
        <div
          style={{
            padding: '9px 20px',
            backgroundColor: '#0B0E15',
            borderBottom: '1px solid #1E2533',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            fontSize: '11px',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <div style={{ color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '480px' }}>
            Runtime cô lập: <span style={{ color: '#CBD5E1' }}>{report?.runtime_dir || '%LOCALAPPDATA%\\DeepChart\\runtime'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span>
              Hệ điều hành: <strong style={{ color: '#E2E8F0' }}>{report?.os_summary || 'WINDOWS (X86_64)'}</strong>
            </span>
            <span>
              Cache tự lưu:{' '}
              <strong style={{ color: '#38BDF8' }}>
                {formatBytes(dataManifest?.total_compressed_bytes || 0)}
              </strong>
            </span>
          </div>
        </div>

        {/* Component Inspection Cards */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(report?.components || []).map((comp) => {
            const meta = getStatusMeta(comp.status);
            const isMt5Card = comp.id === 'mt5_terminal';

            return (
              <div
                key={comp.id}
                data-testid={`sys-component-${comp.id}`}
                style={{
                  backgroundColor: '#0C1018',
                  border: `1px solid ${comp.status === 'MISSING' ? 'rgba(245, 158, 11, 0.5)' : '#202838'}`,
                  borderRadius: '5px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: meta.dot,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>{comp.title}</span>
                  </div>

                  <span
                    style={{
                      fontSize: '10px',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 800,
                      color: meta.text,
                      backgroundColor: meta.bg,
                      border: `1px solid ${meta.border}`,
                      padding: '2px 8px',
                      borderRadius: '3px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {meta.label}
                  </span>
                </div>

                <div style={{ fontSize: '11.5px', color: '#8E9BAE', paddingLeft: '16px' }}>{comp.subtitle}</div>

                <div
                  style={{
                    fontSize: '11px',
                    fontFamily: "'JetBrains Mono', monospace",
                    color: '#CBD5E1',
                    backgroundColor: '#111622',
                    border: '1px solid #1E2636',
                    borderRadius: '4px',
                    padding: '6px 10px',
                    marginLeft: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ wordBreak: 'break-all' }}>{comp.detail}</span>

                  {isMt5Card && canLaunchMt5 && (
                    <button
                      type="button"
                      onClick={handleLaunchMt5}
                      style={{
                        backgroundColor: '#0284C7',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '3px',
                        padding: '3px 9px',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Mở MetaTrader 5 ngay
                    </button>
                  )}

                  {isMt5Card && !report?.mt5_terminal_path && (
                    <button
                      type="button"
                      onClick={() => authService.openExternalPortal('https://www.metatrader5.com/vi/download')}
                      style={{
                        backgroundColor: '#1E293B',
                        color: '#38BDF8',
                        border: '1px solid #334155',
                        borderRadius: '3px',
                        padding: '3px 9px',
                        fontSize: '10.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Tải MetaTrader 5 ↗
                    </button>
                  )}
                </div>

                {comp.action_hint && (
                  <div style={{ fontSize: '11px', color: '#FBBF24', paddingLeft: '16px' }}>
                    💡 {comp.action_hint}
                  </div>
                )}
              </div>
            );
          })}

          {/* Live Installation Log Console */}
          {(isInstalling || installLogs.length > 0) && (
            <div
              style={{
                backgroundColor: '#080B10',
                border: '1px solid #1E293B',
                borderRadius: '4px',
                padding: '10px 12px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '11px',
                color: '#94A3B8',
                maxHeight: '130px',
                overflowY: 'auto',
              }}
            >
              <div style={{ color: '#38BDF8', fontWeight: 700, marginBottom: '4px' }}>
                {isInstalling ? '⏳ ĐANG TẢI & CÀI ĐẶT THƯ VIỆN TƯƠNG THÍCH NGẦM...' : 'NHẬT KÝ CÀI ĐẶT HỆ THỐNG:'}
              </div>
              {installLogs.map((ln, idx) => (
                <div key={idx} style={{ padding: '1px 0', color: '#CBD5E1' }}>
                  › {ln}
                </div>
              ))}
            </div>
          )}

          {/* Status Feedback Banner */}
          {banner && (
            <div
              style={{
                padding: '9px 12px',
                borderRadius: '4px',
                fontSize: '11.5px',
                fontWeight: 600,
                backgroundColor: banner.ok ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.14)',
                border: banner.ok ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid rgba(239, 68, 68, 0.45)',
                color: banner.ok ? '#34D399' : '#FCA5A5',
              }}
            >
              {banner.text}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '13px 20px',
            backgroundColor: '#131823',
            borderTop: '1px solid #222938',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={handleRecheck}
              disabled={isChecking || isInstalling}
              style={{
                backgroundColor: '#1E2534',
                color: '#E2E8F0',
                border: '1px solid #2E384D',
                borderRadius: '4px',
                padding: '7px 12px',
                fontSize: '11.5px',
                fontWeight: 600,
                cursor: isChecking || isInstalling ? 'not-allowed' : 'pointer',
              }}
            >
              {isChecking ? 'Đang quét...' : '↻ Kiểm Tra Lại'}
            </button>

            {(dataManifest?.total_compressed_bytes || 0) > 0 && (
              <button
                type="button"
                onClick={handleClearLocalCache}
                disabled={isInstalling}
                style={{
                  backgroundColor: 'transparent',
                  color: '#94A3B8',
                  border: '1px solid #283142',
                  borderRadius: '4px',
                  padding: '7px 10px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
                title="Xóa bộ nhớ đệm nến tự động lưu trên ổ đĩa"
              >
                Dọn Cache ({formatBytes(dataManifest?.total_compressed_bytes || 0)})
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!allReady && (
              <button
                type="button"
                onClick={handleSkipOptional}
                disabled={isInstalling}
                style={{
                  backgroundColor: 'transparent',
                  color: '#94A3B8',
                  border: '1px solid #2D3648',
                  borderRadius: '4px',
                  padding: '7px 12px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: isInstalling ? 'not-allowed' : 'pointer',
                }}
              >
                Bỏ qua (Chạy dữ liệu Quốc Tế)
              </button>
            )}

            {!allReady ? (
              <button
                type="button"
                data-testid="btn-auto-install-runtime"
                onClick={handleAutoSetup}
                disabled={isInstalling}
                style={{
                  backgroundColor: '#089981',
                  color: '#FFFFFF',
                  border: '1px solid #10B981',
                  borderRadius: '4px',
                  padding: '7px 16px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: isInstalling ? 'wait' : 'pointer',
                }}
              >
                {isInstalling ? 'Đang Tự Động Cài Đặt...' : '⚡ Tự Động Cài Đặt Thư Viện Thiếu (1-Click)'}
              </button>
            ) : (
              <button
                type="button"
                data-testid="btn-enter-terminal"
                onClick={onClose}
                style={{
                  backgroundColor: '#089981',
                  color: '#FFFFFF',
                  border: '1px solid #10B981',
                  borderRadius: '4px',
                  padding: '7px 18px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Vào Biểu Đồ Giao Dịch →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
