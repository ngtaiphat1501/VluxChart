# ADR-CHART-001A: Hybrid-First Chart Architecture (Venue Kline + Lightweight Charts + Custom Overlays)

> **Document ID:** ADR-CHART-001A  
> **Status:** APPROVED & ADOPTED  
> **Deciders:** Lead Product Designer, Principal Frontend Engineer, Graphics Architect, Rust Core Lead  
> **Date:** 2026-11-14  

---

## 1. Context & Problem Statement
Phiên bản prototype ban đầu của DeepChart chỉ hiển thị một vài nến Footprint đơn lẻ trên khung Canvas trống, tạo ra "sa mạc đen" mênh mông chiếm tới 80% diện tích màn hình. Khi mở bất kỳ biểu đồ giao dịch chuyên nghiệp nào (Exocharts, Sierra Chart, ATAS, TradingView), trader luôn kỳ vọng được quan sát tối thiểu **300–500 nến lịch sử** để đọc cấu trúc xu hướng thị trường (Market Structure / Auction Process) trước khi soi chi tiết vào từng mức giá vi mô.

Hơn nữa, nến lịch sử tải từ REST API của sàn giao dịch (Bybit, Binance) chỉ cung cấp thông số OHLCV, không chứa dữ liệu Bid × Ask từng tick bên trong nến. Nếu tự bịa ra số Buy/Sell trên nến lịch sử là vi phạm nghiêm trọng quy chuẩn toàn vẹn dữ liệu (Rule R-DATA-01).

## 2. Decision: Hybrid-First Architecture
Chúng tôi quyết định áp dụng kiến trúc **Hybrid-First** bao gồm 3 lớp độc lập:

1. **Lớp 1: Venue Kline History & Realtime (Base Price Canvas):**
   - Tải tối thiểu 300 nến lịch sử từ REST API chính thức của sàn (`GET /v5/market/kline` của Bybit hoặc `/fapi/v1/klines` của Binance).
   - Sắp xếp tăng dần theo thời gian (ASC order), khử trùng lặp (dedup) và cập nhật nến đang mở qua WebSocket Kline.
   - Hiển thị toàn bộ lịch sử giá sắc nét, phủ kín từ trái sang phải màn hình.

2. **Lớp 2: Rust Order Flow Analytics Engine (Data Core Truth):**
   - Xử lý luồng `TradeEvent` thời gian thực và nhật ký WAL binary (`DCWA` với CRC32).
   - Tính toán chính xác số học nguyên `PriceTicks(i64)` và `ScaledQuantity(u64)` cho Footprint Bid × Ask, Delta, CVD, Volume Speed và POC/Value Area.

3. **Lớp 3: Custom Canvas 2D Order Flow Overlays:**
   - Hoạt động theo cơ chế **Semantic Zoom (Level of Detail - LOD)**:
     * *Zoom xa (Nhiều nến):* Vẽ nến Candlestick mượt mà kèm Volume Profile phiên.
     * *Zoom gần (barSpacing ≥ 50px):* Thân nến tự động mở rộng để hiển thị ma trận Deep Print Bid × Ask với dải màu nhiệt (Volume Gradient Heatmap).
   - Neo chuẩn xác Big Trade Bubbles và các vùng Imbalance trực tiếp vào mốc thời gian và mức giá của nến chứa giao dịch đó.
   - Phân tách minh bạch cờ trạng thái:
     * Nến lịch sử chưa có trade-level data: Ghi rõ `KLINE: COMPLETE | FOOTPRINT: UNAVAILABLE (OHLCV ONLY)`.
     * Nến hiện tại và nến có trade stream: Ghi rõ `FOOTPRINT: VERIFIED`.

4. **Lớp 4: Canonical Instrument Registry:**
   - Một Symbol ID duy nhất điều khiển đồng bộ 100% tất cả các panel (Chart, DOM Ladder, Time & Sales, Position, Footer).
   - Tuyệt đối cách ly dữ liệu giữa các cặp tài sản: Chọn ETHUSDT hiển thị mức giá ~$3,150; chọn BTCUSDT hiển thị ~$95,000; chọn XAUUSDT hiển thị ~$2,650.

## 3. Consequences & Trade-offs
* **Tích cực:**
  - Biểu đồ dày dặn, trực quan, chuyên nghiệp như trạm giao dịch tổ chức.
  - Loại bỏ hoàn toàn tình trạng sa mạc đen và lỗi bong bóng cá voi bay lơ lửng.
  - Tuyệt đối bảo toàn tính trung thực của dữ liệu (không bao giờ giả lập dữ liệu Footprint trên nến lịch sử chỉ có OHLCV).
* **Đánh đổi:**
  - Cần duy trì bộ điều khiển tọa độ thống nhất (`ChartViewportController`) để nến và các lớp overlay luôn đồng bộ khi pan/zoom/resize.
