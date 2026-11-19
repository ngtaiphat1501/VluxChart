//! Realistic Order Flow Execution & Fill Simulator
//! Simulates limit/market order queue priority and footprint-bounded fills (Rule R-DATA-11).

use data_contract::{Aggressor, NormalizedTradeEvent, PriceTicks, ScaledQuantity};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SimOrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SimOrderType {
    Market,
    Limit,
    StopLoss,
    TakeProfit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SimOrderStatus {
    Pending,
    PartiallyFilled,
    Filled,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulatedOrder {
    pub order_id: u64,
    pub side: SimOrderSide,
    pub order_type: SimOrderType,
    pub price_ticks: PriceTicks,
    pub target_quantity: ScaledQuantity,
    pub filled_quantity: ScaledQuantity,
    pub queue_ahead: ScaledQuantity,
    pub status: SimOrderStatus,
    pub created_at_us: i64,
    pub filled_at_us: Option<i64>,
    pub avg_fill_price_ticks: Option<PriceTicks>,
    pub slippage_ticks: i64,
}

impl SimulatedOrder {
    pub fn new_limit(
        order_id: u64,
        side: SimOrderSide,
        price_ticks: PriceTicks,
        quantity: ScaledQuantity,
        queue_ahead: ScaledQuantity,
        created_at_us: i64,
    ) -> Self {
        Self {
            order_id,
            side,
            order_type: SimOrderType::Limit,
            price_ticks,
            target_quantity: quantity,
            filled_quantity: ScaledQuantity(0),
            queue_ahead,
            status: SimOrderStatus::Pending,
            created_at_us,
            filled_at_us: None,
            avg_fill_price_ticks: None,
            slippage_ticks: 0,
        }
    }

    pub fn new_market(
        order_id: u64,
        side: SimOrderSide,
        price_ticks: PriceTicks,
        quantity: ScaledQuantity,
        created_at_us: i64,
    ) -> Self {
        Self {
            order_id,
            side,
            order_type: SimOrderType::Market,
            price_ticks,
            target_quantity: quantity,
            filled_quantity: quantity,
            queue_ahead: ScaledQuantity(0),
            status: SimOrderStatus::Filled,
            created_at_us,
            filled_at_us: Some(created_at_us),
            avg_fill_price_ticks: Some(price_ticks),
            slippage_ticks: 0,
        }
    }

    pub fn unfilled_quantity(&self) -> ScaledQuantity {
        ScaledQuantity(self.target_quantity.0.saturating_sub(self.filled_quantity.0))
    }

    pub fn is_active(&self) -> bool {
        self.status == SimOrderStatus::Pending || self.status == SimOrderStatus::PartiallyFilled
    }
}

/// Realistic order flow execution engine
#[derive(Debug, Default)]
pub struct ExecutionSimulator {
    next_order_id: u64,
    pub orders: Vec<SimulatedOrder>,
}

impl ExecutionSimulator {
    pub fn new() -> Self {
        Self {
            next_order_id: 1,
            orders: Vec::new(),
        }
    }

    /// Place a limit order into the simulator with queue depth
    pub fn submit_limit_order(
        &mut self,
        side: SimOrderSide,
        price_ticks: PriceTicks,
        quantity: ScaledQuantity,
        queue_ahead: ScaledQuantity,
        timestamp_us: i64,
    ) -> u64 {
        let order_id = self.next_order_id;
        self.next_order_id += 1;

        let order = SimulatedOrder::new_limit(
            order_id,
            side,
            price_ticks,
            quantity,
            queue_ahead,
            timestamp_us,
        );
        self.orders.push(order);
        order_id
    }

    /// Place an immediate market order with simulated execution
    pub fn submit_market_order(
        &mut self,
        side: SimOrderSide,
        market_price: PriceTicks,
        quantity: ScaledQuantity,
        timestamp_us: i64,
    ) -> u64 {
        let order_id = self.next_order_id;
        self.next_order_id += 1;

        let order = SimulatedOrder::new_market(
            order_id,
            side,
            market_price,
            quantity,
            timestamp_us,
        );
        self.orders.push(order);
        order_id
    }

    /// Process incoming trade to advance queue and execute fills
    pub fn on_trade(&mut self, trade: &NormalizedTradeEvent) -> Vec<u64> {
        let mut filled_ids = Vec::new();

        for order in self.orders.iter_mut() {
            if !order.is_active() {
                continue;
            }

            match order.side {
                SimOrderSide::Buy => {
                    // Market traded lower than our limit: guaranteed full fill
                    if trade.price_ticks < order.price_ticks {
                        order.filled_quantity = order.target_quantity;
                        order.status = SimOrderStatus::Filled;
                        order.filled_at_us = Some(trade.exchange_ts_us);
                        order.avg_fill_price_ticks = Some(order.price_ticks);
                        filled_ids.push(order.order_id);
                    } else if trade.price_ticks == order.price_ticks && trade.aggressor == Aggressor::Sell {
                        // Aggressor sell hitting our buy limit queue
                        if trade.quantity_units.0 <= order.queue_ahead.0 {
                            order.queue_ahead.0 -= trade.quantity_units.0;
                        } else {
                            let available = trade.quantity_units.0 - order.queue_ahead.0;
                            order.queue_ahead.0 = 0;
                            let remaining = order.unfilled_quantity().0;
                            let fill_units = available.min(remaining);
                            order.filled_quantity.0 += fill_units;

                            if order.filled_quantity.0 >= order.target_quantity.0 {
                                order.status = SimOrderStatus::Filled;
                                order.filled_at_us = Some(trade.exchange_ts_us);
                                order.avg_fill_price_ticks = Some(order.price_ticks);
                                filled_ids.push(order.order_id);
                            } else {
                                order.status = SimOrderStatus::PartiallyFilled;
                            }
                        }
                    }
                }
                SimOrderSide::Sell => {
                    // Market traded higher than our limit: guaranteed full fill
                    if trade.price_ticks > order.price_ticks {
                        order.filled_quantity = order.target_quantity;
                        order.status = SimOrderStatus::Filled;
                        order.filled_at_us = Some(trade.exchange_ts_us);
                        order.avg_fill_price_ticks = Some(order.price_ticks);
                        filled_ids.push(order.order_id);
                    } else if trade.price_ticks == order.price_ticks && trade.aggressor == Aggressor::Buy {
                        // Aggressor buy lifting our sell limit queue
                        if trade.quantity_units.0 <= order.queue_ahead.0 {
                            order.queue_ahead.0 -= trade.quantity_units.0;
                        } else {
                            let available = trade.quantity_units.0 - order.queue_ahead.0;
                            order.queue_ahead.0 = 0;
                            let remaining = order.unfilled_quantity().0;
                            let fill_units = available.min(remaining);
                            order.filled_quantity.0 += fill_units;

                            if order.filled_quantity.0 >= order.target_quantity.0 {
                                order.status = SimOrderStatus::Filled;
                                order.filled_at_us = Some(trade.exchange_ts_us);
                                order.avg_fill_price_ticks = Some(order.price_ticks);
                                filled_ids.push(order.order_id);
                            } else {
                                order.status = SimOrderStatus::PartiallyFilled;
                            }
                        }
                    }
                }
            }
        }

        filled_ids
    }

    /// Cancel an active order
    pub fn cancel_order(&mut self, order_id: u64) -> bool {
        if let Some(order) = self.orders.iter_mut().find(|o| o.order_id == order_id) {
            if order.is_active() {
                order.status = SimOrderStatus::Cancelled;
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use data_contract::AggressorOrigin;

    fn make_test_trade(price: i64, qty: u64, aggressor: Aggressor) -> NormalizedTradeEvent {
        NormalizedTradeEvent::new(
            "BTCUSDT",
            "BINANCE",
            "aggTrade",
            "t-1",
            1700000000000000,
            1700000000001000,
            PriceTicks(price),
            ScaledQuantity(qty),
            100,
            "USDT",
            aggressor,
            AggressorOrigin::ExchangeDirect,
        )
    }

    #[test]
    fn test_queue_priority_and_fill() {
        let mut sim = ExecutionSimulator::new();
        // Place Buy Limit at 95000 with 10 units, queue depth ahead is 15 units
        let order_id = sim.submit_limit_order(
            SimOrderSide::Buy,
            PriceTicks(9500000),
            ScaledQuantity(10),
            ScaledQuantity(15),
            1700000000000000,
        );

        // Trade 1: Sell 10 units at 95000 -> consumes 10 units of queue ahead (5 left)
        let t1 = make_test_trade(9500000, 10, Aggressor::Sell);
        let filled = sim.on_trade(&t1);
        assert!(filled.is_empty());
        assert_eq!(sim.orders[0].queue_ahead.0, 5);
        assert_eq!(sim.orders[0].filled_quantity.0, 0);

        // Trade 2: Sell 10 units at 95000 -> consumes remaining 5 queue ahead, fills 5 of our order
        let t2 = make_test_trade(9500000, 10, Aggressor::Sell);
        let filled = sim.on_trade(&t2);
        assert!(filled.is_empty());
        assert_eq!(sim.orders[0].queue_ahead.0, 0);
        assert_eq!(sim.orders[0].filled_quantity.0, 5);
        assert_eq!(sim.orders[0].status, SimOrderStatus::PartiallyFilled);

        // Trade 3: Sell 5 units at 95000 -> fills remaining 5 units of our order
        let t3 = make_test_trade(9500000, 5, Aggressor::Sell);
        let filled = sim.on_trade(&t3);
        assert_eq!(filled, vec![order_id]);
        assert_eq!(sim.orders[0].filled_quantity.0, 10);
        assert_eq!(sim.orders[0].status, SimOrderStatus::Filled);
    }

    #[test]
    fn test_trade_through_instant_fill() {
        let mut sim = ExecutionSimulator::new();
        // Place Buy Limit at 95000
        let order_id = sim.submit_limit_order(
            SimOrderSide::Buy,
            PriceTicks(9500000),
            ScaledQuantity(10),
            ScaledQuantity(100), // Huge queue ahead
            1700000000000000,
        );

        // Trade trades THROUGH our limit at 94990 -> instant full fill regardless of queue
        let t_through = make_test_trade(9499000, 1, Aggressor::Sell);
        let filled = sim.on_trade(&t_through);
        assert_eq!(filled, vec![order_id]);
        assert_eq!(sim.orders[0].status, SimOrderStatus::Filled);
        assert_eq!(sim.orders[0].filled_quantity.0, 10);
    }
}
