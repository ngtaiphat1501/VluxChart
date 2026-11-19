//! DeepChart Volume Weighted Average Price (VWAP) & Delta Divergence Engine
//! Computes session/anchor VWAP, standard deviation bands (1σ, 2σ), and cumulative volume delta divergence.

use data_contract::{OHLCVBar, PriceTicks, ScaledQuantity};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct VwapBand {
    pub vwap_ticks: PriceTicks,
    pub upper_1sigma_ticks: PriceTicks,
    pub lower_1sigma_ticks: PriceTicks,
    pub upper_2sigma_ticks: PriceTicks,
    pub lower_2sigma_ticks: PriceTicks,
    pub total_volume: ScaledQuantity,
}

/// O(1) single-pass VWAP and Standard Deviation Calculator
#[derive(Debug, Default, Clone)]
pub struct VwapTracker {
    cumulative_pv: u128,     // sum(price * vol)
    cumulative_vol: u128,    // sum(vol)
    cumulative_p2v: u128,    // sum(price^2 * vol)
}

impl VwapTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reset(&mut self) {
        self.cumulative_pv = 0;
        self.cumulative_vol = 0;
        self.cumulative_p2v = 0;
    }

    pub fn update(&mut self, price: PriceTicks, volume: ScaledQuantity) {
        let p = price.0 as u128;
        let v = volume.0 as u128;
        if v == 0 {
            return;
        }

        self.cumulative_pv += p * v;
        self.cumulative_vol += v;
        self.cumulative_p2v += p * p * v;
    }

    pub fn update_from_bar(&mut self, bar: &OHLCVBar) {
        for (&price, cell) in &bar.footprint {
            self.update(price, cell.total_units);
        }
    }

    pub fn current_bands(&self) -> Option<VwapBand> {
        if self.cumulative_vol == 0 {
            return None;
        }

        let vwap_f64 = (self.cumulative_pv as f64) / (self.cumulative_vol as f64);
        let vwap_ticks = vwap_f64.round() as i64;

        // Variance = (sum(P^2 * V) / V) - (VWAP)^2
        let mean_p2 = (self.cumulative_p2v as f64) / (self.cumulative_vol as f64);
        let variance = (mean_p2 - (vwap_f64 * vwap_f64)).max(0.0);
        let std_dev = variance.sqrt().round() as i64;

        Some(VwapBand {
            vwap_ticks: PriceTicks(vwap_ticks),
            upper_1sigma_ticks: PriceTicks(vwap_ticks + std_dev),
            lower_1sigma_ticks: PriceTicks(vwap_ticks - std_dev),
            upper_2sigma_ticks: PriceTicks(vwap_ticks + (std_dev * 2)),
            lower_2sigma_ticks: PriceTicks(vwap_ticks - (std_dev * 2)),
            total_volume: ScaledQuantity(self.cumulative_vol as u64),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DivergenceType {
    BullishDivergence,
    BearishDivergence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeltaDivergence {
    pub bar_start_us: i64,
    pub divergence_type: DivergenceType,
    pub price_ticks: PriceTicks,
    pub cvd_delta: i64,
    pub description: String,
}

/// Detects regular Delta Divergences between price extremes and Cumulative Volume Delta (CVD).
pub fn detect_delta_divergence(
    bars: &[OHLCVBar],
    cvd_at_bars: &[i64],
    lookback: usize,
) -> Vec<DeltaDivergence> {
    let mut divergences = Vec::new();
    let n = bars.len();
    if n < 3 || cvd_at_bars.len() != n {
        return divergences;
    }

    let start_idx = if n > lookback { n - lookback } else { 1 };

    for i in start_idx..n {
        let curr_bar = &bars[i];
        let prev_bar = &bars[i - 1];
        let curr_cvd = cvd_at_bars[i];
        let prev_cvd = cvd_at_bars[i - 1];

        // 1. Bullish Divergence: Price creates Lower Low, but CVD creates Higher Low
        if curr_bar.low_ticks < prev_bar.low_ticks && curr_cvd > prev_cvd {
            divergences.push(DeltaDivergence {
                bar_start_us: curr_bar.bar_start_us,
                divergence_type: DivergenceType::BullishDivergence,
                price_ticks: curr_bar.low_ticks,
                cvd_delta: curr_cvd - prev_cvd,
                description: format!(
                    "Bullish Divergence: Price Lower Low ({} < {}) with CVD Higher Low (Delta: +{})",
                    curr_bar.low_ticks.0, prev_bar.low_ticks.0, curr_cvd - prev_cvd
                ),
            });
        }

        // 2. Bearish Divergence: Price creates Higher High, but CVD creates Lower High
        if curr_bar.high_ticks > prev_bar.high_ticks && curr_cvd < prev_cvd {
            divergences.push(DeltaDivergence {
                bar_start_us: curr_bar.bar_start_us,
                divergence_type: DivergenceType::BearishDivergence,
                price_ticks: curr_bar.high_ticks,
                cvd_delta: curr_cvd - prev_cvd,
                description: format!(
                    "Bearish Divergence: Price Higher High ({} > {}) with CVD Lower High (Delta: {})",
                    curr_bar.high_ticks.0, prev_bar.high_ticks.0, curr_cvd - prev_cvd
                ),
            });
        }
    }

    divergences
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vwap_and_standard_deviation_bands() {
        let mut tracker = VwapTracker::new();

        // 100 units at 1000, 100 units at 2000
        // Expected VWAP = 1500
        // Variance = ((1000^2 * 100 + 2000^2 * 100) / 200) - 1500^2 = 250000
        // StdDev = sqrt(250000) = 500
        tracker.update(PriceTicks(1000), ScaledQuantity(100));
        tracker.update(PriceTicks(2000), ScaledQuantity(100));

        let bands = tracker.current_bands().expect("Should compute bands");
        assert_eq!(bands.vwap_ticks, PriceTicks(1500));
        assert_eq!(bands.upper_1sigma_ticks, PriceTicks(2000));
        assert_eq!(bands.lower_1sigma_ticks, PriceTicks(1000));
        assert_eq!(bands.upper_2sigma_ticks, PriceTicks(2500));
        assert_eq!(bands.lower_2sigma_ticks, PriceTicks(500));
    }
}
