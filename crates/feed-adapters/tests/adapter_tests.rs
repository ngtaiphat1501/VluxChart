use feed_adapters::{BinanceFuturesAdapter, BybitLinearAdapter, HeartbeatTracker};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

#[test]
fn test_parse_real_bybit_fixture() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixture_path = manifest_dir
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("fixtures/raw/bybit/sample_bybit_trades.jsonl");

    assert!(fixture_path.exists(), "Bybit fixture file must exist");
    let file = File::open(&fixture_path).unwrap();
    let reader = BufReader::new(file);

    let mut total_trades = 0;
    for line in reader.lines() {
        let l = line.unwrap();
        if l.trim().is_empty() {
            continue;
        }
        let v: serde_json::Value = serde_json::from_str(&l).unwrap();
        let payload_str = v.get("payload").unwrap().to_string();

        let trades = BybitLinearAdapter::parse_public_trades(
            &payload_str,
            1794502653000000,
            0.10,
            1000,
            "BTC",
        )
        .unwrap();

        total_trades += trades.len();
        for t in trades {
            assert!(t.aggressor.is_buy() || t.aggressor.is_sell());
            assert!(t.price_ticks.0 > 0);
            assert!(t.quantity_units.0 > 0);
            assert_eq!(t.venue, "BYBIT");
        }
    }

    assert!(total_trades >= 30, "Expected >= 30 Bybit trades parsed from fixture");
}

#[test]
fn test_parse_real_binance_btc_and_gold_fixtures() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let btc_fixture = manifest_dir
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("fixtures/raw/binance/sample_binance_aggtrades.jsonl");

    let gold_fixture = manifest_dir
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("fixtures/raw/binance/sample_binance_xauusdt_aggtrades.jsonl");

    assert!(btc_fixture.exists(), "Binance BTC fixture must exist");
    assert!(gold_fixture.exists(), "Binance Gold fixture must exist");

    // Test BTC
    let file = File::open(&btc_fixture).unwrap();
    let mut btc_count = 0;
    for line in BufReader::new(file).lines() {
        let l = line.unwrap();
        let v: serde_json::Value = serde_json::from_str(&l).unwrap();
        let payload_str = v.get("payload").unwrap().to_string();

        let trade = BinanceFuturesAdapter::parse_agg_trade(
            &payload_str,
            1794502665000000,
            0.10,
            1000,
            "BTC",
        )
        .unwrap();

        assert_eq!(trade.venue, "BINANCE");
        assert_eq!(trade.instrument_id, "BINANCE:USDS_M_PERP:BTCUSDT:PERP");
        assert!(trade.price_ticks.0 > 0);
        assert!(trade.quantity_units.0 > 0);
        btc_count += 1;
    }
    assert!(btc_count >= 15);

    // Test Gold (XAUUSDT)
    let file_gold = File::open(&gold_fixture).unwrap();
    let mut gold_count = 0;
    for line in BufReader::new(file_gold).lines() {
        let l = line.unwrap();
        let v: serde_json::Value = serde_json::from_str(&l).unwrap();
        let payload_str = v.get("payload").unwrap().to_string();

        let trade = BinanceFuturesAdapter::parse_agg_trade(
            &payload_str,
            1794502704000000,
            0.01,
            1000,
            "OUNCE_OR_UNIT",
        )
        .unwrap();

        assert_eq!(trade.venue, "BINANCE");
        assert_eq!(trade.instrument_id, "BINANCE:USDS_M_PERP:XAUUSDT:PERP");
        assert!(trade.price_ticks.0 > 200000); // 2000.00 in 0.01 tick
        gold_count += 1;
    }
    assert!(gold_count >= 5);
}

#[test]
fn test_heartbeat_tracker() {
    let mut tracker = HeartbeatTracker::new(5000); // 5s timeout

    let t0 = 1_000_000_000;
    tracker.record_activity(t0);

    // 2s later -> not stale
    assert!(!tracker.is_stale(t0 + 2_000_000));

    // 6s later -> stale!
    assert!(tracker.is_stale(t0 + 6_000_000));
}

#[test]
fn test_mt5_broker_reference_bridge() {
    use feed_adapters::{Mt5ReferenceAdapter, Mt5TickPayload};

    let mut adapter = Mt5ReferenceAdapter::new();

    let tick1 = Mt5TickPayload {
        symbol: "XAUUSD".into(),
        timestamp_ms: 1700000001000,
        bid: 2650.50,
        ask: 2650.80,
        last: 2650.60,
        volume: 1.5,
        flags: Some(6),
    };

    let event1 = adapter.parse_tick(&tick1, 1700000001001000, 0.01, 1000);
    assert_eq!(event1.venue, "MT5_REFERENCE");
    assert_eq!(event1.instrument_id, "MT5:CFD:XAUUSD:SPOT_REF");
    assert_eq!(event1.aggressor_origin, data_contract::AggressorOrigin::Estimated);
    assert_eq!(event1.price_ticks.0, 265060);
    assert_eq!(event1.quantity_units.0, 1500);

    // Next tick higher -> Aggressor Buy
    let tick2 = Mt5TickPayload {
        symbol: "XAUUSD".into(),
        timestamp_ms: 1700000002000,
        bid: 2650.80,
        ask: 2651.10,
        last: 2651.00,
        volume: 2.0,
        flags: Some(6),
    };

    let event2 = adapter.parse_tick(&tick2, 1700000002001000, 0.01, 1000);
    assert_eq!(event2.aggressor, data_contract::Aggressor::Buy);
    assert_eq!(event2.price_ticks.0, 265100);
}

#[test]
fn test_live_feed_dispatcher_binance_agg_trade() {
    use feed_adapters::{ConnectionState, LiveFeedConfig, LiveFeedDispatcher};
    use std::sync::mpsc;

    let (tx, rx) = mpsc::sync_channel(100);
    let config = LiveFeedConfig::binance_btc_perp();
    let mut dispatcher = LiveFeedDispatcher::new(config, tx);
    dispatcher.set_state(ConnectionState::Connected);

    let raw_agg_trade = r#"{"e":"aggTrade","E":1794502665000,"s":"BTCUSDT","a":8829102,"p":"95100.20","q":"0.500","f":123,"l":124,"T":1794502664950,"m":false}"#;
    let count = dispatcher
        .process_raw_frame(raw_agg_trade, 1794502665010000)
        .expect("Parse success");
    assert_eq!(count, 1);

    let trade = rx.recv().expect("Trade received");
    assert_eq!(trade.venue, "BINANCE");
    assert_eq!(trade.price_ticks.0, 951002);
    assert_eq!(trade.quantity_units.0, 500);
    assert!(trade.aggressor.is_buy()); // m == false -> buyer crossed spread -> Aggressor Buy

    assert_eq!(dispatcher.telemetry().total_trades_dispatched, 1);
    assert!(dispatcher.telemetry().estimated_latency_ms >= 0.0);
}

#[test]
fn test_live_feed_backpressure_and_dropped_accounting() {
    use feed_adapters::{ConnectionState, LiveFeedConfig, LiveFeedDispatcher};
    use std::sync::mpsc;

    // Small channel of capacity 1 to test bounded buffer full drops
    let (tx, _rx) = mpsc::sync_channel(1);
    let config = LiveFeedConfig::binance_btc_perp();
    let mut dispatcher = LiveFeedDispatcher::new(config, tx);
    dispatcher.set_state(ConnectionState::Connected);

    let raw_agg_trade = r#"{"e":"aggTrade","E":1794502665000,"s":"BTCUSDT","a":8829102,"p":"95100.20","q":"0.500","f":123,"l":124,"T":1794502664950,"m":false}"#;

    // First trade succeeds and fills buffer
    let c1 = dispatcher.process_raw_frame(raw_agg_trade, 1794502665010000).unwrap();
    assert_eq!(c1, 1);

    // Second trade encounters full channel -> must drop safely without panic
    let c2 = dispatcher.process_raw_frame(raw_agg_trade, 1794502665011000).unwrap();
    assert_eq!(c2, 0);
    assert_eq!(dispatcher.telemetry().total_dropped_messages, 1);
}

