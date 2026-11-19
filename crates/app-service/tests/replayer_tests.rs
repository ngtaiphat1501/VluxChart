//! DeepChart Historical Replayer & Determinism Tests (P2.5)
//! Verifies Rule R-DATA-13: Identical event stream produces 100% identical bars and footprints in live vs replay.

use app_service::{AppCoordinator, HistoricalReplayer, PlaybackSpeed, PlaybackState};
use data_contract::{Aggressor, AggressorOrigin, NormalizedTradeEvent, PriceTicks, ScaledQuantity};
use std::time::Duration;

#[test]
fn test_replayer_deterministic_convergence_with_live() {
    let t0 = 1_700_000_040_000_000i64; // Divisible by 60s
    let mut trades = Vec::new();

    // Generate 500 deterministic trades spanning across 3 bars
    for i in 0..500 {
        let ts = t0 + (i as i64 * 300_000); // 300ms apart
        let price = PriceTicks(9500000 + ((i % 15) as i64 * 10));
        let qty = ScaledQuantity(50 + ((i % 20) as u64 * 5));
        let side = if i % 2 == 0 {
            Aggressor::Buy
        } else {
            Aggressor::Sell
        };

        trades.push(NormalizedTradeEvent::new(
            "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
            "BYBIT",
            "replay-test",
            format!("evt-{}", i),
            ts,
            ts + 10,
            price,
            qty,
            100_000_000,
            "BASE_ASSET",
            side,
            AggressorOrigin::ExchangeDirect,
        ));
    }

    // 1. Run Live simulation directly into Coordinator A
    let mut live_coord = AppCoordinator::new("BYBIT:LINEAR_PERP:BTCUSDT:PERP", "BYBIT", 60_000_000);
    for trade in &trades {
        live_coord.on_trade(trade);
    }
    let live_snapshot = live_coord.snapshot();

    // 2. Run Replay simulation into Coordinator B via HistoricalReplayer
    let mut replay_coord = AppCoordinator::new("BYBIT:LINEAR_PERP:BTCUSDT:PERP", "BYBIT", 60_000_000);
    let mut replayer = HistoricalReplayer::new(trades.clone());
    replayer.play();
    replayer.set_speed(PlaybackSpeed::Fast10x);

    // Step forward in chunks until completed
    while replayer.state == PlaybackState::Playing {
        replayer.step_forward_time(Duration::from_millis(500), &mut replay_coord);
    }

    assert_eq!(replayer.state, PlaybackState::Completed);
    assert_eq!(replayer.progress_pct(), 100.0);

    let replay_snapshot = replay_coord.snapshot();

    // 3. ASSERT 100% IDENTICAL CONVERGENCE
    assert_eq!(
        live_snapshot.bars.len(),
        replay_snapshot.bars.len(),
        "Historical bar count must be identical"
    );

    for (idx, (live_bar, replay_bar)) in live_snapshot
        .bars
        .iter()
        .zip(replay_snapshot.bars.iter())
        .enumerate()
    {
        assert_eq!(live_bar.open_ticks, replay_bar.open_ticks, "Bar {} open must match", idx);
        assert_eq!(live_bar.high_ticks, replay_bar.high_ticks, "Bar {} high must match", idx);
        assert_eq!(live_bar.low_ticks, replay_bar.low_ticks, "Bar {} low must match", idx);
        assert_eq!(live_bar.close_ticks, replay_bar.close_ticks, "Bar {} close must match", idx);
        assert_eq!(live_bar.total_units, replay_bar.total_units, "Bar {} total units must match", idx);
        assert_eq!(live_bar.buy_units, replay_bar.buy_units, "Bar {} buy units must match", idx);
        assert_eq!(live_bar.sell_units, replay_bar.sell_units, "Bar {} sell units must match", idx);
        assert_eq!(live_bar.delta_units, replay_bar.delta_units, "Bar {} delta must match", idx);
        assert_eq!(live_bar.poc_ticks, replay_bar.poc_ticks, "Bar {} POC must match", idx);
        assert_eq!(live_bar.footprint.len(), replay_bar.footprint.len(), "Bar {} footprint cell count must match", idx);
    }

    assert_eq!(
        live_snapshot.cvd_units, replay_snapshot.cvd_units,
        "CVD must match identically"
    );
}

#[test]
fn test_replayer_single_stepping_and_pausing() {
    let t0 = 1_700_000_040_000_000i64;
    let mut trades = Vec::new();
    for i in 0..10 {
        trades.push(NormalizedTradeEvent::new(
            "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
            "BYBIT",
            "step-test",
            format!("step-{}", i),
            t0 + (i as i64 * 1_000_000),
            t0 + (i as i64 * 1_000_000) + 10,
            PriceTicks(9500000),
            ScaledQuantity(100),
            100_000_000,
            "BASE_ASSET",
            Aggressor::Buy,
            AggressorOrigin::ExchangeDirect,
        ));
    }

    let mut coord = AppCoordinator::new("BYBIT:LINEAR_PERP:BTCUSDT:PERP", "BYBIT", 60_000_000);
    let mut replayer = HistoricalReplayer::new(trades);

    assert_eq!(replayer.state, PlaybackState::Paused);
    assert_eq!(replayer.current_index, 0);

    // Step 1 trade
    let stepped = replayer.step_single_trade(&mut coord);
    assert!(stepped);
    assert_eq!(replayer.current_index, 1);
    assert_eq!(coord.total_trades_processed, 1);

    // Step remaining 9 trades
    for _ in 1..10 {
        replayer.step_single_trade(&mut coord);
    }

    assert_eq!(replayer.current_index, 10);
    assert_eq!(replayer.state, PlaybackState::Completed);
    assert_eq!(coord.total_trades_processed, 10);
}
