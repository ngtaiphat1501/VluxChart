//! DeepChart Raw Event Journal & WAL Module
//! Provides durable append-only write-ahead logging, CRC32 data integrity,
//! crash recovery with truncated-tail handling, and atomic checkpoints.

pub mod checkpoint;
pub mod entry;
pub mod reader;
pub mod writer;

pub use checkpoint::{Checkpoint, CheckpointManager};
pub use entry::{decode_entry, encode_entry, JournalError, HEADER_SIZE, WAL_MAGIC, WAL_VERSION};
pub use reader::{RecoveryResult, WalReader};
pub use writer::WalWriter;
