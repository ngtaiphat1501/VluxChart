# BÁO CÁO NGHIÊN CỨU & XÁC MINH NGUỒN DỮ LIỆU VÀNG (GOLD SOURCE REPORT)
**Gate:** G0 — Source Proof  
**Task ID:** SRC-05 & SRC-06  
**Ngày thực hiện:** 2026-11-12  
**Trạng thái kết luận:** `VERIFIED_PASS` cho `BINANCE:XAUUSDT`; `PLANNED_LICENSED` cho `CME:GC`.

---

## 1. Mục tiêu
Thực hiện thẩm định khách quan, có căn cứ thực nghiệm về dữ liệu các công cụ Vàng:
1. Xác minh sự tồn tại của sản phẩm Vàng trên Binance (Spot và USDⓈ-M Futures).
2. Kiểm tra tính khả dụng của WebSocket realtime stream và tính chất giao dịch thực khớp (executed trades).
3. Làm rõ sự khác biệt giữa `Binance XAUUSDT`, `CME GC Futures` và `Forex XAUUSD CFD`.

---

## 2. Kết quả kiểm tra thực tế (Empirical Evidence)

### 2.1. Binance USDⓈ-M Futures: `XAUUSDT` (ĐÃ XÁC MINH CÓ THẬT)
- **Tên Symbol:** `XAUUSDT`
- **Loại hợp đồng:** `TRADIFI_PERPETUAL` (TradFi Commodity Perpetual)
- **Trạng thái:** `TRADING`
- **Underlying Type:** `COMMODITY` (Phân nhóm TradFi)
- **Tài sản cơ sở (Base Asset):** `XAU` (Vàng)
- **Tài sản thanh toán / ký quỹ (Quote / Margin Asset):** `USDT`
- **Bước giá (Tick Size):** `0.01` USDT
- **Bước khối lượng (Step Size / Min Qty):** `0.001` XAU
- **WebSocket Feed Stream:** `wss://fstream.binancefuture.com/ws/xauusdt@aggTrade`
- **Mẫu gói tin trực tiếp đã bắt được:**
  ```json
  {"e":"aggTrade","E":1794502704642,"s":"XAUUSDT","a":12049182,"p":"3887.16","q":"0.005","f":15891241,"l":15891241,"T":1794502704635,"m":false}
  ```
- **Kết luận:** Binance có sản phẩm giao dịch khớp lệnh thật `XAUUSDT` với thanh khoản và khớp lệnh liên tục. Đây là khối lượng khớp lệnh thật của chính sản phẩm này trên Binance.

### 2.2. CME COMEX Gold Futures: `GC` (P1/P2 Roadmap)
- **Loại sản phẩm:** Deliverable Commodity Futures (100 troy oz / contract).
- **Quy tắc:** Bắt buộc quản lý kỳ hạn đáo hạn (Front Month: G, J, M, Q, V, Z) và quy tắc Rollover.
- **Bản quyền dữ liệu:** Dữ liệu chuẩn COMEX Globex MDP3 từ CME yêu cầu giấy phép thương mại (Commercial License) và chi phí feed (ví dụ qua Databento hoặc Rithmic/CQG).
- **Phạm vi:** Không đưa vào MVP P0 miễn phí; đưa vào lộ trình P1/P2 theo mô hình giấy phép hợp lệ hoặc BYO Key.

### 2.3. Forex Broker Quotes: `XAUUSD`
- **Bản chất:** Báo giá CFD / Spot Gold của từng broker riêng lẻ (chỉ gồm Bid/Ask quotes và broker tick count).
- **Quy tắc bất di bất dịch:** **Không phải khối lượng khớp lệnh thực của thị trường vàng toàn cầu**. Chỉ dùng làm biểu đồ giá tham chiếu (Reference Quotes) ở P1.

---

## 3. Quyết định kiến trúc cho P0 (Architecture Decision)
- **Cho phép đưa `BINANCE:USDS_M_PERP:XAUUSDT:PERP` vào danh mục MVP P0**, nhưng giao diện phải hiển thị rõ nhãn nguồn:  
  `BINANCE XAUUSDT TRADIFI PERPETUAL (BINANCE EXECUTION ONLY)`.
- Tuyệt đối không quảng bá đây là "khối lượng toàn thị trường vàng thế giới".
