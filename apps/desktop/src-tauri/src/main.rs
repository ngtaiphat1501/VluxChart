//! DeepChart / VluxChart Windows Desktop Application Entrypoint (Tauri 2)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod cme_mbo;
mod data_manager;
mod gold_options;
mod system_bootstrap;

use app_service::{
    AppServiceState, BacktestConfigDTO, BacktestReportDTO, ChartSnapshotDTO, DataExporter,
    DataQualityStatusDTO, OptimizationReportDTO, OptimizationSweepConfigDTO,
};
use auth::{AuthLoginResultDTO, AuthManager, AuthSessionDTO, PortalUrlsDTO, validate_external_url};
use cme_mbo::{
    CmeConfigInputDTO, CmeConnectionStatusDTO, CmeMboManager, CmeMboPollSnapshotDTO,
};
use data_manager::{DataManifestDTO, DataPackManager, InstalledDataPackDTO, IntegrityReportDTO};
use gold_options::{GoldOptionsChainDTO, GoldOptionsEngine};
use system_bootstrap::{BootstrapInstallResultDTO, SystemEnvironmentReportDTO};
use std::process::Child;
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent, State};

struct DesktopAppState {
    service: Mutex<AppServiceState>,
    auth: Mutex<AuthManager>,
    data_packs: Mutex<DataPackManager>,
    gold_options: Arc<GoldOptionsEngine>,
    cme_mbo: Arc<CmeMboManager>,
    mt5_bridge_child: Mutex<Option<Child>>,
}

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn get_instruments(state: State<DesktopAppState>) -> Result<Vec<data_contract::InstrumentDefinition>, String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    Ok(service.registry.list().into_iter().cloned().collect())
}

#[tauri::command]
fn get_chart_snapshot(state: State<DesktopAppState>) -> Result<ChartSnapshotDTO, String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    service.snapshot()
}

#[tauri::command]
fn switch_instrument(state: State<DesktopAppState>, instrument_id: String) -> Result<ChartSnapshotDTO, String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    service.switch_instrument(&instrument_id)?;
    service.snapshot()
}

#[tauri::command]
fn switch_timeframe(state: State<DesktopAppState>, timeframe_us: i64) -> Result<ChartSnapshotDTO, String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    service.switch_timeframe(timeframe_us)
}

#[tauri::command]
fn get_data_quality_status(state: State<DesktopAppState>) -> Result<DataQualityStatusDTO, String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    let snap = service.snapshot()?;
    Ok(snap.data_quality)
}

#[tauri::command]
fn toggle_replay(state: State<DesktopAppState>, enable: bool) -> Result<ChartSnapshotDTO, String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    service.toggle_replay(enable)
}

#[tauri::command]
fn play_replay(state: State<DesktopAppState>) -> Result<(), String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    service.play_replay()
}

#[tauri::command]
fn pause_replay(state: State<DesktopAppState>) -> Result<(), String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    service.pause_replay()
}

#[tauri::command]
fn step_replay(state: State<DesktopAppState>) -> Result<ChartSnapshotDTO, String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    service.step_replay()
}

#[tauri::command]
fn set_replay_speed(state: State<DesktopAppState>, speed: u32) -> Result<(), String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    service.set_replay_speed(speed)
}

#[tauri::command]
fn reset_replay(state: State<DesktopAppState>) -> Result<ChartSnapshotDTO, String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    service.reset_replay()
}

#[tauri::command]
fn run_order_flow_backtest(
    state: State<DesktopAppState>,
    config: BacktestConfigDTO,
) -> Result<BacktestReportDTO, String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    service.run_backtest(config)
}

#[tauri::command]
fn run_strategy_optimization(
    state: State<DesktopAppState>,
    config: OptimizationSweepConfigDTO,
) -> Result<OptimizationReportDTO, String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    service.run_optimization(config)
}

#[tauri::command]
fn export_chart_csv(state: State<DesktopAppState>, export_type: String) -> Result<String, String> {
    let service = state.service.lock().map_err(|e| e.to_string())?;
    let snap = service.snapshot()?;
    if export_type == "footprint" {
        Ok(DataExporter::footprint_to_csv(&snap.bars))
    } else {
        Ok(DataExporter::bars_to_csv(&snap.bars))
    }
}

// ============================================================================
// AUTHENTICATION COMMANDS (LOGIN-ONLY — REGISTRATION ON EXTERNAL WEB PORTAL)
// ============================================================================

#[tauri::command]
fn auth_get_portal_urls() -> PortalUrlsDTO {
    AuthManager::portal_urls()
}

#[tauri::command]
fn auth_get_hwid(state: State<DesktopAppState>) -> Result<String, String> {
    let auth = state.auth.lock().map_err(|e| e.to_string())?;
    Ok(auth.get_hwid().to_string())
}

#[tauri::command]
fn auth_get_session(state: State<DesktopAppState>) -> Result<Option<AuthSessionDTO>, String> {
    let mut auth = state.auth.lock().map_err(|e| e.to_string())?;
    Ok(auth.current_session())
}

#[tauri::command]
fn auth_login(
    state: State<DesktopAppState>,
    email: String,
    password: String,
    remember_me: bool,
    portal_url: Option<String>,
) -> Result<AuthLoginResultDTO, String> {
    let mut auth = state.auth.lock().map_err(|e| e.to_string())?;
    Ok(auth.login(&email, &password, remember_me, portal_url))
}

#[tauri::command]
fn auth_accept_remote_session(
    state: State<DesktopAppState>,
    email: String,
    display_name: String,
    tier: String,
    license_id: String,
    portal_url: String,
    remember_me: bool,
) -> Result<AuthSessionDTO, String> {
    let mut auth = state.auth.lock().map_err(|e| e.to_string())?;
    auth.accept_remote_portal_session(email, display_name, tier, license_id, portal_url, remember_me)
}

#[tauri::command]
fn auth_logout(state: State<DesktopAppState>) -> Result<(), String> {
    let mut auth = state.auth.lock().map_err(|e| e.to_string())?;
    auth.logout()
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let safe_url = validate_external_url(&url)?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &safe_url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open")
            .arg(&safe_url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    Ok(())
}

// ============================================================================
// ON-DEMAND MARKET DATA PACK MANAGER COMMANDS (LIGHTWEIGHT .EXE ARCHITECTURE)
// ============================================================================

#[tauri::command]
fn data_get_manifest(state: State<DesktopAppState>) -> Result<DataManifestDTO, String> {
    let mgr = state.data_packs.lock().map_err(|e| e.to_string())?;
    Ok(mgr.get_manifest())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn data_save_pack(
    state: State<DesktopAppState>,
    pack_id: String,
    title: String,
    symbols: Vec<String>,
    timeframes: Vec<String>,
    bar_count: usize,
    source: String,
    payload_json: String,
) -> Result<InstalledDataPackDTO, String> {
    let mgr = state.data_packs.lock().map_err(|e| e.to_string())?;
    mgr.save_pack(&pack_id, title, symbols, timeframes, bar_count, source, &payload_json)
}

#[tauri::command]
fn data_load_pack(state: State<DesktopAppState>, pack_id: String) -> Result<String, String> {
    let mgr = state.data_packs.lock().map_err(|e| e.to_string())?;
    mgr.load_pack(&pack_id)
}

#[tauri::command]
fn data_delete_pack(state: State<DesktopAppState>, pack_id: String) -> Result<DataManifestDTO, String> {
    let mgr = state.data_packs.lock().map_err(|e| e.to_string())?;
    mgr.delete_pack(&pack_id)
}

#[tauri::command]
fn data_clear_all(state: State<DesktopAppState>) -> Result<DataManifestDTO, String> {
    let mgr = state.data_packs.lock().map_err(|e| e.to_string())?;
    mgr.clear_all()
}

#[tauri::command]
fn data_verify_integrity(state: State<DesktopAppState>) -> Result<IntegrityReportDTO, String> {
    let mgr = state.data_packs.lock().map_err(|e| e.to_string())?;
    Ok(mgr.verify_integrity())
}

// ============================================================================
// RUST-NATIVE STANDALONE GOLD OPTIONS (XAU/USD) ENGINE (ZERO PYTHON REQUIRED)
// ============================================================================

#[tauri::command]
async fn fetch_gold_options_chain(
    state: State<'_, DesktopAppState>,
    expiry_filter: String,
    spot_gold_usd: Option<f64>,
) -> Result<GoldOptionsChainDTO, String> {
    let engine = Arc::clone(&state.gold_options);
    tokio::task::spawn_blocking(move || engine.fetch_chain(&expiry_filter, spot_gold_usd))
        .await
        .map_err(|e| format!("Gold options worker join error: {}", e))?
}

// ============================================================================
// MT5 LOCAL BRIDGE DISCOVERY & MANAGED LIFECYCLE (ZERO HARDCODED DEV PATHS)
// ============================================================================

fn find_mt5_bridge_script() -> Option<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    // 1. Co-located next to the installed executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("mt5_live_bridge.py"));
            candidates.push(exe_dir.join("scripts").join("mt5_live_bridge.py"));
            candidates.push(exe_dir.join("resources").join("mt5_live_bridge.py"));
        }
    }

    // 2. Local AppData runtime directory
    candidates.push(auth::default_app_data_dir().join("scripts").join("mt5_live_bridge.py"));

    // 3. Relative workspace paths (for dev mode)
    candidates.push(std::path::PathBuf::from("scripts/mt5_live_bridge.py"));
    candidates.push(std::path::PathBuf::from("../../scripts/mt5_live_bridge.py"));
    candidates.push(std::path::PathBuf::from("../../../scripts/mt5_live_bridge.py"));

    for p in candidates {
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn spawn_mt5_bridge_daemon() -> Option<Child> {
    let script_path = system_bootstrap::sync_bridge_script_to_appdata().or_else(find_mt5_bridge_script)?;
    let py_exe = system_bootstrap::resolve_working_python_exe()
        .map(|(p, _)| p)
        .unwrap_or_else(|| std::path::PathBuf::from("python"));
    let mut cmd = std::process::Command::new(py_exe);
    cmd.arg(script_path).arg("--serve");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().ok()
}

fn ensure_mt5_daemon_running(state: &DesktopAppState) {
    if system_bootstrap::check_local_mt5_bridge_port() {
        return;
    }
    if let Ok(mut guard) = state.mt5_bridge_child.lock() {
        let needs_spawn = match guard.as_mut() {
            Some(child) => child.try_wait().ok().flatten().is_some(),
            None => true,
        };
        if needs_spawn {
            *guard = spawn_mt5_bridge_daemon();
        }
    }
}

#[tauri::command]
async fn system_check_environment(
    state: State<'_, DesktopAppState>,
) -> Result<SystemEnvironmentReportDTO, String> {
    ensure_mt5_daemon_running(&state);
    tokio::task::spawn_blocking(system_bootstrap::inspect_system_environment)
        .await
        .map_err(|e| format!("System check worker error: {}", e))
}

#[tauri::command]
async fn system_auto_install_runtimes(
    state: State<'_, DesktopAppState>,
) -> Result<BootstrapInstallResultDTO, String> {
    let mut res = tokio::task::spawn_blocking(system_bootstrap::auto_install_missing_runtimes)
        .await
        .map_err(|e| format!("Runtime installer worker error: {}", e))?;
    if res.ok {
        ensure_mt5_daemon_running(&state);
        std::thread::sleep(std::time::Duration::from_millis(350));
        res.report = tokio::task::spawn_blocking(system_bootstrap::inspect_system_environment)
            .await
            .unwrap_or(res.report);
    }
    Ok(res)
}

#[tauri::command]
fn system_launch_mt5() -> Result<String, String> {
    system_bootstrap::launch_detected_mt5_terminal()
}

#[tauri::command]
async fn mt5_bridge_exec(payload: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let script_path = system_bootstrap::sync_bridge_script_to_appdata()
            .or_else(find_mt5_bridge_script)
            .ok_or_else(|| "MT5 Bridge script not installed in local app directory".to_string())?;
        let py_exe = system_bootstrap::resolve_working_python_exe()
            .map(|(p, _)| p)
            .unwrap_or_else(|| std::path::PathBuf::from("python"));
        let mut cmd = std::process::Command::new(py_exe);
        cmd.arg(script_path).arg("--rpc").arg(&payload);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let output = cmd.output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.is_empty() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "Empty MT5 bridge output".to_string()
            } else {
                stderr
            });
        }
        Ok(stdout)
    })
    .await
    .map_err(|e| format!("MT5 bridge worker join error: {}", e))?
}

// ============================================================================
// US FUTURES CME GLOBEX LEVEL-3 MBO CONNECTOR (`GLBX.MDP3` / DXFEED / RITHMIC)
// ============================================================================

#[tauri::command]
fn cme_get_status(state: State<'_, DesktopAppState>) -> Result<CmeConnectionStatusDTO, String> {
    state.cme_mbo.get_status()
}

#[tauri::command]
async fn cme_save_config(
    state: State<'_, DesktopAppState>,
    input: CmeConfigInputDTO,
) -> Result<CmeConnectionStatusDTO, String> {
    let mgr = Arc::clone(&state.cme_mbo);
    tokio::task::spawn_blocking(move || mgr.save_and_verify_config(input))
        .await
        .map_err(|e| format!("CME config worker error: {}", e))?
}

#[tauri::command]
fn cme_clear_config(state: State<'_, DesktopAppState>) -> Result<CmeConnectionStatusDTO, String> {
    state.cme_mbo.clear_config()
}

#[tauri::command]
async fn cme_fetch_historical_bars(
    state: State<'_, DesktopAppState>,
    instrument_id: String,
    timeframe_us: i64,
    limit: usize,
) -> Result<Vec<app_service::BarDTO>, String> {
    let mgr = Arc::clone(&state.cme_mbo);
    tokio::task::spawn_blocking(move || mgr.fetch_historical_bars(&instrument_id, timeframe_us, limit))
        .await
        .map_err(|e| format!("CME historical bars worker error: {}", e))?
}

#[tauri::command]
async fn cme_start_live_stream(
    state: State<'_, DesktopAppState>,
    instrument_id: String,
) -> Result<CmeConnectionStatusDTO, String> {
    let mgr = Arc::clone(&state.cme_mbo);
    tokio::task::spawn_blocking(move || mgr.start_live_stream(&instrument_id))
        .await
        .map_err(|e| format!("CME live stream worker error: {}", e))?
}

#[tauri::command]
fn cme_stop_live_stream(state: State<'_, DesktopAppState>) -> Result<(), String> {
    state.cme_mbo.stop_live_stream();
    Ok(())
}

#[tauri::command]
async fn cme_import_mbo_file(
    state: State<'_, DesktopAppState>,
    file_path: String,
    instrument_id: String,
) -> Result<CmeMboPollSnapshotDTO, String> {
    let mgr = Arc::clone(&state.cme_mbo);
    tokio::task::spawn_blocking(move || mgr.import_local_mbo_file(&file_path, &instrument_id))
        .await
        .map_err(|e| format!("CME MBO file import worker error: {}", e))?
}

#[tauri::command]
fn cme_poll_mbo_snapshot(
    state: State<'_, DesktopAppState>,
    instrument_id: String,
    since_seq: u64,
) -> Result<CmeMboPollSnapshotDTO, String> {
    state.cme_mbo.poll_mbo_snapshot(&instrument_id, since_seq)
}

fn main() {
    tracing_subscriber::fmt::init();
    tracing::info!("Initializing DeepChart / VluxChart Desktop Core Shell v{}...", env!("CARGO_PKG_VERSION"));
    let mt5_child = spawn_mt5_bridge_daemon();
    let app_data = auth::default_app_data_dir();

    let app_state = DesktopAppState {
        service: Mutex::new(AppServiceState::new()),
        auth: Mutex::new(AuthManager::new()),
        data_packs: Mutex::new(DataPackManager::new()),
        gold_options: Arc::new(GoldOptionsEngine::new()),
        cme_mbo: Arc::new(CmeMboManager::new(&app_data)),
        mt5_bridge_child: Mutex::new(mt5_child),
    };

    let app = tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_instruments,
            get_chart_snapshot,
            switch_instrument,
            switch_timeframe,
            get_data_quality_status,
            toggle_replay,
            play_replay,
            pause_replay,
            step_replay,
            set_replay_speed,
            reset_replay,
            export_chart_csv,
            run_order_flow_backtest,
            run_strategy_optimization,
            mt5_bridge_exec,
            auth_get_portal_urls,
            auth_get_hwid,
            auth_get_session,
            auth_login,
            auth_accept_remote_session,
            auth_logout,
            open_external_url,
            data_get_manifest,
            data_save_pack,
            data_load_pack,
            data_delete_pack,
            data_clear_all,
            data_verify_integrity,
            fetch_gold_options_chain,
            system_check_environment,
            system_auto_install_runtimes,
            system_launch_mt5,
            cme_get_status,
            cme_save_config,
            cme_clear_config,
            cme_fetch_historical_bars,
            cme_start_live_stream,
            cme_stop_live_stream,
            cme_import_mbo_file,
            cme_poll_mbo_snapshot
        ])
        .build(tauri::generate_context!())
        .expect("error while building DeepChart desktop application");

    app.run(|app_handle, event| {
        let should_cleanup = matches!(
            event,
            RunEvent::Exit
                | RunEvent::ExitRequested { .. }
                | RunEvent::WindowEvent {
                    event: tauri::WindowEvent::Destroyed,
                    ..
                }
        );
        if should_cleanup {
            if let Some(state) = app_handle.try_state::<DesktopAppState>() {
                state.cme_mbo.stop_live_stream();
                if let Ok(mut guard) = state.mt5_bridge_child.lock() {
                    if let Some(ref mut child) = *guard {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                    *guard = None;
                }
            }
        }
    });
}
