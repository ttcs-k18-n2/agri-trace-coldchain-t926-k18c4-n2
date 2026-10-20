# BÁO CÁO NGHIỆM THU STORY S-55 (JIRA N2-123)

## Thông tin Story
- **Mã Story:** S-55
- **Mã Jira:** [N2-123](https://nhom02.atlassian.net/browse/N2-123)
- **Tên Story:** Job kiểm tra toàn vẹn định kỳ mọi lô và cảnh báo khi phát hiện đứt mạch
- **Epic:** E-10 — Vận hành và bảo vệ dữ liệu
- **Branch:** `feature/S-55-job-kiem-tra-toan-ven-dinh-ky-canh-bao-dut-mach`
- **Base:** `develop`

## Mục tiêu và Tiêu chí chấp nhận (Acceptance Criteria)
1. **Job kiểm tra toàn vẹn định kỳ (`backend/src/integrity_periodic_job.js`):**
   - Tự động chạy hằng đêm hoặc theo chu kỳ định sẵn để kiểm tra toàn vẹn chuỗi sự kiện cho mọi lô hàng trên toàn hệ thống.
   - Áp dụng kỹ thuật chia nhỏ nhóm lô (Batching, mặc định 25 lô/mẻ) nhằm giải phóng tài nguyên và tránh khóa bảng sự kiện `batch_events` trong thời gian dài (NFR).
   - Sử dụng hàm kiểm tra mật mã học chuẩn S-12 (`verifyBatchEventChain`): đối soát thứ tự liên tục (`sequence_no`), tính liên kết chuỗi băm trước (`previous_hash`) và tính toán lại `event_hash` dựa trên cấu trúc Canonical JSON.
2. **Cơ sở dữ liệu lưu trữ kết quả kiểm tra (Migration 032):**
   - Bảng `integrity_audit_jobs`: ghi nhận phiên kiểm tra (mã job, thời điểm bắt đầu, hoàn thành, tổng số lô đã quét, số lô bị xâm nhập, trạng thái `RUNNING` / `PASSED` / `COMPROMISED`).
   - Bảng `integrity_audit_logs`: ghi nhận chi tiết kết quả từng lô, loại lỗi, thông điệp lỗi, số thứ tự sự kiện lỗi đầu tiên và `final_hash`.
3. **Phát cảnh báo khẩn cấp khi phát hiện xâm phạm / đứt mạch (Alerting):**
   - Khi phát hiện bất kỳ lô nào bị sai lệch mã băm hoặc đứt đoạn chuỗi, hệ thống lập tức đánh dấu trạng thái phiên quét là `COMPROMISED`.
   - Tự động tạo cảnh báo khẩn cấp vào nhật ký kiểm toán S-31 với hành động `INTEGRITY_BREACH_DETECTED`, phân loại mức độ nghiêm trọng `CRITICAL_ALERT` để quản trị viên xử lý ngay lập tức.
4. **REST API Quản trị hệ thống:**
   - `POST /api/admin/integrity-audits/run`: Kích hoạt thủ công phiên kiểm tra toàn vẹn theo yêu cầu.
   - `GET /api/admin/integrity-audits/latest`: Lấy thông tin phiên quét gần nhất và danh sách các lô bị vi phạm phục vụ hiển thị trên Dashboard Admin.
   - `GET /api/admin/integrity-audits`: Danh sách lịch sử các phiên quét kiểm tra toàn vẹn.
   - Kiểm tra phân quyền RBAC: Chỉ tài khoản quản trị viên (`admin`) được phép truy cập; từ chối 403 đối với người dùng thông thường và 401 khi chưa xác thực.

## Bảng đối chiếu kết quả kiểm thử (Test Suite: `s55_integrity_job.test.js` & `migrate.test.js`)
| Mã nhiệm vụ | Tiêu chí nghiệm thu | Kết quả |
|-------------|---------------------|---------|
| N2-241 | Quét hàng loạt chuỗi lô theo từng mẻ nhỏ (batching) và ghi nhận vào cơ sở dữ liệu | PASS |
| N2-242 | Phát hiện lô đứt mạch hash, đánh dấu `COMPROMISED` và phát cảnh báo `INTEGRITY_BREACH_DETECTED` | PASS |
| N2-285 | REST API quản trị `/api/admin/integrity-audits/run`, `/latest`, `/` kiểm tra phân quyền RBAC | PASS |
| Migration 032 | Migration tạo bảng và index `integrity_audit_jobs`, `integrity_audit_logs` kèm rollback | PASS |
| Toàn bộ Suite | 4/4 automated test cases đạt 100% | PASS |
