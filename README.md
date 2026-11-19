# DeepChart â€” High-Performance Order Flow Analytics & Trading Terminal

[![Windows CI](https://github.com/your-username/deepchart/actions/workflows/windows-ci.yml/badge.svg)](https://github.com/your-username/deepchart/actions)
![Rust](https://img.shields.io/badge/rust-2021_edition-orange.svg)
![Tauri](https://img.shields.io/badge/tauri-v2-blue.svg)
![React](https://img.shields.io/badge/react-19-cyan.svg)
![TypeScript](https://img.shields.io/badge/typescript-5-blue.svg)
![License](https://img.shields.io/badge/license-MIT%2FApache--2.0-green.svg)

**DeepChart** is a local-first, low-latency market microstructure and order flow analytics application for institutional and professional traders. It combines the raw power of **Rust** (Tokio async runtime, custom lock-free ring buffers, fixed-point decimal arithmetic) with the fluid UX of **Tauri 2** and **React**.

---

## Key Features

- **Microstructure & Footprint Charting:**
  - Real-time Bid x Ask cluster bars with diagonal imbalance detection (default 300%).
  - Real-time Order Flow Absorption alerts & Naked Point of Control (nPOC) tracking.
  - Steidlmayer Market Profile (TPO, Value Area High/Low - VAH/VAL, POC).
  - Multi-speed Cumulative Volume Delta (CVD) and Volume-Weighted Average Price (VWAP) with Standard Deviation bands.

- **Options Microstructure & GEX Analytics:**
  - Real-time Gamma Exposure (GEX) profiling across strikes and expirations (0DTE, Weekly, Monthly).
  - Exact Call Walls, Put Walls, and Max Pain calculation.
  - Implied Volatility (IV) smile inversion and analytical Black-Scholes Greeks (Delta, Gamma, Vega, Theta).

- **Depth of Market (DOM) & Liquidity Tracking:**
  - High-frequency local Order Book state with sub-millisecond updates.
  - Liquidity Depth Heatmap buffer tracking passive limit orders.
  - Market-by-Order (MBO) Iceberg order detection and executed order queue simulation.

- **Multi-Venue Data Feed & MT5 Live Bridge:**
  - Native WebSocket feeds for Bybit Linear (`publicTrade`, `tickers`) and Binance Futures (`aggTrade`).
  - Low-latency Python RPC bridge (`mt5_live_bridge.py`) connecting directly to MetaTrader 5 (MT5) for Gold (XAUUSD) and Forex live tick data with 0.1-lot precision.
  - Multi-venue price reconciliation and automated feed health monitoring.

- **Deterministic Replay & Crash-Resilient Journaling:**
  - Write-Ahead Logging (WAL) with CRC32 checksums, atomic checkpoints, and automatic tail corruption recovery.
  - Deterministic historical tick replayer with pause, resume, and variable playback speeds (1x to 100x).

- **Ultra-Smooth 60 FPS Rendering:**
  - GPU-accelerated Canvas/WebGL rendering pipeline with viewport culling.
  - Under 16ms frame budget under high-frequency market trade bursts (>10,000 trades/sec).

---

## Architecture Overview

```
DeepChart/
â”œâ”€â”€ crates/
â”‚   â”œâ”€â”€ app_service/      # State management, snapshot coordinator, IPC DTOs
â”‚   â”œâ”€â”€ data_contract/    # Fixed-point price/volume numeric types, core data schemas
â”‚   â”œâ”€â”€ data_quality/     # Sequence gap detection, bounded deduplication, data integrity
â”‚   â”œâ”€â”€ feed_adapters/    # Bybit, Binance, MT5 bridge WebSocket/RPC adapters
â”‚   â”œâ”€â”€ raw_journal/      # Crash-resilient WAL, CRC32 verification, atomic checkpointing
â”‚   â””â”€â”€ volume_engine/    # Footprint, VWAP, POC, CVD, MBO Iceberg, Options GEX engine
â”œâ”€â”€ apps/
â”‚   â””â”€â”€ desktop/          # Tauri 2 native shell + React 19 / TypeScript / Vite frontend
â”œâ”€â”€ fixtures/             # Real exchange market data fixtures for golden tests
â”œâ”€â”€ scripts/              # MT5 bridge, packaging, and developer helper scripts
â”œâ”€â”€ tests/                # Automated integration & quality gate verification suite (G0-G7)
â””â”€â”€ docs/                 # Architecture Decision Records (ADRs), source contracts, benchmarks
```

---

## Getting Started

### Prerequisites

- **Rust:** Stable toolchain (`rustup default stable`, 1.75+)
- **Node.js:** Node.js 18+ and `npm`
- **Python:** Python 3.11+ (required for MT5 bridge and automated test suite)
- **Windows Build Tools:** C++ build tools for Visual Studio

### Quick Run

DeepChart includes convenient Windows batch scripts to start immediately:

```cmd
:: Run complete desktop application (Tauri 2 + React)
run_desktop_app.bat

:: Or run fast native build (if dependencies are already compiled)
run_desktop_fast.bat

:: Or preview the frontend UI in a web browser
run_web_preview.bat
```

### Running from CLI

```bash
# 1. Install frontend dependencies
cd apps/desktop
npm install

# 2. Run in Tauri desktop development mode
npm run tauri dev
```

### Running with MT5 Live Bridge

To feed live Forex / Gold (XAUUSD) data from MetaTrader 5:

```bash
python scripts/mt5_live_bridge.py
```

---

## Verification & Testing

DeepChart adheres to strict quality gates (G0 through G7). Every commit is verified:

```bash
# Run all Rust workspace unit and golden tests (40+ tests)
cargo test --workspace

# Run complete Gate G0-G7 automated test suite
python -m pytest tests -v
```

---

## License

This project is licensed under the MIT License or Apache-2.0 License. See [LICENSE](LICENSE) and [NOTICES.md](NOTICES.md) for details.
# VluxChart
