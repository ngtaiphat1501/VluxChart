use data_contract::{
    Aggressor, AggressorOrigin, DataCompleteness, NormalizedTradeEvent, PriceTicks, ScaledQuantity,
};
use data_quality::{BoundedDedupFilter, SequenceGapDetector};

fn make_dummy_trade(venue: &str, symbol: &str, event_id: &str, ts_us: i64) -> NormalizedTradeEvent {
    NormalizedTradeEvent::new(
        format!("{}:LINEAR_PERP:{}:PERP", venue, symbol),
        venue,
        "publicTrade",
        event_id,
        ts_us,
        ts_us + 100,
        PriceTicks(700000),
        ScaledQuantity(1000),
        1000,
        "BTC",
        Aggressor::Buy,
        AggressorOrigin::ExchangeDirect,
    )
}

#[test]
fn test_bounded_dedup_filter() {
    let mut filter = BoundedDedupFilter::new(500);

    let t1 = make_dummy_trade("BYBIT", "BTCUSDT", "uuid-1", 1000);
    let t2 = make_dummy_trade("BYBIT", "BTCUSDT", "uuid-2", 2000);
    let t1_dup = make_dummy_trade("BYBIT", "BTCUSDT", "uuid-1", 1000);

    assert!(filter.accept(&t1), "First occurrence must be accepted");
    assert!(filter.accept(&t2), "Second unique trade must be accepted");
    assert!(!filter.accept(&t1_dup), "Duplicate event must be rejected");

    assert_eq!(filter.duplicates_detected(), 1);
    assert_eq!(filter.active_keys(), 2);
}

#[test]
fn test_sequence_gap_detection() {
    let mut detector = SequenceGapDetector::new();
    let instrument = "BINANCE:USDS_M_PERP:BTCUSDT:PERP";

    // Continuous trades
    assert!(detector.check_sequence(instrument, 100, 1000).is_none());
    assert!(detector.check_sequence(instrument, 101, 2000).is_none());
    assert!(detector.check_sequence(instrument, 102, 3000).is_none());
    assert_eq!(detector.completeness_status(), DataCompleteness::Complete);

    // Dropped packet simulation: jump from 102 to 107 (missing 103, 104, 105, 106 = 4 trades)
    let gap = detector.check_sequence(instrument, 107, 4000);
    assert!(gap.is_some(), "Gap must be detected on dropped sequence");
    let gap_info = gap.unwrap();
    assert_eq!(gap_info.previous_id, "102");
    assert_eq!(gap_info.next_id, "107");
    assert_eq!(gap_info.missing_count, 4);

    // Completeness must reflect Partial
    assert_eq!(detector.completeness_status(), DataCompleteness::Partial);
    assert_eq!(detector.total_gaps_count(), 1);
}
