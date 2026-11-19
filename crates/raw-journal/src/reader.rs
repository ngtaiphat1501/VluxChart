//! DeepChart WAL Replay & Recovery Reader

use crate::entry::{decode_entry, JournalError};
use std::fs::File;
use std::io::{BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub struct WalReader {
    _path: PathBuf,
    reader: BufReader<File>,
}

pub struct RecoveryResult {
    pub records: Vec<Vec<u8>>,
    pub valid_bytes: u64,
    pub corruption: Option<JournalError>,
}

impl WalReader {
    pub fn open<P: AsRef<Path>>(path: P) -> std::io::Result<Self> {
        let p = path.as_ref().to_path_buf();
        let file = File::open(&p)?;
        Ok(Self {
            _path: p,
            reader: BufReader::new(file),
        })
    }

    pub fn seek_to(&mut self, offset: u64) -> std::io::Result<()> {
        self.reader.seek(SeekFrom::Start(offset))?;
        Ok(())
    }

    /// Recovers all valid records up to EOF or the first corrupted byte.
    /// Does not panic or discard valid records preceding the corruption.
    pub fn recover_all(&mut self, start_offset: u64) -> RecoveryResult {
        let mut records = Vec::new();
        let mut valid_bytes = start_offset;

        if let Err(e) = self.seek_to(start_offset) {
            return RecoveryResult {
                records,
                valid_bytes,
                corruption: Some(JournalError::Io(e)),
            };
        }

        loop {
            match decode_entry(&mut self.reader) {
                Ok(Some(payload)) => {
                    // 14 bytes header + payload len
                    valid_bytes += (crate::entry::HEADER_SIZE + payload.len()) as u64;
                    records.push(payload);
                }
                Ok(None) => {
                    // Clean EOF
                    return RecoveryResult {
                        records,
                        valid_bytes,
                        corruption: None,
                    };
                }
                Err(err) => {
                    // Corrupted record encountered
                    return RecoveryResult {
                        records,
                        valid_bytes,
                        corruption: Some(err),
                    };
                }
            }
        }
    }
}
