# HƯỚNG DẪN BẢO MẬT VÀ XỬ LÝ QUYỀN XÓA DỮ LIỆU ĐỊNH DANH NÔNG HỘ (STORY S-56)
*Tuân thủ Nghị định 13/2023/NĐ-CP về Bảo vệ Dữ liệu Cá nhân & Kiến trúc Bảo toàn Chuỗi Hash (S-12 / K-01)*

---

## 1. Cơ sở Pháp lý & Mục tiêu Kỹ thuật

### 1.1 Cơ sở Pháp lý
Theo **Nghị định số 13/2023/NĐ-CP** ngày 17/04/2023 của Chính phủ về Bảo vệ Dữ liệu Cá nhân:
- **Điều 16 (Quyền xóa dữ liệu):** Chủ thể dữ liệu (ở đây là nông hộ, xã viên, người đứng tên vùng trồng) có quyền yêu cầu Bên Kiểm soát dữ liệu hoặc Bên Xử lý dữ liệu xóa dữ liệu cá nhân của mình khi chấm dứt hợp đồng, rút lại sự đồng ý hoặc không muốn tiếp tục lưu trữ.
- Dữ liệu định danh cá nhân (PII) cần được xóa hoặc làm sạch triệt để: **Họ và tên**, **Số điện thoại**, **Địa chỉ cư trú cá nhân**.

### 1.2 Thách thức Kỹ thuật: Bảo toàn Chuỗi Hash Mật mã học (Cryptographic Immutability)
Trong hệ thống truy xuất nguồn gốc nông sản chuỗi lạnh AgriTrace ColdChain:
- Mỗi sự kiện của lô hàng được băm liên kết (Hash Chaining theo chuẩn K-01 / S-12) dựa trên SHA-256.
- Nếu xóa hoặc sửa các bản ghi sự kiện trong sổ cái lịch sử `batch_events`, toàn bộ chuỗi băm sẽ bị đứt gãy (`BROKEN_CHAIN` hoặc `CONTENT_TAMPERED`), làm mất giá trị chứng minh nguồn gốc sản phẩm trên thị trường.

### 1.3 Giải pháp Kiến trúc (Architectural Solution)
1. **Phân tách PII khỏi Event Payload:**
   - Trong kiến trúc S-12 / K-01, các sự kiện mùa vụ (`batch_events`) chỉ ghi nhận mã định danh kỹ thuật (`farmId`, `productId`, `quantity`, `occurredAt`, `actorUserId`).
   - Thông tin cá nhân của nông hộ (họ tên, SĐT, địa chỉ) được lưu tại bảng danh mục `farms` và các bảng hồ sơ nông hộ, tách rời hoàn toàn khỏi `batch_events.payload`.
2. **Cơ chế Ẩn danh triệt để (Deep Anonymization):**
   - Khi có yêu cầu xóa dữ liệu định danh nông hộ, hệ thống cập nhật bảng `farms`:
     - `farmer_name` $\rightarrow$ `[ĐÃ ẨN DANH THEO NĐ 13/2023]`
     - `farmer_phone` $\rightarrow$ `NULL`
     - `farmer_address` $\rightarrow$ `NULL`
     - `name` $\rightarrow$ `Vùng trồng {farmId} (Đã ẩn danh theo NĐ 13/2023)`
     - `is_anonymized` $\rightarrow$ `TRUE`
   - Mã định danh `farmId` được giữ nguyên làm khóa ngoại để bảo toàn tính toàn vẹn quan hệ cơ sở dữ liệu.
3. **Bảo toàn Hash 100%:**
   - Vì hash trong `batch_events` chỉ băm `farmId` chứ không băm chuỗi ký tự họ tên nông hộ, hàm `verifyBatchEventChain` tiếp tục đạt kết quả `valid: true` đối với mọi lô hàng liên quan.
4. **Không để lộ PII qua API hoặc Giao diện:**
   - Toàn bộ API nghiệp vụ (`GET /api/farms`, `GET /api/farms/:id`) và API công khai (`GET /api/public/trace/:code`) đều tự động lọc qua bộ lọc `sanitizeFarmData` trước khi gửi về client.

---

## 2. Lược đồ Cơ sở Dữ liệu (Migration 033)

Tệp migration: `db/migrations/033_farmer_privacy_anonymization.sql`

```sql
-- Thêm các trường định danh cá nhân và cờ ẩn danh vào bảng farms
ALTER TABLE farms ADD COLUMN IF NOT EXISTS farmer_name VARCHAR(255);
ALTER TABLE farms ADD COLUMN IF NOT EXISTS farmer_phone VARCHAR(32);
ALTER TABLE farms ADD COLUMN IF NOT EXISTS farmer_address TEXT;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS is_anonymized BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

-- Bảng quản lý yêu cầu xóa định danh cá nhân (Right to Erasure)
CREATE TABLE IF NOT EXISTS farmer_anonymization_requests (
  id VARCHAR(64) PRIMARY KEY,
  farm_id VARCHAR(50) NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  requester_name VARCHAR(255) NOT NULL,
  requester_phone VARCHAR(32),
  legalBasis VARCHAR(128) NOT NULL DEFAULT 'Nghi dinh 13/2023/ND-CP',
  status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_by VARCHAR(128) NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_farms_anonymized ON farms(is_anonymized);
CREATE INDEX IF NOT EXISTS idx_farmer_anon_requests_farm ON farmer_anonymization_requests(farm_id);
```

---

## 3. Quy trình Xử lý Yêu cầu Xóa Dữ liệu (Workflow)

```
[Nông hộ yêu cầu xóa PII]
         │
         ▼
[Cán bộ Bảo vệ Dữ liệu / Admin xác thực danh tính & thẩm quyền]
         │
         ▼
[Gọi POST /api/privacy/farmers/:id/anonymize]
         │
         ├─► [1] Cập nhật bảng farms: farmer_name = '[ẨN DANH]', phone = NULL, address = NULL
         ├─► [2] Ghi hồ sơ vào farmer_anonymization_requests
         ├─► [3] Ghi Nhật ký Kiểm toán S-31: action = 'FARMER_PII_ANONYMIZED'
         ├─► [4] Kích hoạt verifyBatchEventChain kiểm tra lại chuỗi hash các lô liên đới
         └─► [5] Trả về mã yêu cầu REQ-PRIVACY-xxx và trạng thái hoàn thành
```

---

## 4. Đặc tả API Quyền Riêng Tư (Privacy REST Endpoints)

### 4.1 Thực hiện xóa dữ liệu định danh nông hộ
- **Endpoint:** `POST /api/privacy/farmers/:id/anonymize`
- **Phân quyền (RBAC):** `admin`, `org_admin` (Cấm các vai trò `producer`, `transporter`, `distributor`).
- **Request Body:**
```json
{
  "requesterName": "Nguyễn Văn A",
  "requesterPhone": "0912345678",
  "legalBasis": "Khoản 1 Điều 16 Nghị định 13/2023/NĐ-CP",
  "notes": "Nông hộ chấm dứt hợp đồng canh tác và yêu cầu xóa dữ liệu cá nhân"
}
```
- **Response:**
```json
{
  "status": 200,
  "success": true,
  "message": "Xóa dữ liệu định danh nông hộ thành công theo Nghị định 13/2023/NĐ-CP.",
  "requestId": "REQ-PRIVACY-1792326500-abc123",
  "farmId": "FARM-001",
  "sanitizedFarm": {
    "id": "FARM-001",
    "name": "Vùng trồng FARM-001 (Đã ẩn danh theo NĐ 13/2023)",
    "farmerName": "[ĐÃ ẨN DANH THEO NĐ 13/2023]",
    "farmerPhone": null,
    "farmerAddress": null,
    "isAnonymized": true
  },
  "hashIntegrityCheck": {
    "verified": true,
    "totalLotsChecked": 3,
    "allValid": true
  }
}
```

### 4.2 Danh sách hồ sơ yêu cầu xóa dữ liệu cá nhân
- **Endpoint:** `GET /api/privacy/anonymization-requests`
- **Phân quyền (RBAC):** `admin`, `org_admin`, `inspector`
- **Mục đích:** Phục vụ thanh tra tuân thủ an toàn thông tin và giải trình kiểm toán.

---

## 5. Nguyên tắc Thử nghiệm An toàn (Safety Compliance)
> [!IMPORTANT]
> **Tuyệt đối không chạy xóa dữ liệu thật trên Production để thử nghiệm.**
> Mọi kịch bản kiểm thử nghiệm thu (Acceptance Testing) và Unit/Integration test đều phải thực thi trên bộ dữ liệu giả lập (In-memory mock hoặc Database Test biệt lập) với các mã định danh tiền tố `FARM-PRIVACY-*` và `LOT-PRIVACY-*`.
