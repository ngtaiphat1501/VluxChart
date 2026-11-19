"""
DeepChart Gate G6 Test Suite: Release Candidate, Packaging, Security & Distribution
Author: DeepChart Core Team
"""

import json
import os
import subprocess
import sys
from pathlib import Path
import pytest

BASE_DIR = Path(__file__).resolve().parent.parent.parent

class TestGateG6ReleaseCandidate:
    """Gate G6 Test Suite for Release Candidate Readiness"""

    def test_tc_g6_01_security_secret_scan(self):
        """TC-G6-01: Codebase security scan: 0 hardcoded private keys, secret tokens, or credentials"""
        scanner = BASE_DIR / "tools" / "security" / "secret_scanner.py"
        res = subprocess.run([sys.executable, str(scanner)], cwd=str(BASE_DIR), capture_output=True, text=True)
        assert res.returncode == 0, f"Secret scanner failed: {res.stdout}\n{res.stderr}"
        assert "PASS: Zero hardcoded secrets found in codebase." in res.stdout

    def test_tc_g6_02_license_and_third_party_notices(self):
        """TC-G6-02: Compliance: Valid LICENSE and comprehensive NOTICES.md with upstream attributions"""
        license_file = BASE_DIR / "LICENSE"
        notices_file = BASE_DIR / "NOTICES.md"
        assert license_file.exists(), "LICENSE file must exist"
        assert notices_file.exists(), "NOTICES.md file must exist"
        
        license_text = license_file.read_text(encoding="utf-8")
        assert "Apache License" in license_text or "MIT License" in license_text
        
        notices_text = notices_file.read_text(encoding="utf-8")
        assert "Rust Dependencies" in notices_text
        assert "Desktop Frontend Dependencies" in notices_text
        assert "Bybit Linear Perpetual Feed" in notices_text
        assert "Binance Futures aggTrade Feed" in notices_text

    def test_tc_g6_03_release_documentation_and_runbooks(self):
        """TC-G6-03: Operational readiness: RELEASE_NOTES.md and OPERATIONS.md disaster runbooks"""
        rel_notes = BASE_DIR / "docs" / "RELEASE_NOTES.md"
        ops_guide = BASE_DIR / "docs" / "OPERATIONS.md"
        assert rel_notes.exists(), "RELEASE_NOTES.md must exist"
        assert ops_guide.exists(), "OPERATIONS.md must exist"
        
        notes_text = rel_notes.read_text(encoding="utf-8")
        assert "v0.1.0-RC1" in notes_text
        assert "Known Limitations" in notes_text
        assert "System Requirements" in notes_text
        
        ops_text = ops_guide.read_text(encoding="utf-8")
        assert "Disaster Recovery & Crash Runbook" in ops_text
        assert "RawJournal::recover_all" in ops_text
        assert "Sequence Gap" in ops_text

    def test_tc_g6_04_tauri_bundle_configuration_and_metadata(self):
        """TC-G6-04: Packaging metadata: Valid tauri.conf.json with Windows bundle and identifier configs"""
        tauri_conf = BASE_DIR / "apps" / "desktop" / "src-tauri" / "tauri.conf.json"
        assert tauri_conf.exists(), "tauri.conf.json must exist"
        
        data = json.loads(tauri_conf.read_text(encoding="utf-8"))
        assert data["productName"] == "DeepChart"
        assert data["version"] == "0.1.0"
        assert data["identifier"] == "com.deepchart.desktop"
        assert "bundle" in data
        assert data["bundle"]["active"] is True
        assert (BASE_DIR / "apps" / "desktop" / "src-tauri" / "icons" / "icon.ico").exists(), "icon.ico must exist"

    def test_tc_g6_05_release_distribution_package_and_checksums(self):
        """TC-G6-05: Release artifact bundle integrity and SHA-256 verification"""
        dist_release = BASE_DIR / "dist-release"
        package_dir = dist_release / "DeepChart-v0.1.0-RC1-windows-x64"
        checksum_file = dist_release / "SHA256SUMS.txt"
        
        assert package_dir.exists(), "Release package directory must exist"
        assert checksum_file.exists(), "SHA256SUMS.txt must exist"
        
        checksum_content = checksum_file.read_text(encoding="utf-8")
        assert "LICENSE.txt" in checksum_content
        assert "NOTICES.txt" in checksum_content
        assert "RELEASE_NOTES.md" in checksum_content
        assert "app-resources/index.html" in checksum_content
        
        # Verify index.html exists in package
        assert (package_dir / "app-resources" / "index.html").exists()
