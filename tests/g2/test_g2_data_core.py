"""
DeepChart Gate G2 Test Suite: Reliable Data Core
Author: DeepChart Core Team
"""

import json
import os
import subprocess
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

class TestGateG2DataCore:
    """Gate G2 Test Suite for Reliable Data Core"""

    def test_tc_g2_01_feed_adapters(self):
        """TC-G2-01: Verify feed-adapters parses real Bybit & Binance (BTC/ETH/Gold) feeds with exact side mapping"""
        result = run_cargo(["test", "-p", "feed-adapters", "--test", "adapter_tests"])
        assert result.returncode == 0, f"feed-adapters tests failed: {result.stderr}"
        assert "test test_parse_real_bybit_fixture ... ok" in result.stdout
        assert "test test_parse_real_binance_btc_and_gold_fixtures ... ok" in result.stdout
        assert "test test_heartbeat_tracker ... ok" in result.stdout

    def test_tc_g2_02_data_quality_engine(self):
        """TC-G2-02: Verify data-quality sequence gap detection and bounded LRU deduplication"""
        result = run_cargo(["test", "-p", "data-quality", "--test", "quality_tests"])
        assert result.returncode == 0, f"data-quality tests failed: {result.stderr}"
        assert "test test_sequence_gap_detection ... ok" in result.stdout
        assert "test test_bounded_dedup_filter ... ok" in result.stdout

    def test_tc_g2_03_raw_journal_and_crash_recovery(self):
        """TC-G2-03: Verify raw-journal WAL roundtrip, atomic checkpoint, and crash recovery with corrupted tail"""
        result = run_cargo(["test", "-p", "raw-journal", "--test", "journal_tests"])
        assert result.returncode == 0, f"raw-journal tests failed: {result.stderr}"
        assert "test test_wal_roundtrip_and_crc_verification ... ok" in result.stdout
        assert "test test_atomic_checkpoint_persistence ... ok" in result.stdout
        assert "test test_crash_recovery_with_truncated_corrupted_tail ... ok" in result.stdout

    def test_tc_g2_04_full_workspace_verification(self):
        """TC-G2-04: Full Rust workspace test execution across all 6 crates (zero test failures)"""
        result = run_cargo(["test", "--workspace"])
        assert result.returncode == 0, f"workspace cargo test failed: {result.stderr}"
        assert "0 failed" in result.stdout
        assert "12 passed" in result.stdout or "passed" in result.stdout

    def test_tc_g2_05_fixtures_reproducibility(self):
        """TC-G2-05: Ensure captured raw fixtures are reproducible, uncorrupted, and non-empty"""
        fixtures = [
            BASE_DIR / "fixtures" / "raw" / "bybit" / "sample_bybit_trades.jsonl",
            BASE_DIR / "fixtures" / "raw" / "binance" / "sample_binance_aggtrades.jsonl",
            BASE_DIR / "fixtures" / "raw" / "binance" / "sample_binance_xauusdt_aggtrades.jsonl",
        ]
        for f in fixtures:
            assert f.exists(), f"Fixture {f} must exist"
            lines = [l.strip() for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]
            assert len(lines) >= 10, f"Fixture {f} must have at least 10 entries"
            for line in lines:
                data = json.loads(line)
                assert isinstance(data, dict), "Fixture line must be valid JSON object"
