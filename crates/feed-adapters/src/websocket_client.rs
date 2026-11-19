//! Live WebSocket Connector and Stream Dispatcher for Bybit and Binance Feeds
//! Compliant with Rules R-DATA-01 to R-DATA-13:
//! - Exact volume conservation & non-negative integer arithmetic
//! - Venue isolation and bounded backpressure queueing
//! - Exponential backoff reconnection with jitter
//! - Silent network freeze detection via heartbeat ping/pong

use crate::{AdapterError, BinanceFuturesAdapter, BybitLinearAdapter, ConnectionState, HeartbeatTracker};
use data_contract::NormalizedTradeEvent;
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::time::Duration;
use tracing::{debug, error, warn};

/// Configuration for a live exchange feed stream
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveFeedConfig {
    pub venue: String,
    pub symbol: String,
    pub instrument_id: String,
    pub endpoint_url: String,
    pub price_tick: f64,
    pub quantity_scale: u64,
    pub trade_unit: String,
    pub ping_interval_ms: u64,
    pub stale_timeout_ms: i64,
    pub initial_reconnect_delay_ms: u64,
    pub max_reconnect_delay_ms: u64,
    pub backoff_factor: f64,
}

impl LiveFeedConfig {
    pub fn bybit_btc_perp() -> Self {
        Self {
            venue: "BYBIT".into(),
            symbol: "BTCUSDT".into(),
            instrument_id: "BYBIT:LINEAR_PERP:BTCUSDT:PERP".into(),
            endpoint_url: "wss://stream.bybit.com/v5/public/linear".into(),
            price_tick: 0.10,
            quantity_scale: 1_000,
            trade_unit: "BTC".into(),
            ping_interval_ms: 20_000,
            stale_timeout_ms: 30_000,
            initial_reconnect_delay_ms: 500,
            max_reconnect_delay_ms: 30_000,
            backoff_factor: 2.0,
        }
    }

    pub fn binance_btc_perp() -> Self {
        Self {
            venue: "BINANCE".into(),
            symbol: "BTCUSDT".into(),
            instrument_id: "BINANCE:USDS_M_PERP:BTCUSDT:PERP".into(),
            endpoint_url: "wss://fstream.binance.com/ws".into(),
            price_tick: 0.10,
            quantity_scale: 1_000,
            trade_unit: "BTC".into(),
            ping_interval_ms: 60_000,
            stale_timeout_ms: 30_000,
            initial_reconnect_delay_ms: 500,
            max_reconnect_delay_ms: 30_000,
            backoff_factor: 2.0,
        }
    }

    pub fn binance_gold_perp() -> Self {
        Self {
            venue: "BINANCE".into(),
            symbol: "XAUUSDT".into(),
            instrument_id: "BINANCE:USDS_M_PERP:XAUUSDT:PERP".into(),
            endpoint_url: "wss://fstream.binance.com/ws".into(),
            price_tick: 0.01,
            quantity_scale: 1_000,
            trade_unit: "OUNCE_OR_UNIT".into(),
            ping_interval_ms: 60_000,
            stale_timeout_ms: 30_000,
            initial_reconnect_delay_ms: 500,
            max_reconnect_delay_ms: 30_000,
            backoff_factor: 2.0,
        }
    }

    /// Generate exchange subscription JSON message
    pub fn build_subscription_payload(&self) -> String {
        match self.venue.to_uppercase().as_str() {
            "BYBIT" => serde_json::json!({
                "op": "subscribe",
                "args": [format!("publicTrade.{}", self.symbol)]
            })
            .to_string(),
            "BINANCE" => serde_json::json!({
                "method": "SUBSCRIBE",
                "params": [format!("{}@aggTrade", self.symbol.to_lowercase())],
                "id": 1
            })
            .to_string(),
            _ => serde_json::json!({}).to_string(),
        }
    }

    /// Generate exchange heartbeat ping message if required
    pub fn build_ping_payload(&self) -> Option<String> {
        match self.venue.to_uppercase().as_str() {
            "BYBIT" => Some(serde_json::json!({ "op": "ping" }).to_string()),
            _ => None,
        }
    }
}

/// Exponential backoff reconnection manager with bounded jitter
#[derive(Debug, Clone)]
pub struct ReconnectionManager {
    attempt: u32,
    initial_delay_ms: u64,
    max_delay_ms: u64,
    factor: f64,
    rng_state: u64,
}

impl ReconnectionManager {
    pub fn new(initial_delay_ms: u64, max_delay_ms: u64, factor: f64) -> Self {
        Self {
            attempt: 0,
            initial_delay_ms,
            max_delay_ms,
            factor,
            rng_state: 88172645463325252,
        }
    }

    /// Reset attempt counter on healthy connection and receipt of trades
    pub fn reset(&mut self) {
        self.attempt = 0;
    }

    pub fn current_attempt(&self) -> u32 {
        self.attempt
    }

    /// Compute next backoff duration: min(max_delay, initial_delay * factor^attempt) + jitter (0..20%)
    pub fn next_delay(&mut self) -> Duration {
        let base_delay = (self.initial_delay_ms as f64 * self.factor.powi(self.attempt as i32))
            .min(self.max_delay_ms as f64);
        
        // Fast deterministic pseudo-random jitter (0% to 20%)
        self.rng_state = self.rng_state.wrapping_mul(6364136223846793005).wrapping_add(1);
        let jitter_ratio = ((self.rng_state >> 32) % 200) as f64 / 1000.0;
        let delay_ms = (base_delay * (1.0 + jitter_ratio)).round() as u64;

        self.attempt = self.attempt.saturating_add(1);
        Duration::from_millis(delay_ms.min(self.max_delay_ms))
    }
}

/// Real-time live feed stream telemetry statistics
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveFeedTelemetry {
    pub state: ConnectionState,
    pub endpoint_url: String,
    pub total_messages_received: u64,
    pub total_trades_dispatched: u64,
    pub total_dropped_messages: u64,
    pub reconnect_attempts: u32,
    pub last_receive_ts_us: i64,
    pub messages_per_sec: f64,
    pub estimated_latency_ms: f64,
}

impl Default for LiveFeedTelemetry {
    fn default() -> Self {
        Self {
            state: ConnectionState::Disconnected,
            endpoint_url: String::new(),
            total_messages_received: 0,
            total_trades_dispatched: 0,
            total_dropped_messages: 0,
            reconnect_attempts: 0,
            last_receive_ts_us: 0,
            messages_per_sec: 0.0,
            estimated_latency_ms: 0.0,
        }
    }
}

/// Dispatches raw incoming string frames to the appropriate venue parser
/// and delivers normalized trades across a bounded channel.
pub struct LiveFeedDispatcher {
    config: LiveFeedConfig,
    heartbeat: HeartbeatTracker,
    reconnect_mgr: ReconnectionManager,
    telemetry: LiveFeedTelemetry,
    sender: SyncSender<NormalizedTradeEvent>,
}

impl LiveFeedDispatcher {
    pub fn new(config: LiveFeedConfig, sender: SyncSender<NormalizedTradeEvent>) -> Self {
        let endpoint_url = config.endpoint_url.clone();
        let stale_timeout_ms = config.stale_timeout_ms;
        let initial_delay = config.initial_reconnect_delay_ms;
        let max_delay = config.max_reconnect_delay_ms;
        let backoff = config.backoff_factor;

        Self {
            config,
            heartbeat: HeartbeatTracker::new(stale_timeout_ms),
            reconnect_mgr: ReconnectionManager::new(initial_delay, max_delay, backoff),
            telemetry: LiveFeedTelemetry {
                state: ConnectionState::Disconnected,
                endpoint_url,
                ..Default::default()
            },
            sender,
        }
    }

    pub fn set_state(&mut self, new_state: ConnectionState) {
        if self.telemetry.state != new_state {
            debug!(
                venue = %self.config.venue,
                from = ?self.telemetry.state,
                to = ?new_state,
                "Live feed connection state transition"
            );
            self.telemetry.state = new_state;
            if new_state == ConnectionState::Connected {
                self.reconnect_mgr.reset();
                self.telemetry.reconnect_attempts = 0;
            }
        }
    }

    pub fn telemetry(&self) -> &LiveFeedTelemetry {
        &self.telemetry
    }

    pub fn check_heartbeat(&mut self, now_us: i64) -> bool {
        let is_stale = self.heartbeat.is_stale(now_us);
        if is_stale && self.telemetry.state == ConnectionState::Connected {
            warn!(
                venue = %self.config.venue,
                last_activity_us = self.heartbeat.last_activity_us(),
                now_us,
                "Heartbeat timeout detected: connection is stale"
            );
            self.set_state(ConnectionState::Stale);
        }
        is_stale
    }

    /// Ingest and parse a raw text payload frame
    pub fn process_raw_frame(&mut self, raw_text: &str, receive_ts_us: i64) -> Result<usize, AdapterError> {
        self.telemetry.total_messages_received += 1;
        self.telemetry.last_receive_ts_us = receive_ts_us;
        self.heartbeat.record_activity(receive_ts_us);

        // Fast filtering of heartbeats / acks
        if raw_text.contains(r#""ret_msg":"pong""#)
            || raw_text.contains(r#""op":"pong""#)
            || raw_text.contains(r#""op":"subscribe""#)
            || raw_text.contains(r#""result":null"#)
        {
            return Ok(0);
        }

        let parsed_trades = match self.config.venue.to_uppercase().as_str() {
            "BYBIT" => BybitLinearAdapter::parse_public_trades(
                raw_text,
                receive_ts_us,
                self.config.price_tick,
                self.config.quantity_scale,
                &self.config.trade_unit,
            )?,
            "BINANCE" => {
                match BinanceFuturesAdapter::parse_agg_trade(
                    raw_text,
                    receive_ts_us,
                    self.config.price_tick,
                    self.config.quantity_scale,
                    &self.config.trade_unit,
                ) {
                    Ok(trade) => vec![trade],
                    Err(AdapterError::UnsupportedType(_)) => vec![],
                    Err(e) => return Err(e),
                }
            }
            _ => {
                return Err(AdapterError::UnsupportedType(format!(
                    "Unsupported venue {}",
                    self.config.venue
                )));
            }
        };

        let mut count = 0;
        for trade in parsed_trades {
            // Track latency: receive_ts_us - exchange_ts_us
            let latency_us = receive_ts_us.saturating_sub(trade.exchange_ts_us);
            self.telemetry.estimated_latency_ms = (latency_us as f64) / 1_000.0;

            match self.sender.try_send(trade) {
                Ok(_) => {
                    self.telemetry.total_trades_dispatched += 1;
                    count += 1;
                }
                Err(TrySendError::Full(_)) => {
                    // Backpressure safeguard: bounded channel is full, record drop
                    self.telemetry.total_dropped_messages += 1;
                    warn!(
                        venue = %self.config.venue,
                        total_dropped = self.telemetry.total_dropped_messages,
                        "Engine ingress buffer full: dropping trade frame to prevent memory exhaustion"
                    );
                }
                Err(TrySendError::Disconnected(_)) => {
                    error!(venue = %self.config.venue, "Engine ingress receiver disconnected");
                    break;
                }
            }
        }

        Ok(count)
    }

    /// Notify that connection was severed; calculates next backoff
    pub fn handle_disconnect(&mut self) -> Duration {
        self.set_state(ConnectionState::Reconnecting);
        let delay = self.reconnect_mgr.next_delay();
        self.telemetry.reconnect_attempts = self.reconnect_mgr.current_attempt();
        warn!(
            venue = %self.config.venue,
            attempt = self.telemetry.reconnect_attempts,
            delay_ms = delay.as_millis(),
            "Connection lost. Scheduling reconnect."
        );
        delay
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn test_reconnection_manager_exponential_backoff() {
        let mut mgr = ReconnectionManager::new(500, 30_000, 2.0);
        assert_eq!(mgr.current_attempt(), 0);

        let d1 = mgr.next_delay();
        assert!(d1.as_millis() >= 500 && d1.as_millis() <= 650);
        assert_eq!(mgr.current_attempt(), 1);

        let d2 = mgr.next_delay();
        assert!(d2.as_millis() >= 1000 && d2.as_millis() <= 1300);
        assert_eq!(mgr.current_attempt(), 2);

        let d3 = mgr.next_delay();
        assert!(d3.as_millis() >= 2000 && d3.as_millis() <= 2600);

        // Test ceiling capping at 30,000 ms
        for _ in 0..10 {
            mgr.next_delay();
        }
        let capped = mgr.next_delay();
        assert!(capped.as_millis() <= 30_000);

        // Reset
        mgr.reset();
        assert_eq!(mgr.current_attempt(), 0);
    }

    #[test]
    fn test_subscription_payload_generation() {
        let bybit_cfg = LiveFeedConfig::bybit_btc_perp();
        let payload = bybit_cfg.build_subscription_payload();
        assert!(payload.contains("publicTrade.BTCUSDT"));
        assert!(payload.contains("subscribe"));

        let binance_cfg = LiveFeedConfig::binance_btc_perp();
        let b_payload = binance_cfg.build_subscription_payload();
        assert!(b_payload.contains("btcusdt@aggTrade"));
        assert!(b_payload.contains("SUBSCRIBE"));
    }

    #[test]
    fn test_live_feed_dispatcher_bybit_pipeline() {
        let (tx, rx) = mpsc::sync_channel(100);
        let config = LiveFeedConfig::bybit_btc_perp();
        let mut dispatcher = LiveFeedDispatcher::new(config, tx);
        dispatcher.set_state(ConnectionState::Connected);

        let raw_json = r#"{"topic":"publicTrade.BTCUSDT","type":"snapshot","ts":1794502653000,"data":[{"T":1794502653000,"s":"BTCUSDT","S":"Buy","v":"0.150","p":"95000.50","i":"BYBIT-999","BT":false}]}"#;
        let count = dispatcher
            .process_raw_frame(raw_json, 1794502653000100)
            .expect("Frame parse success");
        assert_eq!(count, 1);

        let trade = rx.recv().expect("Trade received in channel");
        assert_eq!(trade.venue, "BYBIT");
        assert_eq!(trade.price_ticks.0, 950005);
        assert_eq!(trade.quantity_units.0, 150);
        assert!(trade.aggressor.is_buy());

        // Heartbeat verification
        assert!(!dispatcher.check_heartbeat(1794502653000100 + 1_000_000));
        assert!(dispatcher.check_heartbeat(1794502653000100 + 35_000_000));
        assert_eq!(dispatcher.telemetry().state, ConnectionState::Stale);

        // Disconnect test
        let backoff = dispatcher.handle_disconnect();
        assert_eq!(dispatcher.telemetry().state, ConnectionState::Reconnecting);
        assert!(backoff.as_millis() >= 500);
    }
}
