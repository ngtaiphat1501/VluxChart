//! DeepChart Multi-Exchange Order Flow Aggregator (Phase P2.1)
//! Aggregates normalized executed trades from multiple venues (Bybit + Binance) for a unified symbol.
//! Adheres strictly to Rule R-DATA-04 (explicit venue attribution) and R-DATA-06 (Total = Buy + Sell + Unknown).

use data_contract::{NormalizedTradeEvent, ScaledQuantity};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VenueShare {
    pub venue: String,
    pub buy_units: ScaledQuantity,
    pub sell_units: ScaledQuantity,
    pub total_units: ScaledQuantity,
    pub delta_units: i64,
    pub trade_count: u32,
    pub share_pct: u32, // integer percentage 0-100
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MultiVenueAggregateSummary {
    pub symbol: String,
    pub total_aggregated_units: ScaledQuantity,
    pub total_aggregated_delta: i64,
    pub venue_shares: Vec<VenueShare>,
}

pub struct MultiVenueAggregator;

impl MultiVenueAggregator {
    /// Merges multiple trade streams deterministically ordered by exchange timestamp.
    pub fn merge_trade_streams(
        mut stream_a: Vec<NormalizedTradeEvent>,
        mut stream_b: Vec<NormalizedTradeEvent>,
    ) -> Vec<NormalizedTradeEvent> {
        stream_a.append(&mut stream_b);
        stream_a.sort_by_key(|t| (t.exchange_ts_us, t.receive_ts_us));
        stream_a
    }

    /// Computes venue market share and delta breakdown from a list of trades.
    pub fn compute_venue_breakdown(
        symbol: impl Into<String>,
        trades: &[NormalizedTradeEvent],
    ) -> MultiVenueAggregateSummary {
        let mut venue_map: BTreeMap<String, (u64, u64, u32)> = BTreeMap::new(); // venue -> (buy, sell, count)
        let mut total_vol = 0u64;
        let mut total_delta = 0i64;

        for t in trades {
            let entry = venue_map.entry(t.venue.clone()).or_insert((0, 0, 0));
            entry.2 += 1;
            total_vol += t.quantity_units.0;

            if t.aggressor.is_buy() {
                entry.0 += t.quantity_units.0;
                total_delta += t.quantity_units.0 as i64;
            } else if t.aggressor.is_sell() {
                entry.1 += t.quantity_units.0;
                total_delta -= t.quantity_units.0 as i64;
            }
        }

        let mut venue_shares = Vec::with_capacity(venue_map.len());
        for (venue, (buy, sell, count)) in venue_map {
            let total = buy + sell;
            let share_pct = if total_vol > 0 {
                ((total as f64 / total_vol as f64) * 100.0).round() as u32
            } else {
                0
            };

            venue_shares.push(VenueShare {
                venue,
                buy_units: ScaledQuantity(buy),
                sell_units: ScaledQuantity(sell),
                total_units: ScaledQuantity(total),
                delta_units: (buy as i64) - (sell as i64),
                trade_count: count,
                share_pct,
            });
        }

        MultiVenueAggregateSummary {
            symbol: symbol.into(),
            total_aggregated_units: ScaledQuantity(total_vol),
            total_aggregated_delta: total_delta,
            venue_shares,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use data_contract::{Aggressor, AggressorOrigin, PriceTicks};

    fn make_test_trade(venue: &str, ts: i64, qty: u64, agg: Aggressor) -> NormalizedTradeEvent {
        NormalizedTradeEvent::new(
            format!("{}:BTCUSDT", venue),
            venue,
            "feed",
            format!("evt-{}", ts),
            ts,
            ts + 50,
            PriceTicks(9500000),
            ScaledQuantity(qty),
            1000,
            "BTC",
            agg,
            AggressorOrigin::ExchangeDirect,
        )
    }

    #[test]
    fn test_multi_venue_aggregation_and_shares() {
        let t1 = make_test_trade("BYBIT", 1000, 600, Aggressor::Buy);
        let t2 = make_test_trade("BINANCE", 1050, 400, Aggressor::Sell);

        let merged = MultiVenueAggregator::merge_trade_streams(vec![t1.clone()], vec![t2.clone()]);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].exchange_ts_us, 1000);
        assert_eq!(merged[1].exchange_ts_us, 1050);

        let summary = MultiVenueAggregator::compute_venue_breakdown("BTCUSDT", &merged);
        assert_eq!(summary.total_aggregated_units.0, 1000);
        assert_eq!(summary.total_aggregated_delta, 200); // +600 (Bybit) - 400 (Binance)
        assert_eq!(summary.venue_shares.len(), 2);

        let bybit = summary.venue_shares.iter().find(|v| v.venue == "BYBIT").unwrap();
        assert_eq!(bybit.share_pct, 60);
        assert_eq!(bybit.delta_units, 600);

        let binance = summary.venue_shares.iter().find(|v| v.venue == "BINANCE").unwrap();
        assert_eq!(binance.share_pct, 40);
        assert_eq!(binance.delta_units, -400);
    }
}
