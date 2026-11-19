# ADR-0001: LỰA CHỌN NGUỒN DỮ LIỆU CHÍNH VÀ ĐỐI CHIẾU CHO DEEPCHART P0

- **Trạng thái:** ACCEPTED
- **Ngày quyết định:** 2026-11-12
- **Người đề xuất:** Lead Software Architect & Market Data Engineer
- **Phê duyệt:** QA Architect, Tech Lead

---

## 1. Ngữ cảnh (Context)
DeepChart yêu cầu dữ liệu khớp lệnh thực tế (executed trades) cho BTC, ETH và Vàng, với cờ xác định bên chủ động (Taker aggressor side: BUY/SELL), độ chính xác đến từng bước giá và độ trễ thấp trên Windows Desktop. Cần chọn nguồn dữ liệu chính (Primary) và nguồn đối chiếu (Secondary) có tính khả thi kỹ thuật cao, không tốn phí bản quyền cho bản MVP và có thể bắt đầu triển khai ngay tại Gate G1/G2.

## 2. Các phương án đánh giá
1. **Bybit V5 Linear (`publicTrade`):**
   - Ưu điểm: Cung cấp từng fill lệnh độc lập (individual execution), có trade UUID duy nhất, có cờ `Buy`/`Sell` trực tiếp, timestamp mili-giây, kết nối WebSocket hoạt động ổn định và độ trễ đo thực tế ~150ms.
   - Nhược điểm: Message có thể chứa mảng nhiều trade cùng lúc (cần parser xử lý mảng).
2. **Binance USDⓈ-M Futures (`aggTrade`):**
   - Ưu điểm: Khối lượng giao dịch lớn nhất thị trường, cờ `m` (isBuyerMaker) xác định rõ Taker side, có sản phẩm Vàng `XAUUSDT` TradFi Perpetual đã được kiểm chứng live.
   - Nhược điểm: Dữ liệu bị gộp (aggregated trades trong cửa sổ 100ms), domain `fstream.binance.com` bị chặn ở một số mạng ISP (phải dùng fallback `fstream.binancefuture.com`).
3. **CME COMEX Gold (`GC`):**
   - Ưu điểm: Chuẩn quốc tế cao nhất cho vàng tương lai.
   - Nhược điểm: Đòi hỏi giấy phép thương mại và chi phí lớn, không phù hợp cho bản MVP miễn phí ban đầu.

## 3. Quyết định (Decision)
1. **BTC & ETH:** Chọn **Bybit V5 Linear `publicTrade` làm PRIMARY FEED** cho Volume Core MVP, vì Bybit cung cấp từng fill lệnh riêng lẻ (individual fills) thay vì dữ liệu bị nén gộp.
2. **Đối chiếu & Bổ sung:** Chọn **Binance USDⓈ-M `aggTrade` làm SECONDARY RECONCILIATION FEED** cho BTC và ETH, kết nối qua domain fallback `fstream.binancefuture.com`.
3. **Sản phẩm Vàng:** Chọn **Binance USDⓈ-M `XAUUSDT` làm GOLD FEED cho MVP P0** (được hiển thị với nhãn minh bạch `BINANCE XAUUSDT PERPETUAL`). Hoãn CME GC sang P1/P2.

## 4. Hệ quả & Ràng buộc (Consequences)
- `crates/feed-adapters` sẽ xây dựng 2 adapter riêng: `BybitLinearAdapter` và `BinanceFuturesAdapter`.
- Mỗi venue có bảng nến và footprint riêng; tuyệt đối không cộng gộp trade Bybit và Binance vào cùng 1 chart bar mà không có nhãn tổng hợp rõ ràng.
- Bộ kết nối Binance phải tích hợp sẵn danh sách fallback domains để đảm bảo khả năng kết nối tại mọi khu vực địa lý.
