# S-41: HỢP ĐỒNG GIAO DIỆN API & ĐẶC TẢ KỸ THUẬT (API CONTRACT)
## Jira N2-109: Ghi Nhận Nhiệt Độ Theo Thời Gian Cho Chuyến Vận Chuyển - Bỏ Qua Số Đo Cũ

Tài liệu này xác lập hợp đồng giao diện kỹ thuật (API Contract), lược đồ cơ sở dữ liệu và ngữ nghĩa lỗi chuẩn giữa **Backend**, **IoT Gateway**, **Frontend** và **AI Test** phục vụ tính năng **S-41 (Jira N2-109)** trong hệ thống Chuỗi Cung ứng & Chuỗi Lạnh Nông sản (AgriTrace ColdChain).

---

## 1. TỔNG QUAN NGHIỆP VỤ & NGUYÊN TẮC THIẾT KẾ

### 1.1 Mục tiêu nghiệp vụ
- **Ghi nhận số đo nhiệt độ theo thời gian**: Hệ thống tiếp nhận số đo nhiệt độ kèm thời điểm đo (`timestamp`) cho thùng lạnh của chuyến vận chuyển đang hoạt động (`IN_TRANSIT`).
- **Chống ghi đè số đo mới bởi số đo đến trễ (Out-of-Order Handling)**:
  - Nếu số đo gửi đến có thời điểm **mới hơn** mốc thời gian đã lưu gần nhất (`recorded_at > last_temperature_at`), hệ thống lưu số đo vào bảng lịch sử `shipment_temperatures`, cập nhật số đo hiện hành trong `shipments` và phản hồi xác nhận thành công (`ignored: false`).
  - Nếu số đo gửi đến có thời điểm **cũ hơn hoặc bằng** mốc thời gian đã lưu gần nhất (`recorded_at <= last_temperature_at`), hệ thống **bỏ qua không cập nhật hiện hành**, nhưng vẫn trả về phản hồi xác nhận tiếp nhận gói tin (`acknowledged: true`, `ignored: true`) để thiết bị IoT không gửi lại vô hạn.
- **Xác thực và chống giả mạo tổ chức (Session Auth / Anti-Spoofing)**:
  - Bắt buộc xác thực người gọi / thiết bị qua phiên làm việc (`req.auth`).
  - Danh tính tổ chức được trích xuất trực tiếp từ phiên làm việc trên máy chủ (`req.auth.organizationId`). Hệ thống từ chối hoặc bỏ qua bất kỳ trường `organizationId` nào được gửi trong payload yêu cầu.
  - Người dùng không có quyền quản lý chuyến (khác tổ chức) bị từ chối với mã `403 Forbidden` (`FORBIDDEN_SHIPMENT_ACCESS`), trừ quản trị viên `admin`.
- **Nguyên tử & Khóa cạnh tranh (PostgreSQL ACID Concurrency Defense)**:
  - Sử dụng giao dịch cơ sở dữ liệu với khóa dòng `SELECT ... FOR UPDATE` trên bảng `shipments` và cập nhật có điều kiện `WHERE (last_temperature_at IS NULL OR last_temperature_at < $3)`.
  - Khóa duy nhất `CONSTRAINT uq_shipment_temperature_timestamp UNIQUE (shipment_id, recorded_at)` chặn hoàn toàn việc chèn trùng lặp số đo cho cùng một chuyến tại cùng một thời điểm.
- **Tính xác định môi trường in-memory (Deterministic In-Memory Mutex)**:
  - Sử dụng cơ chế hàng đợi Mutex lock theo mã thùng lạnh (`withTemperatureLock`) khi chạy unit test/môi trường không có PostgreSQL.
- **Bảo toàn vòng đời và chuỗi băm S-40**: Giữ nguyên vẹn toàn bộ vòng đời chuyến vận chuyển (`IN_TRANSIT` -> `COMPLETED`) và chuỗi sự kiện hash-chain RFC 8785 SHA-256 của các lô hàng nông sản gắn trong chuyến.

---

## 2. PHÂN QUYỀN TRUY CẬP (RBAC & TENANCY)

| Vai trò (Role) | Mã vai trò (`roleId`) | Ghi nhận nhiệt độ (POST) | Xem lịch sử nhiệt độ (GET) | Ghi chú phạm vi |
|---|---|:---:|:---:|---|
| Quản trị hệ thống | `admin` | **Có** | **Có** | Toàn quyền trên mọi chuyến của mọi tổ chức |
| Quản trị tổ chức | `org_admin` | **Có** | **Có** | Trong phạm vi chuyến của tổ chức mình |
| Vận chuyển Logistics | `transporter` | **Có** | **Có** | Trong phạm vi chuyến của tổ chức mình |
| Vùng trồng | `producer` | **Có** | **Có** | Trong phạm vi chuyến của tổ chức mình |
| Hợp tác xã | `cooperative` | **Có** | **Có** | Trong phạm vi chuyến của tổ chức mình |
| Phân phối / Bán lẻ | `distributor` | **Có** | **Có** | Trong phạm vi chuyến của tổ chức mình |
| Cán bộ kiểm tra | `inspector` | **Không (403)** | **Có** | Chỉ có quyền đọc, không được phép thực hiện thao tác ghi |

---

## 3. LƯỢC ĐỒ CƠ SỞ DỮ LIỆU (DATABASE SCHEMA)

### 3.1 Bảng `shipment_temperatures` (Lịch sử nhiệt độ chuyến)
```sql
CREATE TABLE IF NOT EXISTS shipment_temperatures (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('temp-' || substr(md5(random()::text), 1, 8)),
    shipment_id VARCHAR(50) NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    cold_box_id VARCHAR(50) NOT NULL,
    temperature NUMERIC(5, 2) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shipment_temperature_timestamp UNIQUE (shipment_id, recorded_at)
);
```

### 3.2 Bổ sung cột bảng `shipments` (Số đo hiện hành phục vụ khóa điều kiện)
```sql
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS current_temperature NUMERIC(5, 2);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS last_temperature_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_shipment_temperatures_shipment ON shipment_temperatures(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_temperatures_cold_box ON shipment_temperatures(cold_box_id);
CREATE INDEX IF NOT EXISTS idx_shipment_temperatures_recorded_at ON shipment_temperatures(recorded_at DESC);
```

---

## 4. CHI TIẾT ENDPOINT API

### 4.1 Ghi nhận số đo nhiệt độ cho chuyến
- **Phương thức:** `POST`
- **Đường dẫn chuẩn:** `/api/shipments/temperatures`
- **Bí danh tương thích:**
  - `POST /api/cold-boxes/:code/temperatures`
  - `POST /api/temperatures`
- **Header:** `Content-Type: application/json`, `Cookie: connect.sid=...`
- **Quyền:** `["producer", "cooperative", "transporter", "distributor", "org_admin", "admin"]`

#### Cấu trúc Payload yêu cầu (Request Body)
| Trường | Kiểu dữ liệu | Bắt buộc | Mô tả |
|---|---|:---:|---|
| `coldBoxId` | `string` | **Có** | Mã thùng lạnh (hỗ trợ bí danh `cold_box_id`, `coldBoxCode`, `code`) |
| `timestamp` | `string` (ISO-8601) | **Có** | Chuỗi thời gian chuẩn ISO-8601/RFC 3339 (ví dụ: `2026-10-17T12:00:00.000Z`). Kiểm tra tính hợp lệ chặt chẽ trên lịch (tháng 1-12, số ngày trong tháng có tính năm nhuận, giờ 0-23, phút 0-59, giây 0-59, múi giờ hợp lệ). Từ chối chuỗi mơ hồ như "1", số nguyên/Unix epoch, boolean, object, hoặc ngày sai lịch (như 31/02). Hỗ trợ bí danh `recordedAt`, `measuredAt`. |
| `temperature` | `number` (hữu hạn) | **Có** | Giá trị nhiệt độ đo được tính theo độ C trong phạm vi lưu trữ PostgreSQL `NUMERIC(5, 2)` (-999.99 đến 999.99). Hỗ trợ số âm, số 0 và số thập phân (hỗ trợ bí danh `value`). |

#### Phản hồi thành công: Số đo mới hơn được lưu (HTTP 200)
```json
{
  "status": 200,
  "success": true,
  "acknowledged": true,
  "ignored": false,
  "message": "Số đo nhiệt độ đã được ghi nhận thành công.",
  "data": {
    "id": "temp-a1b2c3d4",
    "shipmentId": "shp-e8f90a12",
    "coldBoxId": "CB-001",
    "temperature": 4.5,
    "recordedAt": "2026-10-17T12:00:00.000Z",
    "createdAt": "2026-10-17T12:00:01.123Z"
  }
}
```

#### Phản hồi thành công: Số đo cũ hơn, bằng số đã lưu, hoặc đến trễ từ chuyến trước khi tái sử dụng thùng lạnh (HTTP 200 - Bỏ qua cập nhật hiện hành)
```json
{
  "status": 200,
  "success": true,
  "acknowledged": true,
  "ignored": true,
  "message": "Số đo cũ hơn hoặc bằng số đo mới nhất đã lưu, bỏ qua ghi nhận.",
  "data": {
    "shipmentId": "shp-e8f90a12",
    "coldBoxId": "CB-001",
    "temperature": 4.2,
    "recordedAt": "2026-10-17T11:45:00.000Z",
    "latestTemperature": 4.5,
    "latestRecordedAt": "2026-10-17T12:00:00.000Z"
  }
}
```
*Lưu ý:* Khi thùng lạnh được tái sử dụng cho chuyến mới, mọi gói tin đến trễ có mốc thời gian trước thời điểm chuyến mới bắt đầu (`started_at`) sẽ được hệ thống phản hồi `acknowledged: true, ignored: true` với thông điệp `"Số đo ghi nhận trước thời điểm chuyến vận chuyển bắt đầu, bỏ qua ghi nhận."` để không làm ô nhiễm dữ liệu của chuyến mới.

### 4.2 Lấy lịch sử số đo nhiệt độ của chuyến
- **Phương thức:** `GET`
- **Đường dẫn:** `/api/shipments/:id/temperatures`
- **Quyền:** `["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin"]`
- **Phản hồi thành công (HTTP 200):**
```json
{
  "status": 200,
  "success": true,
  "shipmentId": "shp-e8f90a12",
  "coldBoxId": "CB-001",
  "count": 2,
  "temperatures": [
    {
      "id": "temp-11111111",
      "shipmentId": "shp-e8f90a12",
      "coldBoxId": "CB-001",
      "temperature": 4.1,
      "recordedAt": "2026-10-17T11:30:00.000Z",
      "createdAt": "2026-10-17T11:30:02.000Z"
    },
    {
      "id": "temp-22222222",
      "shipmentId": "shp-e8f90a12",
      "coldBoxId": "CB-001",
      "temperature": 4.5,
      "recordedAt": "2026-10-17T12:00:00.000Z",
      "createdAt": "2026-10-17T12:00:01.000Z"
    }
  ]
}
```

### 4.3 Danh sách và chi tiết chuyến vận chuyển (Projection đồng nhất)
Các endpoint `GET /api/shipments` (danh sách) và `GET /api/shipments/:id` (chi tiết) đồng nhất cung cấp thông tin số đo nhiệt độ hiện hành:
- `currentTemperature`: Số thực đại diện cho nhiệt độ mới nhất (hỗ trợ số âm, bảo toàn số 0) hoặc `null` nếu chưa có số đo nào được ghi nhận.
- `lastTemperatureAt`: Chuỗi thời gian chuẩn ISO-8601 của số đo mới nhất hoặc `null` nếu chưa có số đo nào được ghi nhận.

---

## 5. BẢNG MÃ LỖI & NGỮ NGHĨA PHẢN HỒI (ERROR SEMANTICS)

| Mã HTTP | Mã lỗi (`error`) | Mô tả nguyên nhân | Xử lý khuyến nghị phía gọi |
|:---:|---|---|---|
| `400` | `MISSING_COLD_BOX_CODE` | Không truyền mã thùng lạnh trong body hoặc params. | Bổ sung `coldBoxId`. |
| `400` | `INVALID_TEMPERATURE` | Giá trị nhiệt độ bị thiếu, không phải số, là `NaN`/`Infinity`, hoặc vượt quá giới hạn lưu trữ PostgreSQL NUMERIC(5, 2) (-999.99 đến 999.99). | Truyền số thực hữu hạn trong phạm vi cho phép (ví dụ: `4.5`). |
| `400` | `INVALID_TIMESTAMP` | Thời điểm đo bị thiếu, sai kiểu dữ liệu (boolean, number, object), sai định dạng ISO-8601, chuỗi mơ hồ (ví dụ: "1") hoặc ngày giờ không hợp lệ trên lịch (ví dụ: ngày 31 tháng 2). | Sử dụng chuỗi định dạng ISO-8601 hợp lệ trên lịch (`YYYY-MM-DDTHH:mm:ss.sssZ`). |
| `400` | `SHIPMENT_ALREADY_ENDED` | Chuyến vận chuyển của thùng lạnh đã kết thúc (`COMPLETED` hoặc `CANCELLED`). | Không gửi số đo cho chuyến đã dỡ hàng xong. |
| `401` | `UNAUTHORIZED` | Chưa đăng nhập hoặc cookie phiên đã hết hạn. | Thực hiện đăng nhập `/api/login` trước khi gọi. |
| `403` | `INSPECTOR_FORBIDDEN` | Cán bộ kiểm tra cố gắng thực hiện thao tác ghi số đo. | Cán bộ kiểm tra chỉ có quyền đọc. |
| `403` | `FORBIDDEN_SHIPMENT_ACCESS` | Người gọi thuộc tổ chức khác với tổ chức quản lý chuyến (hoặc cố tình giả mạo body tổ chức). | Chỉ gửi số đo cho chuyến thuộc tổ chức của mình. |
| `404` | `NO_ACTIVE_SHIPMENT` | Thùng lạnh không có chuyến vận chuyển nào đang hoạt động (`IN_TRANSIT`). | Mở chuyến vận chuyển (`POST /api/shipments`) trước khi ghi số đo. |
| `500` | `INTERNAL_SERVER_ERROR` | Lỗi máy chủ hoặc mất kết nối cơ sở dữ liệu. | Thử lại sau với cơ chế back-off. |

