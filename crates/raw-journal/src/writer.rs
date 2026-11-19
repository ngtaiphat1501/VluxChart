//! DeepChart Append-Only WAL Writer

use crate::entry::encode_entry;
use std::fs::{File, OpenOptions};
use std::io::{self, BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

pub struct WalWriter {
    path: PathBuf,
    writer: BufWriter<File>,
    current_offset: u64,
}

impl WalWriter {
    pub fn open<P: AsRef<Path>>(path: P) -> io::Result<Self> {
        let p = path.as_ref().to_path_buf();
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .append(true)
            .open(&p)?;

        let current_offset = file.seek(SeekFrom::End(0))?;

        Ok(Self {
            path: p,
            writer: BufWriter::new(file),
            current_offset,
        })
    }

    /// Appends a payload with header and CRC32; returns the byte offset where this record begins.
    pub fn append(&mut self, payload: &[u8]) -> io::Result<u64> {
        let offset = self.current_offset;
        let encoded = encode_entry(payload);
        self.writer.write_all(&encoded)?;
        self.current_offset += encoded.len() as u64;
        Ok(offset)
    }

    pub fn flush(&mut self) -> io::Result<()> {
        self.writer.flush()
    }

    pub fn sync(&mut self) -> io::Result<()> {
        self.writer.flush()?;
        self.writer.get_ref().sync_data()
    }

    pub fn current_offset(&self) -> u64 {
        self.current_offset
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}
