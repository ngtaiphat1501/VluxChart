# DeepChart Daily Reconciliation Report: Gate G3

| Field | Detail |
|---|---|
| **Instrument** | `BINANCE:USD_M_PERP:XAUUSDT:PERP` |
| **Window Boundary** | `2026-11-24T17:36:00Z` (`[1795541760000, 1795541820000)`) |
| **Executed Trades** | `468` |
| **Official Kline Volume** | `903.109` |
| **Aggregated Total Volume** | `903.109` |
| **Official Taker Buy** | `249.686` |
| **Aggregated Buy Volume** | `249.686` |
| **Aggregated Sell Volume** | `653.423` |
| **Aggregated Unknown Volume** | `0` |
| **Volume Variance** | **`0.0000%`** (Allowed: $\\le 0.10\%$) |
| **OHLC Match** | `True` |
| **Invariant Check** | `Total == Buy + Sell + Unknown`: **True** |
| **Reconciliation Status** | **PASS** |

### Verification Details
- **Data Source**: Binance USDⓈ-M Futures API (`/fapi/v1/aggTrades` and `/fapi/v1/klines`).
- **Precision**: Exact fixed decimal math, zero floating point rounding drift.
- **Rule Compliance**: Fully adheres to Rule R-DATA-05, R-DATA-06, and R-DATA-10.
