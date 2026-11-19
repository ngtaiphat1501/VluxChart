//! DeepChart WAL Entry Encoding & CRC32 Verification

use crc32fast::Hasher;
use std::io::{self, Read};
use thiserror::Error;

pub const WAL_MAGIC: [u8; 4] = [0x44, 0x43, 0x57, 0x41]; // "DCWA"
pub const WAL_VERSION: u16 = 1;
pub const HEADER_SIZE: usize = 14; // 4 magic + 2 version + 4 len + 4 crc32

#[derive(Error, Debug)]
pub enum JournalError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("Corrupted WAL entry: invalid magic bytes {0:?}")]
    InvalidMagic([u8; 4]),
    #[error("Unsupported WAL version: {0}")]
    UnsupportedVersion(u16),
    #[error("CRC32 checksum mismatch: expected {expected:#x}, got {computed:#x}")]
    CrcMismatch { expected: u32, computed: u32 },
    #[error("Unexpected end of file while reading record")]
    UnexpectedEof,
}

pub fn encode_entry(payload: &[u8]) -> Vec<u8> {
    let mut hasher = Hasher::new();
    hasher.update(payload);
    let crc = hasher.finalize();

    let mut buf = Vec::with_capacity(HEADER_SIZE + payload.len());
    buf.extend_from_slice(&WAL_MAGIC);
    buf.extend_from_slice(&WAL_VERSION.to_le_bytes());
    buf.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    buf.extend_from_slice(&crc.to_le_bytes());
    buf.extend_from_slice(payload);
    buf
}

pub fn decode_entry<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>, JournalError> {
    let mut first_byte = [0u8; 1];
    match reader.read(&mut first_byte) {
        Ok(0) => return Ok(None), // Clean EOF (exact boundary)
        Ok(_) => {}
        Err(e) => return Err(JournalError::Io(e)),
    }

    let mut header = [0u8; HEADER_SIZE];
    header[0] = first_byte[0];
    if let Err(e) = reader.read_exact(&mut header[1..]) {
        if e.kind() == io::ErrorKind::UnexpectedEof {
            return Err(JournalError::UnexpectedEof);
        }
        return Err(JournalError::Io(e));
    }

    let magic: [u8; 4] = header[0..4].try_into().unwrap();
    if magic != WAL_MAGIC {
        return Err(JournalError::InvalidMagic(magic));
    }

    let version = u16::from_le_bytes(header[4..6].try_into().unwrap());
    if version != WAL_VERSION {
        return Err(JournalError::UnsupportedVersion(version));
    }

    let len = u32::from_le_bytes(header[6..10].try_into().unwrap()) as usize;
    let expected_crc = u32::from_le_bytes(header[10..14].try_into().unwrap());

    let mut payload = vec![0u8; len];
    if let Err(e) = reader.read_exact(&mut payload) {
        if e.kind() == io::ErrorKind::UnexpectedEof {
            return Err(JournalError::UnexpectedEof);
        }
        return Err(JournalError::Io(e));
    }

    let mut hasher = Hasher::new();
    hasher.update(&payload);
    let computed_crc = hasher.finalize();

    if computed_crc != expected_crc {
        return Err(JournalError::CrcMismatch {
            expected: expected_crc,
            computed: computed_crc,
        });
    }

    Ok(Some(payload))
}
