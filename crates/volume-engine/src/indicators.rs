//! DeepChart Indicators: Point of Control (POC), Value Area, Footprint Imbalances & CVD

use data_contract::{OHLCVBar, PriceTicks, ScaledQuantity};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PocInfo {
    pub price_ticks: PriceTicks,
    pub volume_units: ScaledQuantity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValueArea {
    pub poc_ticks: PriceTicks,
    pub vah_ticks: PriceTicks,
    pub val_ticks: PriceTicks,
    pub volume_covered: ScaledQuantity,
    pub total_bar_volume: ScaledQuantity,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagonalImbalance {
    pub price_ticks: PriceTicks,
    pub is_buy_imbalance: bool,
    pub is_sell_imbalance: bool,
    pub current_units: ScaledQuantity,
    pub diagonal_units: ScaledQuantity,
    pub ratio_percent: u32,
}

/// Computes the Point of Control (POC) — the price tick with the highest traded volume.
pub fn compute_poc(bar: &OHLCVBar) -> Option<PocInfo> {
    if bar.footprint.is_empty() {
        return None;
    }

    let mut max_price = None;
    let mut max_vol = ScaledQuantity::ZERO;

    for (&price, cell) in &bar.footprint {
        if cell.total_units > max_vol {
            max_vol = cell.total_units;
            max_price = Some(price);
        }
    }

    max_price.map(|price_ticks| PocInfo {
        price_ticks,
        volume_units: max_vol,
    })
}

/// Computes the Value Area (VAH and VAL) enclosing target percentage (e.g., 70%) of total volume around the POC.
pub fn compute_value_area(bar: &OHLCVBar, target_pct: f64) -> Option<ValueArea> {
    let poc = compute_poc(bar)?;
    let total_vol = bar.total_units.0;
    if total_vol == 0 {
        return None;
    }

    let target_volume = (total_vol as f64 * target_pct).round() as u64;

    // Collect sorted price levels
    let prices: Vec<PriceTicks> = bar.footprint.keys().cloned().collect();
    let poc_idx = prices.iter().position(|&p| p == poc.price_ticks)?;

    let mut low_idx = poc_idx;
    let mut high_idx = poc_idx;
    let mut current_volume = bar.footprint[&poc.price_ticks].total_units.0;

    while current_volume < target_volume && (low_idx > 0 || high_idx < prices.len() - 1) {
        let vol_above = if high_idx + 1 < prices.len() {
            bar.footprint[&prices[high_idx + 1]].total_units.0
        } else {
            0
        };

        let vol_below = if low_idx > 0 {
            bar.footprint[&prices[low_idx - 1]].total_units.0
        } else {
            0
        };

        if vol_above >= vol_below && high_idx + 1 < prices.len() {
            high_idx += 1;
            current_volume += vol_above;
        } else if low_idx > 0 {
            low_idx -= 1;
            current_volume += vol_below;
        } else if high_idx + 1 < prices.len() {
            high_idx += 1;
            current_volume += vol_above;
        } else {
            break;
        }
    }

    Some(ValueArea {
        poc_ticks: poc.price_ticks,
        vah_ticks: prices[high_idx],
        val_ticks: prices[low_idx],
        volume_covered: ScaledQuantity(current_volume),
        total_bar_volume: bar.total_units,
    })
}

/// Computes diagonal bid-ask imbalances across footprint price steps.
/// An imbalance occurs when:
/// Buy volume at price P >= ratio * Sell volume at price (P - 1)
/// OR Sell volume at price (P - 1) >= ratio * Buy volume at price P
pub fn compute_diagonal_imbalances(
    bar: &OHLCVBar,
    imbalance_ratio: f64,
    min_volume_units: u64,
) -> Vec<DiagonalImbalance> {
    let mut imbalances = Vec::new();
    let prices: Vec<PriceTicks> = bar.footprint.keys().cloned().collect();
    if prices.len() < 2 {
        return imbalances;
    }

    for i in 1..prices.len() {
        let p_higher = prices[i];
        let p_lower = prices[i - 1];

        let cell_higher = &bar.footprint[&p_higher];
        let cell_lower = &bar.footprint[&p_lower];

        let buy_at_higher = cell_higher.buy_units.0;
        let sell_at_lower = cell_lower.sell_units.0;

        // Buy imbalance: aggressive buyers lifting offers at P_higher vs sellers hitting bids at P_lower
        if buy_at_higher >= min_volume_units {
            let denominator = if sell_at_lower == 0 { 1 } else { sell_at_lower };
            let ratio = (buy_at_higher as f64) / (denominator as f64);
            if ratio >= imbalance_ratio {
                imbalances.push(DiagonalImbalance {
                    price_ticks: p_higher,
                    is_buy_imbalance: true,
                    is_sell_imbalance: false,
                    current_units: ScaledQuantity(buy_at_higher),
                    diagonal_units: ScaledQuantity(sell_at_lower),
                    ratio_percent: (ratio * 100.0) as u32,
                });
            }
        }

        // Sell imbalance: aggressive sellers hitting bids at P_lower vs buyers lifting offers at P_higher
        if sell_at_lower >= min_volume_units {
            let denominator = if buy_at_higher == 0 { 1 } else { buy_at_higher };
            let ratio = (sell_at_lower as f64) / (denominator as f64);
            if ratio >= imbalance_ratio {
                imbalances.push(DiagonalImbalance {
                    price_ticks: p_lower,
                    is_buy_imbalance: false,
                    is_sell_imbalance: true,
                    current_units: ScaledQuantity(sell_at_lower),
                    diagonal_units: ScaledQuantity(buy_at_higher),
                    ratio_percent: (ratio * 100.0) as u32,
                });
            }
        }
    }

    imbalances
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImbalanceSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StackedImbalance {
    pub side: ImbalanceSide,
    pub start_price_ticks: PriceTicks,
    pub end_price_ticks: PriceTicks,
    pub levels_count: usize,
    pub total_imbalance_volume: ScaledQuantity,
}

/// Identifies stacked imbalances (>= `min_consecutive` consecutive price levels of diagonal buy or sell imbalances).
pub fn compute_stacked_imbalances(
    bar: &OHLCVBar,
    imbalance_ratio: f64,
    min_consecutive: usize,
    min_volume_units: u64,
) -> Vec<StackedImbalance> {
    let diagonal_imbalances = compute_diagonal_imbalances(bar, imbalance_ratio, min_volume_units);
    let mut stacked = Vec::new();

    let prices: Vec<PriceTicks> = bar.footprint.keys().cloned().collect();
    if prices.len() < min_consecutive {
        return stacked;
    }

    // Check consecutive Buy Imbalances
    let mut current_buy_stack: Vec<&DiagonalImbalance> = Vec::new();
    for p in &prices {
        if let Some(imb) = diagonal_imbalances.iter().find(|i| i.is_buy_imbalance && i.price_ticks == *p) {
            current_buy_stack.push(imb);
        } else {
            if current_buy_stack.len() >= min_consecutive {
                let start_price = current_buy_stack.first().unwrap().price_ticks;
                let end_price = current_buy_stack.last().unwrap().price_ticks;
                let total_vol: u64 = current_buy_stack.iter().map(|i| i.current_units.0).sum();
                stacked.push(StackedImbalance {
                    side: ImbalanceSide::Buy,
                    start_price_ticks: start_price,
                    end_price_ticks: end_price,
                    levels_count: current_buy_stack.len(),
                    total_imbalance_volume: ScaledQuantity(total_vol),
                });
            }
            current_buy_stack.clear();
        }
    }
    if current_buy_stack.len() >= min_consecutive {
        let start_price = current_buy_stack.first().unwrap().price_ticks;
        let end_price = current_buy_stack.last().unwrap().price_ticks;
        let total_vol: u64 = current_buy_stack.iter().map(|i| i.current_units.0).sum();
        stacked.push(StackedImbalance {
            side: ImbalanceSide::Buy,
            start_price_ticks: start_price,
            end_price_ticks: end_price,
            levels_count: current_buy_stack.len(),
            total_imbalance_volume: ScaledQuantity(total_vol),
        });
    }

    // Check consecutive Sell Imbalances
    let mut current_sell_stack: Vec<&DiagonalImbalance> = Vec::new();
    for p in &prices {
        if let Some(imb) = diagonal_imbalances.iter().find(|i| i.is_sell_imbalance && i.price_ticks == *p) {
            current_sell_stack.push(imb);
        } else {
            if current_sell_stack.len() >= min_consecutive {
                let start_price = current_sell_stack.first().unwrap().price_ticks;
                let end_price = current_sell_stack.last().unwrap().price_ticks;
                let total_vol: u64 = current_sell_stack.iter().map(|i| i.current_units.0).sum();
                stacked.push(StackedImbalance {
                    side: ImbalanceSide::Sell,
                    start_price_ticks: start_price,
                    end_price_ticks: end_price,
                    levels_count: current_sell_stack.len(),
                    total_imbalance_volume: ScaledQuantity(total_vol),
                });
            }
            current_sell_stack.clear();
        }
    }
    if current_sell_stack.len() >= min_consecutive {
        let start_price = current_sell_stack.first().unwrap().price_ticks;
        let end_price = current_sell_stack.last().unwrap().price_ticks;
        let total_vol: u64 = current_sell_stack.iter().map(|i| i.current_units.0).sum();
        stacked.push(StackedImbalance {
            side: ImbalanceSide::Sell,
            start_price_ticks: start_price,
            end_price_ticks: end_price,
            levels_count: current_sell_stack.len(),
            total_imbalance_volume: ScaledQuantity(total_vol),
        });
    }

    stacked
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderFlowSignalType {
    BullishAbsorption,
    BearishAbsorption,
    BuyingExhaustion,
    SellingExhaustion,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderFlowSignal {
    pub signal_type: OrderFlowSignalType,
    pub price_ticks: PriceTicks,
    pub volume_units: ScaledQuantity,
    pub description: String,
}

/// Detects institutional Absorption and Exhaustion patterns at bar extremes.
pub fn detect_order_flow_signals(bar: &OHLCVBar) -> Vec<OrderFlowSignal> {
    let mut signals = Vec::new();
    if bar.footprint.len() < 3 || bar.total_units.0 == 0 {
        return signals;
    }

    let avg_cell_volume = bar.total_units.0 / (bar.footprint.len() as u64);
    let high_price = bar.high_ticks;
    let low_price = bar.low_ticks;

    // 1. Bearish Absorption at the high: aggressive buyers trapped at the top
    if let Some(top_cell) = bar.footprint.get(&high_price) {
        if top_cell.buy_units.0 >= avg_cell_volume * 2 && bar.close_ticks < high_price {
            signals.push(OrderFlowSignal {
                signal_type: OrderFlowSignalType::BearishAbsorption,
                price_ticks: high_price,
                volume_units: top_cell.buy_units,
                description: format!(
                    "Bearish Absorption: {} aggressive buy units trapped at high, close below",
                    top_cell.buy_units.0
                ),
            });
        }
    }

    // 2. Bullish Absorption at the low: aggressive sellers trapped at the bottom
    if let Some(bottom_cell) = bar.footprint.get(&low_price) {
        if bottom_cell.sell_units.0 >= avg_cell_volume * 2 && bar.close_ticks > low_price {
            signals.push(OrderFlowSignal {
                signal_type: OrderFlowSignalType::BullishAbsorption,
                price_ticks: low_price,
                volume_units: bottom_cell.sell_units,
                description: format!(
                    "Bullish Absorption: {} aggressive sell units absorbed at low, close above",
                    bottom_cell.sell_units.0
                ),
            });
        }
    }

    // 3. Buying Exhaustion at the high: low volume on new high
    if let Some(top_cell) = bar.footprint.get(&high_price) {
        if top_cell.total_units.0 > 0 && top_cell.total_units.0 <= avg_cell_volume / 4 {
            signals.push(OrderFlowSignal {
                signal_type: OrderFlowSignalType::BuyingExhaustion,
                price_ticks: high_price,
                volume_units: top_cell.total_units,
                description: format!(
                    "Buying Exhaustion: Only {} total units traded at extreme high",
                    top_cell.total_units.0
                ),
            });
        }
    }

    // 4. Selling Exhaustion at the low: low volume on new low
    if let Some(bottom_cell) = bar.footprint.get(&low_price) {
        if bottom_cell.total_units.0 > 0 && bottom_cell.total_units.0 <= avg_cell_volume / 4 {
            signals.push(OrderFlowSignal {
                signal_type: OrderFlowSignalType::SellingExhaustion,
                price_ticks: low_price,
                volume_units: bottom_cell.total_units,
                description: format!(
                    "Selling Exhaustion: Only {} total units traded at extreme low",
                    bottom_cell.total_units.0
                ),
            });
        }
    }

    signals
}

/// Cumulative Volume Delta tracker across bars or stream
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CumulativeVolumeDelta {
    pub cvd_units: i64,
    pub total_buy_units: u64,
    pub total_sell_units: u64,
}

impl CumulativeVolumeDelta {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn update_bar(&mut self, bar: &OHLCVBar) {
        self.total_buy_units += bar.buy_units.0;
        self.total_sell_units += bar.sell_units.0;
        self.cvd_units += bar.delta_units();
    }

    pub fn delta(&self) -> i64 {
        self.cvd_units
    }
}
