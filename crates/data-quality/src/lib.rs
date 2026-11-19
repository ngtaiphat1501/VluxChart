//! DeepChart Data Quality & Integrity Engine
//! Handles deduplication, gap detection, sequence tracking, and data quality labeling.

use data_contract::{DataCompleteness, NormalizedTradeEvent};
use std::collections::{HashSet, VecDeque};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectedGap {
    pub instrument_id: String,
    pub previous_id: String,
    pub next_id: String,
    pub missing_count: u64,
    pub start_ts_us: i64,
    pub end_ts_us: i64,
}

/// Bounded Deduplication Filter with LRU-style eviction to prevent unbounded memory growth.
#[derive(Debug)]
pub struct BoundedDedupFilter {
    capacity: usize,
    lookup: HashSet<String>,
    queue: VecDeque<String>,
    duplicates_detected: u64,
}

impl BoundedDedupFilter {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            lookup: HashSet::with_capacity(capacity),
            queue: VecDeque::with_capacity(capacity),
            duplicates_detected: 0,
        }
    }

    /// Returns true if trade is unique and accepted; false if it is a duplicate.
    pub fn accept(&mut self, trade: &NormalizedTradeEvent) -> bool {
        let key = format!("{}:{}:{}", trade.venue, trade.instrument_id, trade.event_id);
        if self.lookup.contains(&key) {
            self.duplicates_detected += 1;
            return false;
        }

        if self.queue.len() >= self.capacity {
            if let Some(oldest) = self.queue.pop_front() {
                self.lookup.remove(&oldest);
            }
        }

        self.lookup.insert(key.clone());
        self.queue.push_back(key);
        true
    }

    pub fn duplicates_detected(&self) -> u64 {
        self.duplicates_detected
    }

    pub fn active_keys(&self) -> usize {
        self.lookup.len()
    }
}

/// Monitors continuous integer trade sequences (e.g. Binance aggTrade id).
#[derive(Debug, Default)]
pub struct SequenceGapDetector {
    last_seq: Option<i64>,
    last_ts_us: i64,
    detected_gaps: Vec<DetectedGap>,
}

impl SequenceGapDetector {
    pub fn new() -> Self {
        Self::default()
    }

    /// Checks the next sequence ID. If a gap is detected, records it and returns Some(DetectedGap).
    pub fn check_sequence(
        &mut self,
        instrument_id: &str,
        current_seq: i64,
        current_ts_us: i64,
    ) -> Option<DetectedGap> {
        let mut gap = None;

        if let Some(last) = self.last_seq {
            let diff = current_seq - last;
            if diff > 1 {
                let detected = DetectedGap {
                    instrument_id: instrument_id.into(),
                    previous_id: last.to_string(),
                    next_id: current_seq.to_string(),
                    missing_count: (diff - 1) as u64,
                    start_ts_us: self.last_ts_us,
                    end_ts_us: current_ts_us,
                };
                self.detected_gaps.push(detected.clone());
                gap = Some(detected);
            }
        }

        self.last_seq = Some(current_seq);
        self.last_ts_us = current_ts_us;
        gap
    }

    pub fn has_unrecovered_gaps(&self) -> bool {
        !self.detected_gaps.is_empty()
    }

    pub fn completeness_status(&self) -> DataCompleteness {
        if self.has_unrecovered_gaps() {
            DataCompleteness::Partial
        } else {
            DataCompleteness::Complete
        }
    }

    pub fn total_gaps_count(&self) -> usize {
        self.detected_gaps.len()
    }
}
