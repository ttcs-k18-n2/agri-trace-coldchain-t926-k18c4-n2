# Báo cáo Story S-43 — Phát hiện vi phạm ngưỡng có độ trễ 30 phút, không gộp hai lần vượt cách xa nhau

- **Mã Jira:** `[N2-111]` (Backlog ID: `S-43`)
- **Dự án:** Agri Trace Cold Chain (`TTCS_T926_K18C4_N2`)
- **Epic:** `[N2-311] [E-07] Giám sát chuỗi lạnh`
- **Nhánh triển khai:** `feature/S-43]-Phát-hiện-vi-phạm-ngưỡng-có-độ-trễ-30-phút-không-gộp-hai-lần-vượt-cách-xa-nhau`
- **Độ ưu tiên:** Must / Medium (5 Story Points)
- **Trạng thái:** Hoàn thành triển khai & Kiểm thử tự động đạt 100%

---

## 1. Mục tiêu & User Story

> *"Là cán bộ kiểm tra tôi muốn chỉ những lần vượt ngưỡng kéo dài mới bị tính là vi phạm để hệ thống không báo động liên tục vì mấy phút mở cửa xe."*

Trong vận hành chuỗi lạnh nông sản thực tế, việc mở cửa xe tải hoặc mở thùng lạnh để bốc dỡ hàng trong vài phút là nghiệp vụ bình thường. Nhiệt độ xung quanh cảm biến có thể vọt lên trong chốc lát nhưng nông sản bên trong vẫn được bảo quản an toàn. Nếu hệ thống báo động ngay lập tức sẽ gây ra cảnh báo giả (false alarm) liên tục. Story S-43 giải quyết bài toán này bằng cơ chế xác nhận vi phạm có độ trễ 30 phút và quy tắc gộp thông minh.

---

## 2. Tiêu chí chấp nhận (Acceptance Criteria)

- **AC-01 (Độ trễ 30 phút):** Nhiệt độ vượt ngưỡng liên tục quá 30 phút (> 1800 giây) thì sinh một vi phạm ghi rõ: thời điểm bắt đầu (`startTime`), kết thúc (`endTime`), nhiệt độ đỉnh (`peakTemperature`) và thời lượng (`durationMinutes`).
- **AC-02 (Loại bỏ cảnh báo giả):** Vượt ngưỡng ngắn (≤ 30 phút) rồi trở lại an toàn thì không tính là vi phạm.
- **AC-03 (Gộp khoảng cách ngắn):** Hai lần vượt cách nhau dưới 5 phút (< 300 giây) được gộp lại thành MỘT vi phạm duy nhất (đỉnh là max của cả hai lần, thời gian tính từ đầu lần 1 đến cuối lần 2).
- **AC-04 (Phân tách khoảng cách xa):** Hai lần vượt cách nhau từ 5 phút trở lên (≥ 300 giây) được tính là HAI vi phạm riêng biệt (không gộp).
- **AC-05 (Đối chiếu 5 kịch bản S-42):** Số lượng vi phạm và các thông số đỉnh/thời lượng khớp chuẩn xác 100% đáp án của cả 5 kịch bản mẫu ở S-42.
- **NFR (Xử lý theo luồng - Streaming):** Thuật toán cửa sổ trượt (sliding window) chạy được theo luồng số đo đến dần, không chờ hết chuyến mới tính.

---

## 3. Kiến trúc kỹ thuật & Thay đổi mã nguồn

### 3.1 Cơ sở dữ liệu (Database Migration 025)
- **Tệp:** `db/migrations/025_cold_chain_threshold_monitoring.sql`
  - Bảng `temperature_readings`: Lưu trữ số đo viễn thám chuỗi lạnh theo thời gian (thùng lạnh, chuyến, nhiệt độ, độ ẩm, thời điểm đo).
  - Bảng `temperature_violations`: Lưu trữ các bản ghi vi phạm ngưỡng được phát hiện (thời điểm bắt đầu, kết thúc, đỉnh, thời lượng, số đợt gộp, trạng thái).
  - Chỉ mục hiệu năng: `idx_temp_readings_shipment`, `idx_temp_violations_shipment`, `idx_temp_violations_coldbox`.
  - Phân quyền ứng dụng cho vai trò `agri_app`.
- **Tệp Rollback:** `db/migrations/down/025_cold_chain_threshold_monitoring.down.sql`.

### 3.2 Lớp dịch vụ nghiệp vụ (Core Engine)
- **Tệp:** `backend/src/cold_chain_violation_service.js`
  - Class `ColdChainViolationDetector`: Thuật toán phân đoạn vượt ngưỡng, hợp nhất khoảng cách `< 5 phút`, lọc độ trễ `> 30 phút`.
  - Hỗ trợ cả 2 chế độ:
    1. **Batch Series Evaluation:** Đánh giá tức thì toàn bộ chuỗi số đo (`evaluateSeries`).
    2. **Streaming Sliding Window (NFR):** Tiếp nhận từng số đo đến dần qua `processReading`, duy trì cửa sổ trượt và tự động kích hoạt vi phạm khi vượt ngưỡng kéo dài qua 30 phút.
  - Dataset chuẩn 5 kịch bản S-42 (`S42_SCENARIOS`) kèm hàm đối chiếu tự động `verifyS42Scenarios`.

### 3.3 Giao diện lập trình ứng dụng (REST API)
Được đăng ký trong `backend/src/server.js` kèm phân quyền chặt chẽ (`requirePermission`):
- `POST /api/cold-chain/readings`: Ghi nhận số đo viễn thám (Dành cho đơn vị vận chuyển / thiết bị IoT).
- `GET /api/cold-chain/readings`: Tra cứu lịch sử số đo nhiệt độ.
- `GET /api/cold-chain/violations`: Tra cứu danh sách vi phạm ngưỡng (Cán bộ kiểm tra đọc toàn quyền).
- `POST /api/cold-chain/evaluate`: Đánh giá chuỗi nhiệt độ theo yêu cầu (On-demand Analysis).
- `GET /api/cold-chain/scenarios`: Lấy thông tin 5 kịch bản mẫu S-42.
- `POST /api/cold-chain/scenarios/verify`: Chạy kiểm chứng toàn bộ 5 kịch bản S-42.

### 3.4 Giao diện người dùng (Frontend Dashboard)
- **Tệp:** `frontend/cold-chain-monitoring.html`
  - Dashboard trực quan cho Cán bộ kiểm tra (Inspector) và Quản trị viên.
  - Biểu đồ nhiệt độ thời gian thực (SVG Interactive Chart) hiển thị đường ngưỡng 8°C, vùng bóng đỏ thể hiện vi phạm, vùng cảnh báo mở cửa xe.
  - Trình duyệt và đối chiếu trực tiếp 5 kịch bản S-42 bằng 1 cú nhấp chuột.
  - Bộ mô phỏng phát hiện vi phạm theo luồng streaming (Streaming Simulator).
  - Tích hợp điều hướng thống nhất vào `frontend/app-shell.js` (`navColdChain`).

---

## 4. Bảng đối chiếu 5 kịch bản S-42

| Kịch bản | Tình huống nghiệp vụ | Đặc tính thời gian | Kết quả kỳ vọng | Kết quả thực tế | Trạng thái |
|---|---|---|---|---|---|
| **KB 1** | Mở cửa xe ngắn (Bốc xếp nhanh) | Vượt 12 phút (≤ 30 phút) | **0 vi phạm** | **0 vi phạm** | **PASS** |
| **KB 2** | Sự cố hỏng máy lạnh liên tục | Vượt liên tục 45 phút (> 30 phút) | **1 vi phạm** (Đỉnh 14.5°C, 45 phút) | **1 vi phạm** (Đỉnh 14.5°C, 45 phút) | **PASS** |
| **KB 3** | Hai lần mở cửa liên tiếp cách nhau dưới 5 phút | Lần 1: 20p; Nghỉ: 3p (< 5p); Lần 2: 22p | **1 vi phạm gộp** (Đỉnh 11.8°C, 45 phút) | **1 vi phạm gộp** (Đỉnh 11.8°C, 45 phút) | **PASS** |
| **KB 4** | Hai lần vi phạm cách xa nhau ≥ 5 phút | Lần 1: 40p; Nghỉ: 25p (≥ 5p); Lần 2: 35p | **2 vi phạm riêng biệt** (Đỉnh 13.0°C và 12.2°C) | **2 vi phạm riêng biệt** (Đỉnh 13.0°C và 12.2°C) | **PASS** |
| **KB 5** | Một lần ngắn, một lần dài cách nhau ≥ 5 phút | Lần 1: 15p; Nghỉ: 20p; Lần 2: 50p | **1 vi phạm** (Chỉ tính lần 2: Đỉnh 15.0°C, 50 phút) | **1 vi phạm** (Đỉnh 15.0°C, 50 phút) | **PASS** |

---

## 5. Kết quả kiểm thử tự động (Automated Test Execution)

### 5.1 Unit Tests Thuật toán (`cold_chain_s43_detector.test.js`)
- `AC1: Nhiệt độ vượt ngưỡng liên tục quá 30 phút thì sinh một vi phạm có đủ start, end, peak` -> **PASS**
- `AC2: Vượt ngắn (<= 30 phút) rồi trở lại bình thường thì không tính là vi phạm` -> **PASS**
- `AC3: Hai lần vượt cách nhau dưới 5 phút tính là một vi phạm (Gộp)` -> **PASS**
- `AC4: Hai lần vượt cách nhau từ 5 phút trở lên tính là hai vi phạm riêng biệt (Không gộp)` -> **PASS**
- `AC5: Đối chiếu chuẩn xác 100% kết quả của cả 5 kịch bản mẫu ở S-42` -> **PASS**
- `NFR: Streaming sliding window cho kết quả hoàn toàn nhất quán với Batch Evaluation` -> **PASS**
- `Edge Cases: Xử lý danh sách rỗng, số đo không có thứ tự, và chính xác tại mốc 30 phút` -> **PASS**

### 5.2 API Integration & Phân quyền (`cold_chain_s43_api.test.js`)
- `POST /api/cold-chain/readings: Kiểm tra xác thực và validation đầu vào` -> **PASS**
- `POST /api/cold-chain/evaluate: Đánh giá chuỗi nhiệt độ theo yêu cầu (On-Demand Evaluation)` -> **PASS**
- `GET /api/cold-chain/scenarios & POST /api/cold-chain/scenarios/verify: 5 Kịch bản S-42` -> **PASS**
- `Phân quyền vai trò: Cán bộ kiểm tra (Inspector) chỉ được đọc vi phạm/số đo, không được ghi trực tiếp` -> **PASS**
- `Streaming Simulator qua API: Bắn số đo từng điểm và phát hiện vi phạm tự động khi qua 30 phút` -> **PASS**

### 5.3 Migration Suite (`migrate.test.js`)
- `S-43: Migration 025 creates temperature_readings and temperature_violations with rollback` -> **PASS**

### 5.4 Lint & Cú pháp
- `eslint src test` -> **0 lỗi**
- `check_tenant_queries.js (T-12 Tenant Isolation)` -> **100% Pass**
- `check_frontend_syntax.js (12 frontend HTML files)` -> **100% Pass**
