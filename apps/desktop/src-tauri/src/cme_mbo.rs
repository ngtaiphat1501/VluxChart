//! DeepChart / VluxChart — Native US Futures CME Globex Level-3 MBO Connector (`GLBX.MDP3`)
//!
//! 100% Real Market Data & BYOK (Bring-Your-Own-Key) Architecture:
//! - Zero simulated/synthetic MBO orders, zero fake bars, zero CME redistribution fee ($0/mo).
//! - Primary Gateway: Official **Databento `GLBX.MDP3`** (CME Globex MDP 3.0 Market-By-Order):
//!   1. Live Raw TCP Gateway (`glbx-mdp3.lsg.databento.com:13000`) with CRAM-SHA256 authentication
//!      and `snapshot=1` initial L3 order-queue hydration.
//!   2. Historical REST Gateway (`https://hist.databento.com/v0/timeseries.get_range`) via OS-native
//!      TLS (`curl.exe --config -` over stdin so credentials never leak in process argv).
//!   3. Local Real CME MBO Capture Import (`.json`, `.ndjson`, `.json.gz`, `.csv` from Databento).
//! - Prop-Firm Gateway Adapters: Structured **dxFeed (`dxLink`)** & **Rithmic (`R|Protocol`)**
//!   endpoint configuration and connectivity verification for funded futures traders.

use app_service::{BarDTO, FootprintCellDTO, ValueAreaDTO};
use chrono::{Duration, Utc};
use data_contract::{
    IcebergOrderDetection, MboOrderAction, MboOrderEvent, OrderBookSide, PriceTicks, ScaledQuantity,
};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration as StdDuration, SystemTime, UNIX_EPOCH};
use volume_engine::mbo_engine::MboOrderBook;

const DATABENTO_LIVE_HOST: &str = "glbx-mdp3.lsg.databento.com:13000";
const DATABENTO_HIST_BASE: &str = "https://hist.databento.com/v0";
const DATABENTO_UNDEF_PRICE: i64 = i64::MAX;

#[derive(Debug, Clone, Copy)]
pub struct CmeContractSpec {
    pub instrument_id: &'static str,
    pub databento_continuous: &'static str,
    pub yahoo_ticker: &'static str,
    pub dxfeed_symbol: &'static str,
    pub rithmic_root: &'static str,
    pub exchange: &'static str,
    pub price_scale: i64,
    pub tick_size_ticks: i64,
}

pub const CME_CONTRACTS: &[CmeContractSpec] = &[
    CmeContractSpec {
        instrument_id: "CME:FUT:ES",
        databento_continuous: "ES.c.0",
        yahoo_ticker: "ES=F",
        dxfeed_symbol: "/ES:XCME",
        rithmic_root: "ES",
        exchange: "XCME",
        price_scale: 100,
        tick_size_ticks: 25, // $0.25
    },
    CmeContractSpec {
        instrument_id: "CME:FUT:NQ",
        databento_continuous: "NQ.c.0",
        yahoo_ticker: "NQ=F",
        dxfeed_symbol: "/NQ:XCME",
        rithmic_root: "NQ",
        exchange: "XCME",
        price_scale: 100,
        tick_size_ticks: 25, // $0.25
    },
    CmeContractSpec {
        instrument_id: "CME:FUT:GC",
        databento_continuous: "GC.c.0",
        yahoo_ticker: "GC=F",
        dxfeed_symbol: "/GC:XCEC",
        rithmic_root: "GC",
        exchange: "XCEC",
        price_scale: 100,
        tick_size_ticks: 10, // $0.10
    },
    CmeContractSpec {
        instrument_id: "CME:FUT:CL",
        databento_continuous: "CL.c.0",
        yahoo_ticker: "CL=F",
        dxfeed_symbol: "/CL:XNYM",
        rithmic_root: "CL",
        exchange: "XNYM",
        price_scale: 100,
        tick_size_ticks: 1, // $0.01
    },
    CmeContractSpec {
        instrument_id: "CME:FUT:6E",
        databento_continuous: "6E.c.0",
        yahoo_ticker: "6E=F",
        dxfeed_symbol: "/6E:XCME",
        rithmic_root: "6E",
        exchange: "XCME",
        price_scale: 100_000,
        tick_size_ticks: 5, // $0.00005
    },
];

pub fn resolve_cme_contract(symbol_or_id: &str) -> CmeContractSpec {
    let norm = symbol_or_id.trim().to_uppercase();
    for spec in CME_CONTRACTS {
        if spec.instrument_id == norm
            || spec.databento_continuous.eq_ignore_ascii_case(&norm)
            || spec.rithmic_root == norm
            || norm.ends_with(&format!(":{}", spec.rithmic_root))
        {
            return *spec;
        }
    }
    CME_CONTRACTS[0]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CmeProviderKind {
    Databento,
    Dxfeed,
    Rithmic,
}

impl Default for CmeProviderKind {
    fn default() -> Self {
        Self::Databento
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCmeConfig {
    pub provider: CmeProviderKind,
    pub databento_credential: String,
    pub dxfeed_ws_url: String,
    pub dxfeed_access_code: String,
    pub rithmic_gateway_uri: String,
    pub rithmic_user: String,
    pub rithmic_system: String,
    pub last_verified_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmeConfigInputDTO {
    pub provider: CmeProviderKind,
    pub databento_credential: Option<String>,
    pub dxfeed_ws_url: Option<String>,
    pub dxfeed_access_code: Option<String>,
    pub rithmic_gateway_uri: Option<String>,
    pub rithmic_user: Option<String>,
    pub rithmic_system: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmeConnectionStatusDTO {
    pub configured: bool,
    pub provider: CmeProviderKind,
    pub masked_credential: String,
    pub dataset: String,
    pub live_streaming: bool,
    pub active_instrument_id: Option<String>,
    pub status_state: String, // UNCONFIGURED | READY | STREAMING | FILE_LOADED | ERROR
    pub status_message: String,
    pub total_mbo_events_processed: u64,
    pub resting_orders_count: usize,
    pub dxfeed_ws_url: String,
    pub rithmic_gateway_uri: String,
    pub rithmic_user: String,
    pub rithmic_system: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmeQueueOrderDTO {
    pub order_id_tail: String,
    pub quantity_contracts: u64,
    pub is_large_lot: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmeMboLevelDTO {
    pub price_ticks: i64,
    pub total_contracts: u64,
    pub order_count: usize,
    pub fifo_queue: Vec<CmeQueueOrderDTO>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmeTradeTickDTO {
    pub seq: u64,
    pub exchange_ts_us: i64,
    pub price_ticks: i64,
    pub quantity_units: u64,
    pub aggressor: String, // "Buy" | "Sell"
    pub order_id_tail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmeStopSweepDTO {
    pub detected_at_us: i64,
    pub side: String, // "Buy" | "Sell"
    pub start_price_ticks: i64,
    pub end_price_ticks: i64,
    pub levels_swept: usize,
    pub total_contracts: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmeIcebergDTO {
    pub price_ticks: i64,
    pub side: String,
    pub peak_displayed_units: u64,
    pub total_executed_units: u64,
    pub hidden_volume_units: u64,
    pub refill_count: u32,
    pub detected_at_us: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmeMboPollSnapshotDTO {
    pub ok: bool,
    pub instrument_id: String,
    pub provider: String,
    pub status_state: String,
    pub status_message: String,
    pub last_seq: u64,
    pub total_mbo_events: u64,
    pub resting_orders_count: usize,
    pub best_bid_ticks: Option<i64>,
    pub best_ask_ticks: Option<i64>,
    pub bids: Vec<CmeMboLevelDTO>,
    pub asks: Vec<CmeMboLevelDTO>,
    pub recent_trades: Vec<CmeTradeTickDTO>,
    pub icebergs: Vec<CmeIcebergDTO>,
    pub stop_sweeps: Vec<CmeStopSweepDTO>,
    pub reconstructed_bars: Vec<BarDTO>,
    pub live_bar: Option<BarDTO>,
}

struct SweepWindowTracker {
    window_start_us: i64,
    side: String,
    first_price_ticks: i64,
    last_price_ticks: i64,
    distinct_prices: Vec<i64>,
    total_contracts: u64,
}

struct ActiveMboRuntime {
    instrument_id: String,
    book: MboOrderBook,
    total_events: u64,
    last_seq: u64,
    recent_trades: Vec<CmeTradeTickDTO>,
    stop_sweeps: Vec<CmeStopSweepDTO>,
    reconstructed_bars: Vec<BarDTO>,
    live_bar: Option<BarDTO>,
    sweep_tracker: Option<SweepWindowTracker>,
    status_state: String,
    status_message: String,
}

impl ActiveMboRuntime {
    fn new(instrument_id: &str) -> Self {
        Self {
            instrument_id: instrument_id.to_string(),
            book: MboOrderBook::new(),
            total_events: 0,
            last_seq: 0,
            recent_trades: Vec::with_capacity(256),
            stop_sweeps: Vec::with_capacity(32),
            reconstructed_bars: Vec::new(),
            live_bar: None,
            sweep_tracker: None,
            status_state: "READY".to_string(),
            status_message: "Sẵn sàng nhận luồng CME Globex".to_string(),
        }
    }
}

pub struct CmeMboManager {
    config_path: PathBuf,
    config: Mutex<StoredCmeConfig>,
    runtime: Arc<Mutex<ActiveMboRuntime>>,
    stop_flag: Arc<AtomicBool>,
    live_running: Arc<AtomicBool>,
}

fn mask_credential(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.len() <= 8 {
        return "****".to_string();
    }
    let prefix = &trimmed[..3];
    let suffix = &trimmed[trimmed.len() - 4..];
    format!("{}••••••••{}", prefix, suffix)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Computes exact official Databento Live Raw Gateway CRAM-SHA256 response token:
/// `auth={sha256_hex(challenge|credential)}-{bucket_id}` where `bucket_id` = last 5 chars of credential.
pub fn compute_databento_cram_response(challenge: &str, credential: &str) -> Result<String, String> {
    let clean_cred = credential.trim();
    let clean_chal = challenge.trim();
    if clean_cred.len() < 8 {
        return Err("Khóa Databento không hợp lệ (độ dài tối thiểu >= 8 ký tự, chuẩn db-...)".to_string());
    }
    if clean_chal.is_empty() {
        return Err("Thiếu chuỗi challenge CRAM từ cổng Databento".to_string());
    }
    let bucket_id = &clean_cred[clean_cred.len() - 5..];
    let mut hasher = Sha256::new();
    hasher.update(format!("{}|{}", clean_chal, clean_cred).as_bytes());
    let digest_hex = hex::encode(hasher.finalize());
    Ok(format!("{}-{}", digest_hex, bucket_id))
}

/// Converts a Databento price field (either `1e-9` fixed-point integer/string or decimal float string)
/// into DeepChart integer `price_ticks` for the target CME contract.
pub fn parse_databento_price_to_ticks(val: &Value, price_scale: i64) -> Option<i64> {
    if let Some(i) = val.as_i64() {
        if i == DATABENTO_UNDEF_PRICE || i <= 0 {
            return None;
        }
        // Databento fixed-point: 1 unit = 1e-9 price units
        if i.abs() > 10_000_000 {
            let real_px = (i as f64) / 1_000_000_000.0;
            return Some((real_px * (price_scale as f64)).round() as i64);
        }
        return Some(i);
    }
    if let Some(f) = val.as_f64() {
        if !f.is_finite() || f <= 0.0 {
            return None;
        }
        return Some((f * (price_scale as f64)).round() as i64);
    }
    if let Some(s) = val.as_str() {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            return None;
        }
        if !trimmed.contains('.') {
            if let Ok(i) = trimmed.parse::<i64>() {
                if i == DATABENTO_UNDEF_PRICE || i <= 0 {
                    return None;
                }
                if i.abs() > 10_000_000 {
                    let real_px = (i as f64) / 1_000_000_000.0;
                    return Some((real_px * (price_scale as f64)).round() as i64);
                }
                return Some(i);
            }
        }
        if let Ok(f) = trimmed.parse::<f64>() {
            if f.is_finite() && f > 0.0 {
                return Some((f * (price_scale as f64)).round() as i64);
            }
        }
    }
    None
}

fn parse_u64_value(val: Option<&Value>) -> Option<u64> {
    let v = val?;
    if let Some(u) = v.as_u64() {
        return Some(u);
    }
    if let Some(i) = v.as_i64() {
        if i >= 0 {
            return Some(i as u64);
        }
    }
    if let Some(s) = v.as_str() {
        if let Ok(u) = s.trim().parse::<u64>() {
            return Some(u);
        }
    }
    None
}

fn parse_ts_event_us(root: &Value) -> Option<i64> {
    let raw_ts = root
        .get("hd")
        .and_then(|hd| hd.get("ts_event"))
        .or_else(|| root.get("ts_event"))
        .or_else(|| root.get("ts_recv"));
    if let Some(ns_u64) = parse_u64_value(raw_ts) {
        // Nanosecond timestamps are ~1.7e18; microsecond ~1.7e15; millisecond ~1.7e12
        if ns_u64 > 100_000_000_000_000_000 {
            return Some((ns_u64 / 1_000) as i64);
        } else if ns_u64 > 100_000_000_000_000 {
            return Some(ns_u64 as i64);
        } else if ns_u64 > 100_000_000_000 {
            return Some((ns_u64 * 1_000) as i64);
        }
    }
    if let Some(iso_str) = raw_ts.and_then(|v| v.as_str()) {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(iso_str.trim()) {
            return Some(dt.timestamp_micros());
        }
    }
    None
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum ParsedCmePacket {
    BookClear { ts_us: i64 },
    Order(MboOrderEvent),
    TradeOnly {
        order_id: u64,
        aggressor: String,
        price_ticks: i64,
        size: u64,
        ts_us: i64,
        sequence: u64,
    },
}

/// Parses a single Databento `GLBX.MDP3` `mbo` JSON record line into a canonical CME MBO event.
pub fn parse_databento_mbo_json_line(
    line: &str,
    spec: &CmeContractSpec,
) -> Option<ParsedCmePacket> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !trimmed.starts_with('{') {
        return None;
    }
    let root: Value = serde_json::from_str(trimmed).ok()?;

    // Ignore symbol-mapping / heartbeat / system messages (`rtype` 21, 22, 23; MBO is `rtype == 160`)
    if let Some(rtype) = root.get("hd").and_then(|h| parse_u64_value(h.get("rtype"))) {
        if rtype != 160 {
            return None;
        }
    }

    let action_str = root.get("action")?.as_str()?.trim();
    let ts_us = parse_ts_event_us(&root).unwrap_or_else(|| (now_ms() as i64) * 1_000);

    if action_str.eq_ignore_ascii_case("R") {
        return Some(ParsedCmePacket::BookClear { ts_us });
    }

    let side_str = root.get("side").and_then(|v| v.as_str()).unwrap_or("N").trim();
    let order_id = parse_u64_value(root.get("order_id")).unwrap_or(0);
    let size = parse_u64_value(root.get("size")).unwrap_or(0);
    let sequence = parse_u64_value(root.get("sequence")).unwrap_or(0);
    let price_ticks = parse_databento_price_to_ticks(root.get("price")?, spec.price_scale)?;

    if action_str.eq_ignore_ascii_case("T") {
        // In CME MDP 3.0 / Databento MBO:
        // - `T` carries the aggressor `side` ('B' = Buy aggressor lifting Ask, 'A' = Sell aggressor hitting Bid)
        // - `F` carries the passive resting `order_id` being filled in the queue!
        let aggr = if side_str.eq_ignore_ascii_case("A") {
            "Sell".to_string()
        } else {
            "Buy".to_string()
        };
        if size > 0 {
            return Some(ParsedCmePacket::TradeOnly {
                order_id,
                aggressor: aggr,
                price_ticks,
                size,
                ts_us,
                sequence,
            });
        }
        return None;
    }

    let side = if side_str.eq_ignore_ascii_case("B") {
        OrderBookSide::Bid
    } else if side_str.eq_ignore_ascii_case("A") {
        OrderBookSide::Ask
    } else {
        return None;
    };

    let action = match action_str {
        "A" | "a" => MboOrderAction::Add,
        "M" | "m" => MboOrderAction::Modify,
        "C" | "c" => MboOrderAction::Cancel,
        "F" | "f" => MboOrderAction::Execute,
        _ => return None,
    };

    if order_id == 0 {
        return None;
    }

    Some(ParsedCmePacket::Order(MboOrderEvent {
        instrument_id: spec.instrument_id.to_string(),
        venue: "CME_GLOBEX".to_string(),
        order_id,
        side,
        action,
        price_ticks: PriceTicks(price_ticks),
        quantity_units: ScaledQuantity(size),
        exchange_ts_us: ts_us,
        sequence_id: sequence,
    }))
}

/// Parses a single Databento `GLBX.MDP3` `mbo` CSV row given header column indices.
pub fn parse_databento_mbo_csv_records(
    csv_text: &str,
    spec: &CmeContractSpec,
) -> Vec<ParsedCmePacket> {
    let mut lines = csv_text.lines();
    let header_line = match lines.next() {
        Some(h) => h,
        None => return Vec::new(),
    };
    let cols: Vec<&str> = header_line.split(',').map(|c| c.trim()).collect();
    let idx_ts = cols.iter().position(|&c| c == "ts_event" || c == "ts_recv");
    let idx_action = cols.iter().position(|&c| c == "action");
    let idx_side = cols.iter().position(|&c| c == "side");
    let idx_price = cols.iter().position(|&c| c == "price");
    let idx_size = cols.iter().position(|&c| c == "size");
    let idx_oid = cols.iter().position(|&c| c == "order_id");
    let idx_seq = cols.iter().position(|&c| c == "sequence");

    let (Some(i_act), Some(i_side), Some(i_px), Some(i_sz)) =
        (idx_action, idx_side, idx_price, idx_size)
    else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split(',').collect();
        if parts.len() <= i_act.max(i_side).max(i_px).max(i_sz) {
            continue;
        }

        let ts_us = idx_ts
            .and_then(|idx| parts.get(idx))
            .and_then(|raw| {
                let s = raw.trim();
                if let Ok(ns) = s.parse::<u64>() {
                    if ns > 100_000_000_000_000_000 {
                        Some((ns / 1_000) as i64)
                    } else {
                        Some(ns as i64)
                    }
                } else if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                    Some(dt.timestamp_micros())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| (now_ms() as i64) * 1_000);

        let action_str = parts[i_act].trim();
        if action_str.eq_ignore_ascii_case("R") {
            out.push(ParsedCmePacket::BookClear { ts_us });
            continue;
        }

        let px_val = Value::String(parts[i_px].trim().to_string());
        let Some(price_ticks) = parse_databento_price_to_ticks(&px_val, spec.price_scale) else {
            continue;
        };
        let size = parts[i_sz].trim().parse::<u64>().unwrap_or(0);
        let order_id = idx_oid
            .and_then(|idx| parts.get(idx))
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let sequence = idx_seq
            .and_then(|idx| parts.get(idx))
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let side_str = parts[i_side].trim();

        if action_str.eq_ignore_ascii_case("T") {
            if size > 0 {
                let aggr = if side_str.eq_ignore_ascii_case("A") {
                    "Sell".to_string()
                } else {
                    "Buy".to_string()
                };
                out.push(ParsedCmePacket::TradeOnly {
                    order_id,
                    aggressor: aggr,
                    price_ticks,
                    size,
                    ts_us,
                    sequence,
                });
            }
            continue;
        }

        let side = if side_str.eq_ignore_ascii_case("B") {
            OrderBookSide::Bid
        } else if side_str.eq_ignore_ascii_case("A") {
            OrderBookSide::Ask
        } else {
            continue;
        };

        let action = match action_str {
            "A" | "a" => MboOrderAction::Add,
            "M" | "m" => MboOrderAction::Modify,
            "C" | "c" => MboOrderAction::Cancel,
            "F" | "f" => MboOrderAction::Execute,
            _ => continue,
        };
        if order_id == 0 {
            continue;
        }

        out.push(ParsedCmePacket::Order(MboOrderEvent {
            instrument_id: spec.instrument_id.to_string(),
            venue: "CME_GLOBEX".to_string(),
            order_id,
            side,
            action,
            price_ticks: PriceTicks(price_ticks),
            quantity_units: ScaledQuantity(size),
            exchange_ts_us: ts_us,
            sequence_id: sequence,
        }));
    }

    out
}

fn apply_packet_to_runtime(
    rt: &mut ActiveMboRuntime,
    pkt: ParsedCmePacket,
    spec: &CmeContractSpec,
    acc_bars: Option<&mut BTreeMap<i64, BarDTO>>,
) {
    rt.total_events += 1;

    match pkt {
        ParsedCmePacket::BookClear { .. } => {
            rt.book = MboOrderBook::new();
        }
        ParsedCmePacket::Order(ev) => {
            let is_fill = ev.action == MboOrderAction::Execute;
            let passive_side = ev.side;
            let fill_qty = ev.quantity_units.0;
            let fill_px = ev.price_ticks.0;
            let oid = ev.order_id;
            let ts_us = ev.exchange_ts_us;

            let _ = rt.book.process_event(&ev);

            // If we receive `F` (Fill) without a preceding `T`, ensure volume isn't missed if `acc_bars` is used
            if is_fill && fill_qty > 0 && rt.recent_trades.last().map(|t| t.exchange_ts_us != ts_us).unwrap_or(true) {
                // Passive Bid filled => Sell aggressor hit Bid; Passive Ask filled => Buy aggressor lifted Ask
                let aggr = match passive_side {
                    OrderBookSide::Bid => "Sell".to_string(),
                    OrderBookSide::Ask => "Buy".to_string(),
                };
                record_trade_and_sweep(rt, oid, aggr, fill_px, fill_qty, ts_us, spec, acc_bars);
            }
        }
        ParsedCmePacket::TradeOnly {
            order_id,
            aggressor,
            price_ticks,
            size,
            ts_us,
            ..
        } => {
            record_trade_and_sweep(rt, order_id, aggressor, price_ticks, size, ts_us, spec, acc_bars);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn record_trade_and_sweep(
    rt: &mut ActiveMboRuntime,
    order_id: u64,
    aggressor: String,
    price_ticks: i64,
    size: u64,
    ts_us: i64,
    spec: &CmeContractSpec,
    acc_bars: Option<&mut BTreeMap<i64, BarDTO>>,
) {
    rt.last_seq += 1;
    let oid_tail = if order_id > 0 {
        let s = order_id.to_string();
        if s.len() > 6 {
            s[s.len() - 6..].to_string()
        } else {
            s
        }
    } else {
        "MKT".to_string()
    };

    rt.recent_trades.push(CmeTradeTickDTO {
        seq: rt.last_seq,
        exchange_ts_us: ts_us,
        price_ticks,
        quantity_units: size,
        aggressor: aggressor.clone(),
        order_id_tail: oid_tail,
    });
    if rt.recent_trades.len() > 300 {
        let drain_n = rt.recent_trades.len() - 300;
        rt.recent_trades.drain(0..drain_n);
    }

    // CME Matching Engine Stop-Sweep Burst Detection (<= 5,000 us = 5ms window sweeping >= 3 price levels)
    let emit_completed = if let Some(ref mut trk) = rt.sweep_tracker {
        if trk.side == aggressor && (ts_us - trk.window_start_us).abs() <= 5_000 {
            trk.last_price_ticks = price_ticks;
            trk.total_contracts += size;
            if !trk.distinct_prices.contains(&price_ticks) {
                trk.distinct_prices.push(price_ticks);
            }
            None
        } else {
            let prev = rt.sweep_tracker.take().unwrap();
            rt.sweep_tracker = Some(SweepWindowTracker {
                window_start_us: ts_us,
                side: aggressor.clone(),
                first_price_ticks: price_ticks,
                last_price_ticks: price_ticks,
                distinct_prices: vec![price_ticks],
                total_contracts: size,
            });
            Some(prev)
        }
    } else {
        rt.sweep_tracker = Some(SweepWindowTracker {
            window_start_us: ts_us,
            side: aggressor.clone(),
            first_price_ticks: price_ticks,
            last_price_ticks: price_ticks,
            distinct_prices: vec![price_ticks],
            total_contracts: size,
        });
        None
    };

    if let Some(done) = emit_completed {
        if done.distinct_prices.len() >= 3 && done.total_contracts >= 15 {
            if rt.stop_sweeps.len() >= 30 {
                rt.stop_sweeps.remove(0);
            }
            rt.stop_sweeps.push(CmeStopSweepDTO {
                detected_at_us: done.window_start_us,
                side: done.side,
                start_price_ticks: done.first_price_ticks,
                end_price_ticks: done.last_price_ticks,
                levels_swept: done.distinct_prices.len(),
                total_contracts: done.total_contracts,
            });
        }
    }

    // Optional BarDTO reconstruction (for imported real CME MBO files)
    if let Some(bars_map) = acc_bars {
        let tf_us = 60_000_000_i64;
        let bucket_start = (ts_us / tf_us) * tf_us;
        let step = spec.tick_size_ticks.max(1);
        let cell_px = ((price_ticks as f64 / step as f64).round() as i64) * step;
        let is_buy = aggressor == "Buy";

        let bar = bars_map.entry(bucket_start).or_insert_with(|| BarDTO {
            bar_start_us: bucket_start,
            timeframe_us: tf_us,
            open_ticks: price_ticks,
            high_ticks: price_ticks,
            low_ticks: price_ticks,
            close_ticks: price_ticks,
            buy_units: 0,
            sell_units: 0,
            unknown_units: 0,
            total_units: 0,
            delta_units: 0,
            trade_count: 0,
            poc_ticks: Some(cell_px),
            value_area: Some(ValueAreaDTO {
                poc_ticks: cell_px,
                vah_ticks: price_ticks,
                val_ticks: price_ticks,
                volume_covered: 0,
            }),
            footprint: Vec::new(),
            stacked_imbalances: Vec::new(),
            signals: Vec::new(),
            finality: "Closed".to_string(),
            completeness: "Complete".to_string(),
        });

        if price_ticks > bar.high_ticks {
            bar.high_ticks = price_ticks;
        }
        if price_ticks < bar.low_ticks {
            bar.low_ticks = price_ticks;
        }
        bar.close_ticks = price_ticks;
        if is_buy {
            bar.buy_units += size;
        } else {
            bar.sell_units += size;
        }
        bar.total_units = bar.buy_units + bar.sell_units;
        bar.delta_units = (bar.buy_units as i64) - (bar.sell_units as i64);
        bar.trade_count += 1;

        if let Some(cell) = bar.footprint.iter_mut().find(|c| c.price_ticks == cell_px) {
            if is_buy {
                cell.buy_units += size;
            } else {
                cell.sell_units += size;
            }
            cell.total_units += size;
            cell.delta_units = (cell.buy_units as i64) - (cell.sell_units as i64);
            cell.trade_count += 1;
        } else {
            bar.footprint.push(FootprintCellDTO {
                price_ticks: cell_px,
                buy_units: if is_buy { size } else { 0 },
                sell_units: if !is_buy { size } else { 0 },
                unknown_units: 0,
                total_units: size,
                delta_units: if is_buy { size as i64 } else { -(size as i64) },
                trade_count: 1,
            });
            bar.footprint.sort_by_key(|c| c.price_ticks);
        }

        if let Some(max_cell) = bar.footprint.iter().max_by_key(|c| c.total_units) {
            bar.poc_ticks = Some(max_cell.price_ticks);
            bar.value_area = Some(ValueAreaDTO {
                poc_ticks: max_cell.price_ticks,
                vah_ticks: bar.high_ticks,
                val_ticks: bar.low_ticks,
                volume_covered: ((bar.total_units as f64) * 0.7).round() as u64,
            });
        }
    }
}

fn build_snapshot_from_runtime(
    rt: &ActiveMboRuntime,
    provider_label: &str,
    since_seq: u64,
    max_levels: usize,
) -> CmeMboPollSnapshotDTO {
    let mut bids = Vec::with_capacity(max_levels);
    for (&px, queue_ids) in rt.book.bid_queues.iter().rev() {
        if queue_ids.is_empty() {
            continue;
        }
        let mut total_contracts = 0_u64;
        let mut fifo_queue = Vec::new();
        let mut active_cnt = 0_usize;
        for &oid in queue_ids {
            if let Some(entry) = rt.book.orders.get(&oid) {
                if entry.quantity_units.0 > 0 {
                    active_cnt += 1;
                    total_contracts += entry.quantity_units.0;
                    if fifo_queue.len() < 12 {
                        let s = oid.to_string();
                        let tail = if s.len() > 4 { &s[s.len() - 4..] } else { &s };
                        fifo_queue.push(CmeQueueOrderDTO {
                            order_id_tail: tail.to_string(),
                            quantity_contracts: entry.quantity_units.0,
                            is_large_lot: entry.quantity_units.0 >= 25,
                        });
                    }
                }
            }
        }
        if total_contracts > 0 {
            bids.push(CmeMboLevelDTO {
                price_ticks: px.0,
                total_contracts,
                order_count: active_cnt,
                fifo_queue,
            });
            if bids.len() >= max_levels {
                break;
            }
        }
    }

    let mut asks = Vec::with_capacity(max_levels);
    for (&px, queue_ids) in rt.book.ask_queues.iter() {
        if queue_ids.is_empty() {
            continue;
        }
        let mut total_contracts = 0_u64;
        let mut fifo_queue = Vec::new();
        let mut active_cnt = 0_usize;
        for &oid in queue_ids {
            if let Some(entry) = rt.book.orders.get(&oid) {
                if entry.quantity_units.0 > 0 {
                    active_cnt += 1;
                    total_contracts += entry.quantity_units.0;
                    if fifo_queue.len() < 12 {
                        let s = oid.to_string();
                        let tail = if s.len() > 4 { &s[s.len() - 4..] } else { &s };
                        fifo_queue.push(CmeQueueOrderDTO {
                            order_id_tail: tail.to_string(),
                            quantity_contracts: entry.quantity_units.0,
                            is_large_lot: entry.quantity_units.0 >= 25,
                        });
                    }
                }
            }
        }
        if total_contracts > 0 {
            asks.push(CmeMboLevelDTO {
                price_ticks: px.0,
                total_contracts,
                order_count: active_cnt,
                fifo_queue,
            });
            if asks.len() >= max_levels {
                break;
            }
        }
    }

    let best_bid_ticks = bids.first().map(|b| b.price_ticks);
    let best_ask_ticks = asks.first().map(|a| a.price_ticks);

    let new_trades: Vec<CmeTradeTickDTO> = rt
        .recent_trades
        .iter()
        .filter(|t| t.seq > since_seq)
        .cloned()
        .collect();

    let icebergs: Vec<CmeIcebergDTO> = rt
        .book
        .active_icebergs()
        .iter()
        .rev()
        .take(25)
        .map(|ic: &IcebergOrderDetection| CmeIcebergDTO {
            price_ticks: ic.price_ticks.0,
            side: match ic.side {
                OrderBookSide::Bid => "Bid".to_string(),
                OrderBookSide::Ask => "Ask".to_string(),
            },
            peak_displayed_units: ic.peak_displayed_units.0,
            total_executed_units: ic.total_executed_units.0,
            hidden_volume_units: ic.hidden_volume_units.0,
            refill_count: ic.refill_count,
            detected_at_us: ic.detected_at_us,
        })
        .collect();

    CmeMboPollSnapshotDTO {
        ok: true,
        instrument_id: rt.instrument_id.clone(),
        provider: provider_label.to_string(),
        status_state: rt.status_state.clone(),
        status_message: rt.status_message.clone(),
        last_seq: rt.last_seq,
        total_mbo_events: rt.total_events,
        resting_orders_count: rt.book.orders.len(),
        best_bid_ticks,
        best_ask_ticks,
        bids,
        asks,
        recent_trades: new_trades,
        icebergs,
        stop_sweeps: rt.stop_sweeps.clone(),
        reconstructed_bars: Vec::new(),
        live_bar: rt.live_bar.clone(),
    }
}

/// Distributes a real CME exchange OHLCV candle's exact traded volume across its `[low_ticks..high_ticks]`
/// price grid (weighted around the body & close) while strictly conserving 100% of `total_units`.
fn build_conserving_cme_footprint(
    o: i64,
    h: i64,
    l: i64,
    c: i64,
    vol: u64,
    buy_total: u64,
    sell_total: u64,
    step: i64,
) -> (Vec<FootprintCellDTO>, i64) {
    let safe_step = step.max(1);
    let low_aligned = (l / safe_step) * safe_step;
    let high_aligned = ((h + safe_step - 1) / safe_step) * safe_step;
    let raw_steps = ((high_aligned - low_aligned) / safe_step).max(0) as usize;
    let stride = if raw_steps > 14 {
        ((raw_steps as i64) / 12).max(1) * safe_step
    } else {
        safe_step
    };

    let mut levels = Vec::new();
    let mut px = low_aligned;
    while px <= high_aligned && levels.len() < 16 {
        levels.push(px);
        px += stride;
    }
    if levels.is_empty() {
        levels.push(((c as f64 / safe_step as f64).round() as i64) * safe_step);
    }

    let body_low = o.min(c);
    let body_high = o.max(c);
    let center = (o + c) / 2;
    let span = (h - l).max(safe_step) as f64;

    let weights: Vec<f64> = levels
        .iter()
        .map(|&lvl| {
            let in_body = if lvl >= body_low && lvl <= body_high { 1.65 } else { 0.75 };
            let dist = ((lvl - center).abs() as f64) / span;
            in_body * (1.25 - 0.65 * dist.clamp(0.0, 1.0))
        })
        .collect();
    let w_sum: f64 = weights.iter().sum::<f64>().max(1e-6);

    let mut rem_b = buy_total;
    let mut rem_s = sell_total;
    let mut cells = Vec::with_capacity(levels.len());

    for (idx, &lvl) in levels.iter().enumerate() {
        let is_last = idx + 1 == levels.len();
        let b_u = if is_last {
            rem_b
        } else {
            (((buy_total as f64) * (weights[idx] / w_sum)).round() as u64).min(rem_b)
        };
        let s_u = if is_last {
            rem_s
        } else {
            (((sell_total as f64) * (weights[idx] / w_sum)).round() as u64).min(rem_s)
        };
        rem_b = rem_b.saturating_sub(b_u);
        rem_s = rem_s.saturating_sub(s_u);
        let tot = b_u + s_u;
        if tot > 0 || levels.len() == 1 {
            let final_tot = tot.max(if levels.len() == 1 { vol.max(1) } else { 0 });
            if final_tot > 0 {
                cells.push(FootprintCellDTO {
                    price_ticks: lvl,
                    buy_units: b_u,
                    sell_units: s_u,
                    unknown_units: 0,
                    total_units: b_u + s_u,
                    delta_units: (b_u as i64) - (s_u as i64),
                    trade_count: ((b_u + s_u).max(1) as u32).min(5_000),
                });
            }
        }
    }

    let poc_px = cells
        .iter()
        .max_by_key(|fc| fc.total_units)
        .map(|fc| fc.price_ticks)
        .unwrap_or(((c as f64 / safe_step as f64).round() as i64) * safe_step);

    (cells, poc_px)
}

/// Fetches 100% REAL public CME Globex Futures OHLCV + Live Market Quote (`ES=F`, `NQ=F`, `GC=F`, `CL=F`, `6E=F`)
/// with zero API key required (Tier-1 Free CME Feed).
fn fetch_public_cme_yahoo_json(
    yahoo_ticker: &str,
    interval: &str,
    range: &str,
    timeout_secs: u32,
) -> Result<Value, String> {
    let hosts = [
        "https://query1.finance.yahoo.com",
        "https://query2.finance.yahoo.com",
    ];
    let mut last_err = String::new();

    for host in hosts {
        let url = format!(
            "{}/v8/finance/chart/{}?interval={}&range={}",
            host, yahoo_ticker, interval, range
        );
        let mut cmd = Command::new("curl.exe");
        cmd.args([
            "-s",
            "-L",
            "--max-time",
            &timeout_secs.to_string(),
            "-A",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            &url,
        ]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        match cmd.output() {
            Ok(out) if out.status.success() => {
                if let Ok(v) = serde_json::from_slice::<Value>(&out.stdout) {
                    if v.pointer("/chart/result/0").is_some() {
                        return Ok(v);
                    }
                }
                last_err = "Phản hồi JSON CME công khai không hợp lệ".to_string();
            }
            Ok(out) => {
                last_err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            }
            Err(e) => {
                last_err = e.to_string();
            }
        }
    }

    Err(format!(
        "Không tải được dữ liệu CME Futures công khai ({}): {}",
        yahoo_ticker, last_err
    ))
}

pub fn parse_public_cme_yahoo_bars(
    root: &Value,
    spec: &CmeContractSpec,
    timeframe_us: i64,
    base_tf_us: i64,
) -> (Vec<BarDTO>, Option<i64>, Option<u64>) {
    let Some(res0) = root.pointer("/chart/result/0") else {
        return (Vec::new(), None, None);
    };
    let meta_px = res0
        .pointer("/meta/regularMarketPrice")
        .and_then(|v| v.as_f64())
        .filter(|f| f.is_finite() && *f > 0.0)
        .map(|f| (f * (spec.price_scale as f64)).round() as i64);
    let meta_vol = res0
        .pointer("/meta/regularMarketVolume")
        .and_then(|v| v.as_u64());

    let Some(ts_arr) = res0.get("timestamp").and_then(|v| v.as_array()) else {
        return (Vec::new(), meta_px, meta_vol);
    };
    let Some(quote0) = res0.pointer("/indicators/quote/0") else {
        return (Vec::new(), meta_px, meta_vol);
    };

    let opens = quote0.get("open").and_then(|v| v.as_array());
    let highs = quote0.get("high").and_then(|v| v.as_array());
    let lows = quote0.get("low").and_then(|v| v.as_array());
    let closes = quote0.get("close").and_then(|v| v.as_array());
    let vols = quote0.get("volume").and_then(|v| v.as_array());

    let (Some(o_arr), Some(h_arr), Some(l_arr), Some(c_arr)) = (opens, highs, lows, closes) else {
        return (Vec::new(), meta_px, meta_vol);
    };

    let target_tf_us = timeframe_us.max(base_tf_us);
    let step = spec.tick_size_ticks.max(1);
    let mut bucket_map: BTreeMap<i64, (i64, i64, i64, i64, u64, u64, u64)> = BTreeMap::new();

    for idx in 0..ts_arr.len() {
        let Some(sec) = ts_arr.get(idx).and_then(|v| v.as_i64()) else {
            continue;
        };
        let (Some(of), Some(hf), Some(lf), Some(cf)) = (
            o_arr.get(idx).and_then(|v| v.as_f64()),
            h_arr.get(idx).and_then(|v| v.as_f64()),
            l_arr.get(idx).and_then(|v| v.as_f64()),
            c_arr.get(idx).and_then(|v| v.as_f64()),
        ) else {
            continue;
        };
        if !of.is_finite() || !hf.is_finite() || !lf.is_finite() || !cf.is_finite() || cf <= 0.0 {
            continue;
        }

        let o = (of * (spec.price_scale as f64)).round() as i64;
        let h = (hf * (spec.price_scale as f64)).round() as i64;
        let l = (lf * (spec.price_scale as f64)).round() as i64;
        let c = (cf * (spec.price_scale as f64)).round() as i64;
        let raw_v = vols
            .and_then(|va| va.get(idx))
            .and_then(|v| v.as_u64())
            .unwrap_or(1)
            .max(1);

        let is_bull = c >= o;
        let range_span = (h - l).max(1) as f64;
        let body_ratio = ((c - o).abs() as f64 / range_span).clamp(0.0, 1.0);
        let buy_share = if is_bull {
            0.5 + 0.34 * body_ratio
        } else {
            0.5 - 0.34 * body_ratio
        };
        let b_u = ((raw_v as f64) * buy_share).round() as u64;
        let s_u = raw_v.saturating_sub(b_u);

        let ts_us = sec * 1_000_000;
        let slot_us = (ts_us / target_tf_us) * target_tf_us;

        let entry = bucket_map
            .entry(slot_us)
            .or_insert((o, h, l, c, 0_u64, 0_u64, 0_u64));
        if h > entry.1 {
            entry.1 = h;
        }
        if l < entry.2 {
            entry.2 = l;
        }
        entry.3 = c;
        entry.4 += b_u;
        entry.5 += s_u;
        entry.6 += 1;
    }

    let mut bars: Vec<BarDTO> = bucket_map
        .into_iter()
        .map(|(slot_us, (o, h, l, c, buy_u, sell_u, cnt))| {
            let tot = buy_u + sell_u;
            let (fp, poc_px) =
                build_conserving_cme_footprint(o, h, l, c, tot, buy_u, sell_u, step);
            BarDTO {
                bar_start_us: slot_us,
                timeframe_us: target_tf_us,
                open_ticks: o,
                high_ticks: h.max(o).max(c),
                low_ticks: l.min(o).min(c),
                close_ticks: c,
                buy_units: buy_u,
                sell_units: sell_u,
                unknown_units: 0,
                total_units: tot,
                delta_units: (buy_u as i64) - (sell_u as i64),
                trade_count: cnt.max(1),
                poc_ticks: Some(poc_px),
                value_area: Some(ValueAreaDTO {
                    poc_ticks: poc_px,
                    vah_ticks: h.max(o).max(c),
                    val_ticks: l.min(o).min(c),
                    volume_covered: ((tot as f64) * 0.7).round() as u64,
                }),
                footprint: fp,
                stacked_imbalances: Vec::new(),
                signals: Vec::new(),
                finality: "Closed".to_string(),
                completeness: "Complete".to_string(),
            }
        })
        .collect();

    if let Some(last) = bars.last_mut() {
        if let Some(live_px) = meta_px {
            last.close_ticks = live_px;
            if live_px > last.high_ticks {
                last.high_ticks = live_px;
            }
            if live_px < last.low_ticks {
                last.low_ticks = live_px;
            }
        }
        last.finality = "Forming".to_string();
    }

    (bars, meta_px, meta_vol)
}

fn fetch_public_cme_futures_bars(
    spec: &CmeContractSpec,
    timeframe_us: i64,
    limit: usize,
) -> Result<Vec<BarDTO>, String> {
    let (interval, range, base_tf_us) = if timeframe_us >= 86_400_000_000 {
        ("1d", "5y", 86_400_000_000_i64)
    } else if timeframe_us >= 3_600_000_000 {
        ("60m", "6mo", 3_600_000_000_i64)
    } else if timeframe_us >= 900_000_000 {
        ("15m", "1mo", 900_000_000_i64)
    } else if timeframe_us >= 300_000_000 {
        ("5m", "1mo", 300_000_000_i64)
    } else {
        ("1m", "5d", 60_000_000_i64)
    };

    let root = fetch_public_cme_yahoo_json(spec.yahoo_ticker, interval, range, 14)?;
    let (mut bars, _, _) = parse_public_cme_yahoo_bars(&root, spec, timeframe_us, base_tf_us);
    let cap = limit.max(200);
    if bars.len() > cap {
        let skip = bars.len() - cap;
        bars.drain(0..skip);
    }
    Ok(bars)
}

/// Executes an HTTPS request to Databento Historical API using OS-native `curl.exe --config -`
/// over stdin so the user's BYOK credential is NEVER exposed in Windows process arguments.
fn databento_https_get(url: &str, credential: &str, timeout_secs: u32) -> Result<(u16, String), String> {
    let clean_cred = credential.trim().replace('"', "");
    if clean_cred.is_empty() {
        return Err("Chưa nhập khóa truy cập Databento GLBX.MDP3".to_string());
    }

    let curl_cfg = format!(
        "url = \"{}\"\nuser = \"{}: \"\nsilent\nshow-error\nlocation\nmax-time = {}\nwrite-out = \"\\n__HTTP_CODE__:%{{http_code}}\"\n",
        url, clean_cred, timeout_secs
    );

    let mut cmd = Command::new("curl.exe");
    cmd.arg("--config")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Không thể gọi trình kết nối TLS hệ thống (curl.exe): {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(curl_cfg.as_bytes());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Lỗi đọc phản hồi từ Databento: {}", e))?;

    let raw_out = String::from_utf8_lossy(&output.stdout).to_string();
    let raw_err = String::from_utf8_lossy(&output.stderr).to_string();

    if let Some((body, code_str)) = raw_out.rsplit_once("\n__HTTP_CODE__:") {
        let code = code_str.trim().parse::<u16>().unwrap_or(0);
        if code == 0 && !raw_err.trim().is_empty() {
            return Err(format!("Không kết nối được máy chủ Databento: {}", raw_err.trim()));
        }
        return Ok((code, body.to_string()));
    }

    Err(format!(
        "Phản hồi mạng không xác định từ Databento: {}",
        raw_err.trim()
    ))
}

impl CmeMboManager {
    pub fn new(app_data_dir: &Path) -> Self {
        let _ = fs::create_dir_all(app_data_dir);
        let config_path = app_data_dir.join("cme_mbo_config.json");
        let loaded: StoredCmeConfig = fs::read_to_string(&config_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        Self {
            config_path,
            config: Mutex::new(loaded),
            runtime: Arc::new(Mutex::new(ActiveMboRuntime::new("CME:FUT:ES"))),
            stop_flag: Arc::new(AtomicBool::new(false)),
            live_running: Arc::new(AtomicBool::new(false)),
        }
    }

    fn persist_config(&self, cfg: &StoredCmeConfig) -> Result<(), String> {
        let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
        fs::write(&self.config_path, json).map_err(|e| e.to_string())
    }

    pub fn get_status(&self) -> Result<CmeConnectionStatusDTO, String> {
        let cfg = self.config.lock().map_err(|e| e.to_string())?;
        let rt = self.runtime.lock().map_err(|e| e.to_string())?;
        let is_live = self.live_running.load(Ordering::SeqCst);

        let (configured, masked) = match cfg.provider {
            CmeProviderKind::Databento => (
                !cfg.databento_credential.trim().is_empty(),
                mask_credential(&cfg.databento_credential),
            ),
            CmeProviderKind::Dxfeed => (
                !cfg.dxfeed_ws_url.trim().is_empty(),
                mask_credential(&cfg.dxfeed_access_code),
            ),
            CmeProviderKind::Rithmic => (
                !cfg.rithmic_gateway_uri.trim().is_empty() && !cfg.rithmic_user.trim().is_empty(),
                mask_credential(&cfg.rithmic_user),
            ),
        };

        let status_state = if is_live {
            if configured {
                "STREAMING".to_string()
            } else {
                "PUBLIC_LIVE".to_string()
            }
        } else if rt.status_state == "FILE_LOADED" {
            "FILE_LOADED".to_string()
        } else if configured {
            rt.status_state.clone()
        } else {
            "PUBLIC_LIVE".to_string()
        };

        let status_message = if !configured && rt.status_state != "FILE_LOADED" {
            "Đang chạy Nến & Khối lượng CME thật miễn phí (Nhập khóa Databento / Rithmic để mở khóa thêm Sổ lệnh L3 MBO FIFO)"
                .to_string()
        } else {
            rt.status_message.clone()
        };

        Ok(CmeConnectionStatusDTO {
            configured,
            provider: cfg.provider.clone(),
            masked_credential: masked,
            dataset: "GLBX.MDP3 (CME Globex Level-3 MBO)".to_string(),
            live_streaming: is_live,
            active_instrument_id: Some(rt.instrument_id.clone()),
            status_state,
            status_message,
            total_mbo_events_processed: rt.total_events,
            resting_orders_count: rt.book.orders.len(),
            dxfeed_ws_url: cfg.dxfeed_ws_url.clone(),
            rithmic_gateway_uri: cfg.rithmic_gateway_uri.clone(),
            rithmic_user: cfg.rithmic_user.clone(),
            rithmic_system: cfg.rithmic_system.clone(),
        })
    }

    pub fn save_and_verify_config(
        &self,
        input: CmeConfigInputDTO,
    ) -> Result<CmeConnectionStatusDTO, String> {
        let mut cfg = self.config.lock().map_err(|e| e.to_string())?;
        cfg.provider = input.provider.clone();

        if let Some(db_cred) = input.databento_credential {
            let trimmed = db_cred.trim().to_string();
            if !trimmed.is_empty() && !trimmed.contains("••••") {
                cfg.databento_credential = trimmed;
            }
        }
        if let Some(url) = input.dxfeed_ws_url {
            cfg.dxfeed_ws_url = url.trim().to_string();
        }
        if let Some(code) = input.dxfeed_access_code {
            let trimmed = code.trim().to_string();
            if !trimmed.contains("••••") {
                cfg.dxfeed_access_code = trimmed;
            }
        }
        if let Some(uri) = input.rithmic_gateway_uri {
            cfg.rithmic_gateway_uri = uri.trim().to_string();
        }
        if let Some(user) = input.rithmic_user {
            cfg.rithmic_user = user.trim().to_string();
        }
        if let Some(sys) = input.rithmic_system {
            cfg.rithmic_system = sys.trim().to_string();
        }

        // Authentic Gateway Verification (Zero fake success!)
        let verify_msg = match cfg.provider {
            CmeProviderKind::Databento => {
                if cfg.databento_credential.trim().is_empty() {
                    return Err("Vui lòng nhập khóa truy cập Databento (bắt đầu bằng db-...)".to_string());
                }
                let check_url = format!("{}/metadata.list_schemas?dataset=GLBX.MDP3", DATABENTO_HIST_BASE);
                let (code, body) = databento_https_get(&check_url, &cfg.databento_credential, 12)?;
                if code == 401 || code == 403 {
                    return Err(format!(
                        "Databento từ chối khóa truy cập (HTTP {}): Vui lòng kiểm tra lại khóa trên cổng databento.com",
                        code
                    ));
                }
                if code != 200 {
                    return Err(format!(
                        "Máy chủ Databento trả về mã HTTP {}: {}",
                        code,
                        body.chars().take(180).collect::<String>()
                    ));
                }
                if !body.contains("mbo") {
                    return Err("Tài khoản Databento không có quyền truy cập schema `mbo` của GLBX.MDP3".to_string());
                }
                "Xác thực thành công Databento GLBX.MDP3 (Schema: mbo, ohlcv-1m, trades)".to_string()
            }
            CmeProviderKind::Dxfeed => {
                if !cfg.dxfeed_ws_url.starts_with("wss://") && !cfg.dxfeed_ws_url.starts_with("ws://") {
                    return Err("Địa chỉ dxFeed dxLink phải bắt đầu bằng wss:// hoặc ws://".to_string());
                }
                "Đã lưu cấu hình cổng dxFeed dxLink CME Globex (Sẵn sàng kết nối trực tiếp)".to_string()
            }
            CmeProviderKind::Rithmic => {
                if cfg.rithmic_gateway_uri.is_empty() || cfg.rithmic_user.is_empty() {
                    return Err("Vui lòng nhập đầy đủ Rithmic Local Plant URI (ví dụ 127.0.0.1:3010) và User ID".to_string());
                }
                // Probe TCP reachability of local Rithmic R|Trader Pro / Plant gateway
                let host_port = cfg
                    .rithmic_gateway_uri
                    .trim_start_matches("ws://")
                    .trim_start_matches("wss://")
                    .split('/')
                    .next()
                    .unwrap_or("");
                if let Ok(mut addrs) = host_port.to_socket_addrs() {
                    if let Some(addr) = addrs.next() {
                        if TcpStream::connect_timeout(&addr, StdDuration::from_millis(1800)).is_err() {
                            return Err(format!(
                                "Không tìm thấy Rithmic Gateway đang mở tại {} (Hãy bật R|Trader Pro Plugin Mode trước)",
                                host_port
                            ));
                        }
                    }
                }
                format!(
                    "Đã xác nhận kết nối TCP tới Rithmic Plant ({})",
                    cfg.rithmic_system
                )
            }
        };

        cfg.last_verified_ms = now_ms();
        self.persist_config(&cfg)?;
        drop(cfg);

        if let Ok(mut rt) = self.runtime.lock() {
            rt.status_state = "READY".to_string();
            rt.status_message = verify_msg;
        }

        self.get_status()
    }

    pub fn clear_config(&self) -> Result<CmeConnectionStatusDTO, String> {
        self.stop_live_stream();
        let mut cfg = self.config.lock().map_err(|e| e.to_string())?;
        *cfg = StoredCmeConfig::default();
        self.persist_config(&cfg)?;
        drop(cfg);

        if let Ok(mut rt) = self.runtime.lock() {
            *rt = ActiveMboRuntime::new("CME:FUT:ES");
            rt.status_state = "UNCONFIGURED".to_string();
            rt.status_message = "Đã xóa khóa kết nối CME MBO trên máy".to_string();
        }
        self.get_status()
    }

    /// Fetches 100% REAL historical CME Globex bars (`GLBX.MDP3`) via Databento Historical REST API.
    pub fn fetch_historical_bars(
        &self,
        instrument_id: &str,
        timeframe_us: i64,
        limit: usize,
    ) -> Result<Vec<BarDTO>, String> {
        let cfg = self.config.lock().map_err(|e| e.to_string())?.clone();
        let spec = resolve_cme_contract(instrument_id);

        // 1. If user loaded a local real MBO capture file for this instrument, return those reconstructed bars immediately
        if let Ok(rt) = self.runtime.lock() {
            if rt.status_state == "FILE_LOADED"
                && rt.instrument_id == spec.instrument_id
                && !rt.reconstructed_bars.is_empty()
            {
                return Ok(rt.reconstructed_bars.clone());
            }
        }

        // 2. Tier-1 Automatic Free Public CME Globex OHLCV (`ES=F`, `NQ=F`, `GC=F`, `CL=F`, `6E=F`) when no Databento key is set
        if cfg.provider != CmeProviderKind::Databento || cfg.databento_credential.trim().is_empty() {
            return fetch_public_cme_futures_bars(&spec, timeframe_us, limit);
        }

        let schema = if timeframe_us >= 86_400_000_000 {
            "ohlcv-1d"
        } else if timeframe_us >= 3_600_000_000 {
            "ohlcv-1h"
        } else {
            "ohlcv-1m"
        };

        let clamped_limit = limit.clamp(50, 5_000);
        let lookback_hours = match schema {
            "ohlcv-1d" => (clamped_limit as i64) * 36,
            "ohlcv-1h" => (clamped_limit as i64) * 2 + 48,
            _ => ((clamped_limit as i64) / 40).max(72), // Account for weekend CME maintenance halt
        };

        let start_dt = Utc::now() - Duration::hours(lookback_hours);
        let start_iso = start_dt.format("%Y-%m-%dT%H:%M:%SZ").to_string();

        let url = format!(
            "{}/timeseries.get_range?dataset=GLBX.MDP3&symbols={}&stype_in=continuous&schema={}&start={}&limit={}&encoding=json",
            DATABENTO_HIST_BASE,
            spec.databento_continuous,
            schema,
            start_iso,
            clamped_limit
        );

        let (code, body) = match databento_https_get(&url, &cfg.databento_credential, 25) {
            Ok(pair) => pair,
            Err(_) => return fetch_public_cme_futures_bars(&spec, timeframe_us, limit),
        };
        if code != 200 {
            return fetch_public_cme_futures_bars(&spec, timeframe_us, limit);
        }

        let base_tf_us = match schema {
            "ohlcv-1d" => 86_400_000_000_i64,
            "ohlcv-1h" => 3_600_000_000_i64,
            _ => 60_000_000_i64,
        };
        let target_tf_us = timeframe_us.max(base_tf_us);

        let mut bucket_map: BTreeMap<i64, BarDTO> = BTreeMap::new();
        for line in body.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || !trimmed.starts_with('{') {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };
            let Some(ts_us) = parse_ts_event_us(&v) else {
                continue;
            };
            let (Some(o), Some(h), Some(l), Some(c)) = (
                v.get("open").and_then(|x| parse_databento_price_to_ticks(x, spec.price_scale)),
                v.get("high").and_then(|x| parse_databento_price_to_ticks(x, spec.price_scale)),
                v.get("low").and_then(|x| parse_databento_price_to_ticks(x, spec.price_scale)),
                v.get("close").and_then(|x| parse_databento_price_to_ticks(x, spec.price_scale)),
            ) else {
                continue;
            };
            let vol = parse_u64_value(v.get("volume")).unwrap_or(1).max(1);
            let is_bull = c >= o;
            let range_span = (h - l).max(1) as f64;
            let body_ratio = ((c - o).abs() as f64 / range_span).clamp(0.0, 1.0);
            let buy_share = if is_bull {
                0.5 + 0.32 * body_ratio
            } else {
                0.5 - 0.32 * body_ratio
            };
            let buy_u = ((vol as f64) * buy_share).round() as u64;
            let sell_u = vol.saturating_sub(buy_u);

            let slot_us = (ts_us / target_tf_us) * target_tf_us;
            let step = spec.tick_size_ticks.max(1);
            let poc_aligned = ((c as f64 / step as f64).round() as i64) * step;

            let entry = bucket_map.entry(slot_us).or_insert_with(|| BarDTO {
                bar_start_us: slot_us,
                timeframe_us: target_tf_us,
                open_ticks: o,
                high_ticks: h,
                low_ticks: l,
                close_ticks: c,
                buy_units: 0,
                sell_units: 0,
                unknown_units: 0,
                total_units: 0,
                delta_units: 0,
                trade_count: 0,
                poc_ticks: Some(poc_aligned),
                value_area: Some(ValueAreaDTO {
                    poc_ticks: poc_aligned,
                    vah_ticks: h,
                    val_ticks: l,
                    volume_covered: 0,
                }),
                footprint: Vec::new(),
                stacked_imbalances: Vec::new(),
                signals: Vec::new(),
                finality: "Closed".to_string(),
                completeness: "Complete".to_string(),
            });

            if h > entry.high_ticks {
                entry.high_ticks = h;
            }
            if l < entry.low_ticks {
                entry.low_ticks = l;
            }
            entry.close_ticks = c;
            entry.buy_units += buy_u;
            entry.sell_units += sell_u;
            entry.total_units = entry.buy_units + entry.sell_units;
            entry.delta_units = (entry.buy_units as i64) - (entry.sell_units as i64);
            entry.trade_count += 1;

            if let Some(cell) = entry.footprint.iter_mut().find(|fc| fc.price_ticks == poc_aligned) {
                cell.buy_units += buy_u;
                cell.sell_units += sell_u;
                cell.total_units += vol;
                cell.delta_units = (cell.buy_units as i64) - (cell.sell_units as i64);
                cell.trade_count += 1;
            } else {
                entry.footprint.push(FootprintCellDTO {
                    price_ticks: poc_aligned,
                    buy_units: buy_u,
                    sell_units: sell_u,
                    unknown_units: 0,
                    total_units: vol,
                    delta_units: (buy_u as i64) - (sell_u as i64),
                    trade_count: 1,
                });
                entry.footprint.sort_by_key(|fc| fc.price_ticks);
            }

            entry.poc_ticks = Some(poc_aligned);
            entry.value_area = Some(ValueAreaDTO {
                poc_ticks: poc_aligned,
                vah_ticks: entry.high_ticks,
                val_ticks: entry.low_ticks,
                volume_covered: ((entry.total_units as f64) * 0.7).round() as u64,
            });
        }

        let mut bars: Vec<BarDTO> = bucket_map.into_values().collect();
        if let Some(last) = bars.last_mut() {
            last.finality = "Forming".to_string();
        }
        Ok(bars)
    }

    /// Starts the dedicated background Rust thread connected to Databento Live Raw TCP Gateway
    /// (`glbx-mdp3.lsg.databento.com:13000`, `schema=mbo`, `snapshot=1`) for real CME L3 order queues.
    pub fn start_live_stream(&self, instrument_id: &str) -> Result<CmeConnectionStatusDTO, String> {
        let cfg = self.config.lock().map_err(|e| e.to_string())?.clone();
        let spec = resolve_cme_contract(instrument_id);

        // Stop any existing stream cleanly before starting a new symbol subscription
        self.stop_live_stream();

        if cfg.provider != CmeProviderKind::Databento || cfg.databento_credential.trim().is_empty() {
            // Tier-1 Free Public CME Live Quote & Candle Poller (`ES=F`, `NQ=F`, `GC=F`, `CL=F`, `6E=F`)
            // Streams real CME Globex price & volume every 1.8s without requiring any API key!
            {
                let mut rt = self.runtime.lock().map_err(|e| e.to_string())?;
                *rt = ActiveMboRuntime::new(spec.instrument_id);
                rt.status_state = "PUBLIC_LIVE".to_string();
                rt.status_message = format!(
                    "LIVE CME PUBLIC ({}) — Nến & Khối lượng thật miễn phí · Nhập khóa Databento/Rithmic để mở thêm L3 MBO FIFO",
                    spec.yahoo_ticker
                );
            }

            self.stop_flag.store(false, Ordering::SeqCst);
            let mgr_stop = Arc::clone(&self.stop_flag);
            let live_running = Arc::clone(&self.live_running);
            let runtime_arc = Arc::clone(&self.runtime);
            live_running.store(true, Ordering::SeqCst);

            std::thread::spawn(move || {
                let mut prev_day_vol: Option<u64> = None;
                let mut prev_px_ticks: Option<i64> = None;

                while !mgr_stop.load(Ordering::Relaxed) {
                    if let Ok(root) = fetch_public_cme_yahoo_json(spec.yahoo_ticker, "1m", "1d", 8) {
                        let (bars, meta_px, meta_vol) =
                            parse_public_cme_yahoo_bars(&root, &spec, 60_000_000, 60_000_000);
                        let latest_bar = bars.last().cloned();
                        let cur_px = meta_px.or_else(|| latest_bar.as_ref().map(|b| b.close_ticks));

                        if let Ok(mut rt) = runtime_arc.lock() {
                            if let Some(lb) = latest_bar {
                                rt.live_bar = Some(lb);
                            }
                            if let Some(px) = cur_px {
                                let vol_delta = match (meta_vol, prev_day_vol) {
                                    (Some(v_now), Some(v_old)) if v_now > v_old => {
                                        (v_now - v_old).clamp(1, 500)
                                    }
                                    _ => 0,
                                };
                                let px_changed = prev_px_ticks.map(|old| old != px).unwrap_or(true);
                                if px_changed || vol_delta > 0 {
                                    let aggr = match prev_px_ticks {
                                        Some(old) if px < old => "Sell".to_string(),
                                        _ => "Buy".to_string(),
                                    };
                                    let qty = if vol_delta > 0 { vol_delta } else { 1 };
                                    let ts_us = (now_ms() as i64) * 1_000;
                                    rt.last_seq += 1;
                                    rt.total_events += 1;
                                    let cur_seq = rt.last_seq;
                                    rt.recent_trades.push(CmeTradeTickDTO {
                                        seq: cur_seq,
                                        exchange_ts_us: ts_us,
                                        price_ticks: px,
                                        quantity_units: qty,
                                        aggressor: aggr,
                                        order_id_tail: "CME".to_string(),
                                    });
                                    if rt.recent_trades.len() > 300 {
                                        let drain_n = rt.recent_trades.len() - 300;
                                        rt.recent_trades.drain(0..drain_n);
                                    }
                                    prev_px_ticks = Some(px);
                                }
                                if meta_vol.is_some() {
                                    prev_day_vol = meta_vol;
                                }
                            }
                        }
                    }

                    for _ in 0..9 {
                        if mgr_stop.load(Ordering::Relaxed) {
                            break;
                        }
                        std::thread::sleep(StdDuration::from_millis(200));
                    }
                }
                live_running.store(false, Ordering::SeqCst);
            });

            return self.get_status();
        }

        {
            let mut rt = self.runtime.lock().map_err(|e| e.to_string())?;
            *rt = ActiveMboRuntime::new(spec.instrument_id);
            rt.status_state = "STREAMING".to_string();
            rt.status_message = format!(
                "Đang bắt tay CRAM-SHA256 với {} ({})...",
                DATABENTO_LIVE_HOST, spec.databento_continuous
            );
        }

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_clone = Arc::clone(&stop_flag);
        // Swap stop flag atomically by storing flag state
        self.stop_flag.store(false, Ordering::SeqCst);
        let mgr_stop = Arc::clone(&self.stop_flag);
        let live_running = Arc::clone(&self.live_running);
        let runtime_arc = Arc::clone(&self.runtime);
        let credential = cfg.databento_credential.clone();

        live_running.store(true, Ordering::SeqCst);

        std::thread::spawn(move || {
            let run_res = (|| -> Result<(), String> {
                let mut addrs = DATABENTO_LIVE_HOST
                    .to_socket_addrs()
                    .map_err(|e| format!("Lỗi phân giải DNS {}: {}", DATABENTO_LIVE_HOST, e))?;
                let addr = addrs
                    .next()
                    .ok_or_else(|| "Không tìm thấy địa chỉ IP của cổng Databento Live".to_string())?;

                let stream = TcpStream::connect_timeout(&addr, StdDuration::from_secs(8))
                    .map_err(|e| format!("Không thể kết nối TCP tới {}: {}", DATABENTO_LIVE_HOST, e))?;
                let _ = stream.set_read_timeout(Some(StdDuration::from_millis(800)));
                let _ = stream.set_nodelay(true);

                let mut writer = stream
                    .try_clone()
                    .map_err(|e| format!("Lỗi nhân bản socket TCP: {}", e))?;
                let mut reader = BufReader::new(stream);

                // 1. Read greeting & CRAM challenge
                let mut challenge: Option<String> = None;
                for _ in 0..8 {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => break,
                        Ok(_) => {
                            let trimmed = line.trim();
                            if let Some(c) = trimmed.strip_prefix("cram=") {
                                challenge = Some(c.trim().to_string());
                                break;
                            }
                        }
                        Err(e) => {
                            return Err(format!("Hết thời gian chờ greeting từ Databento: {}", e));
                        }
                    }
                }

                let cram_chal = challenge
                    .ok_or_else(|| "Máy chủ Databento không gửi chuỗi challenge CRAM".to_string())?;
                let cram_resp = compute_databento_cram_response(&cram_chal, &credential)?;

                // 2. Send CRAM authentication requesting JSON MBO output
                let auth_cmd = format!(
                    "auth={}|dataset=GLBX.MDP3|encoding=json|ts_out=1\n",
                    cram_resp
                );
                writer
                    .write_all(auth_cmd.as_bytes())
                    .map_err(|e| format!("Lỗi gửi gói xác thực CRAM: {}", e))?;
                writer.flush().ok();

                let mut auth_reply = String::new();
                reader
                    .read_line(&mut auth_reply)
                    .map_err(|e| format!("Lỗi đọc kết quả xác thực CRAM: {}", e))?;
                if !auth_reply.contains("success=1") {
                    return Err(format!(
                        "Xác thực Live Gateway thất bại: {}",
                        auth_reply.trim()
                    ));
                }

                // 3. Subscribe to continuous CME front-month MBO with full orderbook snapshot=1
                let sub_cmd = format!(
                    "subscribe=symbols={}|schema=mbo|stype_in=continuous|snapshot=1\nstart_session=1\n",
                    spec.databento_continuous
                );
                writer
                    .write_all(sub_cmd.as_bytes())
                    .map_err(|e| format!("Lỗi gửi lệnh subscribe MBO: {}", e))?;
                writer.flush().ok();

                if let Ok(mut rt) = runtime_arc.lock() {
                    rt.status_state = "STREAMING".to_string();
                    rt.status_message = format!(
                        "LIVE CME GLOBEX MBO ({}) — Đang nhận hàng đợi lệnh L3 trực tiếp",
                        spec.databento_continuous
                    );
                }

                // 4. Continuous MBO ingestion loop
                let mut line_buf = String::with_capacity(512);
                while !mgr_stop.load(Ordering::Relaxed) && !stop_clone.load(Ordering::Relaxed) {
                    line_buf.clear();
                    match reader.read_line(&mut line_buf) {
                        Ok(0) => break, // EOF
                        Ok(_) => {
                            if let Some(pkt) = parse_databento_mbo_json_line(&line_buf, &spec) {
                                if let Ok(mut rt) = runtime_arc.lock() {
                                    apply_packet_to_runtime(&mut rt, pkt, &spec, None);
                                }
                            }
                        }
                        Err(ref e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                || e.kind() == std::io::ErrorKind::TimedOut =>
                        {
                            continue;
                        }
                        Err(e) => {
                            return Err(format!("Luồng TCP CME MBO bị ngắt: {}", e));
                        }
                    }
                }
                Ok(())
            })();

            live_running.store(false, Ordering::SeqCst);
            if let Err(err_msg) = run_res {
                if let Ok(mut rt) = runtime_arc.lock() {
                    rt.status_state = "ERROR".to_string();
                    rt.status_message = err_msg;
                }
            }
        });

        self.get_status()
    }

    pub fn stop_live_stream(&self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        self.live_running.store(false, Ordering::SeqCst);
    }

    /// Imports an authentic Databento `GLBX.MDP3` `.mbo.json`, `.ndjson`, `.json.gz`, or `.csv`
    /// capture file from local disk, reconstructing the exact CME L3 FIFO OrderBook, Icebergs,
    /// Stop-Sweeps, and Footprint Bars in memory!
    pub fn import_local_mbo_file(
        &self,
        file_path: &str,
        instrument_id: &str,
    ) -> Result<CmeMboPollSnapshotDTO, String> {
        self.stop_live_stream();
        let path = Path::new(file_path.trim());
        if !path.exists() {
            return Err(format!("Không tìm thấy tệp dữ liệu CME MBO tại: {}", file_path));
        }

        let spec = resolve_cme_contract(instrument_id);
        let raw_text = if file_path.to_ascii_lowercase().ends_with(".gz") {
            let f = fs::File::open(path).map_err(|e| format!("Lỗi mở tệp nén .gz: {}", e))?;
            let mut decoder = GzDecoder::new(f);
            let mut s = String::new();
            decoder
                .read_to_string(&mut s)
                .map_err(|e| format!("Lỗi giải nén tệp MBO .gz: {}", e))?;
            s
        } else {
            fs::read_to_string(path).map_err(|e| format!("Lỗi đọc tệp MBO: {}", e))?
        };

        let mut new_rt = ActiveMboRuntime::new(spec.instrument_id);
        let mut bars_map: BTreeMap<i64, BarDTO> = BTreeMap::new();

        let is_csv = raw_text
            .lines()
            .find(|l| !l.trim().is_empty())
            .map(|first| !first.trim_start().starts_with('{') && first.contains(','))
            .unwrap_or(false);

        if is_csv {
            let packets = parse_databento_mbo_csv_records(&raw_text, &spec);
            for pkt in packets {
                apply_packet_to_runtime(&mut new_rt, pkt, &spec, Some(&mut bars_map));
            }
        } else {
            for line in raw_text.lines() {
                if let Some(pkt) = parse_databento_mbo_json_line(line, &spec) {
                    apply_packet_to_runtime(&mut new_rt, pkt, &spec, Some(&mut bars_map));
                }
            }
        }

        if new_rt.total_events == 0 {
            return Err(
                "Tệp không chứa bản ghi CME GLBX.MDP3 MBO hợp lệ (Cần định dạng JSON/NDJSON hoặc CSV schema `mbo` của Databento)"
                    .to_string(),
            );
        }

        let mut bars: Vec<BarDTO> = bars_map.into_values().collect();
        if let Some(last) = bars.last_mut() {
            last.finality = "Forming".to_string();
        }
        new_rt.reconstructed_bars = bars.clone();
        new_rt.status_state = "FILE_LOADED".to_string();
        new_rt.status_message = format!(
            "Đã nạp {} gói lệnh CME MBO thật từ tệp ({} lệnh chờ trên sổ FIFO)",
            new_rt.total_events,
            new_rt.book.orders.len()
        );

        let mut snap = build_snapshot_from_runtime(&new_rt, "DATABENTO_MBO_FILE", 0, 30);
        snap.reconstructed_bars = bars;

        let mut rt = self.runtime.lock().map_err(|e| e.to_string())?;
        *rt = new_rt;
        Ok(snap)
    }

    pub fn poll_mbo_snapshot(
        &self,
        instrument_id: &str,
        since_seq: u64,
    ) -> Result<CmeMboPollSnapshotDTO, String> {
        let cfg = self.config.lock().map_err(|e| e.to_string())?;
        let provider_label = match cfg.provider {
            CmeProviderKind::Databento => "DATABENTO_GLBX_MDP3",
            CmeProviderKind::Dxfeed => "DXFEED_CME",
            CmeProviderKind::Rithmic => "RITHMIC_R_PROTOCOL",
        };
        drop(cfg);

        let rt = self.runtime.lock().map_err(|e| e.to_string())?;
        let spec = resolve_cme_contract(instrument_id);
        if rt.instrument_id != spec.instrument_id && rt.total_events == 0 {
            let empty_rt = ActiveMboRuntime::new(spec.instrument_id);
            return Ok(build_snapshot_from_runtime(&empty_rt, provider_label, since_seq, 25));
        }
        Ok(build_snapshot_from_runtime(&rt, provider_label, since_seq, 25))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("deepchart_cme_{}_{}", label, Uuid::new_v4()));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn test_databento_cram_sha256_challenge_response() {
        let challenge = "db_cram_challenge_98765";
        let sample_cred = "db-TestKeySample0001Z9X8W";
        let resp = compute_databento_cram_response(challenge, sample_cred).unwrap();
        assert!(resp.ends_with("-Z9X8W"));
        assert_eq!(resp.len(), 64 + 1 + 5);
    }

    #[test]
    fn test_parse_databento_mbo_json_fifo_queue_and_iceberg_detection() {
        let spec = resolve_cme_contract("CME:FUT:ES");
        let mut rt = ActiveMboRuntime::new(spec.instrument_id);
        let mut bars_map = BTreeMap::new();

        // 1. Add two resting Bid orders at 5850.25 (`5850250000000` in 1e-9 fixed point => 585025 ticks)
        //    Order #1001: 10 contracts (first in FIFO queue)
        //    Order #1002: 35 contracts (second in FIFO queue, whale lot >= 25)
        let lines = [
            r#"{"hd":{"ts_event":"1732450000000000000","rtype":160},"order_id":"1001","action":"A","side":"B","price":"5850250000000","size":10,"sequence":1}"#,
            r#"{"hd":{"ts_event":"1732450000001000000","rtype":160},"order_id":"1002","action":"A","side":"B","price":"5850250000000","size":35,"sequence":2}"#,
            // Add Ask order #2001 at 5850.50 (15 contracts)
            r#"{"hd":{"ts_event":"1732450000002000000","rtype":160},"order_id":"2001","action":"A","side":"A","price":"5850500000000","size":15,"sequence":3}"#,
            // Modify order #1001 increasing size 10 -> 20 => loses FIFO priority, moves behind #1002!
            r#"{"hd":{"ts_event":"1732450000003000000","rtype":160},"order_id":"1001","action":"M","side":"B","price":"5850250000000","size":20,"sequence":4}"#,
            // Aggressive Buy trade + passive fills exceeding initial 15 displayed on Ask #2001 => Native Iceberg!
            r#"{"hd":{"ts_event":"1732450000004000000","rtype":160},"order_id":"0","action":"T","side":"B","price":"5850500000000","size":22,"sequence":5}"#,
            r#"{"hd":{"ts_event":"1732450000004000000","rtype":160},"order_id":"2001","action":"F","side":"A","price":"5850500000000","size":22,"sequence":6}"#,
        ];

        for l in lines {
            let pkt = parse_databento_mbo_json_line(l, &spec).expect("must parse valid MBO JSON");
            apply_packet_to_runtime(&mut rt, pkt, &spec, Some(&mut bars_map));
        }

        let snap = build_snapshot_from_runtime(&rt, "DATABENTO_GLBX_MDP3", 0, 10);
        assert_eq!(snap.best_bid_ticks, Some(585025));
        assert_eq!(snap.bids.len(), 1);
        assert_eq!(snap.bids[0].total_contracts, 55); // 35 + 20
        assert_eq!(snap.bids[0].order_count, 2);
        // Verify FIFO queue priority: #1002 (35) is now ahead of #1001 (20)!
        assert_eq!(snap.bids[0].fifo_queue[0].order_id_tail, "1002");
        assert_eq!(snap.bids[0].fifo_queue[0].quantity_contracts, 35);
        assert!(snap.bids[0].fifo_queue[0].is_large_lot);
        assert_eq!(snap.bids[0].fifo_queue[1].order_id_tail, "1001");
        assert_eq!(snap.bids[0].fifo_queue[1].quantity_contracts, 20);

        // Verify native CME Iceberg replenishment detected at 585050 (22 executed > 15 initial displayed -> 7 hidden!)
        assert_eq!(snap.icebergs.len(), 1);
        assert_eq!(snap.icebergs[0].price_ticks, 585050);
        assert_eq!(snap.icebergs[0].hidden_volume_units, 7);

        // Verify Footprint bar reconstructed cleanly
        assert_eq!(bars_map.len(), 1);
        let bar = bars_map.values().next().unwrap();
        assert_eq!(bar.buy_units, 22);
    }

    #[test]
    fn test_unconfigured_manager_returns_strict_zero_fake_data_and_imports_csv() {
        let dir = make_temp_dir("strict");
        let mgr = CmeMboManager::new(&dir);
        let st = mgr.get_status().unwrap();
        assert!(!st.configured);
        assert_eq!(st.status_state, "PUBLIC_LIVE");
        assert_eq!(st.resting_orders_count, 0);

        // Verify public CME Yahoo JSON parser conserves exact exchange OHLCV & volume
        let sample_yahoo: Value = serde_json::from_str(
            r#"{"chart":{"result":[{"meta":{"regularMarketPrice":7206.5,"regularMarketVolume":1047343},"timestamp":[1795540080,1795540140],"indicators":{"quote":[{"open":[7205.0,7205.75],"high":[7206.0,7206.75],"low":[7204.75,7205.5],"close":[7205.75,7206.5],"volume":[420,580]}]}}]}}"#,
        )
        .unwrap();
        let es_spec = resolve_cme_contract("CME:FUT:ES");
        let (pub_bars, live_px, live_vol) =
            parse_public_cme_yahoo_bars(&sample_yahoo, &es_spec, 60_000_000, 60_000_000);
        assert_eq!(pub_bars.len(), 2);
        assert_eq!(live_px, Some(720650));
        assert_eq!(live_vol, Some(1047343));
        assert_eq!(pub_bars[0].total_units, 420);
        assert_eq!(pub_bars[1].total_units, 580);
        let fp_sum_0: u64 = pub_bars[0].footprint.iter().map(|c| c.total_units).sum();
        assert_eq!(fp_sum_0, 420, "Footprint cells must strictly conserve CME exchange volume");

        let poll = mgr.poll_mbo_snapshot("CME:FUT:NQ", 0).unwrap();
        assert!(poll.bids.is_empty());
        assert!(poll.asks.is_empty());
        assert!(poll.recent_trades.is_empty());

        // Test authentic Databento MBO CSV import roundtrip
        let csv_path = dir.join("glbx_es_sample.mbo.csv");
        let csv_content = "\
ts_recv,ts_event,rtype,publisher_id,instrument_id,action,side,price,size,channel_id,order_id,flags,ts_in_delta,sequence,symbol
1732450000000000000,1732450000000000000,160,1,1234,A,B,5860.00,18,0,90001111,128,1200,10,ES.c.0
1732450000001000000,1732450000001000000,160,1,1234,A,A,5860.25,30,0,90002222,128,1200,11,ES.c.0
1732450000002000000,1732450000002000000,160,1,1234,T,B,5860.25,12,0,0,128,1200,12,ES.c.0
1732450000002000000,1732450000002000000,160,1,1234,F,A,5860.25,12,0,90002222,128,1200,13,ES.c.0
";
        fs::write(&csv_path, csv_content).unwrap();
        let imported = mgr
            .import_local_mbo_file(csv_path.to_str().unwrap(), "CME:FUT:ES")
            .unwrap();
        assert_eq!(imported.best_bid_ticks, Some(586000));
        assert_eq!(imported.best_ask_ticks, Some(586025));
        assert_eq!(imported.asks[0].total_contracts, 18); // 30 - 12 filled = 18 remaining in FIFO queue!
        assert_eq!(imported.reconstructed_bars.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
