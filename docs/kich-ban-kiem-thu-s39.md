# KỊCH BẢN KIỂM THỬ CHỨC NĂNG (TEST SCENARIO SPECIFICATION)
## STORY [S-39]: BỘ DỮ LIỆU THU HỒI MẪU BỐN TẦNG, BA TỔ CHỨC, CÓ ĐÁP ÁN ĐẾM TAY

- **Mã Story:** S-39 (Jira: N2-106)
- **Epic:** E-06 — Thu hồi lô hàng (Batch Recall)
- **Sprint:** 5
- **Tác giả kịch bản:** Nhóm phát triển & QA TTCS K18 N2
- **Người thực hiện đếm tay độc lập:** Nguyễn Văn An (Tester 1) & Trần Thị Bình (Tester 2)
- **Tài liệu tham chiếu:** [docs/bao-cao-S39.md](file:///C:/ttcs/agri-trace-coldchain-t926-k18c4-n2/docs/bao-cao-S39.md)

---

## 1. MỤC TIÊU VÀ PHẠM VI KIỂM THỬ

### 1.1. Mục tiêu (Objectives)
1. Xác thực tính đúng đắn và đầy đủ của bộ dữ liệu mẫu thu hồi 4 tầng qua 3 tổ chức (`ORG-A`, `ORG-B`, `ORG-C`), có gộp đa nguồn và có lô đã tiêu thụ tới người dùng cuối.
2. Kiểm chứng tính độc lập của kết quả đếm tay từ 2 kiểm thử viên độc lập (không sinh bằng mã thuật toán).
3. Đảm bảo 100% các thuật toán truy xuôi hậu duệ (`traceLotDescendants`) và API thu hồi khớp tuyệt đối với đáp án đếm tay về: danh sách hậu duệ, khối lượng còn lại từng lô, tổng tồn kho cần thu hồi, và danh sách lô đã bán hết.
4. Đảm bảo các ràng buộc phi chức năng (NFR): Tính idempotent khi seed nhiều lần, tính toàn vẹn mật mã SHA-256 (K-01 / S-10), và ràng buộc khối lượng lô đã tiêu thụ bằng 0 (S-29 / Migration 022).

### 1.2. Môi trường & Dữ liệu kiểm thử (Test Environment)
- **Hệ điều hành:** Windows / Linux (Docker)
- **Môi trường chạy:** Node.js v20+ / PostgreSQL 15+
- **Test Runner:** `node:test` và `supertest`
- **Tài khoản kiểm thử:**
  - `inspector_s39@gov.vn` (Quyền Inspector: toàn quyền điều tra thu hồi trên toàn chuỗi).
  - `admin_s39@agri.vn` (Quyền Admin tổ chức ORG-A).
  - `distributor_s39@dist.vn` (Quyền Nhà phân phối ORG-C).

---

## 2. MA TRẬN KỊCH BẢN KIỂM THỬ (TEST SUITE MATRIX)

Kịch bản kiểm thử được chia thành 5 nhóm ca kiểm thử chính:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                      KỊCH BẢN KIỂM THỬ STORY S-39                      │
├───────────────────┬────────────────────────────────────────────────────┤
│ Nhóm 1 (TC-01..05)│ Cấu trúc dữ liệu & Đặc tính nghiệp vụ (AC1 & S-29) │
│ Nhóm 2 (TC-06..10)│ Đối chiếu đáp án đếm tay độc lập 2 người (AC2)    │
│ Nhóm 3 (TC-11..12)│ Tính Idempotency & Bảo chứng mật mã SHA-256 (K-01) │
│ Nhóm 4 (TC-13..15)│ Tích hợp API Endpoint & Phân quyền truy cập        │
│ Nhóm 5 (TC-16..18)│ Kiểm thử Giao diện Người dùng (UI / E2E)           │
└───────────────────┴────────────────────────────────────────────────────┘
```

---

## 3. CHI TIẾT CÁC CA KIỂM THỬ (TEST CASES SPECIFICATION)

### NHÓM 1: CẤU TRÚC DỮ LIỆU & ĐẶC TÍNH NGHIỆP VỤ (AC1 & S-29)

#### TC-S39-01: Kiểm tra cấu trúc 15 lô hàng trải rộng qua 4 tầng
* **Mục tiêu:** Đảm bảo đồ thị có đủ 15 lô hàng từ `R01` đến `R15` phân bổ đúng 4 tầng.
* **Tiền điều kiện:** Chạy seed dữ liệu S-39 (`seedS39Data()` hoặc `db/seed_s39.sql`).
* **Các bước thực hiện:**
  1. Truy vấn danh sách lô hàng có ID bắt đầu bằng ký tự `R`.
  2. Gom nhóm các lô theo tầng:
     - Tầng 1 (Nguồn gốc F0): `R01`, `R02`, `R03`.
     - Tầng 2 (Sơ chế & Phân loại): `R04`, `R05`, `R06`, `R07`.
     - Tầng 3 (Chế biến sâu & Gộp): `R08`, `R09`, `R10`.
     - Tầng 4 (Phân phối & Điểm bán): `R11`, `R12`, `R13`, `R14`, `R15`.
* **Kết quả kỳ vọng:**
  - Tổng số lô = 15.
  - Mỗi tầng có số lô tương ứng như trên, quan hệ cha-con (`parent_lot_id`) phản ánh đúng tầng trước đó.
* **Độ ưu tiên:** P1 (Must)

#### TC-S39-02: Kiểm tra sự phân bổ qua 3 tổ chức độc lập trong chuỗi
* **Mục tiêu:** Xác thực dữ liệu đi qua đúng 3 mắt xích tổ chức chuỗi cung ứng.
* **Các bước thực hiện:**
  1. Lấy danh sách `organization_id` của 15 lô hàng.
* **Kết quả kỳ vọng:**
  - Tồn tại chính xác 3 tổ chức:
    - `ORG-A`: Hợp tác xã (Nông trại vùng trồng).
    - `ORG-B`: Nhà máy sơ chế & chế biến.
    - `ORG-C`: Trung tâm phân phối & Hệ thống bán lẻ.
* **Độ ưu tiên:** P1 (Must)

#### TC-S39-03: Kiểm tra sự tồn tại của các lô gộp từ nhiều nguồn (Multi-source merge)
* **Mục tiêu:** Xác thực tiêu chí có ít nhất một lô gộp đa nguồn trong đồ thị.
* **Các bước thực hiện:**
  1. Truy vấn các bản ghi `batch_relations` có `relation_type = 'MERGE'`.
  2. Lọc các lô đích có từ 2 lô nguồn khác nhau trở lên.
* **Kết quả kỳ vọng:**
  - Lô `R08` (Tầng 3) được gộp từ 2 nguồn: `R04` (250 kg) và `R06` (250 kg).
  - Lô `R10` (Tầng 3) được gộp từ 2 nguồn: `R06` (150 kg) và `R07` (250 kg).
* **Độ ưu tiên:** P1 (Must)

#### TC-S39-04: Kiểm tra trạng thái và ràng buộc của lô đã tiêu thụ theo Story S-29
* **Mục tiêu:** Xác thực tiêu chí có ít nhất một lô đã tiêu thụ tới người dùng cuối.
* **Các bước thực hiện:**
  1. Lọc các lô hàng có trạng thái `Đã bán hết`.
  2. Kiểm tra trường `remaining_quantity` của các lô này.
  3. Kiểm tra chuỗi sự kiện `batch_events` của các lô này.
* **Kết quả kỳ vọng:**
  - Có 2 lô đã tiêu thụ: `R11` và `R14`.
  - Khối lượng còn lại bắt buộc bằng `0.000` kg (Tuân thủ ràng buộc `chk_consumed_remaining_zero` của Migration 022).
  - Tồn tại sự kiện `LOT_CONSUMED` với payload ghi nhận số lượng tiêu thụ và ghi chú điểm bán.
* **Độ ưu tiên:** P1 (Must)

#### TC-S39-05: Kiểm tra tính bảo toàn khối lượng khi phân tách và gộp
* **Mục tiêu:** Đảm bảo khối lượng vật lý hợp lý, không sinh ảo khối lượng.
* **Các bước thực hiện:**
  1. So sánh tổng khối lượng tách (`SPLIT`) và khối lượng còn lại tại lô mẹ:
     - `R01`: Ban đầu 1000kg = Tách sang R04 (400kg) + Tách sang R05 (400kg) + Còn lại (200kg).
     - `R02`: Ban đầu 800kg = Tách sang R06 (500kg) + Còn lại (300kg).
     - `R03`: Ban đầu 500kg = Tách sang R07 (400kg) + Còn lại (100kg).
     - `R08`: Ban đầu 500kg (Gộp 250kg từ R04 + 250kg từ R06) = Tách sang R11 (200kg) + Tách sang R12 (200kg) + Còn lại (100kg).
* **Kết quả kỳ vọng:** Tổng các nhánh tách + còn lại bằng đúng khối lượng ban đầu tại từng lô.
* **Độ ưu tiên:** P2

---

### NHÓM 2: ĐỐI CHIẾU ĐÁP ÁN ĐẾM TAY ĐỘC LẬP HAI NGƯỜI (AC2 & NFR)

#### TC-S39-06: Truy xuôi từ lô gốc R01 – Đối chiếu 7 hậu duệ và chỉ số thu hồi
* **Mục tiêu:** Xác thực kết quả thuật toán truy xuôi từ lô gốc `R01` khớp 100% với đáp án đếm tay độc lập của Tester 1 và Tester 2.
* **Dữ liệu đầu vào:** `startLotId = "R01"`
* **Các bước thực hiện:**
  1. Gọi hàm `traceLotDescendants({ startLotId: "R01", ... })`.
  2. So sánh danh sách `descendantIds` với tập kỳ vọng `{R04, R05, R08, R09, R11, R12, R13}`.
  3. So sánh khối lượng còn lại từng lô hậu duệ:
     - `R04`: 150 kg | `R05`: 100 kg | `R08`: 100 kg | `R09`: 100 kg
     - `R11`: 0 kg | `R12`: 200 kg | `R13`: 80 kg
  4. Tính tổng khối lượng tồn kho hậu duệ cần thu hồi: $150 + 100 + 100 + 100 + 200 + 80 = 730$ kg.
  5. Xác định danh sách lô đã bán hết: `['R11']`.
* **Kết quả kỳ vọng:**
  - `descendantCount` = 7.
  - Danh sách hậu duệ khớp 100%.
  - Tổng tồn kho thu hồi = 730.000 kg.
  - Số lô đã tiêu thụ = 1 (`R11`).
* **Độ ưu tiên:** P1 (Must)

#### TC-S39-07: Truy xuôi từ lô gốc R02 – Đối chiếu 6 hậu duệ và chỉ số thu hồi
* **Mục tiêu:** Xác thực kết quả truy xuôi từ `R02` (chứa nhánh gộp kép sang cả R08 và R10).
* **Dữ liệu đầu vào:** `startLotId = "R02"`
* **Kết quả kỳ vọng:**
  - `descendantIds` = `{R06, R08, R10, R11, R12, R14}` (6 lô).
  - Khối lượng tồn kho từng lô: `R06` (100kg), `R08` (100kg), `R10` (100kg), `R11` (0kg), `R12` (200kg), `R14` (0kg).
  - Tổng tồn kho hậu duệ cần thu hồi = 500.000 kg.
  - Lô đã tiêu thụ tới người dùng = 2 lô (`R11`, `R14`).
* **Độ ưu tiên:** P1 (Must)

#### TC-S39-08: Truy xuôi từ lô gốc R03 – Đối chiếu 3 hậu duệ và chỉ số thu hồi
* **Mục tiêu:** Xác thực kết quả truy xuôi từ `R03`.
* **Dữ liệu đầu vào:** `startLotId = "R03"`
* **Kết quả kỳ vọng:**
  - `descendantIds` = `{R07, R10, R14}` (3 lô).
  - Tổng tồn kho hậu duệ cần thu hồi = 250.000 kg (`R07`: 150kg + `R10`: 100kg).
  - Lô đã tiêu thụ = 1 lô (`R14`).
* **Độ ưu tiên:** P1 (Must)

#### TC-S39-09: Truy xuôi từ lô trung gian Tầng 3 (R08 và R10)
* **Mục tiêu:** Xác thực truy xuôi từ giữa đồ thị (khoanh vùng khi sự cố bắt đầu từ khâu đóng gói/chế biến).
* **Các bước thực hiện:**
  1. Truy xuôi từ `R08`: Hậu duệ kỳ vọng `{R11, R12}` (2 lô), tồn kho cần thu hồi = 200 kg (`R12`), đã tiêu thụ = `R11`.
  2. Truy xuôi từ `R10`: Hậu duệ kỳ vọng `{R14}` (1 lô), tồn kho cần thu hồi = 0 kg, đã tiêu thụ = `R14`.
* **Kết quả kỳ vọng:** Kết quả trả về đúng nhánh con cháu tương ứng.
* **Độ ưu tiên:** P1 (Must)

#### TC-S39-10: Truy xuôi từ lô độc lập biên R15
* **Mục tiêu:** Kiểm tra xử lý lô độc lập, không có quan hệ phả hệ.
* **Dữ liệu đầu vào:** `startLotId = "R15"`
* **Kết quả kỳ vọng:** `descendantIds` = `[]`, `descendantCount` = 0.
* **Độ ưu tiên:** P2

---

### NHÓM 3: TÍNH IDEMPOTENCY & BẢO CHỨNG MẬT MÃ SHA-256 (K-01 / NON-FUNCTIONAL)

#### TC-S39-11: Kiểm thử tính Idempotent khi seed nhiều lần
* **Mục tiêu:** Đảm bảo nạp dữ liệu nhiều lần không làm tăng số lượng bản ghi hoặc lỗi trùng khóa chính.
* **Các bước thực hiện:**
  1. Chạy `seedS39Data()` lần 1 $\rightarrow$ Đếm số lô `R*`, quan hệ `rel-s39-*`, sự kiện `evt-s39-*`.
  2. Chạy `seedS39Data()` lần 2 $\rightarrow$ Đếm lại số lượng các bảng.
* **Kết quả kỳ vọng:**
  - Số lượng bản ghi sau lần 2 bằng đúng số lượng sau lần 1.
  - Không phát sinh lỗi `unique_violation` hay crash server.
* **Độ ưu tiên:** P1 (Must)

#### TC-S39-12: Kiểm tra bảo chứng toàn vẹn mật mã SHA-256 (K-01)
* **Mục tiêu:** 100% bản ghi sự kiện có chuỗi băm hợp lệ, không bị làm giả hoặc sửa đổi.
* **Các bước thực hiện:**
  1. Lặp qua tất cả 15 lô (`R01` $\rightarrow$ `R15`).
  2. Gọi `verifyBatchEventChain(eventsOfLot)`.
* **Kết quả kỳ vọng:**
  - Tất cả các lô đều trả về `{ valid: true }`.
  - Không có lô nào bị lỗi gãy xích băm (`BROKEN_HASH_CHAIN`).
* **Độ ưu tiên:** P1 (Must)

---

### NHÓM 4: TÍCH HỢP API & PHÂN QUYỀN TRUY CẬP (API INTEGRATION)

#### TC-S39-13: Gọi API GET /api/lots/:id/descendants bằng tài khoản Inspector
* **Mục tiêu:** Cán bộ kiểm tra (Inspector) có thể truy xuất đầy đủ hậu duệ để khoanh vùng thu hồi.
* **Các bước thực hiện:**
  1. Đăng nhập với `inspector_s39@gov.vn`.
  2. Gửi yêu cầu: `GET /api/lots/R01/descendants`.
* **Kết quả kỳ vọng:**
  - Mã trạng thái: `200 OK`.
  - Body chứa: `lotId: "R01"`, `descendantIds` (đủ 7 lô), `levels` (phân tầng 1..3), danh sách chi tiết `descendants`.
* **Độ ưu tiên:** P1 (Must)

#### TC-S39-14: Gọi API GET /api/lots/R11 kiểm tra chi tiết lô đã bán hết
* **Mục tiêu:** Xác thực API chi tiết lô phản ánh đúng trạng thái tiêu thụ.
* **Các bước thực hiện:**
  1. Gửi yêu cầu: `GET /api/lots/R11`.
* **Kết quả kỳ vọng:**
  - Mã trạng thái: `200 OK`.
  - `status`: `"Đã bán hết"`.
  - `remainingQuantity`: `0`.
* **Độ ưu tiên:** P1 (Must)

#### TC-S39-15: Gọi API truy xuất với mã lô không tồn tại
* **Mục tiêu:** Kiểm tra xử lý ngoại lệ an toàn.
* **Các bước thực hiện:**
  1. Gửi yêu cầu: `GET /api/lots/R999/descendants`.
* **Kết quả kỳ vọng:**
  - Mã trạng thái: `404 Not Found` (hoặc trả về `descendantIds: []` an toàn).
* **Độ ưu tiên:** P2

---

### NHÓM 5: KIỂM THỬ GIAO DIỆN NGƯỜI DÙNG (UI END-TO-END)

#### TC-S39-16: Xem chi tiết lô gốc R01 trên giao diện web
* **Mục tiêu:** Xác thực hiển thị thông tin lô trên giao diện thực tế.
* **Các bước thực hiện:**
  1. Mở trình duyệt, truy cập: `http://localhost:3000/lot-detail.html?id=R01`.
  2. Đăng nhập bằng tài khoản Inspector hoặc Quản trị viên.
* **Kết quả kỳ vọng:**
  - Hiển thị tên lô: "Lô Cà chua Nguồn R01", khối lượng ban đầu 1000 kg, còn lại 200 kg.
  - Tab "Nguồn gốc & Phả hệ" hiển thị các lô con trực tiếp (`R04`, `R05`).
* **Độ ưu tiên:** P2

#### TC-S39-17: Kích hoạt chức năng "Truy xuôi hậu duệ (Khoanh vùng thu hồi)"
* **Mục tiêu:** Kiểm tra nút chức năng truy xuôi trên giao diện `lot-detail.html`.
* **Các bước thực hiện:**
  1. Tại trang chi tiết `R01`, bấm nút **"Truy xuôi hậu duệ"**.
* **Kết quả kỳ vọng:**
  - Hệ thống tải nhanh danh sách hậu duệ (thời gian dưới 1 giây).
  - Cây phả hệ phân tầng hiển thị rõ:
    - Tầng 1: Lô con trực tiếp `R04`, `R05`.
    - Tầng 2: Lô cháu `R08`, `R09`.
    - Tầng 3: Lô chắt `R11`, `R12`, `R13`.
* **Độ ưu tiên:** P1 (Must)

#### TC-S39-18: Kiểm tra Bảng khoanh vùng thu hồi (Recall Quarantine Table)
* **Mục tiêu:** Đảm bảo người dùng phân biệt được lô còn tồn kệ và lô đã tiêu thụ.
* **Các bước thực hiện:**
  1. Quan sát Bảng danh sách hậu duệ thu hồi của `R01`.
* **Kết quả kỳ vọng:**
  - Các lô còn tồn kho (`R04`, `R05`, `R08`, `R09`, `R12`, `R13`): Có nhãn cảnh báo tồn kệ, hiển thị số lượng tồn chính xác (tổng 730 kg).
  - Lô `R11`: Có nhãn màu xám/đỏ `"Đã bán hết"` (S-29), số lượng tồn `0 kg`, ghi chú đã phân phối tới người tiêu dùng.
* **Độ ưu tiên:** P1 (Must)

---

## 4. BẢNG TỔNG HỢP TIÊU CHÍ NGHIỆM THU (ACCEPTANCE CHECKLIST)

| STT | Tiêu chí nghiệm thu | Mã Test Case kiểm chứng | Trạng thái đạt chuẩn |
| :---: | :--- | :---: | :---: |
| 1 | Đồ thị bốn tầng, ba tổ chức | TC-S39-01, TC-S39-02 | ✅ ĐẠT |
| 2 | Có ít nhất một lô gộp đa nguồn | TC-S39-03 | ✅ ĐẠT (Có R08, R10) |
| 3 | Có ít nhất một lô đã tiêu thụ (S-29) | TC-S39-04 | ✅ ĐẠT (Có R11, R14) |
| 4 | Đáp án đếm tay khớp 100% độc lập 2 người | TC-S39-06 .. TC-S39-10 | ✅ ĐẠT (Khớp 100%) |
| 5 | Tính Idempotent không trùng lặp khi chạy lại | TC-S39-11 | ✅ ĐẠT |
| 6 | 100% sự kiện hợp lệ mật mã SHA-256 | TC-S39-12 | ✅ ĐẠT |
| 7 | API Endpoint trả về đầy đủ hậu duệ & thu hồi | TC-S39-13 .. TC-S39-15 | ✅ ĐẠT |
| 8 | Giao diện hiển thị trực quan cây thu hồi | TC-S39-16 .. TC-S39-18 | ✅ ĐẠT |
