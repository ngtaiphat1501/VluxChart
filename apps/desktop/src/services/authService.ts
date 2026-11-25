/**
 * DeepChart / VluxChart Desktop Authentication Service (Login-Only Architecture)
 *
 * Industry Standard (ATAS / Quantower / Sierra Chart):
 * - Desktop client supports LOGIN ONLY.
 * - Account registration, subscription management, and password recovery happen
 *   exclusively on the separate official Web Portal.
 * - Uses Tauri native Rust commands (`auth_login`, `auth_get_session`, `auth_logout`)
 *   for HWID-bound signed session storage in `%LOCALAPPDATA%\DeepChart\auth_session.json`,
 *   with a matching WebCrypto SHA-256 implementation for browser preview mode.
 */

export interface PortalUrlsDTO {
  portal_base_url: string;
  register_url: string;
  reset_password_url: string;
  license_docs_url: string;
}

export interface AuthSessionDTO {
  session_id: string;
  email: string;
  display_name: string;
  tier: string;
  license_id: string;
  hwid: string;
  auth_mode: string;
  portal_url: string;
  issued_at_ms: number;
  expires_at_ms: number;
  remember_me: boolean;
  signature: string;
}

export interface AuthLoginResultDTO {
  ok: boolean;
  session: AuthSessionDTO | null;
  error: string | null;
  error_code: string | null;
  lockout_remaining_ms: number | null;
}

export const DEFAULT_PORTAL_URLS: PortalUrlsDTO = {
  portal_base_url: 'https://portal.vluxchart.com',
  register_url: 'https://portal.vluxchart.com/register',
  reset_password_url: 'https://portal.vluxchart.com/reset-password',
  license_docs_url: 'https://portal.vluxchart.com/pricing',
};

const BROWSER_SESSION_KEY = 'vluxchart_auth_session_v1';
const BROWSER_EPHEMERAL_KEY = 'vluxchart_auth_ephemeral_v1';
const BROWSER_LOCKOUT_KEY = 'vluxchart_auth_lockout_v1';
const CREDENTIAL_DOMAIN_SALT = 'vluxchart-auth-v1';

interface BrowserPilotRecord {
  email: string;
  passwordDigestHex: string;
  displayName: string;
  tier: string;
  licenseId: string;
}

const BROWSER_PROVISIONED_ACCOUNTS: BrowserPilotRecord[] = [
  {
    email: 'trader@vluxchart.com',
    passwordDigestHex: '771b346cfeb44cdd6634f62907acb4d668caf25a95561814af538cdaeeac1a52',
    displayName: 'Institutional Gold Trader',
    tier: 'INSTITUTIONAL PRO',
    licenseId: 'VLUX-PRO-XAU-2026',
  },
  {
    email: 'quant@deepchart.io',
    passwordDigestHex: 'a976e21d8bc11f6fe9766c64fbb71aba9ae71f0f109b41a0e4974e637cde5891',
    displayName: 'Quant Research Desk',
    tier: 'QUANT DESK',
    licenseId: 'DC-QUANT-2026',
  },
  {
    email: 'demo@vluxchart.com',
    passwordDigestHex: '8c5b247f3f2f58b262df42e67784cdf320a1c43396df619d90674e33f0485276',
    displayName: 'Standard Pilot Account',
    tier: 'STANDARD PILOT',
    licenseId: 'VLUX-PILOT-2026',
  },
];

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
}

async function sha256HexBrowser(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isValidEmail(email: string): boolean {
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return (
    local.length > 0 &&
    domain.length >= 3 &&
    domain.includes('.') &&
    !domain.startsWith('.') &&
    !domain.endsWith('.')
  );
}

class AuthService {
  async getPortalUrls(): Promise<PortalUrlsDTO> {
    if (isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<PortalUrlsDTO>('auth_get_portal_urls');
      } catch {
        // Fallback to default URLs
      }
    }
    return DEFAULT_PORTAL_URLS;
  }

  async getMachineHwid(): Promise<string> {
    if (isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<string>('auth_get_hwid');
      } catch {
        // Fallback
      }
    }
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'browser';
    const digest = await sha256HexBrowser(`browser-hwid:${ua}`);
    return `VLX-WEB-${digest.slice(0, 12).toUpperCase()}`;
  }

  async getSession(): Promise<AuthSessionDTO | null> {
    if (isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<AuthSessionDTO | null>('auth_get_session');
      } catch (e) {
        console.warn('[AuthService] Failed to read Tauri session:', e);
        return null;
      }
    }

    // Browser preview fallback
    try {
      const raw =
        sessionStorage.getItem(BROWSER_EPHEMERAL_KEY) ||
        localStorage.getItem(BROWSER_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AuthSessionDTO;
      if (!parsed.expires_at_ms || parsed.expires_at_ms <= Date.now()) {
        localStorage.removeItem(BROWSER_SESSION_KEY);
        sessionStorage.removeItem(BROWSER_EPHEMERAL_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Attempts login against a custom self-hosted Web Portal HTTPS endpoint if specified,
   * otherwise verifies against the signed desktop auth engine.
   * Strictly Login-Only: unregistered emails are never auto-created.
   */
  async login(params: {
    email: string;
    password: string;
    rememberMe: boolean;
    customPortalUrl?: string;
  }): Promise<AuthLoginResultDTO> {
    const email = params.email.trim();
    const password = params.password;
    const customUrl = params.customPortalUrl?.trim().replace(/\/+$/, '');

    // Optional live remote Web Portal login if user configured a self-hosted portal server
    if (
      customUrl &&
      customUrl !== DEFAULT_PORTAL_URLS.portal_base_url &&
      (customUrl.startsWith('https://') || customUrl.startsWith('http://'))
    ) {
      try {
        const hwid = await this.getMachineHwid();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(`${customUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.toLowerCase(),
            password,
            hwid,
            app_version: '0.1.0',
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (resp.ok) {
          const data = await resp.json();
          if (data && data.ok && data.user) {
            if (isTauriRuntime()) {
              const { invoke } = await import('@tauri-apps/api/core');
              const sealed = await invoke<AuthSessionDTO>('auth_accept_remote_session', {
                email: data.user.email || email,
                displayName: data.user.display_name || email.split('@')[0],
                tier: data.user.tier || 'STANDARD',
                licenseId: data.user.license_id || 'WEB-PORTAL-LIC',
                portalUrl: customUrl,
                rememberMe: params.rememberMe,
              });
              return { ok: true, session: sealed, error: null, error_code: null, lockout_remaining_ms: null };
            }
          }
        } else if (resp.status === 401 || resp.status === 403) {
          const errJson = await resp.json().catch(() => ({}));
          return {
            ok: false,
            session: null,
            error:
              errJson.message ||
              'Xác thực từ Web Portal thất bại. Kiểm tra lại email/mật khẩu hoặc đăng ký tài khoản tại Web Portal.',
            error_code: 'REMOTE_UNAUTHORIZED',
            lockout_remaining_ms: null,
          };
        }
      } catch {
        // Remote server unreachable; fall through to signed desktop verification
      }
    }

    // Native Tauri Rust Auth Engine
    if (isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<AuthLoginResultDTO>('auth_login', {
          email,
          password,
          rememberMe: params.rememberMe,
          portalUrl: customUrl || null,
        });
      } catch (e) {
        return {
          ok: false,
          session: null,
          error: `Lỗi hệ thống xác thực: ${String(e)}`,
          error_code: 'IPC_ERROR',
          lockout_remaining_ms: null,
        };
      }
    }

    // Browser preview equivalent (identical SHA-256 verification + rate-limit logic)
    return this.loginBrowserFallback(email, password, params.rememberMe, customUrl);
  }

  private async loginBrowserFallback(
    email: string,
    password: string,
    rememberMe: boolean,
    customPortalUrl?: string
  ): Promise<AuthLoginResultDTO> {
    const nowMs = Date.now();
    let lockState = { failed: 0, until: 0 };
    try {
      const rawLock = sessionStorage.getItem(BROWSER_LOCKOUT_KEY);
      if (rawLock) lockState = JSON.parse(rawLock);
    } catch {}

    if (lockState.until > nowMs) {
      const remaining = lockState.until - nowMs;
      return {
        ok: false,
        session: null,
        error: `Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau ${Math.ceil(remaining / 1000)} giây.`,
        error_code: 'RATE_LIMITED',
        lockout_remaining_ms: remaining,
      };
    }

    const normalized = email.trim().toLowerCase();
    if (!normalized || !isValidEmail(normalized)) {
      return {
        ok: false,
        session: null,
        error: 'Email không hợp lệ. Vui lòng nhập email tài khoản đã đăng ký trên Web Portal.',
        error_code: 'INVALID_EMAIL',
        lockout_remaining_ms: null,
      };
    }

    if (password.length < 6) {
      return {
        ok: false,
        session: null,
        error: 'Mật khẩu phải có ít nhất 6 ký tự.',
        error_code: 'INVALID_PASSWORD',
        lockout_remaining_ms: null,
      };
    }

    const record = BROWSER_PROVISIONED_ACCOUNTS.find((a) => a.email === normalized);
    const recordFailure = (code: string, message: string): AuthLoginResultDTO => {
      lockState.failed += 1;
      if (lockState.failed >= 5) {
        lockState.until = nowMs + 30_000;
        lockState.failed = 0;
        sessionStorage.setItem(BROWSER_LOCKOUT_KEY, JSON.stringify(lockState));
        return {
          ok: false,
          session: null,
          error: 'Đã nhập sai quá 5 lần. Tài khoản tạm khóa 30 giây để bảo vệ thiết bị.',
          error_code: 'RATE_LIMITED',
          lockout_remaining_ms: 30_000,
        };
      }
      sessionStorage.setItem(BROWSER_LOCKOUT_KEY, JSON.stringify(lockState));
      return {
        ok: false,
        session: null,
        error: message,
        error_code: code,
        lockout_remaining_ms: null,
      };
    };

    if (!record) {
      return recordFailure(
        'UNREGISTERED_ACCOUNT',
        'Tài khoản chưa được đăng ký. Ứng dụng Desktop chỉ hỗ trợ đăng nhập — vui lòng tạo tài khoản tại Web Portal chính thức.'
      );
    }

    const digest = await sha256HexBrowser(`${CREDENTIAL_DOMAIN_SALT}:${normalized}:${password}`);
    if (digest !== record.passwordDigestHex) {
      return recordFailure(
        'INVALID_CREDENTIALS',
        'Email hoặc mật khẩu không chính xác. Nếu quên mật khẩu, hãy khôi phục trên Web Portal.'
      );
    }

    sessionStorage.removeItem(BROWSER_LOCKOUT_KEY);
    const hwid = await this.getMachineHwid();
    const ttl = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
    const sessionId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `sess-${nowMs}`;
    const signature = await sha256HexBrowser(`${sessionId}|${normalized}|${record.tier}|${hwid}|${nowMs}`);

    const session: AuthSessionDTO = {
      session_id: sessionId,
      email: record.email,
      display_name: record.displayName,
      tier: record.tier,
      license_id: record.licenseId,
      hwid,
      auth_mode: 'WEB_PORTAL_VERIFIED',
      portal_url: customPortalUrl || DEFAULT_PORTAL_URLS.portal_base_url,
      issued_at_ms: nowMs,
      expires_at_ms: nowMs + ttl,
      remember_me: rememberMe,
      signature,
    };

    if (rememberMe) {
      localStorage.setItem(BROWSER_SESSION_KEY, JSON.stringify(session));
      sessionStorage.removeItem(BROWSER_EPHEMERAL_KEY);
    } else {
      sessionStorage.setItem(BROWSER_EPHEMERAL_KEY, JSON.stringify(session));
      localStorage.removeItem(BROWSER_SESSION_KEY);
    }

    return {
      ok: true,
      session,
      error: null,
      error_code: null,
      lockout_remaining_ms: null,
    };
  }

  async logout(): Promise<void> {
    if (isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('auth_logout');
      } catch (e) {
        console.warn('[AuthService] Tauri logout error:', e);
      }
    }
    try {
      localStorage.removeItem(BROWSER_SESSION_KEY);
      sessionStorage.removeItem(BROWSER_EPHEMERAL_KEY);
    } catch {}
  }

  async openExternalPortal(url: string): Promise<void> {
    if (isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_external_url', { url });
        return;
      } catch (e) {
        console.warn('[AuthService] Failed to invoke open_external_url:', e);
      }
    }
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }
}

export const authService = new AuthService();
