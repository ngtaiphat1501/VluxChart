"""
DeepChart / VluxChart Gate G8 Test Suite:
Login-Only Auth Gate, External Web Portal Registration Policy,
Lightweight On-Demand Data Pack Architecture, and Privacy/Security Hardening.
"""

import os
import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
WINLIBS_BIN = r"C:\Users\ACER\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"


def run_cargo(args: list[str], cwd: Path = BASE_DIR) -> subprocess.CompletedProcess:
    cargo_bin = Path(os.path.expandvars(r"$USERPROFILE\.cargo\bin"))
    cargo_exe = cargo_bin / "cargo.exe"
    env = os.environ.copy()
    env["PATH"] = f"{WINLIBS_BIN};{cargo_bin};" + env.get("PATH", "")
    return subprocess.run([str(cargo_exe)] + args, cwd=str(cwd), capture_output=True, text=True, env=env)


class TestGateG8AuthAndLightweightData:
    """Gate G8: Login-Only Desktop Auth, On-Demand Data Packs & Privacy Hardening"""

    def test_tc_g8_01_rust_auth_and_data_manager_unit_tests(self):
        """TC-G8-01: Tauri Rust auth.rs (login-only, rate-limit, HWID, tamper) & data_manager.rs (gzip, SHA-256)"""
        tauri_dir = BASE_DIR / "apps" / "desktop" / "src-tauri"
        res = run_cargo(["test", "--manifest-path", str(tauri_dir / "Cargo.toml")], cwd=tauri_dir)
        assert res.returncode == 0, f"Tauri Rust tests failed:\n{res.stdout}\n{res.stderr}"
        assert "test auth::tests::test_login_rejects_unregistered_account_no_in_app_signup ... ok" in res.stdout
        assert "test auth::tests::test_login_rate_limiting_after_five_failures ... ok" in res.stdout
        assert "test data_manager::tests::test_save_compress_load_and_verify_integrity ... ok" in res.stdout
        assert "test system_bootstrap::tests::test_windows_store_stub_filter ... ok" in res.stdout
        assert "test system_bootstrap::tests::test_inspect_system_environment_returns_four_pillars ... ok" in res.stdout
        assert "test cme_mbo::tests::test_databento_cram_sha256_challenge_response ... ok" in res.stdout
        assert "test cme_mbo::tests::test_parse_databento_mbo_json_fifo_queue_and_iceberg_detection ... ok" in res.stdout
        assert "test cme_mbo::tests::test_unconfigured_manager_returns_strict_zero_fake_data_and_imports_csv ... ok" in res.stdout

    def test_tc_g8_02_login_only_policy_no_in_app_signup_form(self):
        """TC-G8-02: Desktop app strictly enforces Login-Only UI with external Web Portal registration link"""
        login_tsx = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "LoginScreen.tsx").read_text(encoding="utf-8")
        auth_ts = (BASE_DIR / "apps" / "desktop" / "src" / "services" / "authService.ts").read_text(encoding="utf-8")

        assert "open-web-portal-register" in login_tsx
        assert "/register" in login_tsx
        assert "openExternalPortal" in login_tsx
        # Ensure zero in-app signup / registration handler exists
        assert "async register(" not in auth_ts
        assert "async signup(" not in auth_ts
        assert "confirmPassword" not in login_tsx

    def test_tc_g8_03_privacy_no_hardcoded_personal_mt5_or_dev_paths(self):
        """TC-G8-03: Zero leaked personal MT5 login IDs or hardcoded developer D:/DeepChart paths in desktop runtime"""
        mt5_svc = (BASE_DIR / "apps" / "desktop" / "src" / "services" / "mt5BridgeService.ts").read_text(encoding="utf-8")
        mt5_modal = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "Mt5ConnectionModal.tsx").read_text(encoding="utf-8")
        main_rs = (BASE_DIR / "apps" / "desktop" / "src-tauri" / "src" / "main.rs").read_text(encoding="utf-8")

        assert "279650659" not in mt5_svc, "Personal MT5 login leaked in mt5BridgeService.ts"
        assert "279650659" not in mt5_modal, "Personal MT5 login leaked in Mt5ConnectionModal.tsx"
        assert "D:/DeepChart" not in main_rs, "Hardcoded developer path leaked in src-tauri/src/main.rs"

    def test_tc_g8_04_system_runtime_bootstrapper_auto_skip_and_cache_safety(self):
        """TC-G8-04: System Runtime Compatibility Bootstrapper replaces old DataBootstrapModal (Auto-Skip if ready, 1-Click isolated setup if missing)"""
        app_tsx = (BASE_DIR / "apps" / "desktop" / "src" / "App.tsx").read_text(encoding="utf-8")
        sys_modal = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "SystemBootstrapModal.tsx").read_text(encoding="utf-8")
        sys_svc = (BASE_DIR / "apps" / "desktop" / "src" / "services" / "systemBootstrapService.ts").read_text(encoding="utf-8")
        sys_rs = (BASE_DIR / "apps" / "desktop" / "src-tauri" / "src" / "system_bootstrap.rs").read_text(encoding="utf-8")
        tauri_conf = (BASE_DIR / "apps" / "desktop" / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8")
        data_svc = (BASE_DIR / "apps" / "desktop" / "src" / "services" / "dataPackService.ts").read_text(encoding="utf-8")
        ws_storage = (BASE_DIR / "apps" / "desktop" / "src" / "utils" / "workspaceStorage.ts").read_text(encoding="utf-8")

        assert "DataBootstrapModal" not in app_tsx, "Legacy manual DataBootstrapModal must be completely replaced"
        assert not (BASE_DIR / "apps" / "desktop" / "src" / "components" / "DataBootstrapModal.tsx").exists()
        assert "SystemBootstrapModal" in app_tsx
        assert "should_auto_skip" in app_tsx
        assert "system-bootstrap-modal" in sys_modal
        assert "btn-auto-install-runtime" in sys_modal
        assert "system_check_environment" in sys_svc
        assert "system_auto_install_runtimes" in sys_svc
        assert "python-3.12.8-embed-amd64.zip" in sys_rs
        assert "vc_redist.x64.exe" in sys_rs
        assert "downloadBootstrapper" in tauri_conf
        assert "scheduleAutoPersist" in data_svc
        assert "close_ticks > 8000000" not in ws_storage, "BTC > $80k cache purge bug must stay removed"

    def test_tc_g8_05_js_order_flow_math_and_top7_quant_suite(self):
        """TC-G8-05: Node 22 Order Flow Math & Top 7 Proprietary Indicators verification suite passes"""
        desktop_dir = BASE_DIR / "apps" / "desktop"
        res = subprocess.run(
            ["node", "--experimental-strip-types", "test_order_flow_math.mjs"],
            cwd=str(desktop_dir),
            capture_output=True,
            text=True,
        )
        assert res.returncode == 0, f"JS Math Audit failed:\n{res.stdout}\n{res.stderr}"
        assert "AUDIT COMPLETE:" in res.stdout
        assert "VA-EDGE strictly suppressed on Gold M5" in res.stdout
        assert "FRVP volume conservation" in res.stdout
        assert "TPO Initial Balance (A+B) exact" in res.stdout
        assert "Detected exact unmitigated Unfinished High" in res.stdout
        assert "PRO unlocks Gold/Crypto Options GEX" in res.stdout

    def test_tc_g8_06_rust_native_gold_options_and_cboe_labels(self):
        """TC-G8-06: Standalone Rust-native Gold Options (OPRA/CBOE GLD+IAU, zero Python needed) & chart OPT/GEX toggle"""
        gold_rs = (BASE_DIR / "apps" / "desktop" / "src-tauri" / "src" / "gold_options.rs").read_text(encoding="utf-8")
        main_rs = (BASE_DIR / "apps" / "desktop" / "src-tauri" / "src" / "main.rs").read_text(encoding="utf-8")
        opt_svc = (BASE_DIR / "apps" / "desktop" / "src" / "services" / "optionsLiveService.ts").read_text(encoding="utf-8")
        opt_board = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "OptionsBoardModal.tsx").read_text(encoding="utf-8")
        fp_canvas = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "FootprintCanvas.tsx").read_text(encoding="utf-8")

        assert "solve_implied_volatility" in gold_rs
        assert "api.nasdaq.com/api/quote/" in gold_rs
        assert "cdn.cboe.com" not in gold_rs, "Must not use Cloudflare-blocked cdn.cboe.com endpoint"
        assert "fetch_gold_options_chain" in main_rs
        assert "fetch_gold_options_chain" in opt_svc
        assert "OPRA / CBOE GOLD OPTIONS" in opt_board
        assert 'data-testid="pill-opt-gex"' in fp_canvas
        assert "CBOE GOLD" in fp_canvas

    def test_tc_g8_07_atas_volume_suite_and_three_tier_entitlements(self):
        """TC-G8-07: ATAS/Sierra Volume Suite (FRVP, TPO, Cluster Search, UA) & 3-Tier Account Privileges"""
        ent_ts = (BASE_DIR / "apps" / "desktop" / "src" / "utils" / "entitlements.ts").read_text(encoding="utf-8")
        upg_modal = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "UpgradePrivilegeModal.tsx").read_text(encoding="utf-8")
        left_tools = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "LeftToolsSidebar.tsx").read_text(encoding="utf-8")
        toolbar = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "Toolbar.tsx").read_text(encoding="utf-8")

        for tier in ("STANDARD PILOT", "INSTITUTIONAL PRO", "QUANT DESK"):
            assert tier in ent_ts
            assert tier in upg_modal
        assert "openExternalPortal" in upg_modal
        assert 'data-testid="tool-fixed-range-vp"' in left_tools
        assert 'data-testid="toolbar-tier-badge"' in toolbar

    def test_tc_g8_08_chart_data_authenticity_and_pd_price_formatting(self):
        """TC-G8-08: 100% Real Market Data Only — Zero synthetic sine-wave, fake snapshot, or [SIM] fallbacks anywhere"""
        app_tsx = (BASE_DIR / "apps" / "desktop" / "src" / "App.tsx").read_text(encoding="utf-8")
        inst_reg = (BASE_DIR / "apps" / "desktop" / "src" / "utils" / "instrumentRegistry.ts").read_text(encoding="utf-8")
        live_feed = (BASE_DIR / "apps" / "desktop" / "src" / "services" / "liveFeedService.ts").read_text(encoding="utf-8")
        mt5_svc = (BASE_DIR / "apps" / "desktop" / "src" / "services" / "mt5BridgeService.ts").read_text(encoding="utf-8")
        mt5_py = (BASE_DIR / "scripts" / "mt5_live_bridge.py").read_text(encoding="utf-8")
        fp_canvas = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "FootprintCanvas.tsx").read_text(encoding="utf-8")
        data_pack = (BASE_DIR / "apps" / "desktop" / "src" / "services" / "dataPackService.ts").read_text(encoding="utf-8")

        assert "generateCanonicalSnapshot" not in app_tsx
        assert "generateCanonicalSnapshot" not in inst_reg
        assert "generateOrderBook" not in inst_reg
        assert "createEmptyLiveSnapshot" in app_tsx
        assert "createEmptyLiveSnapshot" in inst_reg
        assert "Simulated Feed" not in app_tsx
        assert "Math.sin" not in app_tsx
        assert "generateMt5HistoricalBars" not in live_feed
        assert "math.sin" not in mt5_py
        assert "copy_ticks_range" in mt5_py
        assert "[SIM]" not in mt5_svc
        assert "priceTicks * instMeta.tickSize" not in fp_canvas, "PD-VAH/PD-POC tickSize multiplier bug must stay removed"
        assert "[REAL-V2]" in data_pack
        assert "isLegacySyntheticWaveSeries" in data_pack

    def test_tc_g8_09_realtime_streaming_and_unlimited_candle_pagination(self):
        """TC-G8-09: 250ms Realtime LiveBar/WS Failover & Zero Artificial 320/500/350 Candle Limits"""
        live_feed = (BASE_DIR / "apps" / "desktop" / "src" / "services" / "liveFeedService.ts").read_text(encoding="utf-8")
        mt5_py = (BASE_DIR / "scripts" / "mt5_live_bridge.py").read_text(encoding="utf-8")
        ws_storage = (BASE_DIR / "apps" / "desktop" / "src" / "utils" / "workspaceStorage.ts").read_text(encoding="utf-8")
        app_tsx = (BASE_DIR / "apps" / "desktop" / "src" / "App.tsx").read_text(encoding="utf-8")

        assert "Math.min(limit, 320)" not in live_feed
        assert "Math.min(limit, 500)" not in live_feed
        assert "openBinanceBackupStream" in live_feed
        assert "onLiveBar" in live_feed
        assert "onLiveBar" in app_tsx
        assert "copy_rates_from(" in mt5_py
        assert '"liveBar"' in mt5_py
        assert "50_000" in ws_storage
        assert "> 0.02" not in ws_storage, "mergeBars must never drop older history >2% away from current price"

    def test_tc_g8_10_real_non_time_bars_and_synthetic_formula_engine(self):
        """TC-G8-10: Real Range / Volume / Tick Bars & Safe Multi-Leg Synthetic AST Engine (Zero eval(), 100% Real Data)"""
        engine_ts = (
            BASE_DIR / "apps" / "desktop" / "src" / "utils" / "customFrameAndSyntheticEngine.ts"
        ).read_text(encoding="utf-8")
        studio_tsx = (
            BASE_DIR / "apps" / "desktop" / "src" / "components" / "InstrumentStudioModal.tsx"
        ).read_text(encoding="utf-8")
        toolbar_tsx = (
            BASE_DIR / "apps" / "desktop" / "src" / "components" / "Toolbar.tsx"
        ).read_text(encoding="utf-8")
        live_feed_ts = (
            BASE_DIR / "apps" / "desktop" / "src" / "services" / "liveFeedService.ts"
        ).read_text(encoding="utf-8")
        app_tsx = (
            BASE_DIR / "apps" / "desktop" / "src" / "App.tsx"
        ).read_text(encoding="utf-8")

        # Safe recursive-descent AST (strictly zero eval / new Function)
        assert "eval(" not in engine_ts or "zero `eval()`" in engine_ts
        assert "window.eval" not in engine_ts
        assert "new Function(" not in engine_ts
        assert "buildNonTimeBarsFromRealData" in engine_ts
        assert "appendLiveTradeToNonTimeSeries" in engine_ts
        assert "parseSyntheticFormula" in engine_ts
        assert "buildSyntheticBarsFromRealLegs" in engine_ts

        # Wired end-to-end across Studio Modal, Toolbar Pill, LiveFeedService, and App.tsx
        assert 'data-testid="btn-apply-synthetic"' in studio_tsx
        assert 'data-testid="btn-apply-custom-frame-value"' in studio_tsx
        assert 'data-testid="toolbar-active-custom-frame-pill"' in toolbar_tsx
        assert "SYNTHETIC SPREADS" in toolbar_tsx
        assert "symbol.startsWith('SYNTH:')" in live_feed_ts
        assert "handleSelectCustomFrame" in app_tsx
        assert "appendLiveTradeToNonTimeSeries" in app_tsx

    def test_tc_g8_11_cme_globex_level3_mbo_byok_connector(self):
        """TC-G8-11: Native CME Globex Level-3 MBO Connector (Databento GLBX.MDP3 CRAM-SHA256 + dxFeed + Rithmic, BYOK 0% Fake Data)"""
        cme_rs = (BASE_DIR / "apps" / "desktop" / "src-tauri" / "src" / "cme_mbo.rs").read_text(encoding="utf-8")
        main_rs = (BASE_DIR / "apps" / "desktop" / "src-tauri" / "src" / "main.rs").read_text(encoding="utf-8")
        cme_svc = (BASE_DIR / "apps" / "desktop" / "src" / "services" / "cmeMboService.ts").read_text(encoding="utf-8")
        cme_modal = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "CmeMboConnectionModal.tsx").read_text(encoding="utf-8")
        dom_tsx = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "DomLadderPanel.tsx").read_text(encoding="utf-8")
        fp_tsx = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "FootprintCanvas.tsx").read_text(encoding="utf-8")
        toolbar_tsx = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "Toolbar.tsx").read_text(encoding="utf-8")

        assert "glbx-mdp3.lsg.databento.com:13000" in cme_rs
        assert "compute_databento_cram_response" in cme_rs
        assert "parse_public_cme_yahoo_bars" in cme_rs
        assert '"ES=F"' in cme_rs and '"NQ=F"' in cme_rs and '"GC=F"' in cme_rs
        assert "--config" in cme_rs, "Credentials must pass to curl via stdin --config -, never CLI argv"
        assert "cme_poll_mbo_snapshot" in main_rs
        assert "cme_start_live_stream" in main_rs
        assert "parseRealDatabentoMboCaptureText" in cme_svc
        assert 'data-testid="cme-mbo-connection-modal"' in cme_modal
        assert 'data-testid="dom-mbo-fifo-toggle"' in dom_tsx
        assert 'data-testid="dom-cme-tier2-unlock-banner"' in dom_tsx
        assert 'data-testid="cme-mbo-awaiting-key-card"' in fp_tsx
        assert 'data-testid="toolbar-cme-mbo-btn"' in toolbar_tsx

    def test_tc_g8_12_ui_ux_standards_and_deepchart_signature_palette(self):
        """TC-G8-12: Preserves DeepChart signature Green/Purple brand palette alongside anti-slop UI/UX standards"""
        fp_tsx = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "FootprintCanvas.tsx").read_text(encoding="utf-8")
        opt_tsx = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "OptionsGammaProfilePanel.tsx").read_text(encoding="utf-8")
        mt5_tsx = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "Mt5ConnectionModal.tsx").read_text(encoding="utf-8")
        toolbar_tsx = (BASE_DIR / "apps" / "desktop" / "src" / "components" / "Toolbar.tsx").read_text(encoding="utf-8")
        index_html = (BASE_DIR / "apps" / "desktop" / "index.html").read_text(encoding="utf-8")

        # DeepChart signature Bull (#00E676) & Bear/Put (#A855F7 / #8B5CF6 / #C084FC) brand identity must remain intact
        assert "#00E676" in fp_tsx and "#A855F7" in fp_tsx and "#8B5CF6" in fp_tsx
        assert "#00E676" in opt_tsx and "#A855F7" in opt_tsx and "#C084FC" in opt_tsx

        # Genuine UI/UX & anti-slop rules remain enforced
        assert "linear-gradient(135deg, #00E676" not in mt5_tsx
        for banned_emoji in ("🕯", "👣", "🪜", "🐋", "🎨"):
            assert banned_emoji not in toolbar_tsx
            assert banned_emoji not in fp_tsx

        assert 'lang="vi"' in index_html
        assert "tabular-nums" in index_html
        assert ":focus-visible" in index_html
        assert ".vlx-login-shell" in index_html







