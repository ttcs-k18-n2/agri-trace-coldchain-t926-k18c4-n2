# BÁO CÁO NGHIỆM THU STORY S-54 (JIRA N2-122)

## Thông tin Story
- **Mã Story:** S-54
- **Mã Jira:** [N2-122](https://nhom02.atlassian.net/browse/N2-122)
- **Tên Story:** Thống kê vi phạm chuỗi lạnh theo đơn vị vận chuyển
- **Epic:** E-09 — Quản lý vi phạm chuỗi lạnh
- **Branch:** `feature/S-54-Thống-kê-vi-phạm-chuỗi-lạnh-theo-đơn-vị-vận-chuyển`
- **Base:** `develop`

## Mục tiêu và Tiêu chí chấp nhận (Acceptance Criteria)
1. **Dịch vụ thống kê vi phạm theo đơn vị vận chuyển (`transporter_violation_report_service.js`):**
   - Tổng hợp số lượng chuyến vận chuyển thực hiện (`totalShipments`).
   - Tổng hợp số chuyến xảy ra vi phạm chuỗi lạnh (`violatedShipments`).
   - Tính tổng thời lượng vi phạm chuỗi lạnh tính bằng phút (`totalViolationMinutes`).
   - Tính tỷ lệ vi phạm theo phần trăm (`violationRatePercentage`), làm tròn 2 chữ số thập phân.
   - Hỗ trợ lọc thống kê theo khoảng thời gian tùy chỉnh (`fromDate` đến `toDate`).
2. **Cách ly dữ liệu đa tổ chức (Multi-tenant & RBAC):**
   - Đơn vị vận chuyển (`transporter`) chỉ xem được số liệu thống kê về chính chuyến hàng của mình.
   - Doanh nghiệp sản xuất / Hợp tác xã / Nhà phân phối chỉ xem được dữ liệu liên quan đến các lô hàng thuộc quyền sở hữu của tổ chức mình.
   - Quản trị viên hệ thống (`admin`) và Thanh tra (`inspector`) xem được toàn diện mọi đơn vị vận chuyển để phục vụ thanh kiểm tra và xếp hạng chất lượng.
   - Người dùng chưa xác thực nhận mã lỗi 401 Unauthorized.
3. **REST API Endpoint (`GET /api/reports/transporter-violations`):**
   - Cung cấp dữ liệu thống kê dạng JSON gồm phần tóm lược tổng quan (`summary`) và danh sách chi tiết từng đơn vị vận chuyển (`transporters`).
4. **Giao diện báo cáo trực quan (`frontend/transporter-violations.html`):**
   - Tích hợp chuẩn giao diện hệ thống (`app-shell`), hiển thị biểu đồ thẻ tóm tắt (Tổng đơn vị, Tổng chuyến, Tỷ lệ vi phạm toàn hệ thống, Tổng thời gian vi phạm).
   - Bộ lọc khoảng ngày động (Từ ngày - Đến ngày) kèm nút nạp dữ liệu.
   - Bảng phân tích chi tiết với thanh tiến trình trực quan hóa tỷ lệ vi phạm theo màu sắc và phân loại mức độ rủi ro.

## Bảng đối chiếu kết quả kiểm thử (Test Suite: `s54_transporter_violations.test.js`)
| Mã nhiệm vụ | Tiêu chí nghiệm thu | Kết quả |
|-------------|---------------------|---------|
| N2-239 | Thống kê số chuyến, số vi phạm, tổng thời lượng phút và tỷ lệ % vi phạm | PASS |
| N2-239 | Lọc chính xác số liệu theo khoảng thời gian `fromDate` và `toDate` | PASS |
| N2-239 / T-12 | Tenant Isolation: Đảm bảo phân quyền truy xuất dữ liệu theo đúng tổ chức | PASS |
| N2-239 | REST API `GET /api/reports/transporter-violations` kiểm tra RBAC (401 khi chưa login, 200 khi phân quyền hợp lệ) | PASS |
| N2-306 | Giao diện HTML `transporter-violations.html` đầy đủ cấu trúc bảng, bộ lọc ngày, thẻ tóm tắt và tích hợp `initAppShell` | PASS |
| Toàn bộ Suite | 6/6 automated test cases đạt 100% | PASS |
