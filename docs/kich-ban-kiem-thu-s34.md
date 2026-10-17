# KỊCH BẢN KIỂM THỬ S-34 – LỆNH THU HỒI LIỆT KÊ ĐỦ MỌI LÔ HẬU DUỆ, KỂ CẢ LÔ GỘP TỪ NHIỀU NGUỒN

## 1. Thông tin kịch bản

- **Mã kịch bản:** KB-S34
- **Story liên quan:** S-34 (N2-101) & S-39 (N2-106)
- **Mục tiêu:** Kiểm thử chức năng mở lệnh thu hồi, tính toán động toàn bộ lô hậu duệ kể cả lô gộp đa nguồn, và kiểm chứng giao diện người dùng.

---

## 2. Dữ liệu tiền đề (Pre-conditions)
1. Bộ dữ liệu mẫu S-39 đã được nạp (`seedS39InMemory()` hoặc `db/seed_s39.sql`).
2. Tài khoản kiểm thử:
   - **Inspector:** `inspector_s34@agri.gov.vn` (Role: `inspector`)
   - **Admin:** `admin_s34@agri.vn` (Role: `admin`)
   - **Producer:** `producer_s34@agri.vn` (Role: `producer`)

---

## 3. Các bước kiểm thử chi tiết

### Kịch bản 1: Mở lệnh thu hồi lô gốc R01 và đối chiếu đáp án đếm tay (AC1)

1. **Bước 1:** Đăng nhập vào hệ thống bằng tài khoản Inspector hoặc Admin.
2. **Bước 2:** Truy cập trang chi tiết lô hàng `R01`: `GET /lot-detail.html?id=R01`.
3. **Bước 3:** Nhấn nút **"Mở lệnh thu hồi"** màu đỏ trên thanh thao tác.
4. **Bước 4:** Điền thông tin:
   - Lý do: *"Phát hiện dư lượng thuốc BVTV vượt ngưỡng quy định"*.
   - Mức độ nghiêm trọng: `HIGH` (Nghiêm trọng).
   - Nhấn **"Xác nhận Mở lệnh thu hồi"**.
5. **Kỳ vọng nghiệm thu:**
   - Trạng thái lô `R01` chuyển sang huy hiệu màu đỏ: `Có sự cố`.
   - Một sự kiện `RECALL_ORDER_CREATED` xuất hiện trong chuỗi thời gian của lô với mã băm SHA-256 hợp lệ.
   - Bảng khoanh vùng thu hồi hiển thị chính xác **7 lô hậu duệ**:
     - `R04` (Tồn 150 kg)
     - `R05` (Tồn 100 kg)
     - `R08` (Tồn 100 kg)
     - `R09` (Tồn 100 kg)
     - `R11` (Tồn 0 kg, trạng thái `Đã bán hết`)
     - `R12` (Tồn 200 kg)
     - `R13` (Tồn 80 kg)
   - Tổng khối lượng tồn kho cần thu hồi hiển thị chính xác: **730.00 kg**.

---

### Kịch bản 2: Kiểm tra nhận diện lô gộp từ nhiều nguồn (AC2)

1. **Bước 1:** Quan sát dòng của lô `R08` trong Bảng khoanh vùng thu hồi của lệnh thu hồi `R01`.
2. **Kỳ vọng nghiệm thu:**
   - Cột **Quan hệ** hiển thị huy hiệu tím nổi bật: `[🔀 Gộp đa nguồn (2)]`.
   - Rê chuột (hover) vào huy hiệu: Hiển thị tooltip chi tiết: `Lô gộp từ các nguồn: R04 (250kg), R06 (250kg)`.
   - Ghi chú `Lô gộp từ nhiều nguồn` hiển thị rõ ràng.

---

### Kịch bản 3: Tách lô mới sau khi đã mở lệnh thu hồi và tính toán động (AC3 & NFR)

1. **Bước 1:** Trong lúc lệnh thu hồi của `R01` đang mở (với 7 hậu duệ ban đầu).
2. **Bước 2:** Thực hiện thao tác tách lô từ lô cháu `R12` (Ví dụ tách 50 kg tạo thành lô con `R16`).
3. **Bước 3:** Quay lại trang chi tiết hoặc nhấn nút **"Làm mới"** (`Refresh Descendants`) tại bảng thu hồi.
4. **Kỳ vọng nghiệm thu:**
   - Hệ thống không cần tạo lại lệnh thu hồi.
   - Bảng tự động tính toán lại Live BFS và hiển thị **8 lô hậu duệ** (xuất hiện thêm lô `R16` với khối lượng tồn 50 kg).
   - Tổng khối lượng tồn kho thu hồi được bảo toàn đúng: **730.00 kg** (R12 còn 150 kg + R16 có 50 kg).

---

### Kịch bản 4: Kiểm tra phân quyền truy cập và bảo vệ dữ liệu (RBAC)

1. **Bước 1:** Đăng nhập bằng tài khoản Nhà sản xuất (`producer_s34@agri.vn`).
2. **Bước 2:** Truy cập `lot-detail.html?id=R01`.
3. **Kỳ vọng nghiệm thu:**
   - Nút **"Mở lệnh thu hồi"** KHÔNG hiển thị trên giao diện của Producer.
   - Thử gửi yêu cầu trực tiếp `POST /api/recalls` qua API: Nhận phản hồi lỗi `403 Forbidden` ("Bạn không có quyền thực hiện thao tác này").
   - Thử gửi `GET /api/recalls/:id/descendants`: Nhận lỗi `403 Forbidden`.

---

## 4. Hướng dẫn chạy kiểm thử tự động (Command Line)

```powershell
# Chạy toàn bộ các test case của Story S-34
node --test backend/test/recall_descendants_s34.test.js

# Chạy kiểm thử hồi quy toàn bộ hệ thống
node --test backend/test/recall_descendants_s34.test.js backend/test/recall_service_s34.test.js backend/test/migrate.test.js backend/test/seed_s39.test.js
```
