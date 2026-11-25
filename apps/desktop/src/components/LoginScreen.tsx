import React, { useState, useEffect } from 'react';
import {
  authService,
  AuthSessionDTO,
  DEFAULT_PORTAL_URLS,
  PortalUrlsDTO,
} from '../services/authService';

interface LoginScreenProps {
  onLoginSuccess: (session: AuthSessionDTO) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [showServerConfig, setShowServerConfig] = useState<boolean>(false);
  const [portalUrlInput, setPortalUrlInput] = useState<string>(DEFAULT_PORTAL_URLS.portal_base_url);
  const [portalUrls, setPortalUrls] = useState<PortalUrlsDTO>(DEFAULT_PORTAL_URLS);
  const [hwid, setHwid] = useState<string>('VLX-INIT...');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [lockoutSec, setLockoutSec] = useState<number>(0);

  useEffect(() => {
    authService.getPortalUrls().then((urls) => {
      setPortalUrls(urls);
      setPortalUrlInput(urls.portal_base_url);
    });
    authService.getMachineHwid().then(setHwid);
  }, []);

  useEffect(() => {
    if (lockoutSec <= 0) return;
    const timer = setInterval(() => {
      setLockoutSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSec]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || lockoutSec > 0) return;

    setErrorMsg(null);
    setErrorCode(null);
    setIsSubmitting(true);

    try {
      const res = await authService.login({
        email,
        password,
        rememberMe,
        customPortalUrl: portalUrlInput,
      });

      if (res.ok && res.session) {
        onLoginSuccess(res.session);
      } else {
        setErrorMsg(res.error || 'Đăng nhập không thành công.');
        setErrorCode(res.error_code);
        if (res.lockout_remaining_ms && res.lockout_remaining_ms > 0) {
          setLockoutSec(Math.ceil(res.lockout_remaining_ms / 1000));
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenWebRegister = () => {
    const base = portalUrlInput.trim().replace(/\/+$/, '') || portalUrls.portal_base_url;
    authService.openExternalPortal(`${base}/register`);
  };

  const handleOpenWebReset = () => {
    const base = portalUrlInput.trim().replace(/\/+$/, '') || portalUrls.portal_base_url;
    authService.openExternalPortal(`${base}/reset-password`);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#090C11',
        color: '#E2E8F0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        userSelect: 'none',
      }}
    >
      {/* Main Institutional Launcher Shell (ATAS / Quantower Standard) */}
      <div
        className="vlx-login-shell"
        style={{
          width: '860px',
          maxWidth: '100%',
          backgroundColor: '#0E121A',
          border: '1px solid #222938',
          borderRadius: '6px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.72)',
          display: 'grid',
          gridTemplateColumns: '330px 1fr',
          overflow: 'hidden',
        }}
      >
        {/* LEFT COLUMN: System Identity, Architecture & External Web Registration Policy */}
        <div
          style={{
            backgroundColor: '#0B0E15',
            borderRight: '1px solid #1E2533',
            padding: '28px 24px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            {/* Wordmark */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span
                style={{
                  color: '#089981',
                  fontWeight: 900,
                  fontSize: '18px',
                  fontStyle: 'italic',
                  letterSpacing: '-1px',
                }}
              >
                ///
              </span>
              <span
                style={{
                  color: '#F8FAFC',
                  fontWeight: 800,
                  fontSize: '17px',
                  letterSpacing: '0.8px',
                }}
              >
                VLUXCHART
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: '10px',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: '#94A3B8',
                  backgroundColor: '#151B27',
                  border: '1px solid #252E40',
                  padding: '2px 6px',
                  borderRadius: '3px',
                }}
              >
                v0.1.0
              </span>
            </div>

            <div style={{ fontSize: '11.5px', color: '#8E9BAE', lineHeight: 1.5, marginBottom: '22px' }}>
              DeepChart Order Flow &amp; Market Microstructure Desktop Terminal
            </div>

            {/* Core Telemetry Modules */}
            <div
              style={{
                borderTop: '1px solid #1B2230',
                paddingTop: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              {[
                { label: 'Core Engine', value: 'Rust Integer Tick (0 Drift)' },
                { label: 'Quant Indicators', value: 'Top 7 XAU & Crypto Zones' },
                { label: 'Market Venues', value: 'MT5 ECN · CME L3 · Bybit' },
                { label: 'Options Analytics', value: 'CBOE Gold · Deribit GEX' },
              ].map((row) => (
                <div
                  key={row.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '11px',
                  }}
                >
                  <span style={{ color: '#64748B' }}>{row.label}</span>
                  <span
                    style={{
                      color: '#CBD5E1',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '10.5px',
                      fontWeight: 600,
                    }}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Strict Login-Only Notice + External Web Portal Registration Link */}
          <div
            style={{
              marginTop: '24px',
              backgroundColor: '#111621',
              border: '1px solid #232B3B',
              borderRadius: '4px',
              padding: '14px',
            }}
          >
            <div
              style={{
                fontSize: '10px',
                fontWeight: 800,
                letterSpacing: '0.6px',
                color: '#94A3B8',
                textTransform: 'uppercase',
                marginBottom: '6px',
              }}
            >
              Chính sách tài khoản (Login-Only)
            </div>
            <p
              style={{
                margin: '0 0 12px 0',
                fontSize: '11.5px',
                color: '#94A3B8',
                lineHeight: 1.5,
              }}
            >
              Ứng dụng Desktop không hỗ trợ đăng ký tài khoản trực tiếp. Tài khoản mới và gói dữ liệu được kích hoạt tại Web Portal riêng.
            </p>
            <button
              type="button"
              onClick={handleOpenWebRegister}
              data-testid="open-web-portal-register"
              style={{
                width: '100%',
                backgroundColor: '#181F2D',
                color: '#E2E8F0',
                border: '1px solid #334155',
                borderRadius: '4px',
                padding: '8px 12px',
                fontSize: '11.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Đăng ký tài khoản tại Web Portal</span>
              <span style={{ color: '#38BDF8', fontFamily: "'JetBrains Mono', monospace" }}>↗</span>
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: Focused Login Form */}
        <div style={{ padding: '32px 34px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <form onSubmit={handleSubmit} noValidate>
            <div style={{ marginBottom: '22px' }}>
              <div
                style={{
                  fontSize: '10.5px',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: '#089981',
                  fontWeight: 700,
                  letterSpacing: '0.8px',
                  textTransform: 'uppercase',
                  marginBottom: '6px',
                }}
              >
                TERMINAL AUTHENTICATION
              </div>
              <h1
                style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: 700,
                  color: '#F8FAFC',
                  letterSpacing: '-0.2px',
                }}
              >
                Đăng nhập VluxChart Terminal
              </h1>
              <p style={{ margin: '5px 0 0 0', fontSize: '12px', color: '#8E9BAE' }}>
                Sử dụng tài khoản đã đăng ký trên Web Portal để mở khóa dữ liệu và biểu đồ Order Flow.
              </p>
            </div>

            {/* Email Field */}
            <div style={{ marginBottom: '14px' }}>
              <label
                htmlFor="vlux-login-email"
                style={{
                  display: 'block',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#CBD5E1',
                  marginBottom: '6px',
                }}
              >
                Email tài khoản
              </label>
              <input
                id="vlux-login-email"
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="trader@vluxchart.com"
                disabled={isSubmitting || lockoutSec > 0}
                style={{
                  width: '100%',
                  backgroundColor: '#0A0D14',
                  border: '1px solid #2A3346',
                  borderRadius: '4px',
                  padding: '10px 12px',
                  color: '#F8FAFC',
                  fontSize: '13px',
                  fontFamily: "'Inter', sans-serif",
                  outline: 'none',
                }}
              />
            </div>

            {/* Password Field */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label
                  htmlFor="vlux-login-password"
                  style={{ fontSize: '11px', fontWeight: 600, color: '#CBD5E1' }}
                >
                  Mật khẩu
                </label>
                <button
                  type="button"
                  onClick={handleOpenWebReset}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#38BDF8',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  Quên mật khẩu? ↗
                </button>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  id="vlux-login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu tài khoản"
                  disabled={isSubmitting || lockoutSec > 0}
                  style={{
                    width: '100%',
                    backgroundColor: '#0A0D14',
                    border: '1px solid #2A3346',
                    borderRadius: '4px',
                    padding: '10px 58px 10px 12px',
                    color: '#F8FAFC',
                    fontSize: '13px',
                    fontFamily: "'Inter', sans-serif",
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: '#8E9BAE',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '4px 6px',
                  }}
                >
                  {showPassword ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
            </div>

            {/* Remember Session + Advanced Server Config Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  fontSize: '12px',
                  color: '#CBD5E1',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: '#089981' }}
                />
                <span>Ghi nhớ phiên trên máy này (HWID)</span>
              </label>

              <button
                type="button"
                onClick={() => setShowServerConfig((prev) => !prev)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748B',
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                {showServerConfig ? 'Ẩn cấu hình Portal' : 'Auth Server'}
              </button>
            </div>

            {/* Optional Web Portal Endpoint Configuration */}
            {showServerConfig && (
              <div
                style={{
                  marginBottom: '16px',
                  padding: '10px 12px',
                  backgroundColor: '#0B0F17',
                  border: '1px solid #202838',
                  borderRadius: '4px',
                }}
              >
                <label
                  htmlFor="vlux-portal-url"
                  style={{
                    display: 'block',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    color: '#94A3B8',
                    marginBottom: '5px',
                  }}
                >
                  WEB PORTAL AUTH ENDPOINT (HTTPS)
                </label>
                <input
                  id="vlux-portal-url"
                  type="url"
                  value={portalUrlInput}
                  onChange={(e) => setPortalUrlInput(e.target.value)}
                  placeholder="https://portal.vluxchart.com"
                  style={{
                    width: '100%',
                    backgroundColor: '#090C11',
                    border: '1px solid #2A3346',
                    borderRadius: '3px',
                    padding: '6px 9px',
                    color: '#38BDF8',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '11px',
                    outline: 'none',
                  }}
                />
              </div>
            )}

            {/* Inline Error Box */}
            {errorMsg && (
              <div
                role="alert"
                data-testid="login-error-banner"
                style={{
                  marginBottom: '16px',
                  padding: '10px 12px',
                  backgroundColor: 'rgba(242, 54, 69, 0.10)',
                  border: '1px solid rgba(242, 54, 69, 0.45)',
                  borderRadius: '4px',
                  color: '#FCA5A5',
                  fontSize: '12px',
                  lineHeight: 1.45,
                }}
              >
                <div style={{ fontWeight: 700, color: '#F87171', marginBottom: '2px' }}>
                  {errorCode === 'RATE_LIMITED'
                    ? `Tạm khóa bảo mật (${lockoutSec}s)`
                    : errorCode === 'UNREGISTERED_ACCOUNT'
                    ? 'Tài khoản chưa được cấp phép'
                    : 'Xác thực không thành công'}
                </div>
                <div>{errorMsg}</div>
                {errorCode === 'UNREGISTERED_ACCOUNT' && (
                  <button
                    type="button"
                    onClick={handleOpenWebRegister}
                    style={{
                      marginTop: '8px',
                      backgroundColor: 'transparent',
                      border: '1px solid #F87171',
                      color: '#FECACA',
                      borderRadius: '3px',
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Mở trang đăng ký Web Portal ↗
                  </button>
                )}
              </div>
            )}

            {/* Primary Login Button */}
            <button
              type="submit"
              data-testid="login-submit-btn"
              disabled={isSubmitting || lockoutSec > 0}
              style={{
                width: '100%',
                backgroundColor: lockoutSec > 0 ? '#1E2533' : '#089981',
                color: lockoutSec > 0 ? '#64748B' : '#FFFFFF',
                border: 'none',
                borderRadius: '4px',
                padding: '11px 16px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: isSubmitting || lockoutSec > 0 ? 'not-allowed' : 'pointer',
                letterSpacing: '0.2px',
              }}
            >
              {isSubmitting
                ? 'Đang xác thực giấy phép...'
                : lockoutSec > 0
                ? `Thử lại sau ${lockoutSec}s`
                : 'Đăng nhập Terminal'}
            </button>
          </form>

          {/* Bottom Hardware & Portal Telemetry Strip */}
          <div
            style={{
              marginTop: '24px',
              paddingTop: '14px',
              borderTop: '1px solid #1C2332',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '10.5px',
              fontFamily: "'JetBrains Mono', monospace",
              color: '#64748B',
            }}
          >
            <span>HWID: {hwid}</span>
            <span>Auth: Login-Only · Web Portal Managed</span>
          </div>
        </div>
      </div>
    </div>
  );
};
