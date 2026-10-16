# S-40: HỢP ĐỒNG GIAO DIỆN API (API CONTRACT)
## Jira N2-211: Mở Chuyến Vận Chuyển Gắn Nhiều Lô và Một Thùng Lạnh

Tài liệu này xác lập hợp đồng giao diện kỹ thuật (API Contract) và lược đồ dữ liệu chuẩn giữa **Backend**, **Frontend**, và **AI Test** phục vụ triển khai tính năng **S-40 (Jira N2-211)** trong hệ thống Truy xuất Nguồn gốc Chuỗi Cung ứng & Chuỗi Lạnh Nông sản (AgriTrace ColdChain).

---

## 1. TỔNG QUAN NGHIỆP VỤ & NGUYÊN TẮC THIẾT KẾ

### 1.1 Mục tiêu nghiệp vụ
- **Liên kết thực thể**: Mỗi chuyến vận chuyển (`shipment`) liên kết **chính xác 1 thùng lạnh** (`coldBoxId`) với **nhiều lô hàng nông sản** (`lotIds: string[]`).
- **Quyền tổ chức nắm giữ**: Chỉ tổ chức đang trực tiếp nắm giữ lô hàng (`CURRENT_HOLDER`, tức `lots.organization_id = req.auth.organizationId`) mới có quyền gắn lô hàng vào chuyến vận chuyển do tổ chức mình mở (ngoại trừ quản trị viên hệ thống `admin`).
- **Chống trùng chuyến đồng thời (No Concurrent Active Shipments)**: Một lô hàng tại một thời điểm chỉ được phép nằm trong **tối đa một chuyến vận chuyển đang hoạt động** (`IN_TRANSIT`). Hệ thống chặn tuyệt đối tình trạng một lô tham gia hai chuyến đồng thời, kể cả trong điều kiện nhiều request gửi đồng thời (race condition / concurrency).
- **Chuỗi khối băm sự kiện (Hash-Chain RFC 8785 SHA-256)**:
  - Khi bắt đầu chuyến (lên xe): Ghi sự kiện `SHIPMENT_LOADED` vào chuỗi băm `batch_events` của từng lô hàng tham gia.
  - Khi kết thúc chuyến (xuống xe): Ghi sự kiện `SHIPMENT_UNLOADED` vào chuỗi băm `batch_events` của từng lô hàng tham gia.
- **Tính nguyên tử (Atomicity & ACID)**: Toàn bộ quá trình tạo chuyến (ghi nhận shipment, shipment_lots, sự kiện chuỗi băm cho mọi lô, và audit log) phải nằm trong một PostgreSQL Transaction duy nhất. Bất kỳ lỗi nào xảy ra sẽ kích hoạt `ROLLBACK` toàn phần.
- **Nhật ký thao tác nghiệp vụ (Audit Log S-31)**: Ghi nhận hành động `SHIPMENT_CREATED` và `SHIPMENT_COMPLETED` phục vụ kiểm toán độc lập.

---

## 2. PHÂN QUYỀN TRUY CẬP (RBAC & TENANCY)

| Vai trò (Role) | Mã vai trò (`roleId`) | Tạo chuyến (POST) | Kết thúc chuyến (POST) | Xem danh sách & Chi tiết (GET) |
|---|---|:---:|:---:|:---:|
| Quản trị hệ thống | `admin` | Có (Mọi tổ chức) | Có (Mọi tổ chức) | Có (Mọi tổ chức) |
| Quản trị tổ chức | `org_admin` | Có (Lô của tổ chức) | Có (Chuyến của tổ chức) | Có (Phạm vi tổ chức) |
| Vận chuyển Logistics | `transporter` | Có (Lô của tổ chức) | Có (Chuyến của tổ chức) | Có (Phạm vi tổ chức) |
| Vùng trồng | `producer` | Có (Lô của tổ chức) | Có (Chuyến của tổ chức) | Có (Phạm vi tổ chức) |
| Hợp tác xã | `cooperative` | Có (Lô của tổ chức) | Có (Chuyến của tổ chức) | Có (Phạm vi tổ chức) |
| Phân phối / Bán lẻ | `distributor` | Có (Lô của tổ chức) | Có (Chuyến của tổ chức) | Có (Phạm vi tổ chức) |
| Cán bộ kiểm tra | `inspector` | **Không (403)** | **Không (403)** | Có (Toàn quyền đọc) |

> **Quy tắc cách ly tổ chức**:
> - Khi gọi API tạo chuyến: Tất cả `lotIds` được truyền lên phải có `organization_id` trùng khớp với `req.auth.organizationId` của người gọi. Nếu có bất kỳ lô hàng nào thuộc tổ chức khác, hệ thống từ chối với mã lỗi `403 Forbidden` (`FORBIDDEN_LOT_ACCESS`).
> - Khi gọi API kết thúc chuyến: Người gọi phải thuộc tổ chức đã tạo chuyến đó (hoặc `admin`).

---

## 3. LƯỢC ĐỒ CƠ SỞ DỮ LIỆU (DATABASE SCHEMA)

### 3.1 Bảng `shipments` (Chuyến vận chuyển)
```sql
CREATE TABLE IF NOT EXISTS shipments (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('shp-' || substr(md5(random()::text), 1, 8)),
    cold_box_id VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'IN_TRANSIT' CHECK (status IN ('IN_TRANSIT', 'COMPLETED', 'CANCELLED')),
    organization_id VARCHAR(50) NOT NULL REFERENCES organizations(id),
    created_by_user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    completed_by_user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    vehicle_plate VARCHAR(50),
    driver_name VARCHAR(100),
    driver_phone VARCHAR(20),
    origin_location_id VARCHAR(50),
    destination_location_id VARCHAR(50),
    notes TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipments_org ON shipments(organization_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_cold_box ON shipments(cold_box_id);
CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON shipments(created_at DESC);
```

### 3.2 Bảng `shipment_lots` (Liên kết Chuyến - Lô hàng)
```sql
CREATE TABLE IF NOT EXISTS shipment_lots (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('shplot-' || substr(md5(random()::text), 1, 8)),
    shipment_id VARCHAR(50) NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    lot_id VARCHAR(50) NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(30) NOT NULL DEFAULT 'LOADED' CHECK (status IN ('LOADED', 'DELIVERED', 'REMOVED')),
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unloaded_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shipment_lot_pair UNIQUE (shipment_id, lot_id)
);

-- RÀNG BUỘC TOÀN VẸN CỐT LÕI (S-40 AC4):
-- Khóa độc quyền một lô hàng chỉ được gắn vào một chuyến vận chuyển đang hoạt động (is_active = TRUE)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_shipment_per_lot 
ON shipment_lots (lot_id) 
WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_shipment_lots_shipment ON shipment_lots(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_lots_lot ON shipment_lots(lot_id);
CREATE INDEX IF NOT EXISTS idx_shipment_lots_active ON shipment_lots(is_active);
```

---

## 4. DANH SÁCH ENDPOINTS CHI TIẾT

### 4.1 Mở chuyến vận chuyển mới (Tạo chuyến & Lên xe)
- **Endpoint**: `POST /api/shipments`
- **Quyền**: `transporter`, `producer`, `cooperative`, `distributor`, `org_admin`, `admin`
- **Mục đích**: Gắn một thùng lạnh với danh sách nhiều lô hàng và xuất phát chuyến. Tự động kiểm tra quyền sở hữu lô, kiểm tra trạng thái hoạt động của lô, và ghi sự kiện `SHIPMENT_LOADED` vào chuỗi băm của từng lô trong 1 transaction nguyên tử.

#### Request Body
```json
{
  "coldBoxId": "CBX-001",
  "lotIds": ["LOT-001", "LOT-002"],
  "vehiclePlate": "29C-888.88",
  "driverName": "Nguyễn Văn Lái",
  "driverPhone": "0912345678",
  "originLocationId": "LOC-WH-TN-01",
  "destinationLocationId": "LOC-HUB-HN-01",
  "notes": "Vận chuyển rau quả chuỗi lạnh nhiệt độ 2 - 4 độ C"
}
```

#### Request Fields
| Trường | Kiểu dữ liệu | Bắt buộc | Mô tả |
|---|---|:---:|---|
| `coldBoxId` | `string` | **Có** | Mã định danh thùng lạnh (VD: `CBX-001`, `TL-01`). Không được để trống. |
| `lotIds` | `string[]` | **Có** | Danh sách mã lô hàng nông sản (ít nhất 1 lô). Không được chứa mã trùng lặp. |
| `vehiclePlate` | `string` | Không | Biển số xe chở thùng lạnh (VD: `29C-888.88`). Chấp nhận alias `licensePlate`. |
| `driverName` | `string` | Không | Tên tài xế điều khiển phương tiện. |
| `driverPhone` | `string` | Không | Số điện thoại liên hệ tài xế. |
| `originLocationId` | `string` | Không | Mã địa điểm / kho xuất phát. |
| `destinationLocationId` | `string` | Không | Mã địa điểm / kho đích đến dự kiến. |
| `notes` | `string` | Không | Ghi chú thêm cho chuyến vận chuyển. |

#### Response Success (`201 Created`)
```json
{
  "success": true,
  "message": "Chuyến vận chuyển đã được khởi tạo thành công.",
  "shipment": {
    "id": "shp-7a8b9c0d",
    "coldBoxId": "CBX-001",
    "status": "IN_TRANSIT",
    "organizationId": "org-trans",
    "organizationName": "Công ty Cổ phần Vận chuyển Chuỗi Lạnh Á Châu",
    "vehiclePlate": "29C-888.88",
    "driverName": "Nguyễn Văn Lái",
    "driverPhone": "0912345678",
    "originLocationId": "LOC-WH-TN-01",
    "destinationLocationId": "LOC-HUB-HN-01",
    "notes": "Vận chuyển rau quả chuỗi lạnh nhiệt độ 2 - 4 độ C",
    "createdByUserId": "usr-transporter",
    "startedAt": "2026-10-16T08:30:00.000Z",
    "completedAt": null,
    "createdAt": "2026-10-16T08:30:00.000Z",
    "updatedAt": "2026-10-16T08:30:00.000Z",
    "lots": [
      {
        "lotId": "LOT-001",
        "status": "LOADED",
        "loadedAt": "2026-10-16T08:30:00.000Z",
        "event": {
          "id": "EVT-d14a51e5-8f6a-4934-bc2e-1317d7b0458a",
          "sequenceNo": 2,
          "eventType": "SHIPMENT_LOADED",
          "eventHash": "b2c3d4e5f6..."
        }
      },
      {
        "lotId": "LOT-002",
        "status": "LOADED",
        "loadedAt": "2026-10-16T08:30:00.000Z",
        "event": {
          "id": "EVT-f25b62f6-9g7b-5045-cd3f-2428e8c1569b",
          "sequenceNo": 3,
          "eventType": "SHIPMENT_LOADED",
          "eventHash": "c3d4e5f6a7..."
        }
      }
    ]
  },
  "data": {
    "id": "shp-7a8b9c0d",
    "coldBoxId": "CBX-001",
    "status": "IN_TRANSIT",
    "lots": [
      { "lotId": "LOT-001", "status": "LOADED" },
      { "lotId": "LOT-002", "status": "LOADED" }
    ]
  }
}
```

---

### 4.2 Xem danh sách chuyến vận chuyển
- **Endpoint**: `GET /api/shipments`
- **Quyền**: Mọi vai trò đã đăng nhập (`admin`, `org_admin`, `transporter`, `producer`, `cooperative`, `distributor`, `inspector`)
- **Bộ lọc (Query Parameters)**:
  - `status`: Lọc theo trạng thái chuyến (`IN_TRANSIT`, `COMPLETED`, `CANCELLED`).
  - `coldBoxId`: Lọc theo mã thùng lạnh.
  - `lotId`: Lọc chuyến chứa mã lô hàng cụ thể.
  - `limit`: Số bản ghi mỗi trang (mặc định 50, tối đa 200).
  - `offset`: Vị trí bắt đầu (mặc định 0).

#### Response Success (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": "shp-7a8b9c0d",
      "coldBoxId": "CBX-001",
      "status": "IN_TRANSIT",
      "organizationId": "org-trans",
      "organizationName": "Công ty Cổ phần Vận chuyển Chuỗi Lạnh Á Châu",
      "vehiclePlate": "29C-888.88",
      "driverName": "Nguyễn Văn Lái",
      "driverPhone": "0912345678",
      "lotCount": 2,
      "lotIds": ["LOT-001", "LOT-002"],
      "startedAt": "2026-10-16T08:30:00.000Z",
      "completedAt": null,
      "createdAt": "2026-10-16T08:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 50,
    "offset": 0
  }
}
```

---

### 4.3 Xem chi tiết một chuyến vận chuyển
- **Endpoint**: `GET /api/shipments/:id`
- **Quyền**: Mọi vai trò đã đăng nhập (tuân thủ quy tắc tổ chức)

#### Response Success (`200 OK`)
```json
{
  "success": true,
  "shipment": {
    "id": "shp-7a8b9c0d",
    "coldBoxId": "CBX-001",
    "status": "IN_TRANSIT",
    "organizationId": "org-trans",
    "organizationName": "Công ty Cổ phần Vận chuyển Chuỗi Lạnh Á Châu",
    "vehiclePlate": "29C-888.88",
    "driverName": "Nguyễn Văn Lái",
    "driverPhone": "0912345678",
    "originLocationId": "LOC-WH-TN-01",
    "destinationLocationId": "LOC-HUB-HN-01",
    "notes": "Vận chuyển rau quả chuỗi lạnh nhiệt độ 2 - 4 độ C",
    "createdByUserId": "usr-transporter",
    "completedByUserId": null,
    "startedAt": "2026-10-16T08:30:00.000Z",
    "completedAt": null,
    "createdAt": "2026-10-16T08:30:00.000Z",
    "updatedAt": "2026-10-16T08:30:00.000Z",
    "lots": [
      {
        "lotId": "LOT-001",
        "lotName": "Lô cà chua Thái Nguyên",
        "status": "LOADED",
        "loadedAt": "2026-10-16T08:30:00.000Z",
        "unloadedAt": null,
        "loadEvent": {
          "id": "EVT-d14a51e5-8f6a-4934-bc2e-1317d7b0458a",
          "sequenceNo": 2,
          "eventHash": "b2c3d4e5f6..."
        },
        "unloadEvent": null
      }
    ]
  }
}
```

---

### 4.4 Kết thúc chuyến vận chuyển (Dỡ hàng & Xuống xe)
- **Endpoint**: `POST /api/shipments/:id/complete` (Hỗ trợ alias `POST /api/shipments/:id/end`)
- **Quyền**: Người tạo chuyến, người dùng thuộc tổ chức quản lý chuyến, hoặc `admin`.
- **Mục đích**: Đánh dấu chuyến hoàn thành, chuyển trạng thái các lô trong chuyến thành `DELIVERED` (`is_active = FALSE`), và tự động ghi sự kiện `SHIPMENT_UNLOADED` vào chuỗi băm của từng lô trong 1 transaction nguyên tử.

#### Request Body (Tuỳ chọn)
```json
{
  "notes": "Đã giao hàng và dỡ khỏi thùng lạnh an toàn tại Tổng kho Long Biên",
  "destinationLocationId": "LOC-HUB-HN-01"
}
```

#### Response Success (`200 OK`)
```json
{
  "success": true,
  "message": "Chuyến vận chuyển đã kết thúc thành công. Đã ghi nhận sự kiện xuống xe vào chuỗi băm của từng lô.",
  "shipment": {
    "id": "shp-7a8b9c0d",
    "coldBoxId": "CBX-001",
    "status": "COMPLETED",
    "completedByUserId": "usr-transporter",
    "startedAt": "2026-10-16T08:30:00.000Z",
    "completedAt": "2026-10-16T11:45:00.000Z",
    "lots": [
      {
        "lotId": "LOT-001",
        "status": "DELIVERED",
        "loadedAt": "2026-10-16T08:30:00.000Z",
        "unloadedAt": "2026-10-16T11:45:00.000Z",
        "unloadEvent": {
          "id": "EVT-e25b62f6-9g7b-5045-cd3f-2428e8c1569c",
          "sequenceNo": 3,
          "eventType": "SHIPMENT_UNLOADED",
          "eventHash": "d4e5f6a7b8..."
        }
      }
    ]
  }
}
```

---

### 4.5 Kiểm tra chuyến đang hoạt động của một lô hàng
- **Endpoint**: `GET /api/lots/:id/active-shipment` (hoặc qua `GET /api/shipments?lotId=:id&status=IN_TRANSIT`)
- **Quyền**: Mọi vai trò có quyền xem lô hàng.

#### Response Success (Nếu có chuyến đang chạy - `200 OK`)
```json
{
  "hasActiveShipment": true,
  "shipment": {
    "id": "shp-7a8b9c0d",
    "coldBoxId": "CBX-001",
    "status": "IN_TRANSIT",
    "vehiclePlate": "29C-888.88",
    "driverName": "Nguyễn Văn Lái",
    "startedAt": "2026-10-16T08:30:00.000Z"
  }
}
```

#### Response Success (Nếu không có chuyến chạy - `200 OK`)
```json
{
  "hasActiveShipment": false,
  "shipment": null
}
```

---

## 5. ĐẶC TẢ SỰ KIỆN CHUỖI BĂM (CRYPTOGRAPHIC HASH-CHAIN EVENTS)

Cả hai sự kiện đều được băm theo chuẩn **RFC 8785 Canonical JSON** kết hợp **SHA-256** với `sequence_no` tuần tự tăng dần:

### 5.1 Sự kiện Lên xe (`SHIPMENT_LOADED`)
- **`eventType`**: `"SHIPMENT_LOADED"`
- **`batchId`**: Mã lô hàng tương ứng (`lotId`)
- **`payload`**:
  ```json
  {
    "shipmentId": "shp-7a8b9c0d",
    "coldBoxId": "CBX-001",
    "action": "LOAD",
    "vehiclePlate": "29C-888.88",
    "driverName": "Nguyễn Văn Lái",
    "originLocationId": "LOC-WH-TN-01",
    "destinationLocationId": "LOC-HUB-HN-01",
    "notes": "Vận chuyển rau quả chuỗi lạnh nhiệt độ 2 - 4 độ C"
  }
  ```

### 5.2 Sự kiện Xuống xe (`SHIPMENT_UNLOADED`)
- **`eventType`**: `"SHIPMENT_UNLOADED"`
- **`batchId`**: Mã lô hàng tương ứng (`lotId`)
- **`payload`**:
  ```json
  {
    "shipmentId": "shp-7a8b9c0d",
    "coldBoxId": "CBX-001",
    "action": "UNLOAD",
    "destinationLocationId": "LOC-HUB-HN-01",
    "notes": "Đã giao hàng và dỡ khỏi thùng lạnh an toàn tại Tổng kho Long Biên"
  }
  ```

---

## 6. NHẬT KÝ KIỂM TOÁN NGHIỆP VỤ (AUDIT LOG S-31)

Các thao tác đều được ghi nhận vào bảng `audit_logs` trong cùng transaction:
1. **`SHIPMENT_CREATED`**:
   - `resourceType`: `"shipment"`
   - `resourceId`: `shipmentId`
   - `action`: `"SHIPMENT_CREATED"`
   - `details`: `{ coldBoxId, lotCount, lotIds, vehiclePlate, driverName }`
2. **`SHIPMENT_COMPLETED`**:
   - `resourceType`: `"shipment"`
   - `resourceId`: `shipmentId`
   - `action`: `"SHIPMENT_COMPLETED"`
   - `details`: `{ coldBoxId, lotCount, lotIds, completedAt }`

---

## 7. BẢNG MÃ LỖI CHUẨN (STANDARD ERROR CODES)

| HTTP Status | Mã lỗi (`error`) | Ý nghĩa & Điều kiện kích hoạt |
|---|---|---|
| `400 Bad Request` | `MISSING_COLD_BOX_ID` | Trường `coldBoxId` bị thiếu hoặc chuỗi rỗng. |
| `400 Bad Request` | `MISSING_LOT_IDS` | Trường `lotIds` không phải mảng hoặc mảng rỗng. |
| `400 Bad Request` | `DUPLICATE_LOT_IN_REQUEST` | Mảng `lotIds` trong request body chứa mã lô trùng lặp. |
| `400 Bad Request` | `LOT_ALREADY_CONSUMED` | Một hoặc nhiều lô hàng đã ở trạng thái tiêu thụ/bán hết, không thể vận chuyển. |
| `400 Bad Request` | `SHIPMENT_ALREADY_COMPLETED` | Chuyến vận chuyển đã ở trạng thái `COMPLETED` trước đó, không thể hoàn thành lại. |
| `400 Bad Request` | `INVALID_SHIPMENT_STATUS` | Trạng thái chuyến không cho phép thao tác này. |
| `401 Unauthorized` | `UNAUTHORIZED` | Người dùng chưa đăng nhập hệ thống. |
| `403 Forbidden` | `FORBIDDEN` | Vai trò của người dùng không có quyền truy cập endpoint. |
| `403 Forbidden` | `FORBIDDEN_LOT_ACCESS` | Tổ chức của người dùng không phải đơn vị đang nắm giữ (`CURRENT_HOLDER`) ít nhất một lô trong danh sách. |
| `403 Forbidden` | `FORBIDDEN_SHIPMENT_ACCESS` | Người dùng không thuộc tổ chức sở hữu chuyến và không phải admin. |
| `403 Forbidden` | `INSPECTOR_FORBIDDEN` | Cán bộ kiểm tra chỉ có quyền đọc dữ liệu, không được tạo/kết thúc chuyến. |
| `404 Not Found` | `LOT_NOT_FOUND` | Một hoặc nhiều mã lô hàng trong `lotIds` không tồn tại trong hệ thống. |
| `404 Not Found` | `SHIPMENT_NOT_FOUND` | Không tìm thấy chuyến vận chuyển theo `id` yêu cầu. |
| `409 Conflict` | `LOT_ALREADY_IN_ACTIVE_SHIPMENT` | Một hoặc nhiều lô hàng đang nằm trong một chuyến vận chuyển khác đang hoạt động (`IN_TRANSIT`). Trả về kèm mảng `conflictingLots`. |

#### Ví dụ phản hồi lỗi 409 Conflict:
```json
{
  "error": "LOT_ALREADY_IN_ACTIVE_SHIPMENT",
  "message": "Không thể mở chuyến: Một hoặc nhiều lô hàng đang tham gia chuyến vận chuyển khác đang hoạt động.",
  "conflictingLots": [
    {
      "lotId": "LOT-001",
      "activeShipmentId": "shp-7a8b9c0d",
      "coldBoxId": "CBX-001"
    }
  ]
}
```

---

## 8. CƠ CHẾ BẢO VỆ CẠNH TRANH ĐỒNG THỜI (CONCURRENCY DEFENSE)

Để chặn 100% tình huống 2 request đồng thời cùng gắn 1 lô hàng vào 2 chuyến khác nhau:
1. **Application Level**: Khóa các hàng của các lô liên quan bằng `SELECT id, organization_id, status FROM lots WHERE id = ANY($1) FOR UPDATE;` theo thứ tự sắp xếp cố định (`ORDER BY id ASC`) để tránh deadlock.
2. **Database Level**: Partial Unique Index `CREATE UNIQUE INDEX idx_unique_active_shipment_per_lot ON shipment_lots (lot_id) WHERE is_active = TRUE;`. Nếu 2 transaction cùng cố chèn bản ghi cho cùng 1 lô, transaction thứ hai sẽ nhận mã lỗi `23505` (unique_violation) từ PostgreSQL engine, kích hoạt rollback an toàn và trả về lỗi `409 LOT_ALREADY_IN_ACTIVE_SHIPMENT`.
