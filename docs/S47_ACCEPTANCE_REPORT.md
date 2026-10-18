# BÁO CÁO NGHIỆM THU STORY S-47 (JIRA N2-116)

## Thông tin Story
- **Mã Story:** S-47
- **Mã Jira:** [N2-116](https://nhom02.atlassian.net/browse/N2-116)
- **Tên Story:** Người tiêu dùng quét QR xem vùng trồng, ngày thu hoạch và các mốc chính
- **Epic:** E-08 — Trang truy xuất công khai quét QR
- **Branch:** `feature/S-47-truy-xuat-cong-khai`
- **Base:** `develop`

## Mục tiêu và Tiêu chí chấp nhận (Acceptance Criteria)
1. **Quét mã QR và chuyển hướng:** Quét mã QR trên bao bì điều hướng đến trang truy xuất nguồn gốc công khai `/public-trace.html?code={lotCode}` hoặc API `/api/public/trace/{lotCode}` mà không cần đăng nhập.
2. **Loại bỏ URL localhost hardcode:** Thay thế toàn bộ tiền tố `localhost:3000` và `localhost:8080` trong QR code và chuyển hướng máy chủ bằng cấu hình URL động (`PUBLIC_URL`, `BASE_URL` hoặc `protocol://host`).
3. **Loại bỏ mặc định LOT-001:** Trang chi tiết và giao diện truy xuất không còn rơi vào giá trị mặc định ngầm `LOT-001`. Nếu không truyền mã lô hợp lệ, hệ thống hiển thị thông báo yêu cầu cung cấp mã rõ ràng.
4. **Hiển thị đầy đủ thông tin truy xuất:**
   - Tên nông sản, mã lô, tên HTX / cơ sở sản xuất ban đầu.
   - Ngày thu hoạch và trạng thái lô hàng.
   - Toàn bộ danh sách vùng trồng gốc (`origins` / `aggregatedOrigins`), hỗ trợ cả lô đơn nguồn và lô gộp (Diamond DAG đa nguồn).
   - Dòng thời gian các mốc hành trình chuỗi lạnh: thu hoạch, sơ chế, vận chuyển, phân phối theo thứ tự thời gian thực tế.
5. **Xử lý lô không tồn tại:** Trả về mã lỗi HTTP 404 chuẩn kèm thông điệp thân thiện `"Không tìm thấy thông tin lô hàng"`, tuyệt đối không để lộ cấu trúc bảng, stack trace hay lỗi hệ thống nội bộ.
6. **Bảo mật & Tương thích:**
   - Tương thích 100% với Story S-48 (Whitelisting danh mục trường công khai, che giấu tên thương mại đối tác trung gian, giấu khối lượng và giá).
   - Tương thích 100% với Story S-49 (Cảnh báo thu hồi và cảnh báo vi phạm chuỗi lạnh).
   - Thiết kế giao diện di động thân thiện (Mobile-first, không cuộn ngang, tải nhanh).

## Bảng đối chiếu kết quả kiểm thử
| Mã nhiệm vụ | Tiêu chí nghiệm thu | Kết quả |
|-------------|---------------------|---------|
| N2-225 | API sinh mã QR (PNG/SVG) sử dụng URL động, không hardcode localhost | PASS |
| N2-227 | Trang công khai hiển thị lịch sử truy xuất lô không cần đăng nhập | PASS |
| N2-228 | Quét QR xem vùng trồng và mốc thu hoạch theo đúng trình tự | PASS |
| N2-280 | API truy xuất lô công khai qua QR (`/api/public/trace/:lotCode`) | PASS |
| N2-298 | Tổng hợp mọi vùng trồng gốc đối với các lô gộp nhiều nguồn | PASS |
| N2-299 | Xử lý mã không tồn tại, trả về 404 và giao diện thông báo an toàn | PASS |
