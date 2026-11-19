//! DeepChart Market-by-Order (MBO) & Iceberg Unit Tests (P2.4)

use data_contract::{
    MboOrderAction, MboOrderEvent, OrderBookSide, PriceTicks, ScaledQuantity,
};
use volume_engine::MboOrderBook;

#[test]
fn test_mbo_order_queue_fifo_lifecycle() {
    let mut book = MboOrderBook::new();

    // 1. Add order 101: 50 units @ 95000 (Bid)
    let ev1 = MboOrderEvent {
        instrument_id: "CME:FUTURES:GC:CONTINUOUS".into(),
        venue: "CME".into(),
        order_id: 101,
        side: OrderBookSide::Bid,
        action: MboOrderAction::Add,
        price_ticks: PriceTicks(95000),
        quantity_units: ScaledQuantity(50),
        exchange_ts_us: 1700000000000000,
        sequence_id: 1,
    };
    book.process_event(&ev1);

    // 2. Add order 102: 100 units @ 95000 (Bid) -> should be behind 101 in queue
    let ev2 = MboOrderEvent {
        instrument_id: "CME:FUTURES:GC:CONTINUOUS".into(),
        venue: "CME".into(),
        order_id: 102,
        side: OrderBookSide::Bid,
        action: MboOrderAction::Add,
        price_ticks: PriceTicks(95000),
        quantity_units: ScaledQuantity(100),
        exchange_ts_us: 1700000000001000,
        sequence_id: 2,
    };
    book.process_event(&ev2);

    assert_eq!(book.level_total_quantity(OrderBookSide::Bid, PriceTicks(95000)), 150);
    let queue = book.bid_queues.get(&PriceTicks(95000)).unwrap();
    assert_eq!(queue, &vec![101, 102]);

    // 3. Partial execution of 30 units on order 101
    let ev3 = MboOrderEvent {
        instrument_id: "CME:FUTURES:GC:CONTINUOUS".into(),
        venue: "CME".into(),
        order_id: 101,
        side: OrderBookSide::Bid,
        action: MboOrderAction::Execute,
        price_ticks: PriceTicks(95000),
        quantity_units: ScaledQuantity(30),
        exchange_ts_us: 1700000000002000,
        sequence_id: 3,
    };
    book.process_event(&ev3);

    assert_eq!(book.level_total_quantity(OrderBookSide::Bid, PriceTicks(95000)), 120);
    assert_eq!(book.orders.get(&101).unwrap().quantity_units.0, 20);

    // 4. Complete fill of remaining 20 units on order 101
    let ev4 = MboOrderEvent {
        instrument_id: "CME:FUTURES:GC:CONTINUOUS".into(),
        venue: "CME".into(),
        order_id: 101,
        side: OrderBookSide::Bid,
        action: MboOrderAction::Execute,
        price_ticks: PriceTicks(95000),
        quantity_units: ScaledQuantity(20),
        exchange_ts_us: 1700000000003000,
        sequence_id: 4,
    };
    book.process_event(&ev4);

    // Order 101 should be deleted from queue, leaving order 102 as front
    assert_eq!(book.level_total_quantity(OrderBookSide::Bid, PriceTicks(95000)), 100);
    assert!(book.orders.get(&101).is_none());
    let queue_after = book.bid_queues.get(&PriceTicks(95000)).unwrap();
    assert_eq!(queue_after, &vec![102]);
}

#[test]
fn test_mbo_iceberg_liquidity_detection() {
    let mut book = MboOrderBook::new();

    // Add an initial order with small displayed size of 100 units @ 95000
    let ev1 = MboOrderEvent {
        instrument_id: "CME:FUTURES:GC:CONTINUOUS".into(),
        venue: "CME".into(),
        order_id: 501,
        side: OrderBookSide::Ask,
        action: MboOrderAction::Add,
        price_ticks: PriceTicks(95000),
        quantity_units: ScaledQuantity(100),
        exchange_ts_us: 1700000000000000,
        sequence_id: 1,
    };
    book.process_event(&ev1);

    // Partial execute 80 units
    let ev2 = MboOrderEvent {
        instrument_id: "CME:FUTURES:GC:CONTINUOUS".into(),
        venue: "CME".into(),
        order_id: 501,
        side: OrderBookSide::Ask,
        action: MboOrderAction::Execute,
        price_ticks: PriceTicks(95000),
        quantity_units: ScaledQuantity(80),
        exchange_ts_us: 1700000000001000,
        sequence_id: 2,
    };
    let ice1 = book.process_event(&ev2);
    assert!(ice1.is_none(), "Exec <= displayed, no iceberg yet");

    // Hidden replenishment executes an additional 150 units at the exact same level
    let ev3 = MboOrderEvent {
        instrument_id: "CME:FUTURES:GC:CONTINUOUS".into(),
        venue: "CME".into(),
        order_id: 501,
        side: OrderBookSide::Ask,
        action: MboOrderAction::Execute,
        price_ticks: PriceTicks(95000),
        quantity_units: ScaledQuantity(150), // Total executed = 80 + 150 = 230 > displayed 100
        exchange_ts_us: 1700000000002000,
        sequence_id: 3,
    };
    let ice2 = book.process_event(&ev3);

    assert!(ice2.is_some(), "Total exec 230 > displayed 100 must trigger Iceberg!");
    let det = ice2.unwrap();
    assert_eq!(det.price_ticks, PriceTicks(95000));
    assert_eq!(det.side, OrderBookSide::Ask);
    assert_eq!(det.peak_displayed_units, ScaledQuantity(100));
    assert_eq!(det.total_executed_units, ScaledQuantity(230));
    assert_eq!(det.hidden_volume_units, ScaledQuantity(130)); // 230 - 100
    assert_eq!(det.refill_count, 1);
}
