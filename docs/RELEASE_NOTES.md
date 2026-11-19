# DeepChart Release Notes — v0.1.0-RC1

- **Release Date**: 2026-11-14
- **Release Target**: Windows 10/11 x64 Desktop
- **Milestone**: Full Production Release Candidate (Phases P1 to P10 / Gates G0 to G7 Completed)

---

## 1. Key Highlights & Features

1. **High-Performance Footprint Engine & Canvas 2D Pipeline**:
   - Sub-millisecond order flow aggregation ($\ge 44,000$ trades/second).
   - Canvas 2D hardware-accelerated rendering with smooth pan, zoom, and viewport culling ($>98\%$ culling rate).
   - Point of Control (POC) dynamic gold highlights.
   - 70% Value Area calculation (Value Area High / Value Area Low brackets).
   - Diagonal bid/ask volume imbalance detection.
   - 60 FPS frame compute benchmark (VIS-011): Average frame compute time of $0.0687\,\text{ms}$, p95 at $0.2483\,\text{ms}$ ($1.49\%$ of $16.66\,\text{ms}$ budget), effective $4,027\,\text{FPS}$.

2. **Multi-Asset Order Flow (Crypto & Gold P0)**:
   - Primary crypto instruments: Bybit Linear Perpetual `BTCUSDT` and `ETHUSDT`.
   - Gold P0 instrument: Binance Futures `XAUUSDT` with 0.01 tick size and 0.001 quantity scale.
   - Instantaneous runtime instrument switching without process restarts.

3. **Guaranteed Data Correctness (Zero Floating-Point Drift)**:
   - Strict scaled integer accounting: `PriceTicks(i64)` and `ScaledQuantity(u64)`.
   - Strict mathematical invariant: $TotalVolume = BuyVolume + SellVolume + UnknownVolume$.
   - Live reconciliation against Binance Kline REST API demonstrating 0.0000% volume variance.

4. **Reliability & Data Quality Center**:
   - Binary Write-Ahead Logging (WAL) with `DCWA` framing and CRC32 verification.
   - Clean crash recovery with atomic checkpoint promotion.
   - Real-time Sequence Gap Detection with automatic `DEGRADED` status transitions.
   - Live feed latency and websocket heartbeat telemetry.

5. **Strategy Optimizer & Forward Paper Trading (Phase P5)**:
   - Grid-search sweep optimizer testing 36 combinations of Stop Loss and Take Profit parameters.
   - Real-time Forward Paper Trading ribbon with live PnL in ticks and USD, entry/mark price tracking, and instant Market Close execution.

6. **Live Feed WebSocket Connector & Reconnection Manager (Phase P6)**:
   - Streaming pipeline connecting to live trade feeds with exponential backoff and deterministic jitter.
   - Live feed status telemetry pill on toolbar showing connection state, latency (ms), messages/sec, and reconnect count.

7. **Multi-Window Workspace & Depth of Market DOM Ladder (Phase P7)**:
   - Draggable, resizable floating windows (`<FloatingPanel>`) with docking capability.
   - Dedicated DOM Ladder panel (`<DomLadderPanel>`) with Bid/Ask relative depth bars and cumulative imbalance ratio meter.
   - Instant cold-start caching via `localStorage` with zero-lag startup.
   - Layout preset switcher: Standard, Order Flow Pro, Pure Heatmap, Options Confluence.

8. **Interactive Drawing & Chart Annotation Suite (Phase P8)**:
   - Floating vertical drawing toolbar with custom color picker, visibility toggle, and clear-all.
   - Geometric annotations: Trendlines with delta tick tags, Horizontal Rays with price tags, Imbalance Boxes, and multi-tier Fibonacci Retracements ($0.0\%$ to $100.0\%$).
   - Live draft preview during mouse drag and per-instrument persistent storage.

---

## 2. Known Limitations & Operational Scope

1. **Offline Historical Replay**:
   - Offline historical replay requires pre-recorded binary WAL journal files in the `.deepchart/wal` directory.
2. **Gold Market Hours**:
   - Binance `XAUUSDT` futures stream operates 24/7; CME gold futures bridge is scheduled for P2.

---

## 3. System Requirements

- **Operating System**: Windows 10 (Build 19041+) or Windows 11 64-bit.
- **CPU**: Dual-core x64 processor (Intel Core i3 / AMD Ryzen 3 or higher).
- **RAM**: Minimum 4 GB RAM (DeepChart operates comfortably with $<150$ MB resident memory).
- **Graphics**: DirectX 11 / OpenGL 3.3 compatible graphics card for Canvas 2D acceleration.
- **WebView2**: Microsoft Edge WebView2 Runtime (pre-installed on Windows 10/11).

