# SOURCE CONTRACT: BYBIT V5 LINEAR (PERPETUAL)

- **Venue:** BYBIT
- **Market Type:** LINEAR_PERP (USDT Perpetual)
- **Official Documentation:** https://bybit-exchange.github.io/docs/v5/websocket/public/trade
- **Verification Date:** 2026-11-12
- **Source Status:** PRIMARY_CANDIDATE (P0)

## 1. WebSocket Endpoint & Subscription
- **Endpoint URL:** `wss://stream.bybit.com/v5/public/linear`
- **Topic Pattern:** `publicTrade.{symbol}` (e.g. `publicTrade.BTCUSDT`, `publicTrade.ETHUSDT`)
- **Heartbeat:** Client sends `{"op":"ping"}` every 20s; server replies `{"op":"pong"}`.

## 2. Raw Message Schema
```json
{
  "topic": "publicTrade.BTCUSDT",
  "type": "snapshot",
  "ts": 1794502653155,
  "data": [
    {
      "T": 1794502653004,
      "s": "BTCUSDT",
      "S": "Buy",
      "v": "0.050",
      "p": "71850.50",
      "L": "PlusTick",
      "i": "c0620610-4cc6-5e24-bb96-de26d37cd91f",
      "BT": false
    }
  ]
}
```

## 3. Field Mapping to Canonical Data Contract
| Bybit Raw Field | Type | Canonical Field | Transform Rule / Note |
|---|---|---|---|
| `T` | int64 (ms) | `exchange_ts_us` | `T * 1000` |
| `s` | string | `symbol` | Standardized to uppercase |
| `S` | string | `aggressor` | `"Buy" -> BUY`, `"Sell" -> SELL` (EXCHANGE_DIRECT) |
| `v` | string | `quantity_units` | `round(float(v) * quantity_scale)` |
| `p` | string | `price_ticks` | `round(float(p) / price_tick)` |
| `i` | string | `event_id` | Unique trade UUID from Bybit |
| `BT` | bool | `is_block_trade` | Flags OTC/block execution |

## 4. Feed Characteristics & Constraints
- **Execution Granularity:** Individual trade executions (fills).
- **Multiple Fills:** A single WebSocket frame can contain an array of trades in `data`.
- **Taker Aggressor:** Direct from field `S`.
- **Trade ID Deduplication Key:** `(venue="BYBIT", instrument_id, event_id="i")`.
