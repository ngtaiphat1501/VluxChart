# DeepChart Daily Reconciliation Report: Gate G3

| Field | Detail |
|---|---|
| **Instrument** | `BINANCE:USD_M_PERP:XAUUSDT:PERP` |
| **Window Boundary** | `2026-11-19T11:49:00Z` (`[1795088940000, 1795089000000)`) |
| **Executed Trades** | `220` |
| **Official Kline Volume** | `225.992` |
| **Aggregated Total Volume** | `225.992` |
| **Official Taker Buy** | `155.129` |
| **Aggregated Buy Volume** | `155.129` |
| **Aggregated Sell Volume** | `70.863` |
| **Aggregated Unknown Volume** | `0` |
| **Volume Variance** | **`0.0000%`** (Allowed: $\\le 0.10\%$) |
| **OHLC Match** | `True` |
| **Invariant Check** | `Total == Buy + Sell + Unknown`: **True** |
| **Reconciliation Status** | **PASS** |

### Verification Details
- **Data Source**: Binance USDⓈ-M Futures API (`/fapi/v1/aggTrades` and `/fapi/v1/klines`).
- **Precision**: Exact fixed decimal math, zero floating point rounding drift.
- **Rule Compliance**: Fully adheres to Rule R-DATA-05, R-DATA-06, and R-DATA-10.
