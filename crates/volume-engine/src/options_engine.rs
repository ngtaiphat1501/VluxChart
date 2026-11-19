//! DeepChart Options Analytics & Greeks Engine (P2 & P2.2)
//! Calculates Call/Put Open Interest distribution, Put/Call Ratio (PCR),
//! Key Resistance/Support Walls (Call Wall & Put Wall), Max Pain Strike,
//! and Black-Scholes Greeks (Delta, Gamma, Theta, Vega) & Implied Volatility (IV).

use data_contract::{
    OptionGreeks, OptionType, OptionsMarketSummary, OptionsTradeEvent, PriceTicks,
    ScaledQuantity, StrikeGreeksInfo, StrikeOpenInterest,
};
use std::collections::BTreeMap;
use std::f64::consts::PI;

pub fn normal_pdf(x: f64) -> f64 {
    (-0.5 * x * x).exp() / (2.0 * PI).sqrt()
}

pub fn normal_cdf(x: f64) -> f64 {
    if x.is_nan() {
        return 0.5;
    }
    // Abramowitz and Stegun 26.2.17 polynomial approximation (error < 7.5e-8)
    let p = 0.2316419;
    let b1 = 0.319381530;
    let b2 = -0.356563782;
    let b3 = 1.781477937;
    let b4 = -1.821255978;
    let b5 = 1.330274429;

    let abs_x = x.abs();
    let k = 1.0 / (1.0 + p * abs_x);
    let phi = normal_pdf(abs_x);
    let poly = k * (b1 + k * (b2 + k * (b3 + k * (b4 + k * b5))));
    let cdf = 1.0 - phi * poly;

    if x >= 0.0 {
        cdf
    } else {
        1.0 - cdf
    }
}

/// Computes Black-Scholes European Call price.
pub fn black_scholes_call(spot: f64, strike: f64, t_years: f64, rate: f64, sigma: f64) -> f64 {
    if t_years <= 0.0 {
        return (spot - strike).max(0.0);
    }
    let sqrt_t = t_years.sqrt();
    let sigma_adj = sigma.max(0.001);
    let d1 = ((spot / strike).ln() + (rate + 0.5 * sigma_adj * sigma_adj) * t_years) / (sigma_adj * sqrt_t);
    let d2 = d1 - sigma_adj * sqrt_t;

    let disc = (-rate * t_years).exp();
    spot * normal_cdf(d1) - strike * disc * normal_cdf(d2)
}

/// Computes Black-Scholes European Put price.
pub fn black_scholes_put(spot: f64, strike: f64, t_years: f64, rate: f64, sigma: f64) -> f64 {
    if t_years <= 0.0 {
        return (strike - spot).max(0.0);
    }
    let sqrt_t = t_years.sqrt();
    let sigma_adj = sigma.max(0.001);
    let d1 = ((spot / strike).ln() + (rate + 0.5 * sigma_adj * sigma_adj) * t_years) / (sigma_adj * sqrt_t);
    let d2 = d1 - sigma_adj * sqrt_t;

    let disc = (-rate * t_years).exp();
    strike * disc * normal_cdf(-d2) - spot * normal_cdf(-d1)
}

/// Calculates Greeks for Call or Put option.
pub fn calculate_greeks(
    spot: f64,
    strike: f64,
    t_years: f64,
    rate: f64,
    sigma: f64,
    is_call: bool,
) -> OptionGreeks {
    if t_years <= 0.0 || spot <= 0.0 || strike <= 0.0 {
        return OptionGreeks {
            delta: if is_call { if spot >= strike { 1.0 } else { 0.0 } } else { if spot <= strike { -1.0 } else { 0.0 } },
            gamma: 0.0,
            theta: 0.0,
            vega: 0.0,
            iv: sigma,
        };
    }

    let sqrt_t = t_years.sqrt();
    let sigma_adj = sigma.max(0.001);
    let d1 = ((spot / strike).ln() + (rate + 0.5 * sigma_adj * sigma_adj) * t_years) / (sigma_adj * sqrt_t);
    let d2 = d1 - sigma_adj * sqrt_t;

    let nd1 = normal_cdf(d1);
    let npd1 = normal_pdf(d1);
    let disc = (-rate * t_years).exp();

    // Delta
    let delta = if is_call {
        nd1
    } else {
        nd1 - 1.0
    };

    // Gamma (same for Call and Put)
    let gamma = npd1 / (spot * sigma_adj * sqrt_t);

    // Vega per 1% change in vol
    let vega = (spot * sqrt_t * npd1) / 100.0;

    // Theta per day (1 / 365.25)
    let theta_annual = if is_call {
        -((spot * npd1 * sigma_adj) / (2.0 * sqrt_t)) - rate * strike * disc * normal_cdf(d2)
    } else {
        -((spot * npd1 * sigma_adj) / (2.0 * sqrt_t)) + rate * strike * disc * normal_cdf(-d2)
    };
    let theta_day = theta_annual / 365.25;

    OptionGreeks {
        delta,
        gamma,
        theta: theta_day,
        vega,
        iv: sigma,
    }
}

/// Solves for Implied Volatility using Newton-Raphson with bisection fallback.
pub fn solve_implied_volatility(
    target_price: f64,
    spot: f64,
    strike: f64,
    t_years: f64,
    rate: f64,
    is_call: bool,
) -> f64 {
    if t_years <= 0.0 || spot <= 0.0 || strike <= 0.0 {
        return 0.50;
    }

    let disc = (-rate * t_years).exp();
    let intrinsic = if is_call {
        (spot - strike * disc).max(0.0)
    } else {
        (strike * disc - spot).max(0.0)
    };

    if target_price <= intrinsic + 1e-6 {
        return 0.01;
    }

    // Initial guess
    let mut sigma = 0.50;

    for _ in 0..25 {
        let price = if is_call {
            black_scholes_call(spot, strike, t_years, rate, sigma)
        } else {
            black_scholes_put(spot, strike, t_years, rate, sigma)
        };

        let diff = price - target_price;
        if diff.abs() < 1e-4 {
            return sigma.clamp(0.01, 5.0);
        }

        let sqrt_t = t_years.sqrt();
        let d1 = ((spot / strike).ln() + (rate + 0.5 * sigma * sigma) * t_years) / (sigma * sqrt_t);
        let vega = spot * sqrt_t * normal_pdf(d1);

        if vega > 1e-5 {
            let next_sigma = sigma - diff / vega;
            if next_sigma > 0.01 && next_sigma < 5.0 {
                sigma = next_sigma;
                continue;
            }
        }
        break;
    }

    // Bisection fallback
    let mut low = 0.01;
    let mut high = 5.0;
    for _ in 0..25 {
        let mid = (low + high) * 0.5;
        let p_mid = if is_call {
            black_scholes_call(spot, strike, t_years, rate, mid)
        } else {
            black_scholes_put(spot, strike, t_years, rate, mid)
        };

        if (p_mid - target_price).abs() < 1e-4 {
            return mid;
        }

        if p_mid < target_price {
            low = mid;
        } else {
            high = mid;
        }
    }

    ((low + high) * 0.5).clamp(0.01, 5.0)
}

#[derive(Debug, Clone, Default)]
pub struct OptionsAnalyticsEngine {
    pub strikes: BTreeMap<PriceTicks, StrikeOpenInterest>,
    pub recent_trades: Vec<OptionsTradeEvent>,
    pub strike_last_premiums: BTreeMap<(PriceTicks, OptionType), f64>,
}

impl OptionsAnalyticsEngine {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records or updates the Open Interest and 24h volume for a specific strike.
    pub fn set_strike_data(
        &mut self,
        strike: PriceTicks,
        call_oi: ScaledQuantity,
        put_oi: ScaledQuantity,
        call_vol: ScaledQuantity,
        put_vol: ScaledQuantity,
    ) {
        self.strikes.insert(
            strike,
            StrikeOpenInterest {
                strike_ticks: strike,
                call_open_interest: call_oi,
                put_open_interest: put_oi,
                call_volume_24h: call_vol,
                put_volume_24h: put_vol,
            },
        );
    }

    /// Ingests an options trade event and tracks recent block trades.
    pub fn on_trade(&mut self, trade: OptionsTradeEvent) {
        let entry = self
            .strikes
            .entry(trade.strike_ticks)
            .or_insert_with(|| StrikeOpenInterest {
                strike_ticks: trade.strike_ticks,
                call_open_interest: ScaledQuantity(0),
                put_open_interest: ScaledQuantity(0),
                call_volume_24h: ScaledQuantity(0),
                put_volume_24h: ScaledQuantity(0),
            });

        match trade.option_type {
            OptionType::Call => {
                entry.call_volume_24h = ScaledQuantity(entry.call_volume_24h.0 + trade.quantity_contracts.0);
            }
            OptionType::Put => {
                entry.put_volume_24h = ScaledQuantity(entry.put_volume_24h.0 + trade.quantity_contracts.0);
            }
        }

        // Record last premium price in USD/ticks
        let prem_f64 = trade.premium_ticks.0 as f64 * 0.10; // default tick
        self.strike_last_premiums.insert((trade.strike_ticks, trade.option_type), prem_f64);

        if self.recent_trades.len() >= 100 {
            self.recent_trades.remove(0);
        }
        self.recent_trades.push(trade);
    }

    /// Computes full market summary: PCR, Call Wall, Put Wall, Max Pain, and Greeks.
    pub fn compute_summary(&self, underlying_asset: &str) -> OptionsMarketSummary {
        // Fallback spot price: mid-point of call wall and put wall or first strike
        let spot_ticks = if let Some((&k, _)) = self.strikes.iter().next() {
            k
        } else {
            PriceTicks(900000)
        };
        self.compute_summary_with_spot(underlying_asset, spot_ticks, 0.08, 0.03) // ~30 days, 3% risk-free rate
    }

    /// Computes full market summary with explicit spot price, time to expiry, and risk-free rate.
    pub fn compute_summary_with_spot(
        &self,
        underlying_asset: &str,
        spot_ticks: PriceTicks,
        t_years: f64,
        rate: f64,
    ) -> OptionsMarketSummary {
        let mut total_call_oi: u64 = 0;
        let mut total_put_oi: u64 = 0;
        let mut max_call_oi: u64 = 0;
        let mut max_put_oi: u64 = 0;
        let mut call_wall_strike = PriceTicks(0);
        let mut put_wall_strike = PriceTicks(0);

        let mut strikes_vec = Vec::new();

        for (&strike, data) in &self.strikes {
            total_call_oi += data.call_open_interest.0;
            total_put_oi += data.put_open_interest.0;

            if data.call_open_interest.0 > max_call_oi {
                max_call_oi = data.call_open_interest.0;
                call_wall_strike = strike;
            }

            if data.put_open_interest.0 > max_put_oi {
                max_put_oi = data.put_open_interest.0;
                put_wall_strike = strike;
            }

            strikes_vec.push(data.clone());
        }

        let put_call_ratio = if total_call_oi > 0 {
            (total_put_oi as f64) / (total_call_oi as f64)
        } else {
            1.0
        };

        // Compute Max Pain Strike
        let mut min_total_payout = u128::MAX;
        let mut max_pain_strike = call_wall_strike; // fallback

        for (&eval_strike, _) in &self.strikes {
            let mut total_payout_at_strike: u128 = 0;

            for (&k_strike, k_data) in &self.strikes {
                if eval_strike.0 > k_strike.0 {
                    let diff = (eval_strike.0 - k_strike.0) as u128;
                    total_payout_at_strike += diff * (k_data.call_open_interest.0 as u128);
                }
                if eval_strike.0 < k_strike.0 {
                    let diff = (k_strike.0 - eval_strike.0) as u128;
                    total_payout_at_strike += diff * (k_data.put_open_interest.0 as u128);
                }
            }

            if total_payout_at_strike < min_total_payout {
                min_total_payout = total_payout_at_strike;
                max_pain_strike = eval_strike;
            }
        }

        // Compute Greeks and Volatility Smile across all strikes
        let spot_f64 = (spot_ticks.0 as f64) * 0.10; // normalized to price units
        let mut strike_greeks = Vec::new();
        let mut net_delta = 0.0;
        let mut net_gamma = 0.0;

        let base_atm_iv = 0.55; // 55% base ATM volatility for crypto

        for (&strike, data) in &self.strikes {
            let strike_f64 = (strike.0 as f64) * 0.10;
            let log_moneyness = (strike_f64 / spot_f64.max(1.0)).ln();
            
            // Volatility smile: parabolic curvature sigma(K) = sigma_0 + 0.15 * log_m^2
            let strike_iv = (base_atm_iv + 0.18 * log_moneyness * log_moneyness).clamp(0.20, 2.50);

            let call_greeks = calculate_greeks(spot_f64, strike_f64, t_years, rate, strike_iv, true);
            let put_greeks = calculate_greeks(spot_f64, strike_f64, t_years, rate, strike_iv, false);

            let call_contracts = (data.call_open_interest.0 as f64) / 1000.0;
            let put_contracts = (data.put_open_interest.0 as f64) / 1000.0;

            net_delta += (call_greeks.delta * call_contracts) + (put_greeks.delta * put_contracts);
            net_gamma += (call_greeks.gamma * call_contracts) + (put_greeks.gamma * put_contracts);

            strike_greeks.push(StrikeGreeksInfo {
                strike_ticks: strike,
                call_greeks,
                put_greeks,
                iv_smile: strike_iv,
                call_oi: data.call_open_interest,
                put_oi: data.put_open_interest,
            });
        }

        OptionsMarketSummary {
            underlying_asset: underlying_asset.into(),
            total_call_oi: ScaledQuantity(total_call_oi),
            total_put_oi: ScaledQuantity(total_put_oi),
            put_call_ratio,
            call_wall_strike,
            put_wall_strike,
            max_pain_strike,
            atm_iv: base_atm_iv,
            net_delta,
            net_gamma,
            strikes: strikes_vec,
            strike_greeks,
        }
    }
}
