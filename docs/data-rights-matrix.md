# MA TRẬN QUYỀN SỬ DỤNG VÀ PHÁP LÝ DỮ LIỆU (DATA RIGHTS MATRIX)
**Gate:** G0 — Source Proof  
**Task ID:** SRC-09  
**Ngày cập nhật:** 2026-11-12  

---

| Sàn / Nguồn dữ liệu | Loại kết nối | Quyền sử dụng cá nhân (Local Desktop) | Quyền tái phân phối thương mại (Redistribution) | Chi phí dữ liệu | Ghi chú điều khoản & Giới hạn |
|---|---|---|---|---|---|
| **Bybit V5 Linear** | Public WebSocket & REST | **CHO PHÉP** (Miễn phí qua API public) | **CẦN THỎA THUẬN RIÊNG** nếu lưu trên cloud bán lại | Miễn phí (theo Rate Limit) | Kết nối client-to-exchange trực tiếp trên máy người dùng tuân thủ API Terms of Service của Bybit. |
| **Binance USDⓈ-M** | Public WebSocket & REST | **CHO PHÉP** (Miễn phí qua API public) | **CẦN THỎA THUẬN RIÊNG** nếu phân phối lại dữ liệu | Miễn phí (theo IP Weight Limits) | Kết nối trực tiếp từ desktop local; cần cơ chế fallback domain khi ISP chặn `fstream.binance.com`. |
| **CME Globex (GC)** | MDP3 / Databento / Rithmic | **YÊU CẦU GIẤY PHÉP** | **NGHIÊM CẤM TÁI PHÂN PHỐI TRÁI PHÉP** | Có phí (Professional / Non-professional fee) | Người dùng cần có tài khoản/khóa cấp quyền (mô hình Bring-Your-Own-Key ở P1/P2). |
| **MT5 / Forex Broker** | MQL5 Bridge / DLL | **CHO PHÉP TRÊN MÁY LOCAL** | Phụ thuộc từng broker | Miễn phí kèm tài khoản broker | Chỉ dùng lấy giá tham chiếu, không phải executed order flow toàn thị trường. |

### Chính sách tuân thủ cho DeepChart Desktop MVP:
1. DeepChart MVP là ứng dụng **Local-first Desktop**: ứng dụng kết nối trực tiếp từ máy của người dùng tới API của sàn, không qua máy chủ trung gian của DeepChart.
2. Không lưu trữ tập trung và không bán lại dữ liệu thị trường (zero redistribution liability).
3. Đính kèm đầy đủ điều khoản miễn trừ trách nhiệm tài chính (Financial Disclaimer) và thông báo bản quyền dữ liệu của từng sàn trong màn hình Settings.
