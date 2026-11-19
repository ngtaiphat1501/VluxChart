//! DeepChart Instrument Registry and Metadata Model

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum InstrumentError {
    #[error("Failed to read instruments file: {0}")]
    Io(#[from] std::io::Error),
    #[error("Failed to parse YAML: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("Instrument not found: {0}")]
    NotFound(String),
    #[error("Invalid instrument configuration: {0}")]
    Invalid(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InstrumentDefinition {
    pub instrument_id: String,
    pub venue: String,
    pub market_type: String,
    pub symbol: String,
    pub contract_type: String,
    pub contract_expiry: Option<String>,
    pub price_tick: f64,
    pub price_precision: u32,
    pub quantity_step: f64,
    pub quantity_precision: u32,
    pub quantity_scale: u64,
    pub contract_multiplier: f64,
    pub base_asset: String,
    pub quote_asset: String,
    pub settle_asset: String,
    pub trade_unit: String,
    pub primary_source_feed: String,
    pub source_status: String,
}

impl InstrumentDefinition {
    pub fn validate(&self) -> Result<(), InstrumentError> {
        if self.price_tick <= 0.0 {
            return Err(InstrumentError::Invalid("price_tick must be > 0".into()));
        }
        if self.quantity_step <= 0.0 {
            return Err(InstrumentError::Invalid("quantity_step must be > 0".into()));
        }
        if self.quantity_scale == 0 {
            return Err(InstrumentError::Invalid("quantity_scale must be > 0".into()));
        }
        if self.contract_multiplier <= 0.0 {
            return Err(InstrumentError::Invalid("contract_multiplier must be > 0".into()));
        }
        let parts: Vec<&str> = self.instrument_id.split(':').collect();
        if parts.len() != 4 {
            return Err(InstrumentError::Invalid(format!(
                "instrument_id must have 4 segments VENUE:MARKET:SYMBOL:CONTRACT, got {}",
                self.instrument_id
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstrumentFile {
    pub version: String,
    pub updated_at: String,
    pub description: Option<String>,
    pub instruments: Vec<InstrumentDefinition>,
}

#[derive(Debug, Clone, Default)]
pub struct InstrumentRegistry {
    instruments: HashMap<String, InstrumentDefinition>,
}

impl InstrumentRegistry {
    pub fn new() -> Self {
        Self {
            instruments: HashMap::new(),
        }
    }

    pub fn load_from_yaml_str(yaml_content: &str) -> Result<Self, InstrumentError> {
        let file: InstrumentFile = serde_yaml::from_str(yaml_content)?;
        let mut registry = Self::new();
        for inst in file.instruments {
            inst.validate()?;
            registry.instruments.insert(inst.instrument_id.clone(), inst);
        }
        Ok(registry)
    }

    pub fn load_from_file<P: AsRef<Path>>(path: P) -> Result<Self, InstrumentError> {
        let content = std::fs::read_to_string(path)?;
        Self::load_from_yaml_str(&content)
    }

    pub fn get(&self, id: &str) -> Option<&InstrumentDefinition> {
        self.instruments.get(id)
    }

    pub fn list(&self) -> Vec<&InstrumentDefinition> {
        self.instruments.values().collect()
    }
}
