//! DeepChart Options Flow & Analytics Unit Tests (P2 & P2.2)

use data_contract::{OptionType, OptionsTradeEvent, PriceTicks, ScaledQuantity};
use volume_engine::options_engine::{
    black_scholes_call, black_scholes_put, calculate_greeks, solve_implied_volatility,
};
use volume_engine::OptionsAnalyticsEngine;

#[test]
fn test_options_call_put_walls_and_max_pain() {
    let mut engine = OptionsAnalyticsEngine::new();

    // Strike 90,000 (0.90 USD / tick)
    // Heavy Put OI = Put Wall
    engine.set_strike_data(
        PriceTicks(9000000),
        ScaledQuantity(500),  // Call OI
        ScaledQuantity(3500), // Put OI (Massive Put Wall!)
        ScaledQuantity(50),
        ScaledQuantity(200),
    );

    // Strike 95,000 (At the money)
    // Moderate OI on both sides
    engine.set_strike_data(
        PriceTicks(9500000),
        ScaledQuantity(1200),
        ScaledQuantity(1100),
        ScaledQuantity(150),
        ScaledQuantity(120),
    );

    // Strike 100,000
    // Heavy Call OI = Call Wall
    engine.set_strike_data(
        PriceTicks(10000000),
        ScaledQuantity(4000), // Call OI (Massive Call Wall!)
        ScaledQuantity(600),  // Put OI
        ScaledQuantity(300),
        ScaledQuantity(40),
    );

    let summary = engine.compute_summary("BTC");

    // Total Call OI = 500 + 1200 + 4000 = 5700
    assert_eq!(summary.total_call_oi, ScaledQuantity(5700));
    // Total Put OI = 3500 + 1100 + 600 = 5200
    assert_eq!(summary.total_put_oi, ScaledQuantity(5200));

    // PCR = 5200 / 5700 ≈ 0.912
    assert!((summary.put_call_ratio - 0.912).abs() < 0.01);

    // Call Wall must be at 100,000 (4,000 Call OI)
    assert_eq!(summary.call_wall_strike, PriceTicks(10000000));

    // Put Wall must be at 90,000 (3,500 Put OI)
    assert_eq!(summary.put_wall_strike, PriceTicks(9000000));

    // Max Pain should settle near middle (95,000) where neither 90k Puts nor 100k Calls can cash in
    assert_eq!(summary.max_pain_strike, PriceTicks(9500000));
}

#[test]
fn test_options_trade_ingestion_and_recent_activity() {
    let mut engine = OptionsAnalyticsEngine::new();

    let trade = OptionsTradeEvent {
        event_id: "opt-trade-1".into(),
        contract_symbol: "BTC-29MAR26-95000-C".into(),
        underlying_asset: "BTC".into(),
        option_type: OptionType::Call,
        strike_ticks: PriceTicks(9500000),
        exchange_ts_us: 1700000000000000,
        premium_ticks: PriceTicks(25000),
        quantity_contracts: ScaledQuantity(150),
        notional_usd: 14_250_000,
        is_block_trade: true,
    };

    engine.on_trade(trade);

    assert_eq!(engine.recent_trades.len(), 1);
    let strike_data = engine.strikes.get(&PriceTicks(9500000)).unwrap();
    assert_eq!(strike_data.call_volume_24h, ScaledQuantity(150));
}

#[test]
fn test_black_scholes_pricing_and_put_call_parity() {
    let spot = 95000.0;
    let strike = 95000.0;
    let t_years = 0.25; // 3 months
    let rate = 0.04;    // 4% risk-free rate
    let sigma = 0.55;   // 55% IV

    let call_price = black_scholes_call(spot, strike, t_years, rate, sigma);
    let put_price = black_scholes_put(spot, strike, t_years, rate, sigma);

    // Put-Call Parity: C - P = S - K * exp(-r * T)
    let discount = (-rate * t_years).exp();
    let parity_diff = (call_price - put_price) - (spot - strike * discount);
    assert!(parity_diff.abs() < 1e-3, "Parity violated: diff = {}", parity_diff);

    // Call and Put prices must be positive
    assert!(call_price > 0.0);
    assert!(put_price > 0.0);
}

#[test]
fn test_greeks_analytical_boundaries() {
    let spot = 95000.0;
    let strike = 95000.0;
    let t_years = 0.10;
    let rate = 0.0;
    let sigma = 0.50;

    let call_greeks = calculate_greeks(spot, strike, t_years, rate, sigma, true);
    let put_greeks = calculate_greeks(spot, strike, t_years, rate, sigma, false);

    // ATM Call Delta should be approximately 0.50
    assert!((call_greeks.delta - 0.50).abs() < 0.05);
    // ATM Put Delta should be approximately -0.50
    assert!((put_greeks.delta - (-0.50)).abs() < 0.05);

    // Delta difference must equal 1.0 (since rate = 0)
    assert!((call_greeks.delta - put_greeks.delta - 1.0).abs() < 1e-4);

    // Gamma must be strictly positive and equal for call and put
    assert!(call_greeks.gamma > 0.0);
    assert!((call_greeks.gamma - put_greeks.gamma).abs() < 1e-6);

    // Vega must be positive and equal for call and put
    assert!(call_greeks.vega > 0.0);
    assert!((call_greeks.vega - put_greeks.vega).abs() < 1e-6);

    // Theta must be negative (time decay)
    assert!(call_greeks.theta < 0.0);
    assert!(put_greeks.theta < 0.0);
}

#[test]
fn test_solve_implied_volatility_inversion() {
    let spot = 92000.0;
    let strike = 95000.0;
    let t_years = 0.15;
    let rate = 0.03;
    let true_sigma = 0.62;

    let call_target = black_scholes_call(spot, strike, t_years, rate, true_sigma);
    let recovered_sigma = solve_implied_volatility(call_target, spot, strike, t_years, rate, true);

    assert!(
        (recovered_sigma - true_sigma).abs() < 1e-3,
        "Failed to invert IV: true={}, recovered={}",
        true_sigma,
        recovered_sigma
    );

    let put_target = black_scholes_put(spot, strike, t_years, rate, true_sigma);
    let recovered_put_sigma = solve_implied_volatility(put_target, spot, strike, t_years, rate, false);

    assert!(
        (recovered_put_sigma - true_sigma).abs() < 1e-3,
        "Failed to invert Put IV: true={}, recovered={}",
        true_sigma,
        recovered_put_sigma
    );
}

#[test]
fn test_options_market_summary_with_greeks_and_smile() {
    let mut engine = OptionsAnalyticsEngine::new();

    engine.set_strike_data(
        PriceTicks(900000),
        ScaledQuantity(1000),
        ScaledQuantity(3000),
        ScaledQuantity(50),
        ScaledQuantity(120),
    );
    engine.set_strike_data(
        PriceTicks(950000),
        ScaledQuantity(2500),
        ScaledQuantity(2000),
        ScaledQuantity(150),
        ScaledQuantity(100),
    );

    let summary = engine.compute_summary_with_spot("BTC", PriceTicks(950000), 0.10, 0.03);

    assert_eq!(summary.strikes.len(), 2);
    assert_eq!(summary.strike_greeks.len(), 2);
    assert!(summary.atm_iv > 0.0);
    assert!(summary.strike_greeks[0].call_greeks.delta > 0.0);
    assert!(summary.strike_greeks[0].put_greeks.delta < 0.0);
}

#[test]
fn test_black_scholes_zero_strike_and_spot_guards() {
    let c0 = black_scholes_call(95000.0, 0.0, 0.25, 0.03, 0.55);
    let p0 = black_scholes_put(95000.0, 0.0, 0.25, 0.03, 0.55);
    let c_neg = black_scholes_call(0.0, 95000.0, 0.25, 0.03, 0.55);
    let p_neg = black_scholes_put(0.0, 95000.0, 0.25, 0.03, 0.55);

    assert!(c0.is_finite() && c0 == 95000.0);
    assert!(p0.is_finite() && p0 == 0.0);
    assert!(c_neg.is_finite() && c_neg == 0.0);
    assert!(p_neg.is_finite() && p_neg == 95000.0);
}
