use raw_journal::{Checkpoint, CheckpointManager, WalReader, WalWriter};
use std::fs::OpenOptions;
use std::io::Write;
use tempfile::tempdir;

#[test]
fn test_wal_roundtrip_and_crc_verification() {
    let dir = tempdir().unwrap();
    let wal_path = dir.path().join("btc_trades.wal");

    let mut writer = WalWriter::open(&wal_path).unwrap();
    for i in 0..500 {
        let payload = format!("trade_event_payload_{}", i);
        writer.append(payload.as_bytes()).unwrap();
    }
    writer.sync().unwrap();

    let mut reader = WalReader::open(&wal_path).unwrap();
    let result = reader.recover_all(0);

    assert_eq!(result.records.len(), 500);
    assert!(result.corruption.is_none());

    for (i, record) in result.records.iter().enumerate() {
        let expected = format!("trade_event_payload_{}", i);
        assert_eq!(record, expected.as_bytes());
    }
}

#[test]
fn test_crash_recovery_with_truncated_corrupted_tail() {
    let dir = tempdir().unwrap();
    let wal_path = dir.path().join("crash_test.wal");

    // Write 100 valid records
    let mut writer = WalWriter::open(&wal_path).unwrap();
    for i in 0..100 {
        let payload = format!("safe_committed_record_{}", i);
        writer.append(payload.as_bytes()).unwrap();
    }
    writer.sync().unwrap();
    let valid_offset_before_crash = writer.current_offset();

    // Simulate system crash during an incomplete write:
    // Append 7 partial garbled bytes to the end of the WAL file
    {
        let mut file = OpenOptions::new().append(true).open(&wal_path).unwrap();
        file.write_all(b"CORRUPT").unwrap();
        file.sync_data().unwrap();
    }

    // Recover from WAL:
    let mut reader = WalReader::open(&wal_path).unwrap();
    let result = reader.recover_all(0);

    // Assert that all 100 pre-crash committed records are fully recovered
    assert_eq!(result.records.len(), 100);
    assert_eq!(result.valid_bytes, valid_offset_before_crash);
    assert!(result.corruption.is_some(), "Corrupted tail must be reported");

    for (i, record) in result.records.iter().enumerate() {
        let expected = format!("safe_committed_record_{}", i);
        assert_eq!(record, expected.as_bytes());
    }
}

#[test]
fn test_atomic_checkpoint_persistence() {
    let dir = tempdir().unwrap();
    let cp_path = dir.path().join("checkpoint.json");
    let manager = CheckpointManager::new(&cp_path);

    assert!(manager.load().unwrap().is_none());

    let cp = Checkpoint {
        instrument_id: "BYBIT:LINEAR_PERP:BTCUSDT:PERP".into(),
        wal_offset: 1048576,
        last_event_id: "trade-uuid-999".into(),
        last_exchange_ts_us: 1794500000000000,
        total_trades_committed: 50000,
        updated_at: "2026-11-13T12:00:00Z".into(),
    };

    manager.save(&cp).unwrap();
    let loaded = manager.load().unwrap().expect("Checkpoint should exist");
    assert_eq!(loaded, cp);
}
