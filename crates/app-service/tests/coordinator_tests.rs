//! DeepChart App Service & Coordinator Tests

use app_service::{AppCoordinator, AppServiceState};
use data_contract::{Aggressor, AggressorOrigin, NormalizedTradeEvent, PriceTicks, ScaledQuantity};

#[test]
fn test_coordinator_snapshot_generation_and_dto() {
    let mut coord = AppCoordinator::new("BYBIT:LINEAR_PERP:BTCUSDT:PERP", "BYBIT", 60_000_000);
    coord.seed_demo_trades(9500000, 5);

    let snap = coord.snapshot();
    assert_eq!(snap.instrument_id, "BYBIT:LINEAR_PERP:BTCUSDT:PERP");
    assert_eq!(snap.venue, "BYBIT");
    assert!(!snap.bars.is_empty(), "Should have closed historical bars");
    assert!(snap.active_bar.is_some(), "Should have active live bar");

    let first_bar = &snap.bars[0];
    assert!(first_bar.total_units > 0);
    assert_eq!(
        first_bar.total_units,
        first_bar.buy_units + first_bar.sell_units + first_bar.unknown_units,
        "Total = Buy + Sell + Unknown must hold on DTO"
    );
    assert_eq!(
        first_bar.delta_units,
        (first_bar.buy_units as i64) - (first_bar.sell_units as i64)
    );
    assert!(first_bar.poc_ticks.is_some());
    assert!(first_bar.value_area.is_some());

    // Deduplication test
    let trade = NormalizedTradeEvent::new(
        "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
        "BYBIT",
        "trade-feed",
        "dedup-test-evt-1",
        1700000000000000,
        1700000000000050,
        PriceTicks(9500000),
        ScaledQuantity(100),
        100_000_000,
        "BASE_ASSET",
        Aggressor::Buy,
        AggressorOrigin::ExchangeDirect,
    );

    let trades_before = coord.total_trades_processed;
    coord.on_trade(&trade);
    assert_eq!(coord.total_trades_processed, trades_before + 1);

    // Replay identical trade
    coord.on_trade(&trade);
    assert_eq!(
        coord.total_trades_processed,
        trades_before + 1,
        "Duplicate trade must be dropped idempotently"
    );
}

#[test]
fn test_app_service_state_lifecycle_and_switching() {
    let state = AppServiceState::new();
    let snap = state.snapshot().expect("Initial snapshot should succeed");
    assert_eq!(snap.instrument_id, "BYBIT:LINEAR_PERP:BTCUSDT:PERP");
    assert_eq!(snap.bars.len(), 9);
    assert!(snap.active_bar.is_some());

    // Switch to Gold (Binance XAUUSDT)
    state
        .switch_instrument("BINANCE:USDS_M_PERP:XAUUSDT:PERP")
        .expect("Switch to gold should succeed");

    let gold_snap = state.snapshot().expect("Gold snapshot should succeed");
    assert_eq!(gold_snap.instrument_id, "BINANCE:USDS_M_PERP:XAUUSDT:PERP");
    assert_eq!(gold_snap.venue, "BINANCE");
    assert_eq!(gold_snap.bars.len(), 9);
    assert!(gold_snap.active_bar.is_some());
    assert!(gold_snap.bars[0].open_ticks > 300000); // Sane gold price ticks (3875.00)
}

#[test]
fn test_coordinator_mbo_iceberg_pipeline() {
    use data_contract::{MboOrderAction, MboOrderEvent, OrderBookSide, PriceTicks, ScaledQuantity};

    let mut coord = AppCoordinator::new("CME:FUTURES:GC:CONTINUOUS", "CME", 60_000_000);

    // Initial add: 100 units
    coord.on_mbo_event(&MboOrderEvent {
        instrument_id: "CME:FUTURES:GC:CONTINUOUS".into(),
        venue: "CME".into(),
        order_id: 999,
        side: OrderBookSide::Bid,
        action: MboOrderAction::Add,
        price_ticks: PriceTicks(265000),
        quantity_units: ScaledQuantity(100),
        exchange_ts_us: 1700000000000000,
        sequence_id: 1,
    });

    // Execute 300 units (triggering 200 units hidden iceberg)
    let det = coord.on_mbo_event(&MboOrderEvent {
        instrument_id: "CME:FUTURES:GC:CONTINUOUS".into(),
        venue: "CME".into(),
        order_id: 999,
        side: OrderBookSide::Bid,
        action: MboOrderAction::Execute,
        price_ticks: PriceTicks(265000),
        quantity_units: ScaledQuantity(300),
        exchange_ts_us: 1700000000001000,
        sequence_id: 2,
    });

    assert!(det.is_some());
    let snap = coord.snapshot();
    assert_eq!(snap.icebergs.len(), 1);
    assert_eq!(snap.icebergs[0].price_ticks, 265000);
    assert_eq!(snap.icebergs[0].hidden_volume_units, 200);
}
