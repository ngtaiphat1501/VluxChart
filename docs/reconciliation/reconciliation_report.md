# DeepChart Daily Reconciliation Report: Gate G3

| Field | Detail |
|---|---|
| **Instrument** | `BINANCE:USD_M_PERP:XAUUSDT:PERP` |
| **Window Boundary** | `2026-11-22T09:09:00Z` (`[1795338540000, 1795338600000)`) |
| **Executed Trades** | `64` |
| **Official Kline Volume** | `17.723` |
| **Aggregated Total Volume** | `17.723` |
| **Official Taker Buy** | `11.525` |
| **Aggregated Buy Volume** | `11.525` |
| **Aggregated Sell Volume** | `6.198` |
| **Aggregated Unknown Volume** | `0` |
| **Volume Variance** | **`0.0000%`** (Allowed: $\\le 0.10\%$) |
| **OHLC Match** | `True` |
| **Invariant Check** | `Total == Buy + Sell + Unknown`: **True** |
| **Reconciliation Status** | **PASS** |

### Verification Details
- **Data Source**: Binance USDⓈ-M Futures API (`/fapi/v1/aggTrades` and `/fapi/v1/klines`).
- **Precision**: Exact fixed decimal math, zero floating point rounding drift.
- **Rule Compliance**: Fully adheres to Rule R-DATA-05, R-DATA-06, and R-DATA-10.
