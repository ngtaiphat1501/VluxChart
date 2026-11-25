/**
 * DeepChart / VluxChart System & Runtime Compatibility Bootstrapper Service
 *
 * Replaces manual "Data Pack Download" prompts with genuine end-user workstation
 * readiness & dependency auto-provisioning:
 * - Inspects WebView2 + Microsoft VC++ Redistributable (`vcruntime140.dll`),
 *   isolated/system Python + `MetaTrader5` + `numpy`, installed MetaTrader 5 Terminal,
 *   and live market network routes.
 * - If the user's PC already has all core libraries (`should_auto_skip === true`),
 *   the app skips startup setup 100% silently (0s friction).
 * - If a clean Windows PC is missing runtimes, provides 1-Click automated silent setup
 *   into `%LOCALAPPDATA%\DeepChart\runtime\`.
 */

export interface SystemComponentDTO {
  id: string;
  title: string;
  subtitle: string;
  status: 'READY' | 'MISSING' | 'STANDBY' | 'WARNING' | string;
  required_for_startup: boolean;
  detail: string;
  action_hint?: string | null;
}

export interface SystemEnvironmentReportDTO {
  all_core_ready: boolean;
  should_auto_skip: boolean;
  os_summary: string;
  runtime_dir: string;
  resolved_python_path?: string | null;
  mt5_terminal_path?: string | null;
  mt5_running: boolean;
  mt5_bridge_active: boolean;
  network_latency_ms?: number | null;
  checked_at_ms: number;
  components: SystemComponentDTO[];
}

export interface BootstrapInstallResultDTO {
  ok: boolean;
  installed_items: string[];
  logs: string[];
  error?: string | null;
  report: SystemEnvironmentReportDTO;
}

const SESSION_SKIP_KEY = 'vluxchart_skip_optional_runtime_v1';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
}

class SystemBootstrapService {
  hasUserSkippedForSession(): boolean {
    try {
      return sessionStorage.getItem(SESSION_SKIP_KEY) === '1';
    } catch {
      return false;
    }
  }

  markSkippedForSession(): void {
    try {
      sessionStorage.setItem(SESSION_SKIP_KEY, '1');
    } catch {}
  }

  async checkEnvironment(): Promise<SystemEnvironmentReportDTO> {
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<SystemEnvironmentReportDTO>('system_check_environment');
    }

    // Browser preview diagnostic fallback (probes local MT5 HTTP bridge + Binance Futures latency)
    let bridgeUp = false;
    let mt5Connected = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 650);
      const r = await fetch('http://127.0.0.1:15556', { method: 'GET', signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        bridgeUp = true;
        const j = await r.json();
        mt5Connected = Boolean(j?.connected);
      }
    } catch {}

    let netLatency: number | null = null;
    try {
      const t0 = performance.now();
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch('https://fapi.binance.com/fapi/v1/time', { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        netLatency = Math.max(5, Math.round(performance.now() - t0));
      }
    } catch {}

    return {
      all_core_ready: true,
      should_auto_skip: true,
      os_summary: 'BROWSER SANDBOX (WEB PREVIEW)',
      runtime_dir: '%LOCALAPPDATA%\\DeepChart\\runtime',
      resolved_python_path: bridgeUp ? 'Local Bridge 127.0.0.1:15556' : null,
      mt5_terminal_path: mt5Connected ? 'MetaTrader 5 Active' : null,
      mt5_running: mt5Connected,
      mt5_bridge_active: bridgeUp,
      network_latency_ms: netLatency,
      checked_at_ms: Date.now(),
      components: [
        {
          id: 'os_webview_vcredist',
          title: 'Nhân Đồ Họa Chromium / WebView2 & Runtime Nền',
          subtitle: 'Bắt buộc để dựng biểu đồ Canvas 60 FPS',
          status: 'READY',
          required_for_startup: true,
          detail: 'Đang chạy trực tiếp trên trình duyệt chuẩn HTML5 Canvas / WebCrypto',
        },
        {
          id: 'mt5_python_runtime',
          title: 'Runtime Cầu Nối MetaTrader 5 & Vector Order Flow',
          subtitle: 'Đồng bộ nến, tick Bid×Ask và đặt lệnh trực tiếp',
          status: bridgeUp ? 'READY' : 'STANDBY',
          required_for_startup: false,
          detail: bridgeUp
            ? 'Daemon 127.0.0.1:15556 đang phản hồi trực tiếp'
            : 'Chế độ Web sử dụng trực tiếp dữ liệu Sàn Quốc Tế (Bản .EXE hỗ trợ cài tự động 1-Click)',
        },
        {
          id: 'mt5_terminal',
          title: 'Ứng Dụng MetaTrader 5 Terminal (Exness / ICMarkets / ECN)',
          subtitle: 'Kết nối tài khoản giao dịch cục bộ',
          status: mt5Connected ? 'READY' : 'STANDBY',
          required_for_startup: false,
          detail: mt5Connected
            ? 'MetaTrader 5 đang mở và đã kết nối tài khoản'
            : 'Chưa kết nối MT5 — Đang dùng luồng dữ liệu Realtime Quốc tế',
        },
        {
          id: 'exchange_network',
          title: 'Tuyến Mạng Dữ Liệu Realtime (Bybit · Binance · OPRA Gold Options)',
          subtitle: 'Truyền tải nến, khớp lệnh từng mili-giây và chuỗi quyền chọn Call/Put',
          status: netLatency !== null ? 'READY' : 'WARNING',
          required_for_startup: false,
          detail:
            netLatency !== null
              ? `Kết nối Realtime thông suốt · Độ trễ ~${netLatency} ms`
              : 'Đang kiểm tra tuyến mạng dữ liệu...',
        },
      ],
    };
  }

  async autoInstallRuntimes(): Promise<BootstrapInstallResultDTO> {
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<BootstrapInstallResultDTO>('system_auto_install_runtimes');
    }
    const rep = await this.checkEnvironment();
    return {
      ok: true,
      installed_items: [],
      logs: ['Chế độ trình duyệt đã sẵn sàng, không cần cài đặt thư viện hệ thống.'],
      error: null,
      report: rep,
    };
  }

  async launchMt5Terminal(): Promise<{ ok: boolean; path?: string; error?: string }> {
    if (isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const path = await invoke<string>('system_launch_mt5');
        return { ok: true, path };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }
    return { ok: false, error: 'Tính năng khởi chạy ứng dụng Windows chỉ hoạt động trên bản Desktop .EXE.' };
  }
}

export const systemBootstrapService = new SystemBootstrapService();
