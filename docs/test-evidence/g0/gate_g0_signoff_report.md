# GATE G0 SIGN-OFF REPORT: SOURCE PROOF VERIFIED

- **Gate:** G0 — SOURCE PROOF
- **Evaluation Date:** 2026-11-12
- **Environment:** Windows 11 (OS build verified) / Python 3.13 / Async WebSockets
- **Decision:** **VERIFIED PASS**
- **Sign-off Role:** Lead Software Architect, Market Data Engineer, QA Architect

---

## 1. Tóm tắt kết quả theo từng Task

| Task ID | Nội dung công việc | Deliverables | Trạng thái | Bằng chứng kiểm thử |
|---|---|---|---|---|
| **SRC-01** | Chốt danh mục instruments chuẩn | `instruments.yaml` | **VERIFIED PASS** | Test case `test_tc_g0_01` PASSED |
| **SRC-02** | Khảo sát API docs & changelog chính thức | `docs/source-contracts/bybit_v5_linear.md`<br>`docs/source-contracts/binance_usds_m.md` | **VERIFIED PASS** | Contract docs cập nhật link và schema |
| **SRC-03** | Kết nối & bắt mẫu Bybit BTC/ETH publicTrade | `fixtures/raw/bybit/sample_bybit_trades.jsonl` | **VERIFIED PASS** | 35 trades / 24 messages; `test_tc_g0_02` PASSED (p95 latency ~151ms) |
| **SRC-04** | Kết nối & bắt mẫu Binance BTC/ETH aggTrade | `fixtures/raw/binance/sample_binance_aggtrades.jsonl` | **VERIFIED PASS** | 23 aggTrades bắt qua domain fallback `fstream.binancefuture.com`; `test_tc_g0_03` PASSED |
| **SRC-05** | Xác minh Symbol Vàng Binance XAUUSDT | `fixtures/raw/binance/sample_binance_xauusdt_aggtrades.jsonl`<br>`docs/source-proof/gold-source-report.md` | **VERIFIED PASS** | Xác minh Binance có `XAUUSDT` TRADIFI_PERPETUAL khớp lệnh thật; `test_tc_g0_04` PASSED |
| **SRC-06** | Khảo sát CME COMEX GC Futures | `docs/source-proof/gold-source-report.md` | **VERIFIED PASS** | Phân định rạch ròi, lập kế hoạch cho P1/P2 |
| **SRC-07** | Đo đạc mẫu độ trễ và phân tích schema | `docs/source-proof/capture_and_validation_report.json` | **VERIFIED PASS** | Đầy đủ SHA-256 hash và log độ trễ |
| **SRC-08** | Thử nghiệm đối soát nến 1m (Reconciliation) | `tests/g0/test_reconciliation_sample.py` | **VERIFIED PASS** | Test case `test_tc_g0_06` PASSED |
| **SRC-09** | Ma trận pháp lý và quyền sử dụng dữ liệu | `docs/data-rights-matrix.md` | **VERIFIED PASS** | Đạt điều kiện Local-first Desktop |
| **SRC-10** | Báo cáo kiến trúc quyết định feed | `docs/adr/ADR-0001-primary-secondary-feeds.md` | **VERIFIED PASS** | ADR-001 được phê duyệt |

---

## 2. Bằng chứng kiểm thử tự động (Automated Test Execution)

```text
============================= test session starts =============================
platform win32 -- Python 3.13.0, pytest-9.1.1, pluggy-1.6.0
rootdir: D:\DeepChart
collecting ... collected 6 items

tests/g0/test_g0_source_proof.py::TestGateG0SourceProof::test_tc_g0_01_instruments_registry_schema PASSED [ 16%]
tests/g0/test_g0_source_proof.py::TestGateG0SourceProof::test_tc_g0_02_bybit_raw_feed_schema_and_integrity PASSED [ 33%]
tests/g0/test_g0_source_proof.py::TestGateG0SourceProof::test_tc_g0_03_binance_aggtrade_feed_schema_and_integrity PASSED [ 50%]
tests/g0/test_g0_source_proof.py::TestGateG0SourceProof::test_tc_g0_04_gold_instrument_live_proof PASSED [ 66%]
tests/g0/test_g0_source_proof.py::TestGateG0SourceProof::test_tc_g0_05_data_normalization_and_exact_accounting_invariants PASSED [ 83%]
tests/g0/test_reconciliation_sample.py::test_tc_g0_06_bybit_1m_candle_reconciliation PASSED [100%]

============================== 6 passed in 0.53s ==============================
```

## 3. Khám phá quan trọng và các sửa đổi kỹ thuật (Fix & Update)
1. **Phát hiện mạng ISP chặn WebSocket:** Domain `wss://fstream.binance.com` bị timeout do cơ chế định tuyến của ISP khu vực. Hệ thống đã khắc phục và bổ sung cơ chế fallback tự động sang `wss://fstream.binancefuture.com` và `wss://stream.binance.com:9443`.
2. **Xác nhận sản phẩm Vàng:** Binance USDⓈ-M Futures hiện đang niêm yết và giao dịch trực tiếp hợp đồng `XAUUSDT` (TradFi Perpetual) với tick size `0.01` và step size `0.001`, volume thực tế chảy liên tục. Điều này giải quyết triệt để rủi ro nguồn dữ liệu Vàng cho bản MVP P0.
3. **Bảo toàn số học chính xác:** Đã kiểm chứng thuật toán chuẩn hóa giá sang integer ticks và khối lượng sang scaled integers, chứng minh bất biến `TotalVolume = BuyVolume + SellVolume + UnknownVolume` chính xác 100% không có sai số trôi dạt dấu phẩy động nhị phân.

---

## 4. Quyết định Gate
**Gate G0 (SOURCE PROOF) CHÍNH THỨC ĐẠT CHUẨN (PASS).**  
Dự án đủ điều kiện tiến vào **Gate G1: Foundation Ready** (xây dựng cấu trúc crate Rust, Tauri shell và CI pipeline).
