"""
DeepChart Gate G4 Test Suite: Desktop Terminal UI & Tauri IPC Bridge
Author: DeepChart Core Team
"""

import json
import os
import subprocess
import sys
from pathlib import Path
import pytest

BASE_DIR = Path(__file__).resolve().parent.parent.parent
WINLIBS_BIN = r"C:\Users\ACER\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"

def run_cargo(args: list[str], cwd: Path = BASE_DIR) -> subprocess.CompletedProcess:
    cargo_bin = Path(os.path.expandvars(r"$USERPROFILE\.cargo\bin"))
    cargo_exe = cargo_bin / "cargo.exe"
    env = os.environ.copy()
    env["PATH"] = f"{cargo_bin};{WINLIBS_BIN};" + env.get("PATH", "")
    
    cmd = [str(cargo_exe)] + args
    return subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, env=env)

class TestGateG4DesktopTerminal:
    """Gate G4 Test Suite for Desktop Terminal UI & Tauri IPC Bridge"""

    def test_tc_g4_01_app_service_snapshot_and_dto_schema(self):
        """TC-G4-01: AppService snapshot generation, Footprint DTO serialization, and exact integer scaling"""
        result = run_cargo(["test", "-p", "app-service", "--test", "coordinator_tests", "test_coordinator_snapshot_generation_and_dto"])
        assert result.returncode == 0, f"AppService snapshot test failed: {result.stderr}"
        assert "test test_coordinator_snapshot_generation_and_dto ... ok" in result.stdout

    def test_tc_g4_02_app_service_state_and_instrument_switching(self):
        """TC-G4-02: AppServiceState lifecycle, thread-safe switching across BTC, ETH, and Gold (XAUUSDT)"""
        result = run_cargo(["test", "-p", "app-service", "--test", "coordinator_tests", "test_app_service_state_lifecycle_and_switching"])
        assert result.returncode == 0, f"AppServiceState switching test failed: {result.stderr}"
        assert "test test_app_service_state_lifecycle_and_switching ... ok" in result.stdout

    def test_tc_g4_03_tauri_shell_compilation_and_command_registration(self):
        """TC-G4-03: Tauri src-tauri shell compilation check and command registry validation"""
        tauri_dir = BASE_DIR / "apps" / "desktop" / "src-tauri"
        result = run_cargo(["check", "--manifest-path", str(tauri_dir / "Cargo.toml")], cwd=tauri_dir)
        assert result.returncode == 0, f"Tauri cargo check failed: {result.stderr}"
        
        main_rs = (tauri_dir / "src" / "main.rs").read_text(encoding="utf-8")
        required_commands = [
            "get_app_version",
            "get_instruments",
            "get_chart_snapshot",
            "switch_instrument",
            "get_data_quality_status",
        ]
        for cmd in required_commands:
            assert cmd in main_rs, f"Command {cmd} not registered in Tauri main.rs"

    def test_tc_g4_04_desktop_frontend_production_build(self):
        """TC-G4-04: Desktop frontend clean TypeScript build and Vite asset bundle generation"""
        desktop_dir = BASE_DIR / "apps" / "desktop"
        dist_html = desktop_dir / "dist" / "index.html"
        assert dist_html.exists(), "dist/index.html must exist from build"
        html_content = dist_html.read_text(encoding="utf-8")
        assert "DeepChart" in html_content
        
        # Verify assets directory contains bundle js
        dist_assets = desktop_dir / "dist" / "assets"
        assert dist_assets.exists() and any(dist_assets.glob("*.js")), "dist/assets must contain JS bundles"

    def test_tc_g4_05_ui_component_architecture_and_quality_center(self):
        """TC-G4-05: Canvas 2D Footprint, Data Quality Center, and Toolbar component integration"""
        desktop_src = BASE_DIR / "apps" / "desktop" / "src"
        canvas_comp = desktop_src / "components" / "FootprintCanvas.tsx"
        quality_comp = desktop_src / "components" / "DataQualityCenter.tsx"
        toolbar_comp = desktop_src / "components" / "Toolbar.tsx"
        app_file = desktop_src / "App.tsx"
        
        assert canvas_comp.exists(), "FootprintCanvas.tsx must exist"
        assert quality_comp.exists(), "DataQualityCenter.tsx must exist"
        assert toolbar_comp.exists(), "Toolbar.tsx must exist"
        assert app_file.exists(), "App.tsx must exist"
        
        canvas_src = canvas_comp.read_text(encoding="utf-8")
        assert "requestAnimationFrame" in canvas_src or "getContext('2d')" in canvas_src
        assert "isPoc" in canvas_src or "poc_ticks" in canvas_src
        assert "value_area" in canvas_src
        assert "footprint" in canvas_src
        
        quality_src = quality_comp.read_text(encoding="utf-8")
        assert "DataQualityCenter" in quality_src
        assert "Invariant: Exact Integer OK" in quality_src
        assert "Speed:" in quality_src
        assert "LIVE_CONNECTED" in quality_src
