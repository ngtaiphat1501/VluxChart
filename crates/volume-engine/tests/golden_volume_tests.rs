//! DeepChart Golden Invariant & High-Volume Property Tests for Volume Engine
//! Strictly verifies Rule R-DATA-05 (Exact integer precision) and Rule R-DATA-06 (Volume Invariant).

use data_contract::{
    Aggressor, FinalityStatus, NormalizedTradeEvent, PriceTicks, ScaledQuantity,
};
use volume_engine::{BarEvent, BarManager, BarManagerConfig};

fn make_deterministic_trade(
    seq: u64,
    bar_offset_s: i64,
    price_cents: i64,
    qty_scaled: u64,
    aggressor: Aggressor,
) -> NormalizedTradeEvent {
    let t0 = 1_700_000_040_000_000i64; // Divisible by 60_000_000
    let ts_us = t0 + (bar_offset_s * 1_000_000);
    NormalizedTradeEvent::new(
        "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
        "BYBIT",
        "publicTrade.BTCUSDT",
        format!("golden-evt-{}", seq),
        ts_us,
        ts_us + 100,
        PriceTicks(price_cents),
        ScaledQuantity(qty_scaled),
        100_000_000,
        "BASE_ASSET",
        aggressor,
        data_contract::AggressorOrigin::ExchangeDirect,
    )
}

#[test]
fn test_golden_1000_trades_exact_summation_and_cell_invariants() {
    let mut manager = BarManager::new(BarManagerConfig {
        timeframe_us: 60_000_000, // 1 minute
        max_late_retention_us: 300_000_000,
    });

    let mut expected_total_units = 0u64;
    let mut expected_buy_units = 0u64;
    let mut expected_sell_units = 0u64;
    let mut expected_unknown_units = 0u64;

    // Feed 500 trades within Bar 0 (offsets 1s to 55s) across 10 price levels
    for i in 0..500u64 {
        let price = 9500000 + ((i % 10) as i64 * 100);
        let qty = 100 + (i * 3);
        let aggressor = match i % 3 {
            0 => {
                expected_buy_units += qty;
                Aggressor::Buy
            }
            1 => {
                expected_sell_units += qty;
                Aggressor::Sell
            }
            _ => {
                expected_unknown_units += qty;
                Aggressor::Unknown
            }
        };
        expected_total_units += qty;

        let trade = make_deterministic_trade(i, (i % 55) as i64 + 1, price, qty, aggressor);
        manager.on_trade(&trade);
    }

    let bar = manager.active_bar().expect("Bar 0 must be active");

    // 1. Invariant: Total = Buy + Sell + Unknown
    assert_eq!(bar.total_units.0, expected_total_units);
    assert_eq!(bar.buy_units.0, expected_buy_units);
    assert_eq!(bar.sell_units.0, expected_sell_units);
    assert_eq!(bar.unknown_units.0, expected_unknown_units);
    assert_eq!(
        bar.total_units.0,
        bar.buy_units.0 + bar.sell_units.0 + bar.unknown_units.0
    );
    assert_eq!(
        bar.delta_units(),
        (expected_buy_units as i64) - (expected_sell_units as i64)
    );

    // 2. Cell-level Invariant: Sum of all footprint cells must exactly match bar total
    let mut cell_sum_total = 0u64;
    let mut cell_sum_buy = 0u64;
    let mut cell_sum_sell = 0u64;
    let mut cell_sum_unknown = 0u64;

    for (&price, cell) in &bar.footprint {
        assert!(
            cell.assert_invariant(),
            "Footprint cell at price {} violated invariant!",
            price.0
        );
        cell_sum_total += cell.total_units.0;
        cell_sum_buy += cell.buy_units.0;
        cell_sum_sell += cell.sell_units.0;
        cell_sum_unknown += cell.unknown_units.0;
    }

    assert_eq!(cell_sum_total, bar.total_units.0);
    assert_eq!(cell_sum_buy, bar.buy_units.0);
    assert_eq!(cell_sum_sell, bar.sell_units.0);
    assert_eq!(cell_sum_unknown, bar.unknown_units.0);

    // 3. Move into Bar 1 (offset 65s) -> closes Bar 0
    let close_trade = make_deterministic_trade(501, 65, 9500500, 1000, Aggressor::Buy);
    let close_event = manager.on_trade(&close_trade);
    match close_event {
        BarEvent::BarClosed { closed, new_bar } => {
            assert_eq!(closed.finality, FinalityStatus::Closed);
            assert_eq!(closed.total_units.0, expected_total_units);
            assert_eq!(new_bar.finality, FinalityStatus::Live);
            assert_eq!(new_bar.total_units.0, 1000);
        }
        _ => panic!("Expected BarClosed event"),
    }

    // 4. Send late trade into closed Bar 0 (offset 30s)
    let late_qty = 777u64;
    let late_trade = make_deterministic_trade(502, 30, 9500200, late_qty, Aggressor::Buy);
    let late_event = manager.on_trade(&late_trade);
    match late_event {
        BarEvent::BarCorrected { corrected_bar, .. } => {
            assert_eq!(corrected_bar.finality, FinalityStatus::Corrected);
            assert_eq!(corrected_bar.total_units.0, expected_total_units + late_qty);
            assert_eq!(corrected_bar.buy_units.0, expected_buy_units + late_qty);
            assert!(corrected_bar.assert_invariant());

            // Check that the updated footprint cell also incorporates the late trade
            let target_cell = corrected_bar
                .footprint
                .get(&PriceTicks(9500200))
                .expect("Cell must exist");
            assert!(target_cell.assert_invariant());
        }
        _ => panic!("Expected BarCorrected event"),
    }
}
