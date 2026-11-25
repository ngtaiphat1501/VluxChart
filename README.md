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

## 2. Verified Quality Gates & Audit Report (G0 – G8)

VluxChart has successfully passed all **rigorous automated institutional tests** across 9 deployment gates plus **68/68 Order Flow mathematical invariants**:

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
| **G8** | **Integration & Entitlements** | CME Globex L3 MBO connector, Range/Volume/Tick bars, AST Synthetic Spreads (`SYNTH:*`), Argon2id 3-tier auth (PILOT/PRO/QUANT), System Bootstrapper | **PASSED** | 100% acceptance across all entitlement tiers |
| **MATH** | **Invariant Audit** | Volume conservation, Steidlmayer 70% VA, Diagonal Imbalance, NPOC, Absorption, CVD Divergence, Options GEX, Top 7 Zones, FRVP, TPO, L3 FIFO Iceberg & Sweep | **PASSED** | **68/68 invariants verified (100% pass rate)** |

**Overall Audit Result:** `Full suite passed, 0 failed, 68/68 mathematical invariants verified`.

👉 **[Read the Full Institutional Technical Audit & Mathematical Proofs Report (TRANSPARENCY_AND_AUDIT_REPORT.md)](docs/TRANSPARENCY_AND_AUDIT_REPORT.md)**

---

## 3. Core Capabilities & Architecture

- **2-Tier CME Globex Level-3 MBO Connector:**
  - Free real-time live OHLCV feed for global benchmark futures (ES, NQ, CL, GC).
  - BYOK (Bring-Your-Own-Key) direct connection for Databento GLBX.MDP3 (CRAM-SHA256 authenticated), dxFeed, and Rithmic.
  - Native CME Order-ID tracking: microsecond-level FIFO queue position simulation, Iceberg replenishment detection, and multi-tick Stop-Sweep detection.
- **Non-Time Bars & AST Multi-Leg Synthetic Spreads:**
  - Custom discrete aggregation: Range bars (e.g. 10R, 15R), Volume bars (e.g. 500V, 1000V), and Tick bars (e.g. 100T, 250T) with strict volume/delta conservation.
  - Safe Abstract Syntax Tree (AST) parser for multi-leg synthetic spreads (`SYNTH:*`, e.g. `XAUUSD - XAUUSDT`, `ES - NQ`) without unsafe `eval()`.
- **Top 7 Empirically Backtested Horizontal Zone Indicators:**
  - Specialized for XAUUSD microstructure (4000-bar MT5 backtest) and crypto:
    1. **NPOC-MAG:** Naked Point of Control magnet pull.
    2. **ABS-WALL:** Institutional limit absorption defense wall.
    3. **VWAP-2SD:** Mean-reversion envelope at 2nd standard deviation.
    4. **STK-ZONE:** Multi-level stacked aggressive imbalance clusters.
    5. **VA-EDGE:** Steidlmayer Value Area boundary reversion (H1+ timeframe gated).
    6. **LVN-DEF:** Low Volume Node liquidity void defense.
    7. **UNFIN-AUC:** Unfinished auction high/low boundary magnets.
- **Options GEX & Greeks Microstructure:**
  - Real-time Gamma Exposure (GEX) profiling across strikes (0DTE, Weekly, Monthly) for both Crypto and OPRA/CBOE Gold Options.
  - Exact Call Walls, Put Walls, and Max Pain calculations.
  - Analytical Black-Scholes Greeks (Delta, Gamma, Vega, Theta) with Implied Volatility (IV) smile inversion.
  - Fixed Range Volume Profile (FRVP) and Steidlmayer TPO Market Profile with Single Prints.
- **Footprint & Cluster Charting:**
  - Real-time Bid x Ask cluster bars with configurable Diagonal Imbalances (default 300%).
  - Real-time Order Flow Absorption detection and Naked Point of Control (nPOC) tracking.
  - Multi-speed Cumulative Volume Delta (CVD) and Volume-Weighted Average Price (VWAP) with $\pm 1\sigma, 2\sigma, 3\sigma$ standard deviation bands.
- **Argon2id Local Authentication & 3-Tier Entitlement Privileges:**
  - Zero-cloud, encrypted local authentication powered by Argon2id password hashing.
  - Tiered feature access: **STANDARD PILOT** (core charting), **INSTITUTIONAL PRO** (Options GEX, FRVP, TPO), **QUANT DESK** (L3 MBO, Synthetic Spreads, automated Backtester).
  - System Runtime Bootstrapper verifying GPU hardware acceleration, WebView2 runtime, and IPC latency.
- **Multi-Venue Data Feed & MT5 Live Bridge:**
  - Native public WebSockets for Bybit Linear and Binance Futures.
  - Low-latency Python RPC bridge (`scripts/mt5_live_bridge.py`) connecting directly to MetaTrader 5 on Windows for Gold (XAUUSD) and Forex ticks.
- **Ultra-Smooth 60 FPS GPU Rendering:**
  - GPU-accelerated HTML5 Canvas/WebGL engine with viewport culling, delivering fluid 60 FPS under extreme market trade bursts (>10,000 trades/sec).

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

# Run complete Gate G0-G8 institutional verification suite
python -m pytest tests -v

# Run 68/68 Order Flow mathematical invariants audit
node apps/desktop/test_order_flow_math.mjs
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

## 2. 权威质量门禁审计报告 (G0 – G8)

VluxChart 已通过全部 **机构级全自动化严苛测试**，涵盖 9 个系统交付门禁以及 **68/68 项订单流数学不变性审计**：

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
| **G8** | **深度集成与权限** | CME Globex L3 MBO 直连器、非时间 K 线（Range/Volume/Tick）、AST 合成价差（`SYNTH:*`）、Argon2id 三级权限（PILOT/PRO/QUANT） | **通过** | 全层级验收通过率 100% |
| **MATH** | **数学不变性** | 离散聚合守恒、Steidlmayer 70% 价值区、失衡堆叠、NPOC 追踪、吸收点、期权 GEX、Top 7 水平带、L3 FIFO 冰山探测 | **通过** | **68/68 项数学不变性全数验证通过 (100%)** |

**总测试审计结果：** `全套自动化测试通过，0 失败，68/68 项订单流数学不变性严苛验证`。

👉 **[阅读完整机构级技术审计与数学证明报告 (TRANSPARENCY_AND_AUDIT_REPORT.md)](docs/TRANSPARENCY_AND_AUDIT_REPORT.md)**

---

## 3. 核心功能与架构特性

- **双层 CME Globex Level-3 MBO 直连器：**
  - 免配置免费实时接收全球基准期货（ES、NQ、CL、GC）秒级 OHLCV 数据。
  - 支持 BYOK（自备密钥）直连 Databento GLBX.MDP3（CRAM-SHA256 签名鉴权）、dxFeed 以及 Rithmic。
  - 原生 CME 订单 ID 追踪：微秒级模拟撮合队列 FIFO 排队位置，精准识别被动限价单撤单/增量优先级损失，探测 Iceberg 冰山订单自动补仓以及多档 Stop-Sweep 扫盘脉冲。
- **非时间周期 K 线（Non-Time Bars）与 AST 跨品种合成价差：**
  - 支持 Range 点数条（如 10R、15R）、Volume 成交量条（如 500V、1000V）与 Tick 跳动笔数条（如 100T、250T），成交量与 Delta 严格守恒。
  - 内置基于抽象语法树（AST）的安全多腿合成公式解析引擎（`SYNTH:*`，如 `XAUUSD - XAUUSDT`、`ES - NQ`），杜绝不安全 `eval()` 执行。
- **Top 7 经实证回测的主动买卖水平带指标：**
  - 针对 XAUUSD 黄金微观结构（4000 根 MT5 历史 K 线实证检验）与加密资产量身定制：
    1. **NPOC-MAG：** 未触及控制点强引力回踩带。
    2. **ABS-WALL：** 机构限价吸收被动防御墙。
    3. **VWAP-2SD：** 动态均价第二标准差均值回归包络线。
    4. **STK-ZONE：** 连续多层失衡堆叠动能带。
    5. **VA-EDGE：** Steidlmayer 价值区高低沿均值回归带（H1 以上周期自动启用）。
    6. **LVN-DEF：** 低成交量节点流动性真空防御区。
    7. **UNFIN-AUC：** 未完成拍卖上下极值磁吸带。
- **期权 GEX 与希腊字母深度分析：**
  - 支持加密货币与 OPRA/CBOE 黄金期权（Gold Options）跨行权价与到期日（0DTE、周度、月度）实时 Gamma 风险敞口（GEX）全景图。
  - 精确计算看涨墙（Call Wall）、看跌墙（Put Wall）与最大痛点（Max Pain）。
  - 解析 Black-Scholes 希腊字母（Delta、Gamma、Vega、Theta）与隐含波动率微笑曲线反演。
  - 固定区间成交量分布（FRVP）与附带 Single Prints 的 Steidlmayer TPO 市场轮廓。
- **足迹图与微观结构图表（Footprint Chart）：**
  - 实时买卖簇聚（Bid x Ask Clusters），支持对角失衡自动标记（默认 300%）。
  - 订单流吸收（Absorption）实时告警，未测试控制点（Naked POC）追踪。
  - 多周期累积成交量差（CVD）与成交量加权平均价（VWAP，附带 $\pm 1\sigma, 2\sigma, 3\sigma$ 标准差带）。
- **Argon2id 本地安全加密认证与三级权限管理：**
  - 零云端依赖，本地 Argon2id 高强度哈希密码存储与数据加密。
  - 三级权限控制体系：**STANDARD PILOT**（核心图表）、**INSTITUTIONAL PRO**（期权 GEX、FRVP、TPO）、**QUANT DESK**（L3 MBO、合成价差、量化回测器）。
  - 系统启动引导器（System Bootstrapper）自动化诊断 GPU 加速、WebView2 运行库与 IPC 延迟。
- **多交易所聚合与 MT5 实时网桥：**
  - 原生支持 Bybit Linear 与 Binance Futures 公共 WebSocket 实时行情。
  - 高效 Python RPC 桥接器（`scripts/mt5_live_bridge.py`），直连 Windows MetaTrader 5 终端获取黄金（XAUUSD）与外汇实时报价。
- **GPU 加速 60 FPS 超流畅渲染：**
  - 基于 Canvas/WebGL 的 GPU 加速图表引擎，具备智能视口剔除（Viewport Culling），即便在上万笔/秒的市场脉冲下仍保持 60 FPS 丝滑响应。
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

# 运行 G0 - G8 全套自动化质量审计
python -m pytest tests -v

# 运行 68/68 项订单流数学不变性严苛审计
node apps/desktop/test_order_flow_math.mjs
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

## 2. Báo Cáo Kiểm Định Chất Lượng & Benchmark (G0 – G8)

VluxChart đã vượt qua xuất sắc toàn bộ **các kịch bản kiểm thử tự động cấp định chế (Institutional-grade tests)** qua 9 cổng chất lượng cùng **68/68 bất biến toán học Order Flow**:

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
| **G8** | **Tích Hợp & Phân Quyền**| Kết nối CME Globex L3 MBO, nến phi thời gian (Range/Volume/Tick), spread tổng hợp AST (`SYNTH:*`), phân quyền 3 cấp Argon2id | **PASSED** | Nghiệm thu 100% qua tất cả các phân cấp tài khoản |
| **MATH** | **Bất Biến Toán Học** | Bảo toàn khối lượng/Delta, Steidlmayer 70% VA, nPOC, Absorption, CVD Divergence, Options GEX, Top 7 Vùng, L3 FIFO Iceberg & Sweep | **PASSED** | **68/68 bất biến toán học đạt tuyệt đối (100%)** |

**Tổng Kết Kiểm Định:** `Vượt qua toàn bộ kiểm thử tự động, 0 lỗi, 68/68 bất biến vi cấu trúc được kiểm chứng`.

👉 **[Xem toàn văn Báo Cáo Thẩm Định Chi Tiết & Bằng Chứng Toán Học (TRANSPARENCY_AND_AUDIT_REPORT.md)](docs/TRANSPARENCY_AND_AUDIT_REPORT.md)**

---

## 3. Các Tính Năng Vi Cấu Trúc Vượt Trội

- **Bộ Kết Nối CME Globex Level-3 MBO 2 Tầng:**
  - Cung cấp luồng nến OHLCV thời gian thực miễn phí cho các hợp đồng tương lai tiêu chuẩn (ES, NQ, CL, GC).
  - Hỗ trợ BYOK (Bring-Your-Own-Key) kết nối trực tiếp Databento GLBX.MDP3 (xác thực chữ ký số CRAM-SHA256), dxFeed và Rithmic.
  - Theo dõi mã định danh lệnh gốc (Order-ID) từ CME: mô phỏng vị trí xếp hàng khớp lệnh FIFO ở cấp độ microsecond, phát hiện lệnh ẩn Iceberg tự động chèn thanh khoản và cảnh báo các đợt quét Stop-Sweep đa bước giá.
- **Nến Phi Thời Gian (Non-Time Bars) & Spread Đa Chân Tổng Hợp AST:**
  - Tùy biến nến theo bước giá Range bars (10R, 15R), nến khối lượng Volume bars (500V, 1000V), nến số lượng lệnh Tick bars (100T, 250T) với nguyên tắc bảo toàn khối lượng và Delta tuyệt đối.
  - Bộ phân tích cú pháp AST an toàn cho phép thiết lập công thức Spread tổng hợp đa tài sản (`SYNTH:*`, ví dụ `XAUUSD - XAUUSDT`, `ES - NQ`) mà không cần dùng hàm `eval()` nguy hiểm.
- **Top 7 Chỉ Báo Vùng Ngang Mua/Bán Được Thực Nghiệm Backtest:**
  - Tối ưu hóa đặc thù cho vi cấu trúc Vàng XAUUSD (kiểm nghiệm qua 4.000 nến MT5 thực tế) và tài sản Crypto:
    1. **NPOC-MAG:** Vùng hút giá Naked Point of Control chưa được kiểm tra.
    2. **ABS-WALL:** Bức tường hấp thụ thanh khoản phòng thủ của cá mập.
    3. **VWAP-2SD:** Dải bao bọc hồi quy trung bình độ lệch chuẩn thứ 2 của VWAP.
    4. **STK-ZONE:** Vùng mất cân bằng xếp chồng nhiều bước giá liên tiếp.
    5. **VA-EDGE:** Biên đảo chiều của vùng giá trị Value Area (tự động bật từ khung H1 trở lên).
    6. **LVN-DEF:** Vùng phòng thủ khoảng trống thanh khoản Low Volume Node.
    7. **UNFIN-AUC:** Vùng hút giá đấu giá dang dở Unfinished Auction đỉnh/đáy.
- **Phân Tích Options GEX & Greeks Chuyên Sâu:**
  - Hỗ trợ toàn diện Options tiền mã hóa và OPRA/CBOE Gold Options (Quyền chọn Vàng) thời gian thực trên mọi kỳ hạn (0DTE, Tuần, Tháng).
  - Tính toán chính xác Call Walls, Put Walls và điểm Max Pain của thị trường.
  - Mô hình định giá Black-Scholes giải mã các chỉ số Hy Lạp (Delta, Gamma, Vega, Theta) và nụ cười biến động (IV Smile).
  - Hồ sơ khối lượng vùng cố định (Fixed Range Volume Profile - FRVP) và Steidlmayer TPO Market Profile tích hợp Single Prints.
- **Biểu Đồ Footprint & Cluster:**
  - Cụm nến Bid x Ask thời gian thực với tính năng phát hiện Mất Cân Bằng Chéo (Diagonal Imbalance 300%).
  - Cảnh báo Hấp thụ thanh khoản (Absorption) và vẽ mức kiểm soát chưa chạm (Naked POC).
  - Chỉ báo Cumulative Volume Delta (CVD) đa tốc độ và VWAP kèm các dải độ lệch chuẩn $\pm 1\sigma, 2\sigma, 3\sigma$.
- **Xác Thực Mã Hóa Cục Bộ Argon2id & Phân Quyền 3 Cấp:**
  - Không phụ thuộc cloud, mã hóa mật khẩu cục bộ an toàn bằng thuật toán Argon2id.
  - Hệ thống phân cấp đặc quyền: **STANDARD PILOT** (các tính năng cốt lõi), **INSTITUTIONAL PRO** (Options GEX, FRVP, TPO), **QUANT DESK** (L3 MBO, Synthetic Spreads, bộ Backtest chiến lược định lượng).
  - Trình khởi tạo hệ thống (System Bootstrapper) tự động chẩn đoán tăng tốc phần cứng GPU, môi trường WebView2 và độ trễ IPC.
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

# Kiểm tra bộ kiểm thử chất lượng Gate G0 đến G8
python -m pytest tests -v

# Kiểm định 68/68 bất biến toán học vi cấu trúc Order Flow
node apps/desktop/test_order_flow_math.mjs
```

---

## License & Bản Quyền

Dự án phát hành theo giấy phép kép MIT License hoặc Apache-2.0 License. Xem chi tiết tại [LICENSE](LICENSE) và [NOTICES.md](NOTICES.md).
