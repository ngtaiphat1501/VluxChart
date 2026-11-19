"""
DeepChart Gate G3 Test Suite: Verified Analytics & Footprint Core
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

def run_cargo(args: list[str]) -> subprocess.CompletedProcess:
    cargo_bin = Path(os.path.expandvars(r"$USERPROFILE\.cargo\bin"))
    cargo_exe = cargo_bin / "cargo.exe"
    env = os.environ.copy()
    env["PATH"] = f"{cargo_bin};{WINLIBS_BIN};" + env.get("PATH", "")
    
    cmd = [str(cargo_exe)] + args
    return subprocess.run(cmd, cwd=str(BASE_DIR), capture_output=True, text=True, env=env)

class TestGateG3Analytics:
    """Gate G3 Test Suite for Verified Analytics & Footprint Core"""

    def test_tc_g3_01_bar_manager_and_late_corrections(self):
        """TC-G3-01: Bar manager lifecycle, exact [start, end) boundaries, and late-trade corrections"""
        result = run_cargo(["test", "-p", "volume-engine", "--test", "volume_tests", "test_bar_manager_lifecycle_and_exact_invariants"])
        assert result.returncode == 0, f"BarManager tests failed: {result.stderr}"
        assert "test test_bar_manager_lifecycle_and_exact_invariants ... ok" in result.stdout

    def test_tc_g3_02_golden_volume_accounting_invariants(self):
        """TC-G3-02: 1000-trade golden test: Total = Buy + Sell + Unknown, zero float drift, cell sum == bar total"""
        result = run_cargo(["test", "-p", "volume-engine", "--test", "golden_volume_tests"])
        assert result.returncode == 0, f"Golden volume tests failed: {result.stderr}"
        assert "test test_golden_1000_trades_exact_summation_and_cell_invariants ... ok" in result.stdout

    def test_tc_g3_03_indicators_poc_value_area_and_imbalance(self):
        """TC-G3-03: Indicators: POC price level, 70% Value Area (VAH/VAL), and diagonal bid/ask imbalances"""
        result = run_cargo(["test", "-p", "volume-engine", "--test", "volume_tests", "test_poc_value_area_and_diagonal_imbalances"])
        assert result.returncode == 0, f"Indicators tests failed: {result.stderr}"
        assert "test test_poc_value_area_and_diagonal_imbalances ... ok" in result.stdout

    def test_tc_g3_04_multi_speed_windows_and_cvd(self):
        """TC-G3-04: Multi-speed rolling windows (1s, 5s, 10s) and Cumulative Volume Delta tracking"""
        result = run_cargo(["test", "-p", "volume-engine", "--test", "volume_tests", "test_cvd_and_multi_speed_engine"])
        assert result.returncode == 0, f"Speed & CVD tests failed: {result.stderr}"
        assert "test test_cvd_and_multi_speed_engine ... ok" in result.stdout

    def test_tc_g3_05_reconciliation_audit(self):
        """TC-G3-05: Real-world 1-minute candle reconciliation with variance <= 0.1% against official Kline"""
        recon_script = BASE_DIR / "tools" / "g3_reconciliation" / "reconcile_bars.py"
        res = subprocess.run([sys.executable, str(recon_script)], cwd=str(BASE_DIR), capture_output=True, text=True)
        assert res.returncode == 0, f"Reconciliation script failed: {res.stderr}\n{res.stdout}"
        
        report_file = BASE_DIR / "docs" / "reconciliation" / "reconciliation_report.json"
        assert report_file.exists(), "Reconciliation report JSON must exist"
        data = json.loads(report_file.read_text(encoding="utf-8"))
        assert data["status"] == "PASS"
        assert data["volume"]["variance_pct"] <= 0.10
        assert data["invariant_check"]["total_eq_buy_plus_sell_plus_unknown"] is True
