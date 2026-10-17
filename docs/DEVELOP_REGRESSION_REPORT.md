# BÁO CÁO HỒI QUY SAU MERGE DEVELOP (STORY S-44 / JIRA N2-112)
**Ngưỡng nhiệt độ và độ trễ cấu hình theo loại sản phẩm**

- **Dự án:** AgriTrace ColdChain
- **Repository:** https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2
- **Pull Request đã merge:** [PR #157](https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2/pull/157)
- **Merge Commit SHA:** `feba4ed169cc9d08139635ac94f91c1ac47636ef`
- **Nhánh đích:** `develop`
- **Thời điểm kiểm thử:** 17/10/2026 21:07 (GMT+7)
- **Trạng thái kiểm thử:** **100% PASS — KHÔNG CÓ LỖI HỒI QUY**

---

## 1. TỔNG QUAN TÍCH HỢP

Nhánh `fix-develop` đã được tích hợp thành công vào nhánh `develop` thông qua PR #157 sau khi hoàn thành 100% tiêu chí chấp nhận (DoD), vượt qua 100% bộ kiểm thử tự động, linter, kiểm tra cách ly đa tổ chức (Tenant Isolation) và kiểm tra bắt buộc của GitHub Actions CI (6/6 checks đạt `success`).

Ngay sau khi merge, toàn bộ hệ thống đã được kiểm tra lại trực tiếp trên commit HEAD mới nhất của `develop` (`feba4ed169cc9d08139635ac94f91c1ac47636ef`).

---

## 2. KẾT QUẢ KIỂM THỬ TRÊN HEAD DEVELOP

### 2.1. Bộ kiểm thử Story S-44 (`backend/test/s44_product_temperature_config.test.js`)
- **Kết quả:** 16/16 tests **PASS 100%** (Thời gian chạy: ~170ms)
- **Chi tiết từng Test Case:**
  - `TC01`: Sản phẩm A có ngưỡng riêng và phát hiện vi phạm trên (`UPPER_BREACH`) — **PASS**
  - `TC02`: Sản phẩm B có ngưỡng khác — cùng số đo hợp lệ với A nhưng vi phạm với B — **PASS**
  - `TC03`: Nhiệt độ thấp hơn ngưỡng dưới tạo vi phạm `LOWER_BREACH` đúng điều kiện độ trễ — **PASS**
  - `TC04`: Chuyến nhiều sản phẩm áp dụng giới hạn chặt nhất `MAX(min)`, `MIN(max)`, `MIN(delay)` — **PASS**
  - `TC05`: Hai sản phẩm có khoảng nhiệt độ không tương thích bị từ chối rõ ràng (`HTTP 400`) — **PASS**
  - `TC06`: Cập nhật cấu hình sản phẩm không làm thay đổi lịch sử vi phạm đã ghi — **PASS**
  - `TC07`: Biên số đo — vừa bằng ngưỡng không vi phạm, vừa đủ độ trễ không vi phạm, vượt độ trễ có vi phạm — **PASS**
  - `TC08`: Phân quyền sửa cấu hình — Non-admin bị từ chối 403, unauthenticated 401, admin 200 — **PASS**
  - `TC09`: Phân lập dữ liệu tổ chức — Tổ chức 2 không thể tạo chuyến hay truy cập dữ liệu tổ chức 1 — **PASS**
  - `TC10`: Kiểm thử trực tiếp với CSDL PostgreSQL thật (Migration 028 và DML) — **PASS**
  - `TC11`: Kiểm tra cấu trúc DOM và giao diện HTML (`products.html` & `shipments.html`) — **PASS**
  - `TC12`: Kiểm tra hồi quy toàn diện 5 kịch bản mẫu S-42 — **PASS**
  - `TC13`: Số đo cũ hơn hoặc trùng timestamp được bỏ qua an toàn (Resilience) — **PASS**
  - `TC14`: Kiểm tra vi phạm ở cả nhiệt độ âm (-18°C), 0°C và số thập phân — **PASS**
  - `TC15`: Kiểm tra lịch sử sự kiện bất biến và toàn vẹn chuỗi hash RFC 8785 SHA-256 (S-45) — **PASS**

### 2.2. Kiểm thử hồi quy toàn bộ hệ thống (`npm test`)
- **Kết quả:** **100% Test Files PASS**
- **Exit Code:** `0`
- **Các chức năng đã kiểm chứng bảo toàn:**
  - Chuỗi sự kiện bất biến và băm SHA-256 (S-10, S-45).
  - Thu hoạch, phân tách và gộp lô (S-17, S-18, S-19).
  - Bàn giao lô hàng và quét quá hạn (S-16, S-24).
  - Phả hệ và bản đồ truy xuất nguồn gốc (S-21, S-26, S-28, S-60).
  - Thu hồi lô hàng và xác nhận thu hồi (S-34, S-35, S-36, S-37, S-38).
  - Quản lý vị trí và kiểm toán (S-30, S-31).
  - Quản lý chuyến vận chuyển và thùng lạnh (S-40).
  - Thu thập nhiệt độ theo thời gian thực (S-41).
  - Phát hiện vi phạm chuỗi lạnh theo ngưỡng (S-42, S-43).
  - Sinh mã QR cho lô hàng (S-46).

### 2.3. Kiểm thử Migration cơ sở dữ liệu (`backend/test/migrate.test.js`)
- **Kết quả:** 16/16 tests **PASS 100%**
- Cơ chế nâng cấp (up) và khôi phục (down) cho Migration 028 hoạt động chính xác, bảo toàn toàn vẹn dữ liệu.

### 2.4. Kiểm tra Linter, Đa tổ chức và Cú pháp Frontend (`npm run lint`)
- **Linter:** 0 errors.
- **T-12 Tenant Isolation Lint:** 100% truy vấn nghiệp vụ tuân thủ scopedQuery/scopedQueryById/tenantRepository.
- **Frontend Syntax Check:** 14/14 tệp HTML frontend hợp lệ không có lỗi cú pháp.

---

## 3. KẾT LUẬN VÀ TRẠNG THÁI NGHIỆM THU

1. **Jira S-44 (N2-112):** Đạt 100% DoD, sẵn sàng chuyển trạng thái **Done**.
2. **Subtask N2-219 (Backend):** Hoàn thành xuất sắc, chuyển **Done**.
3. **Subtask N2-278 (Frontend):** Hoàn thành xuất sắc, chuyển **Done**.
4. **Subtask N2-220 (Tester):** Hoàn thành đầy đủ bằng chứng kiểm thử 15 TC, chuyển **Done**.
5. Nhánh `develop` hiện tại ở trạng thái hoàn toàn ổn định (green build).
