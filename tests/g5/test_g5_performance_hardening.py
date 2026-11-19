"""
DeepChart Gate G5 Test Suite: Performance, Hardening, Resilience & Soak
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

class TestGateG5PerformanceHardening:
    """Gate G5 Test Suite for Performance & Hardening"""

    def test_tc_g5_01_engine_throughput_and_sub_millisecond_latency(self):
        """TC-G5-01: Engine throughput >= 25,000 trades/sec and sub-millisecond per-trade latency (< 100 µs)"""
        result = run_cargo([
            "test", "-p", "app-service", "--test", "performance_tests",
            "test_pipeline_throughput_and_sub_millisecond_latency", "--", "--nocapture"
        ])
        assert result.returncode == 0, f"Throughput test failed: {result.stderr}\n{result.stdout}"
        assert "test test_pipeline_throughput_and_sub_millisecond_latency ... ok" in result.stdout
        assert "Throughput:" in result.stdout

    def test_tc_g5_02_100k_trade_soak_and_memory_stability(self):
        """TC-G5-02: 100,000-trade continuous ingestion soak test with zero memory leaks and bounded structures"""
        result = run_cargo([
            "test", "-p", "app-service", "--test", "performance_tests",
            "test_100k_trade_soak_and_memory_stability", "--", "--nocapture"
        ])
        assert result.returncode == 0, f"Soak test failed: {result.stderr}\n{result.stdout}"
        assert "test test_100k_trade_soak_and_memory_stability ... ok" in result.stdout

    def test_tc_g5_03_chaos_gap_detection_and_degradation(self):
        """TC-G5-03: Chaos resilience: Sequence gap injection triggers gap tracking and transitions to DEGRADED"""
        result = run_cargo([
            "test", "-p", "app-service", "--test", "performance_tests",
            "test_chaos_resilience_gap_injection_and_degradation", "--", "--nocapture"
        ])
        assert result.returncode == 0, f"Chaos gap test failed: {result.stderr}\n{result.stdout}"
        assert "test test_chaos_resilience_gap_injection_and_degradation ... ok" in result.stdout

    def test_tc_g5_04_late_trade_correction_and_accounting_integrity(self):
        """TC-G5-04: Late trade arrival causes BarCorrected event, updates historical bar, and preserves invariants"""
        result = run_cargo([
            "test", "-p", "app-service", "--test", "performance_tests",
            "test_late_trade_correction_integrity", "--", "--nocapture"
        ])
        assert result.returncode == 0, f"Late trade correction test failed: {result.stderr}\n{result.stdout}"
        assert "test test_late_trade_correction_integrity ... ok" in result.stdout

    def test_tc_g5_05_desktop_ui_viewport_culling_and_frame_budget(self):
        """TC-G5-05: Desktop Canvas 2D viewport culling (> 90% rate) and frame compute time well within 60 FPS (<= 16.6 ms)"""
        bench_script = BASE_DIR / "tools" / "g5_benchmarks" / "benchmark_canvas_renderer.js"
        res = subprocess.run(["node", str(bench_script)], cwd=str(BASE_DIR), capture_output=True, text=True)
        assert res.returncode == 0, f"Canvas benchmark script failed: {res.stderr}\n{res.stdout}"
        
        report_file = BASE_DIR / "docs" / "benchmarks" / "g5_ui_benchmark_report.json"
        assert report_file.exists(), "UI benchmark report must exist"
        data = json.loads(report_file.read_text(encoding="utf-8"))
        assert data["status"] == "PASS"
        assert data["metrics"]["p95_frame_ms"] < 16.6
        assert data["metrics"]["culling_efficiency_pct"] >= 90.0

    def test_tc_g5_06_vis011_full_workload_profiling_and_60fps(self):
        """TC-G5-06 / VIS-011: Heavy multi-layer workload profiling (1,000 bars, 40k cells, heatmap, bubbles, drawings, 2x DPR)"""
        bench_script = BASE_DIR / "tools" / "g5_benchmarks" / "benchmark_vis011_full_workload.js"
        res = subprocess.run(["node", str(bench_script)], cwd=str(BASE_DIR), capture_output=True, text=True)
        assert res.returncode == 0, f"VIS-011 benchmark failed: {res.stderr}\n{res.stdout}"

        report_file = BASE_DIR / "docs" / "benchmarks" / "vis011_full_workload_report.json"
        assert report_file.exists(), "VIS-011 benchmark report must exist"
        data = json.loads(report_file.read_text(encoding="utf-8"))
        assert data["status"] == "PASS"
        assert data["performance_metrics"]["p95_frame_ms"] < 16.666, "p95 must be <= 16.66ms for 60 FPS"
        assert data["performance_metrics"]["culling_efficiency_pct"] >= 90.0, "Culling efficiency must be >= 90%"
        assert data["performance_metrics"]["effective_fps_p95"] >= 60, "Effective FPS must meet or exceed 60 FPS"

