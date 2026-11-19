//! DeepChart Order Book & Liquidity Heatmap Unit Tests (P1)

use data_contract::{DepthLevel, NormalizedDepthUpdate, PriceTicks, ScaledQuantity};
use volume_engine::{HeatmapTracker, LocalOrderBook};

#[test]
fn test_local_order_book_snapshot_and_incremental_updates() {
    let mut ob = LocalOrderBook::new("BYBIT:LINEAR_PERP:BTCUSDT:PERP");

    // 1. Initial snapshot
    let snapshot = NormalizedDepthUpdate {
        schema_version: 1,
        instrument_id: "BYBIT:LINEAR_PERP:BTCUSDT:PERP".into(),
        venue: "BYBIT".into(),
        exchange_ts_us: 1700000000000000,
        receive_ts_us: 1700000000000050,
        first_update_id: 1,
        final_update_id: 1,
        bids: vec![
            DepthLevel::new(PriceTicks(9500000), ScaledQuantity(500)),
            DepthLevel::new(PriceTicks(9499990), ScaledQuantity(300)),
            DepthLevel::new(PriceTicks(9499980), ScaledQuantity(200)),
        ],
        asks: vec![
            DepthLevel::new(PriceTicks(9500010), ScaledQuantity(400)),
            DepthLevel::new(PriceTicks(9500020), ScaledQuantity(250)),
            DepthLevel::new(PriceTicks(9500030), ScaledQuantity(150)),
        ],
        is_snapshot: true,
    };

    ob.apply_update(&snapshot);

    assert_eq!(
        ob.best_bid(),
        Some((PriceTicks(9500000), ScaledQuantity(500)))
    );
    assert_eq!(
        ob.best_ask(),
        Some((PriceTicks(9500010), ScaledQuantity(400)))
    );
    assert_eq!(ob.spread_ticks(), Some(10));
    assert_eq!(ob.mid_price_ticks(), Some(9500005));

    // 2. Incremental Delta Update:
    // - Update best bid size from 500 -> 800
    // - Remove 9499990 by setting qty to 0
    // - Add new higher ask at 9500040 with 600
    let delta = NormalizedDepthUpdate {
        schema_version: 1,
        instrument_id: "BYBIT:LINEAR_PERP:BTCUSDT:PERP".into(),
        venue: "BYBIT".into(),
        exchange_ts_us: 1700000000100000,
        receive_ts_us: 1700000000100050,
        first_update_id: 2,
        final_update_id: 2,
        bids: vec![
            DepthLevel::new(PriceTicks(9500000), ScaledQuantity(800)),
            DepthLevel::new(PriceTicks(9499990), ScaledQuantity(0)), // Deleted!
        ],
        asks: vec![DepthLevel::new(PriceTicks(9500040), ScaledQuantity(600))],
        is_snapshot: false,
    };

    ob.apply_update(&delta);

    // Verify best bid updated to 800
    assert_eq!(
        ob.best_bid(),
        Some((PriceTicks(9500000), ScaledQuantity(800)))
    );
    // Verify 9499990 was removed
    assert_eq!(ob.bids.get(&PriceTicks(9499990)), None);
    // Verify remaining bids: 9500000 and 9499980
    assert_eq!(ob.bids.len(), 2);
    // Verify asks: 9500010, 9500020, 9500030, 9500040
    assert_eq!(ob.asks.len(), 4);

    let snap = ob.snapshot(5);
    assert_eq!(snap.bids.len(), 2);
    assert_eq!(snap.asks.len(), 4);
    assert_eq!(snap.bids[0].price_ticks, PriceTicks(9500000));
}

#[test]
fn test_heatmap_tracker_ring_buffer() {
    let mut ob = LocalOrderBook::new("BYBIT:LINEAR_PERP:BTCUSDT:PERP");
    let mut tracker = HeatmapTracker::new(5); // Capacity 5

    // Seed orderbook
    let snapshot = NormalizedDepthUpdate {
        schema_version: 1,
        instrument_id: "BYBIT:LINEAR_PERP:BTCUSDT:PERP".into(),
        venue: "BYBIT".into(),
        exchange_ts_us: 1700000000000000,
        receive_ts_us: 1700000000000050,
        first_update_id: 1,
        final_update_id: 1,
        bids: vec![DepthLevel::new(PriceTicks(9500000), ScaledQuantity(100))],
        asks: vec![DepthLevel::new(PriceTicks(9500010), ScaledQuantity(100))],
        is_snapshot: true,
    };
    ob.apply_update(&snapshot);

    // Push 8 slices (exceeds capacity 5)
    for i in 0..8 {
        let ts = 1700000000000000 + i * 100_000;
        let slice = ob.to_heatmap_slice(ts, 10);
        tracker.push_slice(slice);
    }

    assert_eq!(tracker.len(), 5, "Ring buffer must not exceed capacity");
    let slices = tracker.slices();
    // Oldest slice should be i = 3
    assert_eq!(slices.front().unwrap().timestamp_us, 1700000000300000);
    // Newest slice should be i = 7
    assert_eq!(slices.back().unwrap().timestamp_us, 1700000000700000);
}
