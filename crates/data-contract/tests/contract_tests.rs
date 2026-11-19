use data_contract::{
    Aggressor, AggressorOrigin, InstrumentRegistry, NormalizedTradeEvent, OHLCVBar, PriceTicks,
    ScaledQuantity,
};
use std::path::PathBuf;

#[test]
fn test_load_official_instruments_yaml() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let yaml_path = manifest_dir.parent().unwrap().parent().unwrap().join("instruments.yaml");
    assert!(yaml_path.exists(), "instruments.yaml should exist at project root");

    let registry = InstrumentRegistry::load_from_file(&yaml_path)
        .expect("Should parse instruments.yaml without error");

    let btc = registry
        .get("BYBIT:LINEAR_PERP:BTCUSDT:PERP")
        .expect("Bybit BTC should exist");
    assert_eq!(btc.symbol, "BTCUSDT");
    assert_eq!(btc.price_tick, 0.10);
    assert_eq!(btc.quantity_scale, 1000);

    let eth = registry
        .get("BINANCE:USDS_M_PERP:ETHUSDT:PERP")
        .expect("Binance ETH should exist");
    assert_eq!(eth.symbol, "ETHUSDT");

    let gold = registry
        .get("BINANCE:USDS_M_PERP:XAUUSDT:PERP")
        .expect("Binance XAUUSDT should exist");
    assert_eq!(gold.symbol, "XAUUSDT");
    assert_eq!(gold.price_tick, 0.01);
}

#[test]
fn test_exact_bar_and_footprint_invariants() {
    let t1 = NormalizedTradeEvent::new(
        "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
        "BYBIT",
        "publicTrade",
        "trade-1",
        1_700_000_000_000_000,
        1_700_000_000_150_000,
        PriceTicks(700_000), // 70,000.0
        ScaledQuantity(2_000), // 2.000 BTC
        1_000,
        "BTC",
        Aggressor::Buy,
        AggressorOrigin::ExchangeDirect,
    );

    let t2 = NormalizedTradeEvent::new(
        "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
        "BYBIT",
        "publicTrade",
        "trade-2",
        1_700_000_000_050_000,
        1_700_000_000_160_000,
        PriceTicks(700_000), // same price
        ScaledQuantity(1_250), // 1.250 BTC
        1_000,
        "BTC",
        Aggressor::Sell,
        AggressorOrigin::ExchangeDirect,
    );

    let t3 = NormalizedTradeEvent::new(
        "BYBIT:LINEAR_PERP:BTCUSDT:PERP",
        "BYBIT",
        "publicTrade",
        "trade-3",
        1_700_000_000_090_000,
        1_700_000_000_170_000,
        PriceTicks(700_001), // higher price
        ScaledQuantity(750),  // 0.750 BTC
        1_000,
        "BTC",
        Aggressor::Buy,
        AggressorOrigin::ExchangeDirect,
    );

    let mut bar = OHLCVBar::new(1_700_000_000_000_000, 60_000_000, &t1);
    bar.apply_trade(&t2);
    bar.apply_trade(&t3);

    // Verify OHLC
    assert_eq!(bar.open_ticks, PriceTicks(700_000));
    assert_eq!(bar.high_ticks, PriceTicks(700_001));
    assert_eq!(bar.low_ticks, PriceTicks(700_000));
    assert_eq!(bar.close_ticks, PriceTicks(700_001));

    // Golden values from Master Doc Section 4.1:
    // Buy = 2.75 BTC (2750 units), Sell = 1.25 BTC (1250 units), Total = 4.00 BTC (4000 units), Delta = +1.50 BTC (1500 units)
    assert_eq!(bar.buy_units.0, 2_750);
    assert_eq!(bar.sell_units.0, 1_250);
    assert_eq!(bar.unknown_units.0, 0);
    assert_eq!(bar.total_units.0, 4_000);
    assert_eq!(bar.delta_units(), 1_500);

    // Mathematical Invariant Assertion: Total = Buy + Sell + Unknown
    assert!(bar.assert_invariant());

    // Footprint POC Assertion: 700,000 has 3,250 units, 700,001 has 750 units -> POC is 700,000
    assert_eq!(bar.poc_ticks(), Some(PriceTicks(700_000)));

    // Assert cell level invariants
    for cell in bar.footprint.values() {
        assert!(cell.assert_invariant());
    }
}
