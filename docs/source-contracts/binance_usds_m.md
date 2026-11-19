# SOURCE CONTRACT: BINANCE USDⓈ-M FUTURES (PERPETUAL)

- **Venue:** BINANCE
- **Market Type:** USDS_M_PERP (USDT Margined Futures)
- **Official Documentation:** https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Live-Subscribing-Unsubscribing-to-streams
- **Verification Date:** 2026-11-12
- **Source Status:** SECONDARY_RECONCILIATION & VALIDATED GOLD CANDIDATE

## 1. WebSocket Endpoint & Fallback Domains
- **Standard Primary:** `wss://fstream.binance.com/ws/{stream}`
- **Verified Working Fallback (ISP Bypass):** `wss://fstream.binancefuture.com/ws/{stream}`
- **Alternative:** `wss://stream.binance.com:9443/ws/{stream}`
- **Stream Patterns:** `{symbol_lowercase}@aggTrade` (e.g. `btcusdt@aggTrade`, `xauusdt@aggTrade`)

## 2. Raw Message Schema
```json
{
  "e": "aggTrade",
  "E": 1794502665751,
  "s": "BTCUSDT",
  "a": 320590200,
  "p": "71776.60",
  "q": "0.0011",
  "f": 556727946,
  "l": 556727946,
  "T": 1794502665451,
  "m": false
}
```

## 3. Field Mapping to Canonical Data Contract
| Binance Raw Field | Type | Canonical Field | Transform Rule / Note |
|---|---|---|---|
| `T` | int64 (ms) | `exchange_ts_us` | `T * 1000` |
| `E` | int64 (ms) | `vendor_engine_ts_us` | Binance event creation timestamp |
| `s` | string | `symbol` | Uppercase symbol |
| `a` | int64 | `event_id` | Aggregate trade ID |
| `p` | string decimal | `price_ticks` | `round(Decimal(p) / price_tick)` |
| `q` | string decimal | `quantity_units` | `round(Decimal(q) * quantity_scale)` |
| `m` | bool | `aggressor` | `if m == true: SELL, else: BUY` |
| `f` | int64 | `first_trade_id` | First constituent fill ID |
| `l` | int64 | `last_trade_id` | Last constituent fill ID |

## 4. Feed Characteristics & Constraints
- **Aggregation Notice (CRITICAL):** Binance `aggTrade` aggregates trades that fill at the same price, on the same taker order, within 100ms.
- **Constituent Count:** `(l - f + 1)` represents the number of fills compressed into this aggregate trade.
- **Taker Aggressor Rule:**
  - `m = true` -> Buyer was maker -> Taker was **Seller** -> Aggressor = `SELL`.
  - `m = false` -> Buyer was taker -> Aggressor = `BUY`.
- **Deduplication Key:** `(venue="BINANCE", instrument_id, event_id="a")`.
