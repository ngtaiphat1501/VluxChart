//! DeepChart / VluxChart On-Demand Market Data Pack Store
//!
//! Keeps the Windows `.exe` installer ultra-lightweight (~8-12 MB) by storing zero
//! bulky historical tick/bar archives inside the executable. Instead, historical
//! market data packs are downloaded on demand after login, Gzip-compressed (`flate2`),
//! SHA-256 verified, and persisted atomically in `%LOCALAPPDATA%\DeepChart\market-data\`.

use chrono::Utc;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;

use crate::auth::default_app_data_dir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledDataPackDTO {
    pub pack_id: String,
    pub title: String,
    pub symbols: Vec<String>,
    pub timeframes: Vec<String>,
    pub bar_count: usize,
    pub uncompressed_bytes: u64,
    pub compressed_bytes: u64,
    pub sha256: String,
    pub updated_at_ms: i64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataManifestDTO {
    pub storage_dir: String,
    pub total_compressed_bytes: u64,
    pub total_uncompressed_bytes: u64,
    pub total_bars: usize,
    pub has_core_data: bool,
    pub packs: Vec<InstalledDataPackDTO>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityCheckItemDTO {
    pub pack_id: String,
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityReportDTO {
    pub all_valid: bool,
    pub checked_count: usize,
    pub items: Vec<IntegrityCheckItemDTO>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PersistedManifest {
    packs: Vec<InstalledDataPackDTO>,
}

pub struct DataPackManager {
    data_dir: PathBuf,
    manifest_path: PathBuf,
}

impl DataPackManager {
    pub fn new() -> Self {
        let dir = default_app_data_dir().join("market-data");
        Self::with_dir(dir)
    }

    pub fn with_dir(data_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&data_dir);
        let manifest_path = data_dir.join("manifest.json");
        Self {
            data_dir,
            manifest_path,
        }
    }

    fn sanitize_pack_id(pack_id: &str) -> Result<String, String> {
        let clean: String = pack_id
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        if clean.is_empty() || clean != pack_id {
            return Err(format!("Invalid pack_id: {}", pack_id));
        }
        Ok(clean)
    }

    fn pack_file_path(&self, pack_id: &str) -> Result<PathBuf, String> {
        let clean = Self::sanitize_pack_id(pack_id)?;
        Ok(self.data_dir.join(format!("{}.json.gz", clean)))
    }

    fn read_manifest_internal(&self) -> PersistedManifest {
        if !self.manifest_path.exists() {
            return PersistedManifest::default();
        }
        fs::read_to_string(&self.manifest_path)
            .ok()
            .and_then(|s| serde_json::from_str::<PersistedManifest>(&s).ok())
            .unwrap_or_default()
    }

    fn write_manifest_atomic(&self, manifest: &PersistedManifest) -> Result<(), String> {
        fs::create_dir_all(&self.data_dir).map_err(|e| e.to_string())?;
        let tmp = self.manifest_path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.manifest_path).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_manifest(&self) -> DataManifestDTO {
        let persisted = self.read_manifest_internal();
        // Filter out any pack whose file no longer exists on disk
        let existing_packs: Vec<InstalledDataPackDTO> = persisted
            .packs
            .into_iter()
            .filter(|p| {
                self.pack_file_path(&p.pack_id)
                    .map(|path| path.exists())
                    .unwrap_or(false)
            })
            .collect();

        let total_compressed_bytes: u64 = existing_packs.iter().map(|p| p.compressed_bytes).sum();
        let total_uncompressed_bytes: u64 = existing_packs.iter().map(|p| p.uncompressed_bytes).sum();
        let total_bars: usize = existing_packs.iter().map(|p| p.bar_count).sum();
        let has_core_data = !existing_packs.is_empty() && total_bars > 0;

        DataManifestDTO {
            storage_dir: self.data_dir.to_string_lossy().to_string(),
            total_compressed_bytes,
            total_uncompressed_bytes,
            total_bars,
            has_core_data,
            packs: existing_packs,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_pack(
        &self,
        pack_id: &str,
        title: String,
        symbols: Vec<String>,
        timeframes: Vec<String>,
        bar_count: usize,
        source: String,
        payload_json: &str,
    ) -> Result<InstalledDataPackDTO, String> {
        fs::create_dir_all(&self.data_dir).map_err(|e| e.to_string())?;
        let file_path = self.pack_file_path(pack_id)?;
        let uncompressed_bytes = payload_json.len() as u64;

        // Gzip compress payload for minimal disk footprint
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(payload_json.as_bytes())
            .map_err(|e| format!("Compression write failed: {}", e))?;
        let compressed = encoder
            .finish()
            .map_err(|e| format!("Compression finish failed: {}", e))?;

        let compressed_bytes = compressed.len() as u64;
        let sha256 = sha256_hex(&compressed);

        // Atomic file write
        let tmp_path = file_path.with_extension("gz.tmp");
        fs::write(&tmp_path, &compressed).map_err(|e| e.to_string())?;
        fs::rename(&tmp_path, &file_path).map_err(|e| e.to_string())?;

        let meta = InstalledDataPackDTO {
            pack_id: pack_id.to_string(),
            title,
            symbols,
            timeframes,
            bar_count,
            uncompressed_bytes,
            compressed_bytes,
            sha256,
            updated_at_ms: Utc::now().timestamp_millis(),
            source,
        };

        let mut manifest = self.read_manifest_internal();
        manifest.packs.retain(|p| p.pack_id != pack_id);
        manifest.packs.push(meta.clone());
        self.write_manifest_atomic(&manifest)?;

        Ok(meta)
    }

    pub fn load_pack(&self, pack_id: &str) -> Result<String, String> {
        let file_path = self.pack_file_path(pack_id)?;
        if !file_path.exists() {
            return Err(format!("Data pack '{}' not found on disk", pack_id));
        }
        let manifest = self.read_manifest_internal();
        let expected_sha = manifest
            .packs
            .iter()
            .find(|p| p.pack_id == pack_id)
            .map(|p| p.sha256.clone());

        let compressed = fs::read(&file_path).map_err(|e| e.to_string())?;
        if let Some(expected) = expected_sha {
            let actual = sha256_hex(&compressed);
            if actual != expected {
                return Err(format!(
                    "SHA-256 integrity mismatch for pack '{}': expected {}, got {}",
                    pack_id, expected, actual
                ));
            }
        }

        let mut decoder = GzDecoder::new(&compressed[..]);
        let mut json_out = String::new();
        decoder
            .read_to_string(&mut json_out)
            .map_err(|e| format!("Failed to decompress pack '{}': {}", pack_id, e))?;

        Ok(json_out)
    }

    pub fn delete_pack(&self, pack_id: &str) -> Result<DataManifestDTO, String> {
        let file_path = self.pack_file_path(pack_id)?;
        if file_path.exists() {
            fs::remove_file(&file_path).map_err(|e| e.to_string())?;
        }
        let mut manifest = self.read_manifest_internal();
        manifest.packs.retain(|p| p.pack_id != pack_id);
        self.write_manifest_atomic(&manifest)?;
        Ok(self.get_manifest())
    }

    pub fn clear_all(&self) -> Result<DataManifestDTO, String> {
        let manifest = self.read_manifest_internal();
        for p in &manifest.packs {
            if let Ok(path) = self.pack_file_path(&p.pack_id) {
                let _ = fs::remove_file(path);
            }
        }
        self.write_manifest_atomic(&PersistedManifest::default())?;
        Ok(self.get_manifest())
    }

    pub fn verify_integrity(&self) -> IntegrityReportDTO {
        let manifest = self.read_manifest_internal();
        let mut items = Vec::new();
        let mut all_valid = true;

        for p in &manifest.packs {
            match self.pack_file_path(&p.pack_id) {
                Ok(path) if path.exists() => match fs::read(&path) {
                    Ok(bytes) => {
                        let actual = sha256_hex(&bytes);
                        if actual == p.sha256 {
                            items.push(IntegrityCheckItemDTO {
                                pack_id: p.pack_id.clone(),
                                ok: true,
                                message: format!("SHA-256 OK ({}..)", &actual[..12]),
                            });
                        } else {
                            all_valid = false;
                            items.push(IntegrityCheckItemDTO {
                                pack_id: p.pack_id.clone(),
                                ok: false,
                                message: "Checksum mismatch — corrupted pack".into(),
                            });
                        }
                    }
                    Err(e) => {
                        all_valid = false;
                        items.push(IntegrityCheckItemDTO {
                            pack_id: p.pack_id.clone(),
                            ok: false,
                            message: format!("Read error: {}", e),
                        });
                    }
                },
                _ => {
                    all_valid = false;
                    items.push(IntegrityCheckItemDTO {
                        pack_id: p.pack_id.clone(),
                        ok: false,
                        message: "Missing archive file on disk".into(),
                    });
                }
            }
        }

        IntegrityReportDTO {
            all_valid,
            checked_count: items.len(),
            items,
        }
    }
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("deepchart_data_test_{}_{}", name, Uuid::new_v4()));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn test_save_compress_load_and_verify_integrity() {
        let dir = temp_dir("roundtrip");
        let mgr = DataPackManager::with_dir(dir.clone());

        assert!(!mgr.get_manifest().has_core_data);

        let sample_payload = r#"{"XAUUSDT_300000000":[{"bar_start_us":1760000000000000,"close_ticks":384000}]}"#.repeat(20);
        let saved = mgr
            .save_pack(
                "gold_institutional",
                "Gold Institutional Core".into(),
                vec!["XAUUSDT".into()],
                vec!["1m".into(), "5m".into(), "15m".into(), "1h".into()],
                1200,
                "Binance Futures + Bybit".into(),
                &sample_payload,
            )
            .expect("Save pack must succeed");

        assert!(saved.compressed_bytes < saved.uncompressed_bytes, "Gzip must shrink payload");

        let manifest = mgr.get_manifest();
        assert!(manifest.has_core_data);
        assert_eq!(manifest.packs.len(), 1);
        assert_eq!(manifest.total_bars, 1200);

        let loaded = mgr.load_pack("gold_institutional").expect("Load must succeed");
        assert_eq!(loaded, sample_payload);

        let report = mgr.verify_integrity();
        assert!(report.all_valid);
        assert_eq!(report.checked_count, 1);

        // Corrupt a byte and verify checksum catches it!
        let gz_path = dir.join("gold_institutional.json.gz");
        let mut corrupted = fs::read(&gz_path).unwrap();
        corrupted[0] ^= 0xFF;
        fs::write(&gz_path, corrupted).unwrap();

        let bad_report = mgr.verify_integrity();
        assert!(!bad_report.all_valid);
        assert!(mgr.load_pack("gold_institutional").is_err());

        // Clear all
        let after_clear = mgr.clear_all().unwrap();
        assert!(!after_clear.has_core_data);
        assert_eq!(after_clear.packs.len(), 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_path_traversal_pack_id_rejected() {
        let dir = temp_dir("traversal");
        let mgr = DataPackManager::with_dir(dir.clone());
        let res = mgr.save_pack(
            "../evil",
            "Bad".into(),
            vec![],
            vec![],
            0,
            "test".into(),
            "{}",
        );
        assert!(res.is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
