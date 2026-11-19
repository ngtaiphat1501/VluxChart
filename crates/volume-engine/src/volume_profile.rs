//! DeepChart Session Volume Profile Engine
//! Aggregates trade footprint matrices across bars into a unified session volume profile with POC and Value Area.

use data_contract::{OHLCVBar, PriceTicks, ScaledQuantity};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VolumeProfileBin {
    pub price_ticks: PriceTicks,
    pub buy_units: ScaledQuantity,
    pub sell_units: ScaledQuantity,
    pub total_units: ScaledQuantity,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionVolumeProfile {
    pub bins: Vec<VolumeProfileBin>,
    pub poc_ticks: PriceTicks,
    pub vah_ticks: PriceTicks,
    pub val_ticks: PriceTicks,
    pub total_volume: ScaledQuantity,
}

/// Computes composite session volume profile across multiple bars.
pub fn compute_session_volume_profile(
    bars: &[OHLCVBar],
    value_area_pct: f64,
) -> Option<SessionVolumeProfile> {
    if bars.is_empty() {
        return None;
    }

    let mut price_bins: BTreeMap<PriceTicks, (u64, u64)> = BTreeMap::new(); // price -> (buy, sell)
    let mut total_vol = 0u64;

    for bar in bars {
        for (&price, cell) in &bar.footprint {
            let entry = price_bins.entry(price).or_insert((0, 0));
            entry.0 += cell.buy_units.0;
            entry.1 += cell.sell_units.0;
            total_vol += cell.total_units.0;
        }
    }

    if price_bins.is_empty() || total_vol == 0 {
        return None;
    }

    // Identify POC (Price with max total volume)
    let mut max_vol = 0u64;
    let mut poc_price = PriceTicks(0);
    let mut bins = Vec::with_capacity(price_bins.len());

    for (&price, &(buy, sell)) in &price_bins {
        let total = buy + sell;
        if total > max_vol {
            max_vol = total;
            poc_price = price;
        }
        bins.push(VolumeProfileBin {
            price_ticks: price,
            buy_units: ScaledQuantity(buy),
            sell_units: ScaledQuantity(sell),
            total_units: ScaledQuantity(total),
        });
    }

    // Compute Value Area enclosing value_area_pct (default 70%)
    let target_va_vol = (total_vol as f64 * value_area_pct).round() as u64;
    let prices: Vec<PriceTicks> = price_bins.keys().cloned().collect();
    let poc_idx = prices.iter().position(|&p| p == poc_price).unwrap_or(0);

    let mut low_idx = poc_idx;
    let mut high_idx = poc_idx;
    let mut current_va_vol = price_bins[&poc_price].0 + price_bins[&poc_price].1;

    while current_va_vol < target_va_vol && (low_idx > 0 || high_idx < prices.len() - 1) {
        let vol_above = if high_idx + 1 < prices.len() {
            let (b, s) = price_bins[&prices[high_idx + 1]];
            b + s
        } else {
            0
        };

        let vol_below = if low_idx > 0 {
            let (b, s) = price_bins[&prices[low_idx - 1]];
            b + s
        } else {
            0
        };

        if vol_above >= vol_below && high_idx + 1 < prices.len() {
            high_idx += 1;
            current_va_vol += vol_above;
        } else if low_idx > 0 {
            low_idx -= 1;
            current_va_vol += vol_below;
        } else if high_idx + 1 < prices.len() {
            high_idx += 1;
            current_va_vol += vol_above;
        } else {
            break;
        }
    }

    Some(SessionVolumeProfile {
        bins,
        poc_ticks: poc_price,
        vah_ticks: prices[high_idx],
        val_ticks: prices[low_idx],
        total_volume: ScaledQuantity(total_vol),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use data_contract::{Aggressor, NormalizedTradeEvent};

    fn make_trade(price: i64, qty: u64, agg: Aggressor) -> NormalizedTradeEvent {
        NormalizedTradeEvent::new(
            "TEST:BTC",
            "TEST",
            "feed",
            "evt",
            1000,
            1050,
            PriceTicks(price),
            ScaledQuantity(qty),
            100_000_000,
            "BASE",
            agg,
            data_contract::AggressorOrigin::ExchangeDirect,
        )
    }

    #[test]
    fn test_session_volume_profile_aggregation() {
        let mut bar1 = OHLCVBar::new(1000, 60_000_000, &make_trade(100, 50, Aggressor::Buy));
        bar1.apply_trade(&make_trade(101, 100, Aggressor::Buy));
        bar1.apply_trade(&make_trade(102, 30, Aggressor::Sell));

        let mut bar2 = OHLCVBar::new(2000, 60_000_000, &make_trade(101, 200, Aggressor::Sell));
        bar2.apply_trade(&make_trade(103, 40, Aggressor::Buy));

        let profile = compute_session_volume_profile(&[bar1, bar2], 0.70).expect("Should compute");

        assert_eq!(profile.total_volume.0, 420);
        // At 101: 100 + 200 = 300 (highest volume -> POC)
        assert_eq!(profile.poc_ticks, PriceTicks(101));
        assert!(profile.vah_ticks >= PriceTicks(101));
        assert!(profile.val_ticks <= PriceTicks(101));
    }
}
