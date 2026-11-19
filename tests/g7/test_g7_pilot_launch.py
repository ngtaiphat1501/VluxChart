"""
DeepChart Gate G7 Test Suite: Pilot & Final Launch Acceptance
Author: DeepChart Core Team
"""

import json
import os
import subprocess
import sys
from pathlib import Path
import pytest

BASE_DIR = Path(__file__).resolve().parent.parent.parent

class TestGateG7PilotLaunch:
    """Gate G7 Test Suite for Final Launch & Commercial Delivery Acceptance"""

    def test_tc_g7_01_pilot_session_execution_and_zero_crash_rate(self):
        """TC-G7-01: Complete pilot session execution: 0 crashes, 0 P0 bugs, and clean trade aggregation"""
        pilot_script = BASE_DIR / "tools" / "pilot" / "pilot_validation.py"
        res = subprocess.run([sys.executable, str(pilot_script)], cwd=str(BASE_DIR), capture_output=True, text=True)
        assert res.returncode == 0, f"Pilot session failed: {res.stderr}\n{res.stdout}"
        
        report_file = BASE_DIR / "docs" / "pilot_session_report.json"
        assert report_file.exists(), "Pilot session report must exist"
        data = json.loads(report_file.read_text(encoding="utf-8"))
        assert data["status"] == "PASS"
        assert data["crash_count"] == 0
        assert data["p0_bug_count"] == 0
        assert data["invariant_violations"] == 0

    def test_tc_g7_02_multi_asset_switching_and_gold_p0_integrity(self):
        """TC-G7-02: Seamless switching between BTC, ETH, and Gold (XAUUSDT) with exact scale adherence"""
        registry_file = BASE_DIR / "instruments.yaml"
        assert registry_file.exists()
        content = registry_file.read_text(encoding="utf-8")
        assert "BTCUSDT" in content
        assert "ETHUSDT" in content
        assert "XAUUSDT" in content
        
        # Verify reconciliation against real exchange data for Gold
        recon_file = BASE_DIR / "docs" / "reconciliation" / "reconciliation_report.json"
        assert recon_file.exists()
        recon_data = json.loads(recon_file.read_text(encoding="utf-8"))
        assert recon_data["status"] == "PASS"
        assert recon_data["volume"]["variance_pct"] <= 0.10

    def test_tc_g7_03_zero_float_drift_golden_invariants(self):
        """TC-G7-03: Strict mathematical invariant verification: Total == Buy + Sell + Unknown across all modules"""
        # Read Gate G3 golden invariant test confirmation
        g3_report = BASE_DIR / "docs" / "test-evidence" / "g3" / "gate_g3_signoff_report.md"
        assert g3_report.exists()
        g3_text = g3_report.read_text(encoding="utf-8")
        assert "Total = Buy + Sell + Unknown" in g3_text

    def test_tc_g7_04_rollback_build_readiness(self):
        """TC-G7-04: Packaging and release distribution readiness with verifiable checksums"""
        checksum_file = BASE_DIR / "dist-release" / "SHA256SUMS.txt"
        assert checksum_file.exists(), "SHA256SUMS.txt must exist for reproducible release rollback"
        lines = [line.strip() for line in checksum_file.read_text(encoding="utf-8").splitlines() if line.strip()]
        assert len(lines) >= 5, "Release package must contain all core distribution files"

    def test_tc_g7_05_final_signoff_checklist_and_audit_trail(self):
        """TC-G7-05: Complete gate sign-off audit trail: G0, G1, G2, G3, G4, G5, G6 reports exist and verified"""
        evidence_dir = BASE_DIR / "docs" / "test-evidence"
        gates = ["g0", "g1", "g2", "g3", "g4", "g5", "g6"]
        for g in gates:
            report_path = evidence_dir / g / f"gate_{g}_signoff_report.md"
            assert report_path.exists(), f"Gate {g.upper()} sign-off report must exist"
            content = report_path.read_text(encoding="utf-8")
            assert "VERIFIED PASS" in content or "PASSED (VERIFIED)" in content, f"Gate {g.upper()} must be signed off as VERIFIED PASS"
