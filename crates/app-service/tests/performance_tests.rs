//! DeepChart Gate G5: Performance, Stress & Hardening Test Suite
//! Measures ingestion throughput, latency distribution, soak stability,
//! chaos resilience (sequence gaps, late corrections), and invariant guarantees.

use app_service::AppCoordinator;
use data_contract::{Aggressor, AggressorOrigin, NormalizedTradeEvent, PriceTicks, ScaledQuantity};
use std::time::Instant;

#[test]
fn test_pipeline_throughput_and_sub_millisecond_latency() {
    let mut coord = AppCoordinator::new("BYBIT:LINEAR_PERP:BTCUSDT:PERP", "BYBIT", 60_000_000);

    const NUM_TRADES: usize = 50_000;
    let base_time: i64 = 1_700_000_040_000_000; // aligned
    let base_price: i64 = 9_500_000;

    println!("Starting 50,000-trade throughput benchmark...");
    let start_time = Instant::now();

    for i in 0..NUM_TRADES {
        let trade_time = base_time + (i as i64 * 2_000); // 2ms apart
        let price_offset = ((i % 100) as i64) * 10;
        let price = PriceTicks(base_price + price_offset);
        let qty = ScaledQuantity(10 + ((i % 50) as u64));
        let side = if i % 2 == 0 {
            Aggressor::Buy
        } else {
            Aggressor::Sell
        };

        let trade = NormalizedTradeEvent::new(
            "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
            "BYBIT",
            "perf-bench",
            format!("bench-trade-{}", i),
            trade_time,
            trade_time + 50,
            price,
            qty,
            100_000_000,
            "BASE_ASSET",
            side,
            AggressorOrigin::ExchangeDirect,
        );

        coord.on_trade(&trade);
    }

    let elapsed = start_time.elapsed();
    let total_secs = elapsed.as_secs_f64();
    let throughput = (NUM_TRADES as f64) / total_secs;
    let avg_latency_us = (elapsed.as_micros() as f64) / (NUM_TRADES as f64);

    println!(
        "Benchmark Result: {} trades processed in {:.4}s | Throughput: {:.1} trades/s | Avg Latency: {:.2} µs/trade",
        NUM_TRADES, total_secs, throughput, avg_latency_us
    );

    // Target: >= 25,000 trades/sec in release, >= 15,000 in unoptimized debug build
    let min_target = if cfg!(debug_assertions) { 15_000.0 } else { 25_000.0 };
    assert!(
        throughput >= min_target,
        "Throughput {:.1} trades/s is below target {:.0} trades/s",
        throughput,
        min_target
    );

    // Target: Sub-millisecond processing latency per trade (< 100 µs)
    assert!(
        avg_latency_us < 100.0,
        "Latency {:.2} µs/trade exceeds 100 µs target",
        avg_latency_us
    );

    assert_eq!(coord.total_trades_processed, NUM_TRADES as u64);

    // Verify snapshot invariants on output
    let snap = coord.snapshot();
    for bar in &snap.bars {
        assert_eq!(
            bar.total_units,
            bar.buy_units + bar.sell_units + bar.unknown_units,
            "Total = Buy + Sell + Unknown invariant violated on bar!"
        );
        for cell in &bar.footprint {
            assert_eq!(
                cell.total_units,
                cell.buy_units + cell.sell_units + cell.unknown_units,
                "Total = Buy + Sell + Unknown invariant violated on cell!"
            );
        }
    }
}

#[test]
fn test_100k_trade_soak_and_memory_stability() {
    let mut coord = AppCoordinator::new("BYBIT:LINEAR_PERP:BTCUSDT:PERP", "BYBIT", 60_000_000);

    const NUM_TRADES: usize = 100_000;
    let base_time: i64 = 1_700_000_040_000_000;
    let base_price: i64 = 9_500_000;

    println!("Starting 100,000-trade soak test...");
    let start_time = Instant::now();

    for i in 0..NUM_TRADES {
        let trade_time = base_time + (i as i64 * 500); // 500µs apart -> 50s total
        let price_offset = ((i % 50) as i64) * 20;
        let price = PriceTicks(base_price + price_offset);
        let qty = ScaledQuantity(25);
        let side = match i % 3 {
            0 => Aggressor::Buy,
            1 => Aggressor::Sell,
            _ => Aggressor::Unknown,
        };

        let trade = NormalizedTradeEvent::new(
            "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
            "BYBIT",
            "soak-feed",
            format!("soak-trade-{}", i),
            trade_time,
            trade_time + 10,
            price,
            qty,
            100_000_000,
            "BASE_ASSET",
            side,
            if side == Aggressor::Unknown {
                AggressorOrigin::Unknown
            } else {
                AggressorOrigin::ExchangeDirect
            },
        );

        coord.on_trade(&trade);
    }

    let elapsed = start_time.elapsed();
    println!("100k Soak completed in {:.3}s", elapsed.as_secs_f64());

    assert_eq!(coord.total_trades_processed, NUM_TRADES as u64);

    let snap = coord.snapshot();
    assert!(snap.active_bar.is_some());
    assert_eq!(snap.data_quality.total_gaps_detected, 0);
    assert_eq!(snap.data_quality.completeness, "COMPLETE");
}

#[test]
fn test_chaos_resilience_gap_injection_and_degradation() {
    let mut coord = AppCoordinator::new("BYBIT:LINEAR_PERP:BTCUSDT:PERP", "BYBIT", 60_000_000);

    let t0: i64 = 1_700_000_040_000_000;

    // Normal trade 1 (seq = 1000)
    let trade1 = NormalizedTradeEvent::new(
        "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
        "BYBIT",
        "chaos-feed",
        "1000",
        t0,
        t0 + 10,
        PriceTicks(9500000),
        ScaledQuantity(100),
        100_000_000,
        "BASE_ASSET",
        Aggressor::Buy,
        AggressorOrigin::ExchangeDirect,
    );
    coord.on_trade(&trade1);

    // Normal trade 2 (seq = 1001)
    let trade2 = NormalizedTradeEvent::new(
        "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
        "BYBIT",
        "chaos-feed",
        "1001",
        t0 + 100,
        t0 + 110,
        PriceTicks(9500010),
        ScaledQuantity(50),
        100_000_000,
        "BASE_ASSET",
        Aggressor::Sell,
        AggressorOrigin::ExchangeDirect,
    );
    coord.on_trade(&trade2);

    let snap_ok = coord.snapshot();
    assert_eq!(snap_ok.data_quality.total_gaps_detected, 0);
    assert_eq!(snap_ok.data_quality.completeness, "COMPLETE");

    // Inject CHAOS: Jump sequence from 1001 to 1050 (48 missing trades!)
    let gap_trade = NormalizedTradeEvent::new(
        "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
        "BYBIT",
        "chaos-feed",
        "1050",
        t0 + 200,
        t0 + 210,
        PriceTicks(9500050),
        ScaledQuantity(200),
        100_000_000,
        "BASE_ASSET",
        Aggressor::Buy,
        AggressorOrigin::ExchangeDirect,
    );
    coord.on_trade(&gap_trade);

    // Verify system detected gap and marked quality as Degraded
    let snap_degraded = coord.snapshot();
    assert_eq!(
        snap_degraded.data_quality.total_gaps_detected, 1,
        "Gap detector must record missing trades"
    );
    assert_eq!(
        snap_degraded.data_quality.completeness, "DEGRADED",
        "Completeness must transition to DEGRADED on sequence gap"
    );
}

#[test]
fn test_late_trade_correction_integrity() {
    let mut coord = AppCoordinator::new("BYBIT:LINEAR_PERP:BTCUSDT:PERP", "BYBIT", 60_000_000);

    let t0: i64 = 1_700_000_040_000_000; // aligned to 60s
    let t1: i64 = t0 + 60_000_000; // bar 2 start

    // Trade in Bar 0
    let trade_bar0 = NormalizedTradeEvent::new(
        "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
        "BYBIT",
        "feed",
        "bar0-1",
        t0 + 10_000_000, // at 10s
        t0 + 10_000_050,
        PriceTicks(9500000),
        ScaledQuantity(100),
        100_000_000,
        "BASE_ASSET",
        Aggressor::Buy,
        AggressorOrigin::ExchangeDirect,
    );
    coord.on_trade(&trade_bar0);

    // Trade in Bar 1 (causes Bar 0 to close)
    let trade_bar1 = NormalizedTradeEvent::new(
        "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
        "BYBIT",
        "feed",
        "bar1-1",
        t1 + 5_000_000, // at 65s
        t1 + 5_000_050,
        PriceTicks(9510000),
        ScaledQuantity(150),
        100_000_000,
        "BASE_ASSET",
        Aggressor::Sell,
        AggressorOrigin::ExchangeDirect,
    );
    coord.on_trade(&trade_bar1);

    let snap_after_close = coord.snapshot();
    assert_eq!(snap_after_close.bars.len(), 1);
    assert_eq!(snap_after_close.bars[0].total_units, 100);

    // Inject LATE TRADE arriving out of order for Bar 0 (timestamp is within Bar 0)
    let late_trade = NormalizedTradeEvent::new(
        "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
        "BYBIT",
        "feed",
        "late-trade-bar0",
        t0 + 30_000_000, // at 30s
        t0 + 30_000_050,
        PriceTicks(9505000),
        ScaledQuantity(75),
        100_000_000,
        "BASE_ASSET",
        Aggressor::Buy,
        AggressorOrigin::ExchangeDirect,
    );
    coord.on_trade(&late_trade);

    // Check that historical bar 0 was corrected and total volume updated accurately
    let snap_after_correction = coord.snapshot();
    assert_eq!(snap_after_correction.bars.len(), 1);
    let corrected_bar = &snap_after_correction.bars[0];
    assert_eq!(
        corrected_bar.total_units, 175,
        "Corrected bar total volume must reflect late trade (100 + 75)"
    );
    assert_eq!(
        corrected_bar.buy_units, 175,
        "Corrected bar buy volume must reflect late trade (100 + 75)"
    );
    assert_eq!(
        corrected_bar.total_units,
        corrected_bar.buy_units + corrected_bar.sell_units + corrected_bar.unknown_units
    );
}
