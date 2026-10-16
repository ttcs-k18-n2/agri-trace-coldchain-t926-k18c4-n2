# KẾ HOẠCH KIỂM THỬ (TEST PLAN) - S-40 / JIRA N2-212
## MỞ CHUYẾN VẬN CHUYỂN GẮN NHIỀU LÔ VÀ MỘT THÙNG LẠNH
**Dự án:** Truy xuất nguồn gốc nông sản và chuỗi cung ứng lạnh (AgriTrace ColdChain)  
**QA Automation Engineer:** Jira N2-212  
**Nhánh Git:** `agent/s40-test`  
**Ngày lập:** 16/10/2026  
**Trạng thái:** DRAFTING / PENDING BACKEND API CONTRACT  

---

## 1. TỔNG QUAN VÀ MỤC TIÊU (OVERVIEW & OBJECTIVES)

### 1.1. Bối cảnh nghiệp vụ
Trong chuỗi cung ứng nông sản lạnh, việc vận chuyển từ nông trại/hợp tác xã (Producer/Cooperative) đến đơn vị chế biến, trung tâm phân phối, hoặc đơn vị vận chuyển chuyên nghiệp (Transporter - ví dụ `org-trans`) đòi hỏi quản lý nhiệt độ và kiểm soát phương tiện/thùng lạnh nghiêm ngặt.
- **S-40 (Jira N2-212):** Cung cấp khả năng mở một chuyến vận chuyển (Shipment / Dispatch) chứa **nhiều lô nông sản** (multi-lot) được xếp vào **một thùng lạnh chuyên dụng** (single cold box).
- **Mối liên kết với S-16 (Xác nhận/Từ chối bàn giao):** Chuyến vận chuyển đóng vai trò làm phương tiện chuyên chở trong quá trình bàn giao liên tổ chức (Inter-organization transfer). Khi chuyến vận chuyển được tạo và xuất phát (sự kiện lên xe), các lô hàng chuyển sang trạng thái đang vận chuyển. Khi đến nơi, bên nhận sẽ dỡ hàng (sự kiện xuống xe) và thực hiện nghiệp vụ S-16: kiểm tra, xác nhận tiếp nhận (`CONFIRMED`) hoặc từ chối (`REJECTED`) kèm lý do biên bản.

### 1.2. Mục tiêu kiểm thử
1. Đảm bảo toàn bộ Acceptance Criteria của S-40 và các điểm chạm nghiệp vụ với S-16 được bao phủ 100% bằng kiểm thử tự động (Automation Integration Tests).
2. Kiểm tra tính toàn vẹn dữ liệu (Data Integrity) theo chuẩn K-01: chuỗi băm sự kiện SHA-256 (hash-chain) không bị đứt gãy, không thể sửa lén.
3. Kiểm tra tính bảo mật & cô lập dữ liệu đa tổ chức (Multi-tenant & Role-based Authorization): ngăn chặn hoàn toàn việc can thiệp trái phép vào lô hàng của tổ chức khác.
4. Kiểm tra tính xử lý đồng thời (Concurrency Control): ngăn chặn triệt để race condition khi hai chuyến vận chuyển cùng tranh chấp một lô hàng.
5. Kiểm tra tính nguyên tử của giao dịch (PostgreSQL ACID & Transaction Rollback): đảm bảo không tồn tại dữ liệu mồ côi (orphan records) hay trạng thái nửa vời khi xảy ra lỗi.
6. Xác nhận toàn bộ bài test chạy thành công trên cơ sở dữ liệu PostgreSQL thực tế.

---

## 2. PHÂN TÍCH ACCEPTANCE CRITERIA (AC) & NGHIỆP VỤ BÀN GIAO S-16

| AC ID | Tên tiêu chí chấp nhận | Mô tả chi tiết & Ràng buộc kỹ thuật |
|---|---|---|
| **AC-S40-01** | Tạo chuyến vận chuyển hợp lệ | Cho phép tổ chức sở hữu tạo chuyến vận chuyển gắn đúng 1 thùng lạnh và danh sách $\ge 1$ lô hàng thuộc quyền sở hữu của tổ chức mình. Mã chuyến sinh tự động hoặc chuẩn hóa. |
| **AC-S40-02** | Phân quyền tổ chức (Tenant Isolation) | Chỉ người dùng thuộc tổ chức sở hữu các lô hàng mới được phép lập chuyến vận chuyển cho các lô đó. Người dùng tổ chức khác cố tình gán lô -> HTTP `403 Forbidden` / `404 Not Found`. Role `inspector` chỉ có quyền đọc, không được tạo chuyến -> HTTP `403 Forbidden`. |
| **AC-S40-03** | Chặn lô hàng không hợp lệ | Chặn request tạo chuyến nếu chứa lô không tồn tại, lô đã tiêu thụ (`is_consumed = TRUE`), hoặc lô đã bị đóng/hủy. Trả về mã lỗi HTTP `400 Bad Request` hoặc `404 Not Found`. |
| **AC-S40-04** | Chặn trùng lặp lô trong cùng chuyến | Nếu payload đầu vào chứa các mã lô trùng lặp (ví dụ `lotIds: ["LOT-01", "LOT-01"]`) -> Chặn ngay lập tức với HTTP `400 Bad Request` (mã lỗi `DUPLICATE_LOTS`). |
| **AC-S40-05** | Kiểm tra tính hợp lệ của thùng lạnh | Thùng lạnh phải tồn tại, hợp lệ và đang ở trạng thái rảnh rỗi (`AVAILABLE`). Nếu mã thùng lạnh không tồn tại -> HTTP `400` / `404`. Nếu thùng lạnh đang gắn với chuyến vận chuyển khác đang chạy -> HTTP `409 Conflict` (`COLD_BOX_ALREADY_IN_USE`). |
| **AC-S40-06** | Xử lý tranh chấp đồng thời (Concurrency) | Khi hai request đồng thời cố gắng đưa cùng một lô hàng vào hai chuyến vận chuyển đang chạy khác nhau -> Chỉ DUY NHẤT một request thành công (`201 Created`), request còn lại phải bị từ chối với HTTP `409 Conflict` (`LOT_ALREADY_IN_TRANSIT`). Không một lô hàng nào được phép xuất hiện trên 2 chuyến xe đang chạy đồng thời. |
| **AC-S40-07** | Tính nguyên tử & Rollback PostgreSQL | Nếu có bất kỳ lỗi nào xảy ra trong quá trình tạo chuyến (ví dụ 1 trong số 5 lô vi phạm, hoặc lỗi DB): Toàn bộ transaction PostgreSQL phải ROLLBACK sạch sẽ. Không để lại bản ghi rác trong bảng chuyến hàng, chi tiết lô, sự kiện hay audit log. |
| **AC-S40-08** | Ghi nhận sự kiện lên xe & Chuỗi hash SHA-256 | Khi các lô được xếp lên xe thành công, hệ thống phải tự động phát sinh sự kiện lên xe (ví dụ `SHIPMENT_LOADED` / `DISPATCHED`) cho từng lô trong `batch_events`. Mỗi sự kiện phải kế thừa `previous_hash` chính xác và tính hash SHA-256 theo chuẩn K-01. Kiểm tra tính toàn vẹn chuỗi sự kiện của từng lô phải trả về `valid: true`. |
| **AC-S40-09** | Nghiệp vụ giao nhận/xuống xe gắn với S-16 | Khi chuyến xe đến nơi: hỗ trợ ghi nhận sự kiện xuống xe (`SHIPMENT_UNLOADED` / `DELIVERED`). Kết nối với S-16: Bên nhận thực hiện xác nhận (`CONFIRMED` -> chuyển quyền sở hữu) hoặc từ chối (`REJECTED` -> giữ nguyên chủ cũ, kèm lý do tối thiểu 10 ký tự). |
| **AC-S40-10** | Ghi nhận Audit Log kiểm toán (S-31) | Mọi thao tác tạo chuyến, bắt đầu hành trình, hoàn thành chuyến phải được ghi vĩnh viễn vào bảng `audit_logs` trên PostgreSQL với đầy đủ ngữ cảnh (`actor_id`, `actor_email`, `action`, `resource_type`, `resource_id`, `ip_address`). |

---

## 3. MA TRẬN TEST CASES CHI TIẾT (TEST CASES MATRIX)

### Nhóm 1: Kiểm thử chức năng & Luồng chính (Happy Path)
- **TC-S40-01 (Happy Path - Tạo chuyến 1 thùng lạnh, nhiều lô):**
  - *Mô tả:* Người dùng hợp lệ tạo chuyến vận chuyển gồm 1 thùng lạnh hợp lệ và 3 lô hàng hợp lệ thuộc cùng tổ chức.
  - *Kỳ vọng:* HTTP 201 Created. Chuyến hàng được lưu với trạng thái khởi tạo/đang chạy. Các liên kết lô hàng được tạo đủ. Sự kiện lên xe được ghi vào `batch_events` cho từng lô. Chuỗi hash hợp lệ.
- **TC-S40-02 (Happy Path - Tạo chuyến 1 thùng lạnh, 1 lô tối thiểu):**
  - *Mô tả:* Kiểm tra biên tối thiểu với danh sách chứa đúng 1 lô hàng.
  - *Kỳ vọng:* HTTP 201 Created. Chuyến hàng hoạt động chính xác.

### Nhóm 2: Phân quyền & Cô lập đa tổ chức (Security & Multi-tenancy)
- **TC-S40-03 (Cross-tenant - Đưa lô của tổ chức khác vào chuyến):**
  - *Mô tả:* User A (thuộc `org-001`) tạo chuyến vận chuyển nhưng gài một mã lô `LOT-002` thuộc sở hữu của `org-002`.
  - *Kỳ vọng:* HTTP 403 Forbidden hoặc 404 Not Found. Thao tác bị chặn, không có chuyến hàng nào được tạo ra.
- **TC-S40-04 (Role Permission - Tài khoản Inspector cố tình tạo chuyến):**
  - *Mô tả:* User có vai trò `inspector` gửi request POST tạo chuyến vận chuyển.
  - *Kỳ vọng:* HTTP 403 Forbidden. Cán bộ thanh tra chỉ có quyền giám sát, bị cấm thực hiện thao tác thay đổi trạng thái vận hành.
- **TC-S40-05 (Unauthenticated - Không đăng nhập gọi API):**
  - *Mô tả:* Gửi request tạo chuyến không đính kèm cookie/phiên đăng nhập.
  - *Kỳ vọng:* HTTP 401 Unauthorized.

### Nhóm 3: Dữ liệu đầu vào không hợp lệ & Lô trùng (Data Validation & Edge Cases)
- **TC-S40-06 (Invalid Lot - Lô không tồn tại trong DB):**
  - *Mô tả:* Payload chứa danh sách `lotIds: ["LOT-VALID-01", "LOT-NON-EXISTENT"]`.
  - *Kỳ vọng:* HTTP 400 Bad Request hoặc 404 Not Found. Báo rõ lô không tồn tại.
- **TC-S40-07 (Duplicate Lots - Lô bị trùng lặp trong cùng một payload):**
  - *Mô tả:* Payload chứa `lotIds: ["LOT-001", "LOT-002", "LOT-001"]`.
  - *Kỳ vọng:* HTTP 400 Bad Request (lỗi `DUPLICATE_LOTS`). Toàn bộ request bị từ chối, không xử lý dở dang.
- **TC-S40-08 (Consumed Lot - Lô đã tiêu thụ / đóng gói):**
  - *Mô tả:* Payload chứa lô hàng có cờ `is_consumed = TRUE` hoặc trạng thái đã tiêu thụ hết.
  - *Kỳ vọng:* HTTP 400 Bad Request / 409 Conflict (`LOT_ALREADY_CONSUMED`).
- **TC-S40-09 (Invalid Cold Box - Thùng lạnh không tồn tại hoặc rỗng):**
  - *Mô tả:* Payload gửi `coldBoxId: ""` hoặc `coldBoxId: "BOX-FAKE-999"`.
  - *Kỳ vọng:* HTTP 400 Bad Request hoặc 404 Not Found.
- **TC-S40-10 (Cold Box In Use - Thùng lạnh đang bận trên chuyến khác):**
  - *Mô tả:* Thùng lạnh đang nằm trong chuyến vận chuyển ở trạng thái `IN_TRANSIT` / `ACTIVE`, cố tình mở chuyến mới với thùng lạnh này.
  - *Kỳ vọng:* HTTP 409 Conflict (`COLD_BOX_ALREADY_IN_USE`).
- **TC-S40-11 (Empty Lot List - Danh sách lô rỗng):**
  - *Mô tả:* Payload gửi `lotIds: []`.
  - *Kỳ vọng:* HTTP 400 Bad Request (`EMPTY_LOTS`).

### Nhóm 4: Xử lý đồng thời (Concurrency Control & Race Conditions)
- **TC-S40-12 (Concurrency Race - Hai chuyến tranh chấp cùng một lô hàng):**
  - *Mô tả:* Gửi 2 request `Promise.all([POST shipment A, POST shipment B])` đồng thời, cả hai cùng chỉ định lô `LOT-CONCURRENT-01`.
  - *Kỳ vọng:* 
    + Đúng 1 request thành công (HTTP 201 Created).
    + Đúng 1 request thất bại (HTTP 409 Conflict).
    + Cơ sở dữ liệu ghi nhận lô này chỉ thuộc duy nhất về chuyến A hoặc chuyến B, không bao giờ thuộc về cả hai.

### Nhóm 5: Tính nguyên tử & Rollback giao dịch PostgreSQL (Database Atomicity)
- **TC-S40-13 (PostgreSQL Transaction Rollback khi gặp lỗi giữa chừng):**
  - *Mô tả:* Tạo chuyến với 4 lô hợp lệ và 1 lô cố tình vi phạm (hoặc giả lập lỗi database ở bước ghi event/audit log).
  - *Kỳ vọng:*
    + Request trả về mã lỗi thích hợp (HTTP 4xx / 5xx).
    + Transaction PostgreSQL thực hiện `ROLLBACK`.
    + Kiểm tra bảng `shipments`: không có bản ghi chuyến hàng mới.
    + Kiểm tra bảng `shipment_lots`: không có bản ghi chi tiết nào được lưu.
    + Kiểm tra bảng `lots`: trạng thái các lô hợp lệ không bị thay đổi.
    + Kiểm tra bảng `batch_events`: không có sự kiện mồ côi nào được tạo ra.

### Nhóm 6: Chuỗi băm SHA-256 (K-01) & Audit Logs (S-31)
- **TC-S40-14 (Sự kiện lên xe & Kiểm tra chuỗi băm K-01):**
  - *Mô tả:* Sau khi tạo chuyến vận chuyển thành công, truy vấn `GET /api/lots/:id/events` và `GET /api/lots/:id/integrity` cho tất cả các lô trong chuyến.
  - *Kỳ vọng:*
    + Mỗi lô có sự kiện lên xe với `previous_hash` khớp đúng `event_hash` của sự kiện trước đó.
    + `event_hash` tính toán bằng SHA-256 chuẩn xác.
    + API kiểm tra toàn vẹn trả về `{ valid: true, error: null }`.
- **TC-S40-15 (Ghi nhận Audit Log trên PostgreSQL):**
  - *Mô tả:* Truy vấn bảng `audit_logs` trên PostgreSQL sau khi thực hiện tạo chuyến.
  - *Kỳ vọng:* Có bản ghi kiểm toán với `action` tương ứng (ví dụ `SHIPMENT_CREATED`), ghi đúng thông tin người thực hiện, tổ chức, IP và thời gian.

### Nhóm 7: Nghiệp vụ bàn giao liên tổ chức gắn với S-16
- **TC-S40-16 (S-16 Xác nhận giao hàng chuyến xe - Confirm):**
  - *Mô tả:* Chuyến xe vận chuyển từ `org-001` đến `org-002`. Khi đến nơi, `org-002` xác nhận tiếp nhận.
  - *Kỳ vọng:* Sự kiện xuống xe / nhận hàng được ghi vào chuỗi băm của từng lô. Quyền sở hữu của tất cả các lô trong chuyến được chuyển sang `org-002`.
- **TC-S40-17 (S-16 Từ chối nhận hàng chuyến xe - Reject kèm lý do):**
  - *Mô tả:* Khi giao hàng, `org-002` từ chối nhận toàn bộ hoặc lô hàng do vi phạm nhiệt độ thùng lạnh. Lý do từ chối $\ge 10$ ký tự.
  - *Kỳ vọng:* Sự kiện từ chối được ghi nhận. Quyền sở hữu lô giữ nguyên ở `org-001`. Lô quay về trạng thái sẵn sàng hoặc có sự cố.

---

## 4. MÔI TRƯỜNG VÀ CHIẾN LƯỢC THỰC THI (TEST EXECUTION STRATEGY)

### 4.1. Môi trường kiểm thử
- **Hệ quản trị CSDL:** PostgreSQL 16 chạy trên Docker / port 5432 cục bộ (`agri_trace`).
- **Tài khoản DB test:** `agri_app:app_password` và `agri_migration:migration_password`.
- **Test Runner:** Node.js native test runner (`node --test`) kết hợp `supertest` và driver `pg`.
- **Độc lập dữ liệu (Test Isolation):**
  - Mỗi test case / test suite sử dụng ID riêng biệt với tiền tố tiền định (ví dụ `org-s40-test-...`, `lot-s40-...`, `box-s40-...`).
  - Dọn dẹp (`before` / `after`) dứt điểm trước và sau mỗi lượt chạy để tránh ô nhiễm dữ liệu giữa các lần kiểm thử.

### 4.2. Kế hoạch phối hợp với Backend (Chờ API Contract)
1. **Giai đoạn 1 (Hiện tại):** Hoàn thiện và phê duyệt Test Plan, sẵn sàng khung kiểm thử (Test Scaffold).
2. **Giai đoạn 2:** Tiếp nhận tài liệu `docs/S40_API_CONTRACT.md` chính thức từ nhánh `agent/s40-backend`.
3. **Giai đoạn 3:** Ánh xạ các Test Cases trong Test Plan với các endpoint, method, schema request/response chính thức trong API contract (không tự phát minh endpoint).
4. **Giai đoạn 4:** Viết mã nguồn kiểm thử tích hợp tự động trong `backend/test/s40_shipment_postgres.test.js`.
5. **Giai đoạn 5:** Thực thi test trên PostgreSQL thực tế, ghi nhận kết quả Pass/Fail, phân tích lỗi (nếu có bug), lập báo cáo chi tiết.
