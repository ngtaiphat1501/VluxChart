"""
DeepChart Gate G1 Test Suite: Foundation, Rust Workspace & Desktop Shell
Author: DeepChart Core Team
"""

import json
import os
import subprocess
from pathlib import Path
import yaml
import pytest

BASE_DIR = Path(__file__).resolve().parent.parent.parent
CARGO_TOML = BASE_DIR / "Cargo.toml"
DESKTOP_DIR = BASE_DIR / "apps" / "desktop"
TAURI_CONF = DESKTOP_DIR / "src-tauri" / "tauri.conf.json"
PACKAGE_JSON = DESKTOP_DIR / "package.json"
CI_WORKFLOW = BASE_DIR / ".github" / "workflows" / "windows-ci.yml"
WINLIBS_BIN = r"C:\Users\ACER\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"

class TestGateG1Foundation:
    """Gate G1 Test Suite for Foundation Ready"""

    def test_tc_g1_01_cargo_workspace_structure(self):
        """TC-G1-01: Verify Cargo root workspace defines all 6 canonical crates"""
        assert CARGO_TOML.exists(), "Root Cargo.toml must exist"
        content = CARGO_TOML.read_text(encoding="utf-8")
        assert "members" in content
        for crate in ["data-contract", "volume-engine", "data-quality", "raw-journal", "feed-adapters", "app-service"]:
            assert f"crates/{crate}" in content, f"Crate {crate} missing from workspace members"

    def test_tc_g1_02_rust_crates_cargo_test(self):
        """TC-G1-02: Verify cargo test executes and passes across Rust data-contract crate"""
        cargo_bin = Path(os.path.expandvars(r"$USERPROFILE\.cargo\bin"))
        cargo_exe = cargo_bin / "cargo.exe"
        env = os.environ.copy()
        env["PATH"] = f"{cargo_bin};{WINLIBS_BIN};" + env.get("PATH", "")
        
        cmd = [str(cargo_exe), "test", "-p", "data-contract"]
        result = subprocess.run(cmd, cwd=str(BASE_DIR), capture_output=True, text=True, env=env)
        
        print("\nCargo test output:\n", result.stdout)
        if result.returncode != 0:
            print("Cargo test stderr:\n", result.stderr)
            
        assert result.returncode == 0, f"cargo test -p data-contract must exit with 0. stderr: {result.stderr}"
        assert "test numeric::tests::test_scaled_quantity_arithmetic ... ok" in result.stdout
        assert "test test_exact_bar_and_footprint_invariants ... ok" in result.stdout

    def test_tc_g1_03_desktop_app_manifest_and_tauri_config(self):
        """TC-G1-03: Verify Tauri 2 shell configuration and package manifest"""
        assert PACKAGE_JSON.exists(), "apps/desktop/package.json must exist"
        pkg = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
        assert pkg["name"] == "deepchart-desktop"
        assert "@tauri-apps/api" in pkg["dependencies"]

        assert TAURI_CONF.exists(), "tauri.conf.json must exist"
        tauri_conf = json.loads(TAURI_CONF.read_text(encoding="utf-8"))
        assert tauri_conf["productName"] == "DeepChart"
        assert tauri_conf["app"]["windows"][0]["title"] == "DeepChart — Order Flow Analytics"

    def test_tc_g1_04_windows_ci_pipeline_config(self):
        """TC-G1-04: Verify GitHub Actions Windows CI pipeline configuration"""
        assert CI_WORKFLOW.exists(), "windows-ci.yml must exist"
        workflow = yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8"))
        assert "jobs" in workflow
        assert "test" in workflow["jobs"]
        assert workflow["jobs"]["test"]["runs-on"] == "windows-latest"
