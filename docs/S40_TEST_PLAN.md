# KẾ HOẠCH VÀ BÁO CÁO KIỂM THỬ (TEST PLAN & EXECUTION REPORT) - S-40 / JIRA N2-211 & N2-212
## MỞ CHUYẾN VẬN CHUYỂN GẮN NHIỀU LÔ VÀ MỘT THÙNG LẠNH (MULTI-LOT COLD BOX SHIPMENTS)
**Dự án:** Truy xuất nguồn gốc nông sản và chuỗi cung ứng lạnh (AgriTrace ColdChain)  
**QA Automation & Test Remediation Engineer:** Jira N2-212 (Test Worker S-40)  
**Nhánh Git:** `agent/s40-test`  
**Ngày cập nhật:** 16/10/2026  
**Trạng thái:** HOÀN TẤT & ĐÃ XÁC MINH TOÀN DIỆN (COMPLETED / VERIFIED)  
- **PostgreSQL Integration Suite (`s40_shipment_postgres.test.js`):** 34/34 PASS (100%)
- **In-Memory Core Suite (`shipment_s40.test.js`):** 8/8 PASS (100%)
- **In-Memory Regression Suite (Integrity, Transfer S-15/S-16, Auth, RBAC):** 52/52 PASS (100%)

---

## 1. TỔNG QUAN VÀ MỤC TIÊU (OVERVIEW & OBJECTIVES)

### 1.1. Bối cảnh nghiệp vụ
Trong chuỗi cung ứng nông sản lạnh, việc vận chuyển từ nông trại/hợp tác xã (Producer/Cooperative) đến đơn vị chế biến, trung tâm phân phối, hoặc đơn vị vận chuyển chuyên nghiệp (Transporter - ví dụ `org-trans`) đòi hỏi quản lý nhiệt độ và kiểm soát phương tiện/thùng lạnh nghiêm ngặt.
- **S-40 (Jira N2-211/N2-212):** Cung cấp khả năng mở một chuyến vận chuyển (Shipment / Dispatch) chứa **nhiều lô nông sản** (multi-lot) được xếp vào **một thùng lạnh chuyên dụng** (single cold box).
- **Mối liên kết với S-16 (Xác nhận/Từ chối bàn giao):** Chuyến vận chuyển đóng vai trò làm phương tiện chuyên chở trong quá trình bàn giao liên tổ chức (Inter-organization transfer). Khi chuyến vận chuyển được tạo và xuất phát, sự kiện lên xe (`SHIPMENT_LOADED`) được gắn vào chuỗi băm của từng lô. Khi đến nơi và dỡ hàng, sự kiện xuống xe (`SHIPMENT_UNLOADED`) được ghi nhận và kích hoạt quy trình S-16: Bên nhận kiểm tra chất lượng, xác nhận tiếp nhận (`CONFIRMED` -> đổi chủ sở hữu sang bên nhận) hoặc từ chối (`REJECTED` -> giữ nguyên quyền sở hữu của bên gửi, bắt buộc lý do $\ge 10$ ký tự).

### 1.2. Mục tiêu kiểm thử
1. Đảm bảo toàn bộ Acceptance Criteria của S-40 (AC-S40-01 đến AC-S40-10) và các điểm chạm nghiệp vụ với S-16 được bao phủ 100% bằng kiểm thử tự động.
2. Kiểm tra tính toàn vẹn dữ liệu (Data Integrity) theo chuẩn K-01: chuỗi băm sự kiện SHA-256 (hash-chain) liên tục qua 5 mắt xích không bị đứt gãy, không thể sửa lén.
3. Kiểm tra tính bảo mật & cô lập dữ liệu đa tổ chức (Multi-tenant & Role-based Authorization): ngăn chặn hoàn toàn việc can thiệp trái phép vào lô hàng hoặc chuyến hàng của tổ chức khác; Inspector chỉ đọc.
4. Kiểm tra tính xử lý đồng thời (Concurrency Control): ngăn chặn triệt để race condition khi hai chuyến vận chuyển cùng tranh chấp một lô hàng thông qua partial unique index `idx_unique_active_shipment_per_lot`.
5. Kiểm tra tính nguyên tử của giao dịch (PostgreSQL ACID & Transaction Rollback): đảm bảo không tồn tại dữ liệu mồ côi (orphan records) hay trạng thái nửa vời khi xảy ra lỗi.
6. Xác nhận toàn bộ bài test chạy thành công trên cơ sở dữ liệu PostgreSQL thực tế cô lập (disposable test database) và chế độ bảo vệ dữ liệu dùng chung (safe guard).

---

## 2. MA TRẬN ACCEPTANCE CRITERIA (AC) & MỨC ĐỘ BAO PHỦ

| AC ID | Tên tiêu chí chấp nhận | Trạng thái | File kiểm thử & Suite thực thi |
|---|---|---|---|
| **AC-S40-01** | Tạo chuyến vận chuyển hợp lệ (1 thùng lạnh, $\ge 1$ lô) | **PASS** | `s40_shipment_postgres.test.js` (Suite 3.1), `shipment_s40.test.js` (Test 1) |
| **AC-S40-02** | Phân quyền tổ chức (Tenant Isolation) & RBAC Inspector | **PASS** | `s40_shipment_postgres.test.js` (Suite 1.1 - 1.4), `shipment_s40.test.js` (Test 2, 7) |
| **AC-S40-03** | Chặn lô hàng không hợp lệ (lô ảo, lô đã tiêu thụ) | **PASS** | `s40_shipment_postgres.test.js` (Suite 2.4, 2.5), `shipment_s40.test.js` (Test 3) |
| **AC-S40-04** | Chặn trùng lặp lô trong cùng một payload request | **PASS** | `s40_shipment_postgres.test.js` (Suite 2.3) |
| **AC-S40-05** | Kiểm tra tính hợp lệ của thùng lạnh (bắt buộc, không rỗng) | **PASS** | `s40_shipment_postgres.test.js` (Suite 2.1) |
| **AC-S40-06** | Xử lý tranh chấp đồng thời (Concurrency Race Condition) | **PASS** | `s40_shipment_postgres.test.js` (Suite 4.1, 4.2), `shipment_s40.test.js` (Test 4, 5) |
| **AC-S40-07** | Tính nguyên tử & Rollback giao dịch PostgreSQL | **PASS** | `s40_shipment_postgres.test.js` (Suite 5.1) |
| **AC-S40-08** | Ghi nhận sự kiện lên xe & Chuỗi hash SHA-256 (K-01) | **PASS** | `s40_shipment_postgres.test.js` (Suite 6.1) |
| **AC-S40-09** | Nghiệp vụ giao nhận/xuống xe gắn với S-16 (Confirm/Reject) | **PASS** | `s40_shipment_postgres.test.js` (Suite 6.4, 7.1 - 7.4), `shipment_s40.test.js` (Test 6) |
| **AC-S40-10** | Ghi nhận Audit Log kiểm toán (S-31) trên PostgreSQL | **PASS** | `s40_shipment_postgres.test.js` (Suite 6.2) |

---

## 3. CƠ CHẾ BẢO VỆ VÀ CÔ LẬP CƠ SỞ DỮ LIỆU (DATABASE GUARD ARCHITECTURE)

Nhằm bảo vệ cơ sở dữ liệu dùng chung (`agri_trace`) không bao giờ bị ghi lén, truncate, migrate sai lệch hoặc sửa đổi trạng thái:

1. **Chế độ An toàn Cục bộ (Optional Local Safe Mode - Mặc định khi không có cờ):**
   - Khi chạy test ở máy cục bộ mà không có biến môi trường chỉ định CSDL cô lập (`TEST_DATABASE_URL` hoặc `CONFIRMED_DISPOSABLE_DB=true`), bài test phát hiện nguy cơ ảnh hưởng CSDL dùng chung và tự động bỏ qua (`t.skip`) kèm thông báo rõ ràng, không làm crash môi trường dev.
2. **Chế độ Bắt buộc CSDL (Required-DB / CI Strict Mode):**
   - Kích hoạt khi có `CI=true`, `REQUIRE_DB=true`, `REQUIRE_POSTGRES=true`, hoặc `STRICT_POSTGRES=true`.
   - Nếu không có CSDL cô lập được xác nhận hoặc CSDL không thể kết nối, test suite **FAIL NGAY LẬP TỨC** (`assert.fail`) với thông báo lỗi rõ ràng, tuyệt đối không âm thầm skip.
3. **Quy trình Disposable Database (Vòng đời CSDL Test Tự hủy):**
   - CSDL được tạo độc lập với tên riêng biệt (ví dụ `agri_trace_s40_disposable_test`).
   - Chạy toàn bộ migrations từ `001_init.sql` đến `024_shipments.sql`.
   - Thực thi trọn vẹn test suite.
   - Dọn dẹp (`DROP DATABASE`) ngay sau khi hoàn tất, đảm bảo không để lại tài nguyên rác.

---

## 4. CHI TIẾT CÁC SUITE KIỂM THỬ TRÊN POSTGRESQL (34 TEST UNITS)

File: `backend/test/s40_shipment_postgres.test.js`

### Suite 1: Phân quyền tổ chức và vai trò (Security & RBAC) - 4 subtests
- **1.1 Unauthenticated:** Chặn request mở chuyến khi chưa đăng nhập (HTTP `401 Unauthorized`).
- **1.2 Inspector RBAC:** Cán bộ kiểm tra (vai trò `inspector`) bị cấm tạo chuyến vận chuyển (HTTP `403 Forbidden`).
- **1.3 Multi-tenant Isolation:** Chặn người dùng đưa lô hàng thuộc quyền quản lý của tổ chức khác vào chuyến vận chuyển (HTTP `403 FORBIDDEN_LOT_ACCESS`).
- **1.4 Inspector Complete Block:** Cán bộ kiểm tra bị cấm kết thúc chuyến vận chuyển (HTTP `403 Forbidden`).

### Suite 2: Kiểm tra dữ liệu đầu vào & Ngoại lệ (Validation & Edge Cases) - 6 subtests
- **2.1 Missing Cold Box:** Chặn payload thiếu `coldBoxId` (HTTP `400 MISSING_COLD_BOX_ID`).
- **2.2 Empty Lot List:** Chặn payload thiếu danh sách hoặc mảng `lotIds` rỗng (HTTP `400 MISSING_LOT_IDS`).
- **2.3 Duplicate Lots in Request:** Chặn payload chứa các mã lô trùng lặp nhau (HTTP `400 DUPLICATE_LOT_IN_REQUEST`).
- **2.4 Lot Not Found:** Chặn payload chứa mã lô không tồn tại trong hệ thống (HTTP `404 LOT_NOT_FOUND`).
- **2.5 Consumed Lot:** Chặn đưa lô đã tiêu thụ (`is_consumed = TRUE`) vào chuyến (HTTP `400 LOT_ALREADY_CONSUMED`).
- **2.6 Complete Non-existent Shipment:** Chặn gọi API kết thúc trên chuyến không tồn tại (HTTP `404 SHIPMENT_NOT_FOUND`).

### Suite 3: Luồng chính - Mở chuyến 1 thùng lạnh, nhiều lô (Happy Path) - 4 subtests
- **3.1 Create Shipment:** Tạo chuyến vận chuyển gắn 1 thùng lạnh và 2 lô thành công (HTTP `201 Created`). Trả về chi tiết chuyến và danh sách lô đã gắn.
- **3.2 Get Shipment Details:** `GET /api/shipments/:id` trả về đầy đủ thông tin chuyến và mảng `lots`.
- **3.3 List Shipments:** `GET /api/shipments` hỗ trợ phân trang, lọc theo tổ chức, trả về danh sách chính xác.
- **3.4 Active Shipment of Lot:** `GET /api/lots/:id/active-shipment` trả về chuyến đang hoạt động của lô.

### Suite 4: Tranh chấp đồng thời (Concurrency Race Conditions) - 2 subtests
- **4.1 Concurrent Request Collision:** Bắn đồng thời 2 request (`Promise.all`) cố gắng đưa cùng một lô `LOT-S40-CONCUR` vào 2 chuyến xe khác nhau.
  - *Kết quả:* Đúng 1 request thành công (`201 Created`), đúng 1 request bị từ chối với HTTP `409 Conflict` (`LOT_ALREADY_IN_TRANSIT`).
  - *Cơ chế CSDL:* Bảo vệ bởi Partial Unique Index `idx_unique_active_shipment_per_lot ON shipment_lots(lot_id) WHERE is_active = TRUE`.
- **4.2 Sequential Duplicate Assignment:** Chặn gán một lô đã nằm trong chuyến active khi gọi tuần tự (HTTP `409 Conflict`).

### Suite 5: Tính nguyên tử & Rollback giao dịch PostgreSQL (ACID Rollback) - 1 subtest
- **5.1 Atomic Batch Rollback:** Tạo chuyến chứa 1 lô hợp lệ và 1 lô vi phạm (lô đã tiêu thụ).
  - *Kết quả:* Toàn bộ transaction bị ROLLBACK sạch sẽ.
  - *Khẳng định CSDL:* Không có bản ghi mồ côi trong bảng `shipments`, bảng `shipment_lots`, bảng `batch_events`, và không có audit log giả mạo.

### Suite 6: Chuỗi băm SHA-256 (K-01), Audit Log (S-31) và Xuống xe - 5 subtests
- **6.1 Ingestion Hash-chain:** Kiểm tra sự kiện lên xe `SHIPMENT_LOADED` được tự động ghi vào `batch_events` cho từng lô trong chuyến, tính đúng hash SHA-256 và `GET /api/lots/:id/integrity` trả về `valid: true`.
- **6.2 S-31 Audit Log:** Khẳng định hành vi mở chuyến được lưu vào bảng `audit_logs` trên PostgreSQL với `action = 'SHIPMENT_CREATED'`, đúng `actor_id` và `organization_id`.
- **6.3 Cross-tenant Complete Block:** Tổ chức khác không có quyền kết thúc chuyến vận chuyển (HTTP `403 FORBIDDEN_SHIPMENT_ACCESS`).
- **6.4 Complete Shipment & Unload:** Hoàn thành chuyến vận chuyển: Ghi nhận sự kiện xuống xe `SHIPMENT_UNLOADED`, giải phóng lô (`is_active = FALSE`), cập nhật trạng thái chuyến thành `COMPLETED`, kiểm tra tính toàn vẹn K-01 đạt `valid: true`.
- **6.5 Complete Idempotency:** Chặn gọi complete lần 2 khi chuyến đã hoàn thành (HTTP `400 SHIPMENT_ALREADY_COMPLETED`).

### Suite 7: Nghiệp vụ bàn giao liên tổ chức sau khi dỡ hàng (S-16 Handover & Ownership) - 4 subtests
- **7.1 Transfer Initiation (S-15/S-16):** Khởi tạo yêu cầu bàn giao cho các lô sau khi hoàn tất dỡ hàng sang `ORG_OTHER`.
  - Khẳng định trong CSDL PostgreSQL bảng `lot_transfers`: trạng thái là `PENDING`.
  - Khẳng định quyền sở hữu trong thời gian chờ: `lots.organization_id` **vẫn giữ nguyên `ORG_TRANS`** (chưa đổi chủ).
- **7.2 S-16 RBAC & Reason Validation:**
  - Bên gửi cố tự confirm bàn giao của chính mình -> HTTP `403 Forbidden`.
  - Cán bộ kiểm tra (Inspector) cố confirm -> HTTP `403 Forbidden`.
  - Cán bộ kiểm tra cố reject -> HTTP `403 Forbidden`.
  - Bên nhận từ chối nhưng không nhập lý do -> HTTP `400 Bad Request` (`INVALID_REASON`).
  - Bên nhận từ chối với lý do $< 10$ ký tự -> HTTP `400 Bad Request` (`INVALID_REASON`).
- **7.3 S-16 AC1 Confirm (Đổi chủ sở hữu & Chuỗi băm K-01 5 mắt xích):**
  - Bên nhận (`otherAgent`) xác nhận tiếp nhận bàn giao `LOT-S40-001`.
  - *Khẳng định CSDL PostgreSQL:* `lots.organization_id` **đổi thành công sang `ORG_OTHER`**.
  - *Khẳng định API:* `GET /api/lots/:id` trả về `organizationId = ORG_OTHER`, lô xuất hiện trong danh mục quản lý của `ORG_OTHER`.
  - *Khẳng định Chuỗi băm 5 mắt xích liên tục:*
    1. `HARVEST_RECORDED` (seq 1, previous_hash = GENESIS_HASH)
    2. `SHIPMENT_LOADED` (seq 2, previous_hash = event 1 hash)
    3. `SHIPMENT_UNLOADED` (seq 3, previous_hash = event 2 hash)
    4. `TRANSFER_INITIATED` (seq 4, previous_hash = event 3 hash)
    5. `TRANSFER_CONFIRMED` (seq 5, previous_hash = event 4 hash)
  - *Khẳng định tính toàn vẹn:* API `GET /api/lots/:id/integrity` trả về `{ valid: true }`.
  - *Khẳng định chặn thao tác lặp:* Chặn confirm lần 2 trả về HTTP `409 Conflict` (`TRANSFER_ALREADY_RESOLVED`).
- **7.4 S-16 AC2 Reject (Giữ nguyên chủ cũ & Chuỗi băm K-01 5 mắt xích):**
  - Bên nhận từ chối tiếp nhận bàn giao `LOT-S40-002` với lý do: *"Nhiệt độ thùng lạnh ghi nhận 14 độ C trong suốt chuyến, vi phạm dải bảo quản 2-4 độ C"*.
  - *Khẳng định CSDL PostgreSQL:* `lots.organization_id` **giữ nguyên `ORG_TRANS`** (không đổi chủ).
  - *Khẳng định API:* Bên gửi (`transAgent`) vẫn giữ nguyên quyền quản lý lô hàng.
  - *Khẳng định Chuỗi băm 5 mắt xích liên tục:*
    1. `HARVEST_RECORDED` (seq 1)
    2. `SHIPMENT_LOADED` (seq 2)
    3. `SHIPMENT_UNLOADED` (seq 3)
    4. `TRANSFER_INITIATED` (seq 4)
    5. `TRANSFER_REJECTED` (seq 5, lưu lý do biên bản trong payload)
  - *Khẳng định tính toàn vẹn:* API `GET /api/lots/:id/integrity` trả về `{ valid: true }`.
  - *Khẳng định chặn thao tác lặp:* Chặn reject hoặc confirm lần 2 trả về HTTP `409 Conflict` (`TRANSFER_ALREADY_RESOLVED`).

---

## 5. LỆNH THỰC THI KIỂM THỬ VÀ BẰNG CHỨNG THỰC TẾ (COMMANDS & EVIDENCE)

### 5.1. Kiểm tra Chế độ Bắt buộc CSDL (Required-DB Guard Verification)
**Lệnh thực thi:**
```powershell
$env:REQUIRE_DB="true"; node --test backend/test/s40_shipment_postgres.test.js; Remove-Item Env:\REQUIRE_DB
```
**Bằng chứng kết quả (FAIL chuẩn xác khi không có CSDL cô lập):**
```text
✖ S-40 (Jira N2-211/N2-212): Mở chuyến vận chuyển gắn nhiều lô và một thùng lạnh trên PostgreSQL thực tế (1.4399ms)
  AssertionError [ERR_ASSERTION]: [REQUIRED-DB/CI FAILURE] [S-40 PG Test Guard] Không phát hiện CSDL test cô lập (disposable test database). Để bảo vệ CSDL dùng chung/live không bị ghi, migrate, seed hoặc truncate, bài test yêu cầu cấu hình TEST_DATABASE_URL hoặc CONFIRMED_DISPOSABLE_DB=true.
```

### 5.2. Kiểm tra Chế độ An toàn Cục bộ (Optional Local Safe Mode Verification)
**Lệnh thực thi:**
```powershell
node --test backend/test/s40_shipment_postgres.test.js
```
**Bằng chứng kết quả (SKIP an toàn, bảo vệ CSDL dùng chung):**
```text
[SKIP] [S-40 PG Test Guard] Không phát hiện CSDL test cô lập (disposable test database). Để bảo vệ CSDL dùng chung/live không bị ghi, migrate, seed hoặc truncate, bài test yêu cầu cấu hình TEST_DATABASE_URL hoặc CONFIRMED_DISPOSABLE_DB=true.
﹣ S-40 (Jira N2-211/N2-212): Mở chuyến vận chuyển gắn nhiều lô và một thùng lạnh trên PostgreSQL thực tế (1.0642ms) # Bỏ qua do chưa cấu hình CSDL PostgreSQL test cô lập (chế độ an toàn local)
ℹ tests 1 | ℹ pass 0 | ℹ skipped 1 | ℹ fail 0
```

### 5.3. Khởi tạo, Di chuyển Schema và Chạy Full Suite trên CSDL Cô lập (Isolated Disposable DB Execution)
**Các bước thực thi:**
```powershell
# Bước 1: Tạo database cô lập chuyên dụng
node -e "const { Pool } = require('pg'); const p = new Pool({ connectionString: 'postgresql://agri_migration:migration_password@localhost:5432/postgres' }); async function init() { await p.query('DROP DATABASE IF EXISTS agri_trace_s40_disposable_test;'); await p.query('CREATE DATABASE agri_trace_s40_disposable_test;'); console.log('Disposable test DB created successfully'); await p.end(); } init();"

# Bước 2: Chạy đầy đủ các bản migration (001 đến 024)
$env:MIGRATION_DATABASE_URL="postgresql://agri_migration:migration_password@localhost:5432/agri_trace_s40_disposable_test"
$env:DATABASE_URL="postgresql://agri_migration:migration_password@localhost:5432/agri_trace_s40_disposable_test"
node backend/src/migrate.js
Remove-Item Env:MIGRATION_DATABASE_URL; Remove-Item Env:DATABASE_URL

# Bước 3: Chạy toàn bộ 34 test units trên PostgreSQL thực tế
$env:TEST_DATABASE_URL="postgresql://agri_app:app_password@localhost:5432/agri_trace_s40_disposable_test"
$env:TEST_MIGRATION_DATABASE_URL="postgresql://agri_migration:migration_password@localhost:5432/agri_trace_s40_disposable_test"
$env:CONFIRMED_DISPOSABLE_DB="true"
$env:REQUIRE_DB="true"
node --test backend/test/s40_shipment_postgres.test.js
Remove-Item Env:TEST_DATABASE_URL; Remove-Item Env:TEST_MIGRATION_DATABASE_URL; Remove-Item Env:CONFIRMED_DISPOSABLE_DB; Remove-Item Env:REQUIRE_DB

# Bước 4: Hủy CSDL cô lập ngay sau khi test xong
node -e "const { Pool } = require('pg'); const p = new Pool({ connectionString: 'postgresql://agri_migration:migration_password@localhost:5432/postgres' }); async function cleanup() { await p.query('DROP DATABASE IF EXISTS agri_trace_s40_disposable_test;'); console.log('Disposable test DB dropped successfully'); await p.end(); } cleanup();"
```

**Bằng chứng kết quả (34/34 PASS):**
```text
▶ S-40 (Jira N2-211/N2-212): Mở chuyến vận chuyển gắn nhiều lô và một thùng lạnh trên PostgreSQL thực tế
  ✔ SUITE 1: Phân quyền tổ chức và vai trò (Security & RBAC) (22.8056ms)
  ✔ SUITE 2: Kiểm tra tính hợp lệ của dữ liệu đầu vào (Validation & Edge Cases) (34.1484ms)
  ✔ SUITE 3: Luồng chính - Mở chuyến 1 thùng lạnh, nhiều lô (Happy Path) (38.9038ms)
  ✔ SUITE 4: Tranh chấp đồng thời - Hai chuyến cùng gắn 1 lô (Concurrency Race) (26.1081ms)
  ✔ SUITE 5: Tính nguyên tử & Rollback giao dịch PostgreSQL (ACID Rollback) (11.1719ms)
  ✔ SUITE 6: Chuỗi băm SHA-256 (K-01), Audit Log (S-31) và Xuống xe S-16 (52.9249ms)
  ✔ SUITE 7: Nghiệp vụ bàn giao liên tổ chức sau khi dỡ hàng (S-16 Handover & Ownership) (122.4868ms)
✔ S-40 (Jira N2-211/N2-212): Mở chuyến vận chuyển gắn nhiều lô và một thùng lạnh trên PostgreSQL thực tế (541.6304ms)
ℹ tests 34
ℹ suites 0
ℹ pass 34
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 769.9836
```

### 5.4. Kiểm tra Bộ kiểm thử In-Memory và Hồi quy liên quan (Regression Suites)
**Lệnh thực thi:**
```powershell
node --test backend/test/shipment_s40.test.js backend/test/integrity.test.js backend/test/integrity_verification.test.js backend/test/transfer.test.js backend/test/auth.test.js backend/test/permission_matrix.test.js
```
**Bằng chứng kết quả (52/52 PASS):**
```text
ℹ tests 52
ℹ suites 0
ℹ pass 52
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 812.3328
```

---

## 6. HẠN CHẾ MÔI TRƯỜNG VÀ CÁC ĐIỀU KIỆN BIÊN (LIMITATIONS & BOUNDARY CONDITIONS)

1. **Quyền truy cập Docker Daemon cục bộ (Docker API Permission):**
   - Lệnh `docker ps` trên môi trường Windows hiện tại gặp lỗi quyền: `permission denied while trying to connect to the docker API at npipe:////./pipe/docker_engine`.
   - *Biện pháp thay thế:* Sử dụng trực tiếp kết nối TCP Port 5432 cục bộ (`localhost:5432`) thông qua tài khoản di trú PostgreSQL `agri_migration` có quyền `CREATEDB` để tạo và hủy cơ sở dữ liệu cô lập `agri_trace_s40_disposable_test`.
2. **Quyền sở hữu thực thi Cơ sở dữ liệu (Database Ownership Division):**
   - Theo chỉ thị của Master: Test Worker sở hữu toàn bộ việc chạy và kiểm thử trên cơ sở dữ liệu thực tế (PostgreSQL integration suite). Backend worker được chỉ thị chỉ chạy in-memory.
   - Các file mã nguồn production (`backend/src/*`) và frontend (`frontend/*`) được giữ nguyên, không chỉnh sửa ngoài phạm vi test và CI.
3. **Cấu hình Continuous Integration (CI Automation):**
   - Tệp `.github/workflows/ci.yml` đã được bổ sung đầy đủ các biến môi trường:
     ```yaml
          NODE_ENV: test
          CI: "true"
          REQUIRE_DB: "true"
          CONFIRMED_DISPOSABLE_DB: "true"
     ```
   - Đảm bảo khi chạy trên GitHub Actions (nơi service container PostgreSQL được dựng riêng biệt), test suite sẽ tự động chạy chế độ bắt buộc CSDL, phát hiện lỗi nếu CSDL không khả dụng và không bao giờ skip sai sót.
