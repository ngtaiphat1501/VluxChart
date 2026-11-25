//! DeepChart Market-by-Order (MBO) Engine & Iceberg Detection (P2.4)
//! Maintains individual order queues with FIFO execution priority
//! and identifies hidden/replenishing Iceberg orders.

use data_contract::{
    IcebergOrderDetection, MboOrderAction, MboOrderEvent, OrderBookSide, PriceTicks, ScaledQuantity,
};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MboOrderEntry {
    pub order_id: u64,
    pub side: OrderBookSide,
    pub price_ticks: PriceTicks,
    pub quantity_units: ScaledQuantity,
    pub initial_displayed_units: ScaledQuantity,
    pub cumulative_executed_units: ScaledQuantity,
}

#[derive(Debug, Clone, Default)]
pub struct LevelExecutionStats {
    pub initial_displayed_units: u64,
    pub total_executed_units: u64,
    pub execution_slice_count: u32,
    pub refill_count: u32,
    pub last_execution_ts_us: i64,
}

#[derive(Debug, Clone, Default)]
pub struct MboOrderBook {
    pub orders: HashMap<u64, MboOrderEntry>,
    pub bid_queues: BTreeMap<PriceTicks, Vec<u64>>, // Price -> list of order IDs (FIFO order)
    pub ask_queues: BTreeMap<PriceTicks, Vec<u64>>,
    pub level_stats: HashMap<(PriceTicks, OrderBookSide), LevelExecutionStats>,
    pub detected_icebergs: Vec<IcebergOrderDetection>,
}

impl MboOrderBook {
    pub fn new() -> Self {
        Self::default()
    }

    /// Ingests an MBO order event and updates the order queue.
    /// Returns an `IcebergOrderDetection` if a hidden iceberg replenishment is detected.
    pub fn process_event(&mut self, event: &MboOrderEvent) -> Option<IcebergOrderDetection> {
        match event.action {
            MboOrderAction::Add => {
                let entry = MboOrderEntry {
                    order_id: event.order_id,
                    side: event.side,
                    price_ticks: event.price_ticks,
                    quantity_units: event.quantity_units,
                    initial_displayed_units: event.quantity_units,
                    cumulative_executed_units: ScaledQuantity(0),
                };
                self.orders.insert(event.order_id, entry);

                let queue = match event.side {
                    OrderBookSide::Bid => self.bid_queues.entry(event.price_ticks).or_default(),
                    OrderBookSide::Ask => self.ask_queues.entry(event.price_ticks).or_default(),
                };
                queue.push(event.order_id);

                let stats = self
                    .level_stats
                    .entry((event.price_ticks, event.side))
                    .or_default();
                stats.initial_displayed_units += event.quantity_units.0;

                None
            }

            MboOrderAction::Modify => {
                if let Some(existing) = self.orders.get_mut(&event.order_id) {
                    let old_qty = existing.quantity_units.0;
                    let new_qty = event.quantity_units.0;
                    existing.quantity_units = event.quantity_units;

                    // If order size increases, it loses FIFO queue priority and moves to the back
                    if new_qty > old_qty {
                        let queue = match existing.side {
                            OrderBookSide::Bid => self.bid_queues.get_mut(&existing.price_ticks),
                            OrderBookSide::Ask => self.ask_queues.get_mut(&existing.price_ticks),
                        };
                        if let Some(q) = queue {
                            if let Some(pos) = q.iter().position(|&id| id == event.order_id) {
                                q.remove(pos);
                                q.push(event.order_id);
                            }
                        }
                    }
                }
                None
            }

            MboOrderAction::Cancel => {
                if let Some(existing) = self.orders.remove(&event.order_id) {
                    let queue = match existing.side {
                        OrderBookSide::Bid => self.bid_queues.get_mut(&existing.price_ticks),
                        OrderBookSide::Ask => self.ask_queues.get_mut(&existing.price_ticks),
                    };
                    if let Some(q) = queue {
                        if let Some(pos) = q.iter().position(|&id| id == event.order_id) {
                            q.remove(pos);
                        }
                    }
                }
                None
            }

            MboOrderAction::Execute => {
                let mut iceberg_found = None;

                if let Some(existing) = self.orders.get_mut(&event.order_id) {
                    let exec_qty = event.quantity_units.0;
                    existing.cumulative_executed_units.0 += exec_qty;

                    if existing.quantity_units.0 >= exec_qty {
                        existing.quantity_units.0 -= exec_qty;
                    } else {
                        existing.quantity_units.0 = 0;
                    }

                    let stats = self
                        .level_stats
                        .entry((existing.price_ticks, existing.side))
                        .or_default();
                    stats.total_executed_units += exec_qty;
                    stats.execution_slice_count += 1;
                    stats.last_execution_ts_us = event.exchange_ts_us;

                    // Iceberg Condition:
                    // Total executed units at this price level exceeds initial displayed units
                    if stats.total_executed_units > stats.initial_displayed_units
                        && stats.initial_displayed_units > 0
                    {
                        let hidden = stats.total_executed_units - stats.initial_displayed_units;
                        // Increment refill_count on initial hidden breach and each subsequent full displayed reload
                        if stats.refill_count == 0
                            || hidden >= stats.initial_displayed_units * (stats.refill_count as u64 + 1)
                        {
                            stats.refill_count += 1;
                        }

                        let detection = IcebergOrderDetection {
                            price_ticks: existing.price_ticks,
                            side: existing.side,
                            peak_displayed_units: ScaledQuantity(stats.initial_displayed_units),
                            total_executed_units: ScaledQuantity(stats.total_executed_units),
                            hidden_volume_units: ScaledQuantity(hidden),
                            refill_count: stats.refill_count,
                            detected_at_us: event.exchange_ts_us,
                        };

                        if self.detected_icebergs.len() >= 50 {
                            self.detected_icebergs.remove(0);
                        }
                        self.detected_icebergs.push(detection.clone());
                        iceberg_found = Some(detection);
                    }

                    // Remove order if completely filled
                    if existing.quantity_units.0 == 0 {
                        let price = existing.price_ticks;
                        let side = existing.side;
                        self.orders.remove(&event.order_id);

                        let queue = match side {
                            OrderBookSide::Bid => self.bid_queues.get_mut(&price),
                            OrderBookSide::Ask => self.ask_queues.get_mut(&price),
                        };
                        if let Some(q) = queue {
                            if let Some(pos) = q.iter().position(|&id| id == event.order_id) {
                                q.remove(pos);
                            }
                        }
                    }
                }

                iceberg_found
            }
        }
    }

    /// Returns the total displayed quantity at a price level.
    pub fn level_total_quantity(&self, side: OrderBookSide, price: PriceTicks) -> u64 {
        let queue = match side {
            OrderBookSide::Bid => self.bid_queues.get(&price),
            OrderBookSide::Ask => self.ask_queues.get(&price),
        };
        match queue {
            Some(q) => q
                .iter()
                .filter_map(|id| self.orders.get(id))
                .map(|e| e.quantity_units.0)
                .sum(),
            None => 0,
        }
    }

    /// Returns active detected icebergs.
    pub fn active_icebergs(&self) -> &[IcebergOrderDetection] {
        &self.detected_icebergs
    }
}
