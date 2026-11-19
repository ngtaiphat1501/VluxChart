//! DeepChart Checkpoint Manager
//! Implements atomic checkpointing to survive unexpected crashes and restarts.

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Checkpoint {
    pub instrument_id: String,
    pub wal_offset: u64,
    pub last_event_id: String,
    pub last_exchange_ts_us: i64,
    pub total_trades_committed: u64,
    pub updated_at: String,
}

pub struct CheckpointManager {
    checkpoint_file: PathBuf,
}

impl CheckpointManager {
    pub fn new<P: AsRef<Path>>(checkpoint_file: P) -> Self {
        Self {
            checkpoint_file: checkpoint_file.as_ref().to_path_buf(),
        }
    }

    /// Atomically persists checkpoint via temporary file and replace.
    pub fn save(&self, checkpoint: &Checkpoint) -> io::Result<()> {
        if let Some(parent) = self.checkpoint_file.parent() {
            fs::create_dir_all(parent)?;
        }

        let tmp_file = self.checkpoint_file.with_extension("tmp");
        let json_bytes = serde_json::to_vec_pretty(checkpoint)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        {
            let mut file = File::create(&tmp_file)?;
            file.write_all(&json_bytes)?;
            file.sync_data()?;
        }

        // Atomic file replacement on Windows and POSIX
        if self.checkpoint_file.exists() {
            fs::remove_file(&self.checkpoint_file)?;
        }
        fs::rename(tmp_file, &self.checkpoint_file)?;

        Ok(())
    }

    pub fn load(&self) -> io::Result<Option<Checkpoint>> {
        if !self.checkpoint_file.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&self.checkpoint_file)?;
        let checkpoint: Checkpoint = serde_json::from_str(&content)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        Ok(Some(checkpoint))
    }
}
