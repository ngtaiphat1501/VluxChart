//! DeepChart Liquidity Heatmap History Tracker (P1)
//! Stores consecutive time-slices of resting liquidity for Bookmap-style visualizations.

use data_contract::HeatmapSlice;
use std::collections::VecDeque;

#[derive(Debug, Clone)]
pub struct HeatmapTracker {
    capacity: usize,
    slices: VecDeque<HeatmapSlice>,
}

impl HeatmapTracker {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            slices: VecDeque::with_capacity(capacity),
        }
    }

    pub fn push_slice(&mut self, slice: HeatmapSlice) {
        if self.slices.len() >= self.capacity {
            self.slices.pop_front();
        }
        self.slices.push_back(slice);
    }

    pub fn slices(&self) -> &VecDeque<HeatmapSlice> {
        &self.slices
    }

    pub fn clear(&mut self) {
        self.slices.clear();
    }

    pub fn len(&self) -> usize {
        self.slices.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slices.is_empty()
    }
}
