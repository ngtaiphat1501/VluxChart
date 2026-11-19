//! DeepChart Volume Engine & Footprint Analytics Integration Tests

use data_contract::{
    Aggressor, FinalityStatus, NormalizedTradeEvent, PriceTicks, ScaledQuantity,
};
use volume_engine::{
    compute_diagonal_imbalances, compute_poc, compute_value_area, BarEvent, BarManager,
    BarManagerConfig, CumulativeVolumeDelta, MultiSpeedTracker,
};

fn make_trade(
    ts_us: i64,
    price_cents: i64,
    qty_scaled: u64,
    aggressor: Aggressor,
) -> NormalizedTradeEvent {
    NormalizedTradeEvent::new(
        "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
        "BYBIT",
        "publicTrade.BTCUSDT",
        format!("evt-{}", ts_us),
        ts_us,
        ts_us + 500,
        PriceTicks(price_cents),
        ScaledQuantity(qty_scaled),
        100_000_000,
        "BASE_ASSET",
        aggressor,
        data_contract::AggressorOrigin::ExchangeDirect,
    )
}

#[test]
fn test_bar_manager_lifecycle_and_exact_invariants() {
    let mut manager = BarManager::new(BarManagerConfig {
        timeframe_us: 60_000_000, // 1 minute
        max_late_retention_us: 300_000_000,
    });

    let timeframe = 60_000_000i64;
    let t0 = (1_700_000_000_000_000i64 / timeframe) * timeframe; // Exact bar boundary

    // Trade 1: Bar 0, Buy 100 @ 9500000
    let ev1 = manager.on_trade(&make_trade(t0 + 10_000_000, 9500000, 100, Aggressor::Buy));
    match ev1 {
        BarEvent::BarUpdated(bar) => {
            assert_eq!(bar.bar_start_us, t0);
            assert_eq!(bar.buy_units.0, 100);
            assert_eq!(bar.sell_units.0, 0);
            assert_eq!(bar.total_units.0, 100);
            assert_eq!(bar.finality, FinalityStatus::Live);
            assert!(bar.assert_invariant());
        }
        _ => panic!("Expected BarUpdated"),
    }

    // Trade 2: Bar 0, Sell 50 @ 9500100
    let ev2 = manager.on_trade(&make_trade(t0 + 20_000_000, 9500100, 50, Aggressor::Sell));
    match ev2 {
        BarEvent::BarUpdated(bar) => {
            assert_eq!(bar.buy_units.0, 100);
            assert_eq!(bar.sell_units.0, 50);
            assert_eq!(bar.total_units.0, 150);
            assert_eq!(bar.delta_units(), 50);
            assert!(bar.assert_invariant());
        }
        _ => panic!("Expected BarUpdated"),
    }

    // Trade 3: Bar 0, Unknown 25 @ 9500000
    let ev3 = manager.on_trade(&make_trade(
        t0 + 30_000_000,
        9500000,
        25,
        Aggressor::Unknown,
    ));
    match ev3 {
        BarEvent::BarUpdated(bar) => {
            assert_eq!(bar.buy_units.0, 100);
            assert_eq!(bar.sell_units.0, 50);
            assert_eq!(bar.unknown_units.0, 25);
            assert_eq!(bar.total_units.0, 175);
            assert!(bar.assert_invariant());
        }
        _ => panic!("Expected BarUpdated"),
    }

    // Trade 4: Moves into Bar 1 (t0 + 60s) -> closes Bar 0
    let ev4 = manager.on_trade(&make_trade(
        t0 + 65_000_000,
        9501000,
        200,
        Aggressor::Buy,
    ));
    match ev4 {
        BarEvent::BarClosed { closed, new_bar } => {
            assert_eq!(closed.bar_start_us, t0);
            assert_eq!(closed.finality, FinalityStatus::Closed);
            assert_eq!(closed.total_units.0, 175);
            assert!(closed.assert_invariant());

            assert_eq!(new_bar.bar_start_us, t0 + 60_000_000);
            assert_eq!(new_bar.buy_units.0, 200);
            assert_eq!(new_bar.finality, FinalityStatus::Live);
            assert!(new_bar.assert_invariant());
        }
        _ => panic!("Expected BarClosed"),
    }

    // Trade 5: LATE trade belonging to closed Bar 0!
    let late_trade = make_trade(t0 + 45_000_000, 9500000, 30, Aggressor::Buy);
    let ev5 = manager.on_trade(&late_trade);
    match ev5 {
        BarEvent::BarCorrected {
            bar_start_us,
            corrected_bar,
        } => {
            assert_eq!(bar_start_us, t0);
            assert_eq!(corrected_bar.finality, FinalityStatus::Corrected);
            assert_eq!(corrected_bar.buy_units.0, 130); // 100 + 30
            assert_eq!(corrected_bar.total_units.0, 205); // 175 + 30
            assert!(corrected_bar.assert_invariant());
        }
        _ => panic!("Expected BarCorrected"),
    }
}

#[test]
fn test_poc_value_area_and_diagonal_imbalances() {
    let mut bar = data_contract::OHLCVBar::new(
        1000,
        60_000_000,
        &make_trade(1000, 100, 10, Aggressor::Buy),
    );

    // Populate footprint across 4 price levels: 100, 101, 102, 103
    bar.apply_trade(&make_trade(1001, 100, 50, Aggressor::Sell)); // Total @ 100 = 60
    bar.apply_trade(&make_trade(1002, 101, 500, Aggressor::Buy)); // Total @ 101 = 500 (POC)
    bar.apply_trade(&make_trade(1003, 101, 100, Aggressor::Sell)); // Total @ 101 = 600
    bar.apply_trade(&make_trade(1004, 102, 30, Aggressor::Buy)); // Total @ 102 = 30
    bar.apply_trade(&make_trade(1005, 103, 10, Aggressor::Sell)); // Total @ 103 = 10

    // 1. POC check: level 101 has 600 volume
    let poc = compute_poc(&bar).expect("POC should exist");
    assert_eq!(poc.price_ticks, PriceTicks(101));
    assert_eq!(poc.volume_units.0, 600);

    // 2. Value Area check (70% of 700 total = 490) -> level 101 alone covers 600 >= 490
    let va = compute_value_area(&bar, 0.70).expect("Value Area should compute");
    assert_eq!(va.poc_ticks, PriceTicks(101));
    assert!(va.volume_covered.0 >= 490);

    // 3. Diagonal imbalance check
    // At price 101, Buy = 500. At price 100, Sell = 50.
    // Ratio = 500 / 50 = 10.0 >= 3.0 -> Buy Imbalance at 101!
    let imbalances = compute_diagonal_imbalances(&bar, 3.0, 10);
    assert!(!imbalances.is_empty());
    let buy_imb = imbalances
        .iter()
        .find(|imb| imb.is_buy_imbalance && imb.price_ticks == PriceTicks(101));
    assert!(buy_imb.is_some(), "Expected buy imbalance at 101 vs 100");
    let imb = buy_imb.unwrap();
    assert_eq!(imb.current_units.0, 500);
    assert_eq!(imb.diagonal_units.0, 50);
}

#[test]
fn test_cvd_and_multi_speed_engine() {
    let mut cvd = CumulativeVolumeDelta::new();
    let mut speed = MultiSpeedTracker::new();

    let t = 1_000_000_000i64;

    let tr1 = make_trade(t, 50000, 1000, Aggressor::Buy);
    let tr2 = make_trade(t + 500_000, 50000, 400, Aggressor::Sell);
    let tr3 = make_trade(t + 2_000_000, 50000, 200, Aggressor::Buy); // 2s later (evicts tr1 from 1s window)

    speed.on_trade(&tr1);
    speed.on_trade(&tr2);
    speed.on_trade(&tr3);

    // 1s window: only tr3 should be present
    let m1 = speed.metrics_1s();
    assert_eq!(m1.trade_count, 1);
    assert_eq!(m1.buy_units.0, 200);

    // 5s window: all 3 trades present
    let m5 = speed.metrics_5s();
    assert_eq!(m5.trade_count, 3);
    assert_eq!(m5.buy_units.0, 1200);
    assert_eq!(m5.sell_units.0, 400);
    assert_eq!(m5.delta_units, 800);

    // Bar CVD tracking
    let bar = data_contract::OHLCVBar::new(t, 60_000_000, &tr1);
    cvd.update_bar(&bar);
    assert_eq!(cvd.delta(), 1000);
}

#[test]
fn test_stacked_imbalances_and_order_flow_absorption() {
    use volume_engine::{
        compute_stacked_imbalances, detect_order_flow_signals, ImbalanceSide, OrderFlowSignalType,
    };

    let t = 1_700_000_000_000_000i64;
    // Create trades across 5 price levels: 100, 101, 102, 103, 104
    // Make Buy imbalances at levels 101, 102, 103 (3 consecutive levels)
    // Buy at 101 vs Sell at 100: 300 vs 20 -> 15.0x
    // Buy at 102 vs Sell at 101: 400 vs 30 -> 13.3x
    // Buy at 103 vs Sell at 102: 500 vs 40 -> 12.5x
    let mut bar = data_contract::OHLCVBar::new(
        t,
        60_000_000,
        &make_trade(t + 100, 100, 20, Aggressor::Sell),
    );
    bar.apply_trade(&make_trade(t + 200, 101, 300, Aggressor::Buy));
    bar.apply_trade(&make_trade(t + 300, 101, 30, Aggressor::Sell));
    bar.apply_trade(&make_trade(t + 400, 102, 400, Aggressor::Buy));
    bar.apply_trade(&make_trade(t + 500, 102, 40, Aggressor::Sell));
    bar.apply_trade(&make_trade(t + 600, 103, 500, Aggressor::Buy));
    bar.apply_trade(&make_trade(t + 700, 103, 50, Aggressor::Sell));
    bar.apply_trade(&make_trade(t + 800, 104, 50, Aggressor::Sell));

    // Test Stacked Imbalance: >= 3 consecutive levels with ratio >= 3.0
    let stacked = compute_stacked_imbalances(&bar, 3.0, 3, 100);
    assert_eq!(stacked.len(), 1, "Should find exactly 1 stacked buy imbalance");
    assert_eq!(stacked[0].side, ImbalanceSide::Buy);
    assert_eq!(stacked[0].levels_count, 3);
    assert_eq!(stacked[0].start_price_ticks, PriceTicks(101));
    assert_eq!(stacked[0].end_price_ticks, PriceTicks(103));
    assert_eq!(stacked[0].total_imbalance_volume.0, 1200);

    // Test Absorption Detection:
    // Close below high (close is at 100 or 101, while high is 104 with massive buy volume)
    let mut absorbed_bar = bar.clone();
    // Simulate high at 105 with 2000 buy units, but close drops back to 101
    absorbed_bar.apply_trade(&make_trade(t + 900, 105, 2000, Aggressor::Buy));
    absorbed_bar.close_ticks = PriceTicks(101); // Closed far below high
    let signals = detect_order_flow_signals(&absorbed_bar);
    assert!(!signals.is_empty());
    let absorption = signals
        .iter()
        .find(|s| s.signal_type == OrderFlowSignalType::BearishAbsorption);
    assert!(absorption.is_some(), "Should detect Bearish Absorption at the high");
}

#[test]
fn test_ai_market_structure_narrator() {
    use volume_engine::{generate_market_narrative, OrderFlowSignal, OrderFlowSignalType};

    let sigs = vec![OrderFlowSignal {
        signal_type: OrderFlowSignalType::BullishAbsorption,
        price_ticks: PriceTicks(95000),
        volume_units: ScaledQuantity(5000),
        description: "Bullish absorption".into(),
    }];

    let narrative = generate_market_narrative(&[], None, &[], &sigs, &[], None, None);
    assert_eq!(narrative.sentiment, "BULLISH");
    assert!(narrative.headline.contains("hấp thụ"));
    assert!(narrative.order_flow_summary.contains("Aggressor Buy"));
}
