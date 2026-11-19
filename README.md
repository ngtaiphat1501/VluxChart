# VluxChart — High-Performance Order Flow Analytics & Microstructure Terminal

<div align="center">

[![Windows CI](https://github.com/ngtaiphat1501/VluxChart/actions/workflows/windows-ci.yml/badge.svg)](https://github.com/ngtaiphat1501/VluxChart/actions)
![Rust](https://img.shields.io/badge/rust-2021_edition-orange.svg)
![Tauri](https://img.shields.io/badge/tauri-v2-blue.svg)
![React](https://img.shields.io/badge/react-19-cyan.svg)
![TypeScript](https://img.shields.io/badge/typescript-5-blue.svg)
![License](https://img.shields.io/badge/license-MIT%2FApache--2.0-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey.svg)

**[English](#english)** | **[简体中文](#chinese)** | **[Tiếng Việt](#vietnamese)**

</div>

---

<a name="english"></a>
# English Documentation

## 1. Transparency & Market Integrity Manifesto

> [!IMPORTANT]
> **Data Integrity Pledge:** VluxChart is built on the strict principle of mathematical transparency and data integrity. 
> - **No Synthetic "Prediction" Magic:** VluxChart does not generate fake "AI predictive buy/sell signals". 
> - **Fact vs. Model:** We clearly distinguish between **Observed Exchange Facts** (actual executed aggressor trades, real order book limit depth, exact broker tick prices) and **Analytical Microstructure Models** (Options Gamma Exposure GEX, Steidlmayer Market Profile, Implied Volatility Smile).
> - **Zero Float Drift:** Financial quantities are calculated using scaled 64-bit and 128-bit fixed-point integers to guarantee zero floating-point rounding errors (`TotalVolume == BuyVolume + SellVolume + UnknownVolume`).

---

## 2. Verified Quality Gates & Audit Report (G0 – G7)

VluxChart has successfully passed all **41/41 rigorous automated institutional tests** across 8 deployment gates:

| Gate | Category | Test Scope | Status | Result / Metric |
| :--- | :--- | :--- | :---: | :--- |
| **G0** | **Source Proof** | Bybit Linear & Binance Futures WebSocket schemas, Gold contract validity, tick invariants | **PASSED** | 6/6 tests passed (100% schema match) |
| **G1** | **Foundation** | Cargo workspace architecture, CI/CD pipeline, Tauri 2 shell manifest | **PASSED** | 4/4 tests passed |
| **G2** | **Data Core** | Bounded dedup filter, sequence gap detection, Write-Ahead Log (WAL) CRC32 crash recovery | **PASSED** | 5/5 tests passed (Zero data loss on simulated crash) |
| **G3** | **Analytics Core** | Real-time Footprint clusters, Steidlmayer Value Area (VAH/VAL/POC), Diagonal Imbalance, CVD | **PASSED** | 5/5 tests passed (Exact volume golden invariants) |
| **G4** | **Desktop Terminal** | IPC DTO schema serialization, state lifecycle, frontend Vite/React 19 production compilation | **PASSED** | 5/5 tests passed |
| **G5** | **Performance** | Throughput (>10,000 trades/s), pipeline latency, 100k trade soak test, 60 FPS viewport culling | **PASSED** | 6/6 tests passed (<1ms latency, 0 memory leak) |
| **G6** | **Release Audit** | Automated secret & credential scan, third-party notices, SHA-256 package checksums | **PASSED** | 5/5 tests passed (0 secret leaks detected) |
| **G7** | **Pilot Signoff** | Multi-asset live switching, zero float drift verification, rollback readiness | **PASSED** | 5/5 tests passed (100% acceptance signoff) |

**Overall Audit Result:** `41 passed, 0 failed, 0 skipped in 65.47s`.

---

## 3. Core Capabilities & Architecture

- **Footprint & Cluster Charting:**
  - Real-time Bid x Ask cluster bars with configurable Diagonal Imbalances (default 300%).
  - Real-time Order Flow Absorption detection and Naked Point of Control (nPOC) tracking.
  - Steidlmayer Market Profile (TPO, Value Area High/Low - VAH/VAL, POC).
  - Multi-speed Cumulative Volume Delta (CVD) and Volume-Weighted Average Price (VWAP) with $\pm 1\sigma, 2\sigma, 3\sigma$ standard deviation bands.
- **Options GEX & Greeks Microstructure:**
  - Real-time Gamma Exposure (GEX) profiling across strikes (0DTE, Weekly, Monthly).
  - Exact Call Walls, Put Walls, and Max Pain calculations.
  - Analytical Black-Scholes Greeks (Delta, Gamma, Vega, Theta) with Implied Volatility (IV) smile inversion.
- **Depth of Market (DOM) & MBO Iceberg Tracking:**
  - High-frequency local Order Book state with sub-millisecond updates.
  - Liquidity Depth Heatmap buffer tracking passive limit orders.
  - Market-by-Order (MBO) Iceberg order detection and queue position tracking.
- **Multi-Venue Data Feed & MT5 Live Bridge:**
  - Native public WebSockets for Bybit Linear and Binance Futures.
  - Low-latency Python RPC bridge (`scripts/mt5_live_bridge.py`) connecting directly to MetaTrader 5 on Windows for Gold (XAUUSD) and Forex ticks.
- **Ultra-Smooth 60 FPS GPU Rendering:**
  - GPU-accelerated HTML5 Canvas/WebGL engine with viewport culling, delivering fluid 60 FPS under extreme market trade bursts.

---

## 4. Quick Start Guide

### Prerequisites
- Windows 10/11 (64-bit)
- [Node.js](https://nodejs.org/) (v18+)
- [Rust & Cargo](https://rustup.rs/) (Stable 1.75+)
- *(Optional for MT5)* Python 3.11+ & MetaTrader 5 terminal

### Launching the Application
```cmd
:: 1. Launch complete Desktop Terminal (Tauri 2 + React):
run_desktop_app.bat

:: 2. Or preview in Web Browser (Fast Web Mode):
run_web_preview.bat
```

### Running the MT5 Live Bridge (Gold / Forex)
```bash
python scripts/mt5_live_bridge.py
```

### Running Tests
```bash
# Run all Rust workspace tests
cargo test --workspace

# Run complete Gate G0-G7 institutional verification suite
python -m pytest tests -v
```

---

<br/>

<a name="chinese"></a>
# 简体中文文档

## 1. 数据透明度与量化诚信宣言

> [!IMPORTANT]
> **数据诚信承诺：** VluxChart 严格建立在数学透明度和数据真实性的基础之上。
> - **杜绝虚假预测：** VluxChart 不生成任何虚假的“AI 预测买卖点”或黑盒魔法信号。
> - **事实与模型严格区分：** 我们清晰划分 **交易所客观事实**（真实主动吃单成交、订单簿限价挂单深度、经纪商真实报价跳动）与 **微观结构分析模型**（期权 Gamma 风险敞口 GEX、Steidlmayer 市场轮廓图、隐含波动率微笑曲线）。
> - **零浮点漂移（Zero Float Drift）：** 财务与交易量数值全部采用 64 位与 128 位定点数（Fixed-point Integers）进行精确计算，彻底杜绝浮点数舍入误差（保证 `TotalVolume == BuyVolume + SellVolume + UnknownVolume` 恒等成立）。

---

## 2. 权威质量门禁审计报告 (G0 – G7)

VluxChart 已通过全部 **41/41 项全自动化机构级严苛测试**，涵盖 8 个系统交付阶段：

| 门禁 | 类别 | 测试范围 | 状态 | 核心指标 / 测试结果 |
| :--- | :--- | :--- | :---: | :--- |
| **G0** | **数据源凭证** | Bybit Linear、Binance Futures 协议规范，黄金合约有效性，成交恒等式 | **通过** | 6/6 项测试通过（100% 协议一致） |
| **G1** | **系统架构** | Cargo Workspace 架构完整性，Windows CI 流水线，Tauri 2 配置 | **通过** | 4/4 项测试通过 |
| **G2** | **数据核心** | 有界去重过滤器，序列漏包检测，预写日志 (WAL) CRC32 崩溃恢复 | **通过** | 5/5 项测试通过（断电崩溃模拟数据零丢失） |
| **G3** | **分析引擎** | 实时足迹图 (Footprint)，市场轮廓价值区 (VAH/VAL/POC)，对角失衡，CVD | **通过** | 5/5 项测试通过（成交量恒等式 100% 吻合） |
| **G4** | **桌面终端** | IPC DTO 模式序列化，状态生命周期，Vite/React 19 生产环境构建 | **通过** | 5/5 项测试通过 |
| **G5** | **高并发性能** | 吞吐量 (>10,000 笔/秒)，管线亚毫秒级延迟，10 万笔交易浸泡，60 FPS 渲染 | **通过** | 6/6 项测试通过（延迟 <1ms，内存零泄漏） |
| **G6** | **安全审计** | 自动化密钥泄露扫描，开源协议合规性，SHA-256 发布包校验和 | **通过** | 5/5 项测试通过（零密钥泄露） |
| **G7** | **最终交付** | 多资产实时切换，零浮点漂移复核，紧急版本回滚就绪测试 | **通过** | 5/5 项测试通过（验收签署通过率 100%） |

**总测试审计结果：** `41 项全部通过，0 失败，0 跳过，耗时 65.47 秒`。

---

## 3. 核心功能与架构特性

- **足迹图与微观结构图表（Footprint Chart）：**
  - 实时买卖簇聚（Bid x Ask Clusters），支持对角失衡自动标记（默认 300%）。
  - 订单流吸收（Absorption）实时告警，未测试控制点（Naked POC）追踪。
  - Steidlmayer 市场轮廓（TPO、价值区高/低点 VAH/VAL、POC）。
  - 多周期累积成交量差（CVD）与成交量加权平均价（VWAP，附带 $\pm 1\sigma, 2\sigma, 3\sigma$ 标准差带）。
- **期权 GEX 与希腊字母分析：**
  - 跨行权价与到期日（0DTE、周度、月度）实时 Gamma 风险敞口（GEX）全景图。
  - 精确计算看涨墙（Call Wall）、看跌墙（Put Wall）与最大痛点（Max Pain）。
  - 解析 Black-Scholes 希腊字母（Delta、Gamma、Vega、Theta）与隐含波动率微笑曲线反演。
- **深度梯子（DOM）与 MBO 冰山订单监控：**
  - 亚毫秒级本地 L2 订单簿高速撮合状态维护。
  - 挂单深度流动性热力图（Heatmap），记录被动限价单流动性变化。
  - 逐笔订单（Market-by-Order）冰山订单探测与 FIFO 排队深度估算。
- **多交易所聚合与 MT5 实时网桥：**
  - 原生支持 Bybit Linear 与 Binance Futures 公共 WebSocket 实时行情。
  - 高效 Python RPC 桥接器（`scripts/mt5_live_bridge.py`），直连 Windows MetaTrader 5 终端获取黄金（XAUUSD）与外汇实时报价。
- **GPU 加速 60 FPS 超流畅渲染：**
  - 基于 Canvas/WebGL 的 GPU 加速图表引擎，具备智能视口剔除（Viewport Culling），即便在上万笔/秒的市场脉冲下仍保持 60 FPS 丝滑响应。

---

## 4. 快速使用指南

### 环境依赖
- Windows 10/11 (64-bit)
- [Node.js](https://nodejs.org/) (v18+)
- [Rust & Cargo](https://rustup.rs/) (Stable 1.75+)
- *(可选，用于 MT5)* Python 3.11+ 以及已登录的 MetaTrader 5 软件

### 快速启动
```cmd
:: 1. 运行完整桌面终端 (Tauri 2 + React):
run_desktop_app.bat

:: 2. 或者在浏览器中极速预览前端 (Web 预览模式):
run_web_preview.bat
```

### 启动 MT5 黄金/外汇实时网桥
```bash
python scripts/mt5_live_bridge.py
```

### 执行自动化审计测试
```bash
# 运行 Rust 核心单元与黄金测试
cargo test --workspace

# 运行 G0 - G7 全套自动化质量审计
python -m pytest tests -v
```

---

<br/>

<a name="vietnamese"></a>
# Tài liệu Tiếng Việt

## 1. Tuyên Ngôn Minh Bạch & Liêm Chính Dữ Liệu

> [!IMPORTANT]
> **Cam Kết Liêm Chính Dữ Liệu:** VluxChart được xây dựng trên triết lý minh bạch toán học tuyệt đối và sự liêm chính trong dữ liệu tài chính.
> - **Không Dự Đoán Thần Thánh Hóa:** VluxChart không tạo ra các tín hiệu "AI thần bí dự đoán đáy đỉnh" thiếu cơ sở. 
> - **Tách Bạch Thực Tế & Mô Hình:** Chúng tôi phân định rõ ràng giữa **Dữ Liệu Thực Tế Khách Quan** (lệnh khớp thị trường thực, độ sâu sổ lệnh limit book, giá tick thực từ broker) và **Mô Hình Vi Cấu Trúc** (Gamma Exposure GEX, Steidlmayer Market Profile, Implied Volatility Smile).
> - **Zero Float Drift (Không Sai Số Số Thực):** Toàn bộ phép toán khối lượng và giá trị đều dùng số nguyên cố định (Fixed-point 64-bit & 128-bit), đảm bảo nguyên tắc bất biến: `Tổng Khối Lượng = Khối Lượng Mua Chủ Động + Khối Lượng Bán Chủ Động + Khối Lượng Chưa Xác Định`.

---

## 2. Báo Cáo Kiểm Định Chất Lượng & Benchmark (G0 – G7)

VluxChart đã vượt qua xuất sắc toàn bộ **41/41 kịch bản kiểm thử tự động cấp định chế (Institutional-grade tests)** qua 8 cổng chất lượng:

| Cổng | Danh Mục | Phạm Vi Kiểm Tra | Trạng Thái | Kết Quả / Chỉ Số Đạt Được |
| :--- | :--- | :--- | :---: | :--- |
| **G0** | **Bằng Chứng Nguồn** | Schema Bybit Linear, Binance Futures, tính hợp lệ hợp đồng Vàng, tính bất biến của tick | **PASSED** | 6/6 test đạt (Khớp 100% đặc tả sàn) |
| **G1** | **Nền Tảng Hệ Thống** | Cấu trúc Cargo Workspace, pipeline Windows CI, manifest Tauri 2 | **PASSED** | 4/4 test đạt |
| **G2** | **Lõi Dữ Liệu** | Bộ lọc khử trùng lặp, phát hiện rớt gói tin, phục hồi sự cố sập nguồn WAL CRC32 | **PASSED** | 5/5 test đạt (Không mất dữ liệu khi crash) |
| **G3** | **Lõi Phân Tích** | Nến Footprint, Steidlmayer Value Area (VAH/VAL/POC), Imbalance chéo, CVD đa tốc độ | **PASSED** | 5/5 test đạt (Khối lượng khớp chuẩn 100%) |
| **G4** | **Terminal Desktop** | Tuần tự hóa DTO IPC, vòng đời trạng thái, build production Vite/React 19 | **PASSED** | 5/5 test đạt |
| **G5** | **Hiệu Năng & Tải** | Thông lượng (>10.000 lệnh/s), độ trễ pipeline <1ms, ngâm tải 100k lệnh, culling 60 FPS | **PASSED** | 6/6 test đạt (Độ trễ <1ms, 0 rò rỉ bộ nhớ) |
| **G6** | **Kiểm Tra Bảo Mật** | Quét tự động lộ lọt Secret/Key, rà soát bản quyền mã nguồn mở, mã băm SHA-256 | **PASSED** | 5/5 test đạt (0 rủi ro bảo mật) |
| **G7** | **Nghiệm Thu Vận Hành**| Chuyển đổi đa tài sản mượt mà, kiểm tra trôi số thập phân, kịch bản rollback khẩn cấp | **PASSED** | 5/5 test đạt (Nghiệm thu đạt 100%) |

**Tổng Kết Kiểm Định:** `41 passed, 0 failed, 0 skipped trong 65.47 giây`.

---

## 3. Các Tính Năng Vi Cấu Trúc Vượt Trội

- **Biểu Đồ Footprint & Cluster:**
  - Cụm nến Bid x Ask thời gian thực với tính năng phát hiện Mất Cân Bằng Chéo (Diagonal Imbalance 300%).
  - Cảnh báo Hấp thụ thanh khoản (Absorption) và vẽ mức kiểm soát chưa chạm (Naked POC).
  - Phân tích Steidlmayer Market Profile (TPO, VAH, VAL, POC).
  - Chỉ báo Cumulative Volume Delta (CVD) đa tốc độ và VWAP kèm các dải độ lệch chuẩn $\pm 1\sigma, 2\sigma, 3\sigma$.
- **Phân Tích Options GEX & Greeks:**
  - Bản đồ nhiệt Gamma Exposure (GEX) theo từng mức giá thực hiện (0DTE, Tuần, Tháng).
  - Tính toán chính xác Call Walls, Put Walls và điểm Max Pain của thị trường.
  - Mô hình định giá Black-Scholes giải mã các chỉ số Hy Lạp (Delta, Gamma, Vega, Theta) và nụ cười biến động (IV Smile).
- **Độ Sâu Thị Trường (DOM) & Phát Hiện Lệnh Ẩn Iceberg:**
  - Sổ lệnh Level 2 cập nhật ở tốc độ sub-millisecond.
  - Bộ đệm Heatmap ghi nhận lịch sử biến động thanh khoản limit order của cá mập.
  - Thuật toán MBO phát hiện lệnh ẩn Iceberg và mô phỏng vị trí xếp hàng khớp lệnh FIFO.
- **Dữ Liệu Đa Sàn & Cầu Nối MT5 Trực Tiếp:**
  - WebSocket trực tiếp Bybit Linear và Binance Futures.
  - Cầu nối Python RPC (`scripts/mt5_live_bridge.py`) kết nối trực tiếp phần mềm MetaTrader 5 trên máy tính để đọc dữ liệu tick thật của Vàng (XAUUSD) và Forex.
- **Đồ Họa GPU 60 FPS Cực Mượt:**
  - Engine Canvas/WebGL tối ưu GPU kết hợp thuật toán Viewport Culling, duy trì khung hình 60 FPS ổn định ngay cả trong những đợt biến động tin tức bão táp (>10.000 lệnh/giây).

---

## 4. Hướng Dẫn Cài Đặt & Sử Dụng Nhanh

### Yêu Cầu Môi Trường
- Hệ điều hành: Windows 10/11 (64-bit)
- [Node.js](https://nodejs.org/) (phiên bản 18 trở lên)
- [Rust & Cargo](https://rustup.rs/) (Stable 1.75+)
- *(Tùy chọn nếu dùng MT5)* Python 3.11+ và phần mềm MetaTrader 5

### Khởi Chạy Ứng Dụng
```cmd
:: 1. Chạy ứng dụng Desktop hoàn chỉnh (Tauri 2 + React):
run_desktop_app.bat

:: 2. Hoặc xem trước giao diện trên Trình duyệt web (Web Preview):
run_web_preview.bat
```

### Chạy Cầu Nối MT5 Lấy Dữ Liệu Vàng / Forex Sàn Cá Nhân
```bash
python scripts/mt5_live_bridge.py
```

### Chạy Kiểm Thử Tự Động Toàn Diện
```bash
# Kiểm tra toàn bộ unit test và golden test Rust core
cargo test --workspace

# Kiểm tra bộ 41 bài test Gate G0 đến G7
python -m pytest tests -v
```

---

## License & Bản Quyền

Dự án phát hành theo giấy phép kép MIT License hoặc Apache-2.0 License. Xem chi tiết tại [LICENSE](LICENSE) và [NOTICES.md](NOTICES.md).
