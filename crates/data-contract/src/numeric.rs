//! DeepChart Exact Numeric Representation
//! Prohibits binary float arithmetic for financial volume and tick calculations.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Exact price representation stored as integer ticks.
/// e.g. If tick_size = 0.10, price 71850.50 is stored as 718505 ticks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
pub struct PriceTicks(pub i64);

impl PriceTicks {
    pub const ZERO: Self = Self(0);

    #[inline]
    pub fn from_f64(price: f64, tick_size: f64) -> Self {
        debug_assert!(tick_size > 0.0, "tick_size must be positive");
        let ticks = (price / tick_size).round() as i64;
        Self(ticks)
    }

    #[inline]
    pub fn to_f64(self, tick_size: f64) -> f64 {
        (self.0 as f64) * tick_size
    }

    #[inline]
    pub fn ticks(self) -> i64 {
        self.0
    }
}

impl fmt::Display for PriceTicks {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Exact quantity representation stored as an integer scaled by quantity_scale.
/// e.g. If scale = 1000 (0.001 BTC step), 0.050 BTC is stored as 50 units.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
pub struct ScaledQuantity(pub u64);

impl ScaledQuantity {
    pub const ZERO: Self = Self(0);

    #[inline]
    pub fn from_f64(qty: f64, scale: u64) -> Self {
        debug_assert!(scale > 0, "scale must be positive");
        let units = (qty * (scale as f64)).round() as u64;
        Self(units)
    }

    #[inline]
    pub fn to_f64(self, scale: u64) -> f64 {
        debug_assert!(scale > 0, "scale must be positive");
        (self.0 as f64) / (scale as f64)
    }

    #[inline]
    pub fn units(self) -> u64 {
        self.0
    }
}

impl std::ops::Add for ScaledQuantity {
    type Output = Self;
    #[inline]
    fn add(self, rhs: Self) -> Self::Output {
        Self(self.0 + rhs.0)
    }
}

impl std::ops::AddAssign for ScaledQuantity {
    #[inline]
    fn add_assign(&mut self, rhs: Self) {
        self.0 += rhs.0;
    }
}

impl fmt::Display for ScaledQuantity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_price_ticks_roundtrip() {
        let tick_size = 0.10;
        let price = 71850.50;
        let ticks = PriceTicks::from_f64(price, tick_size);
        assert_eq!(ticks.ticks(), 718505);
        let reconstructed = ticks.to_f64(tick_size);
        assert!((reconstructed - price).abs() < 1e-6);
    }

    #[test]
    fn test_scaled_quantity_arithmetic() {
        let scale = 1000;
        let q1 = ScaledQuantity::from_f64(1.234, scale);
        let q2 = ScaledQuantity::from_f64(0.006, scale);
        assert_eq!(q1.units(), 1234);
        assert_eq!(q2.units(), 6);
        let q3 = q1 + q2;
        assert_eq!(q3.units(), 1240);
        assert_eq!(q3.to_f64(scale), 1.240);
    }
}
