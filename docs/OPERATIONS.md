# DeepChart Operations & Troubleshooting Runbook

This runbook provides installation, operational guidance, telemetry details, and disaster recovery procedures for DeepChart Desktop on Windows.

---

## 1. Installation & Execution

### Prerequisites
- Windows 10/11 x64
- Microsoft Edge WebView2 Evergreen Runtime

### Launching the Application
- From binary: Run `DeepChart.exe` directly or via Start Menu shortcut.
- From dev environment:
  ```powershell
  cd apps/desktop
  npm run tauri dev
  ```

---

## 2. Directory Structure & Persisted State

DeepChart stores state in the user's standard application directory:
- **Root Directory**: `%LOCALAPPDATA%\DeepChart\`
- **Binary Write-Ahead Logs (WAL)**: `%LOCALAPPDATA%\DeepChart\wal\*.wal`
- **Atomic Checkpoints**: `%LOCALAPPDATA%\DeepChart\checkpoints\*.chk`
- **Application Logs**: `%LOCALAPPDATA%\DeepChart\logs\deepchart.log`

---

## 3. Disaster Recovery & Crash Runbook

### Scenario A: Process Crash / Power Outage
1. Upon startup, DeepChart checks for existing unfinalized WAL segments in the WAL directory.
2. The `RawJournal::recover_all` engine validates the 14-byte binary framing (`DCWA`) and CRC32 checksums of each frame sequentially.
3. 100% of committed pre-crash records are reconstructed into the memory state.
4. Any partial or corrupted tail bytes (caused by power cut during write) are truncated cleanly, preventing data corruption.

### Scenario B: Sequence Gap / Missing Trades
1. If the `DataQualityCenter` displays `Status: DEGRADED` and `total_gaps_detected > 0`:
2. Inspect the gap log in `%LOCALAPPDATA%\DeepChart\logs\gaps.log`.
3. The system records the start and end sequence IDs of missing events.
4. A backfill worker queries the exchange REST API (e.g. Binance `/fapi/v1/aggTrades?fromId=...`) to backfill missing trades.
5. Once backfilled, the quality badge automatically resets to `COMPLETE`.

---

## 4. Telemetry & Health Verification

The terminal UI continuously monitors:
- **Feed Latency**: Time difference between exchange timestamp and local receipt timestamp. Expected: $20 - 80\,\text{ms}$.
- **Invariant Health**: `Total == Buy + Sell + Unknown`. If this invariant ever deviates, an immediate red banner is displayed.
