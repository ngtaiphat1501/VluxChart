//! DeepChart Windows Desktop Application Entrypoint (Tauri 2)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use app_service::{
    AppServiceState, BacktestConfigDTO, BacktestReportDTO, ChartSnapshotDTO, DataExporter,
    DataQualityStatusDTO, OptimizationReportDTO, OptimizationSweepConfigDTO,
};
use std::sync::Mutex;
use tauri::State;

struct DesktopAppState {
    service: Mutex<AppServiceState>,
}

#[tauri::command]
fn get_app_version() -> &'static str {
    "0.1.0-alpha"
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

fn find_mt5_bridge_script() -> Option<std::path::PathBuf> {
    let candidates = [
        std::path::PathBuf::from("scripts/mt5_live_bridge.py"),
        std::path::PathBuf::from("../../scripts/mt5_live_bridge.py"),
        std::path::PathBuf::from("../../../scripts/mt5_live_bridge.py"),
        std::path::PathBuf::from("D:/DeepChart/scripts/mt5_live_bridge.py"),
    ];
    for p in candidates {
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn spawn_mt5_bridge_daemon() {
    if let Some(script_path) = find_mt5_bridge_script() {
        let mut cmd = std::process::Command::new("python");
        cmd.arg(script_path).arg("--serve");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let _ = cmd.spawn();
    }
}

#[tauri::command]
fn mt5_bridge_exec(payload: String) -> Result<String, String> {
    let script_path = find_mt5_bridge_script()
        .ok_or_else(|| "scripts/mt5_live_bridge.py not found".to_string())?;
    let mut cmd = std::process::Command::new("python");
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
        return Err(if stderr.is_empty() { "Empty MT5 bridge output".to_string() } else { stderr });
    }
    Ok(stdout)
}

fn main() {
    tracing_subscriber::fmt::init();
    tracing::info!("Initializing DeepChart Desktop Core Shell...");
    spawn_mt5_bridge_daemon();

    let app_state = DesktopAppState {
        service: Mutex::new(AppServiceState::new()),
    };

    tauri::Builder::default()
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
            mt5_bridge_exec
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeepChart desktop application");
}
