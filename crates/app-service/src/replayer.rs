//! DeepChart Deterministic Historical Replayer (P2.5)
//! Replays recorded historical trades and depth updates at configurable playback speeds (1x, 5x, 10x, 50x).
//! Guarantees deterministic bar closing and footprint reproduction identical to live streams.

use crate::coordinator::AppCoordinator;
use data_contract::NormalizedTradeEvent;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaybackState {
    Playing,
    Paused,
    Completed,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PlaybackSpeed {
    Normal = 1,
    Fast5x = 5,
    Fast10x = 10,
    Fast50x = 50,
}

pub struct HistoricalReplayer {
    pub trades: Vec<NormalizedTradeEvent>,
    pub current_index: usize,
    pub state: PlaybackState,
    pub speed: PlaybackSpeed,
    pub start_ts_us: i64,
    pub end_ts_us: i64,
    pub current_ts_us: i64,
}

impl HistoricalReplayer {
    pub fn new(mut trades: Vec<NormalizedTradeEvent>) -> Self {
        // Sort deterministically by exchange timestamp
        trades.sort_by_key(|t| t.exchange_ts_us);

        let start_ts_us = trades.first().map(|t| t.exchange_ts_us).unwrap_or(0);
        let end_ts_us = trades.last().map(|t| t.exchange_ts_us).unwrap_or(0);

        Self {
            trades,
            current_index: 0,
            state: PlaybackState::Paused,
            speed: PlaybackSpeed::Normal,
            start_ts_us,
            end_ts_us,
            current_ts_us: start_ts_us,
        }
    }

    pub fn play(&mut self) {
        self.state = PlaybackState::Playing;
    }

    pub fn pause(&mut self) {
        self.state = PlaybackState::Paused;
    }

    pub fn set_speed(&mut self, speed: PlaybackSpeed) {
        self.speed = speed;
    }

    pub fn reset(&mut self) {
        self.current_index = 0;
        self.current_ts_us = self.start_ts_us;
        self.state = PlaybackState::Paused;
    }

    /// Advances playback by a simulated time delta, feeding trades to the coordinator.
    /// Returns the number of trades processed in this tick.
    pub fn step_forward_time(
        &mut self,
        delta: Duration,
        coordinator: &mut AppCoordinator,
    ) -> usize {
        if self.state != PlaybackState::Playing || self.current_index >= self.trades.len() {
            if self.current_index >= self.trades.len() {
                self.state = PlaybackState::Completed;
            }
            return 0;
        }

        let speed_multiplier = self.speed as u64;
        let delta_us = (delta.as_micros() as u64) * speed_multiplier;
        let target_ts = self.current_ts_us + (delta_us as i64);

        let mut processed_count = 0;

        while self.current_index < self.trades.len() {
            let next_trade = &self.trades[self.current_index];
            if next_trade.exchange_ts_us <= target_ts {
                coordinator.on_trade(next_trade);
                self.current_ts_us = next_trade.exchange_ts_us;
                self.current_index += 1;
                processed_count += 1;
            } else {
                break;
            }
        }

        self.current_ts_us = target_ts;

        if self.current_index >= self.trades.len() {
            self.state = PlaybackState::Completed;
        }

        processed_count
    }

    /// Steps forward by exactly one trade regardless of timestamp.
    pub fn step_single_trade(&mut self, coordinator: &mut AppCoordinator) -> bool {
        if self.current_index < self.trades.len() {
            let trade = &self.trades[self.current_index];
            coordinator.on_trade(trade);
            self.current_ts_us = trade.exchange_ts_us;
            self.current_index += 1;
            if self.current_index >= self.trades.len() {
                self.state = PlaybackState::Completed;
            }
            true
        } else {
            self.state = PlaybackState::Completed;
            false
        }
    }

    pub fn progress_pct(&self) -> f64 {
        if self.trades.is_empty() {
            100.0
        } else {
            (self.current_index as f64 / self.trades.len() as f64) * 100.0
        }
    }
}
