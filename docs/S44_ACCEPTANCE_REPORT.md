# BÁO CÁO NGHIỆM THU STORY S-44 (JIRA N2-112)
**Ngưỡng nhiệt độ và độ trễ cấu hình theo loại sản phẩm**

- **Dự án:** AgriTrace ColdChain
- **Repository:** https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2
- **Nhánh triển khai:** `fix-develop`
- **Jira Story:** [N2-112: S-44](https://nhom02.atlassian.net/browse/N2-112)
- **Subtasks hoàn thành:**
  - `N2-219`: Backend (AGY-Backend)
  - `N2-278`: Frontend (AGY-Frontend)
  - `N2-220`: Tester (AGY-Tester)
- **Ngày hoàn thành:** 17/10/2026
- **Trạng thái:** **100% HOÀN THÀNH — ĐẠT ĐẦY ĐỦ TIÊU CHÍ DoD**

---

## 1. TỔNG QUAN VÀ MỤC TIÊU STORY S-44

Trước Story S-44, hệ thống giám sát chuỗi lạnh sử dụng ngưỡng nhiệt độ và độ trễ cố định (8°C, độ trễ 30 phút). Story S-44 hiện thực hóa:
1. **Cấu hình độc lập theo từng sản phẩm:** Mỗi sản phẩm có ngưỡng nhiệt độ dưới (`temp_min`), ngưỡng trên (`temp_max`), và độ trễ chấp nhận (`delay_minutes`).
2. **Quy tắc phối hợp chặt nhất (Strict Intersection):** Khi một chuyến vận chuyển chở nhiều sản phẩm khác nhau, hệ thống tự động áp dụng:
   - Ngưỡng dưới: `MAX(temp_min)`
   - Ngưỡng trên: `MIN(temp_max)`
   - Độ trễ: `MIN(delay_minutes)`
3. **Phát hiện xung đột bảo quản (Incompatible Ranges):** Nếu các sản phẩm có dải nhiệt độ không giao nhau (`effectiveTempMin > effectiveTempMax`), hệ thống từ chối tạo chuyến với mã lỗi `INCOMPATIBLE_PRODUCT_TEMPERATURE_RANGES` (HTTP 400).
4. **Bảo toàn lịch sử vi phạm (Immutability):** Cấu hình nhiệt độ áp dụng được snapshot trực tiếp vào chuyến vận chuyển khi khởi tạo. Mọi cập nhật ngưỡng sản phẩm sau đó **không** làm tính lại hoặc thay đổi các sự kiện vi phạm đã ghi nhận.
5. **Phân quyền và bảo mật (RBAC & Multi-tenant):** Chỉ quản trị viên (`admin`) được phép thay đổi cấu hình ngưỡng sản phẩm.
6. **Không hardcode mặc định:** Việc áp đặt ngưỡng mặc định toàn cục cho sản phẩm chưa cấu hình được đặt trạng thái `BLOCKED` chờ xác nhận nghiệp vụ từ tài liệu GD-8 và chuyên gia ngành.

---

## 2. MA TRẬN ĐỐI CHIẾU ACCEPTANCE CRITERIA (AC MATRIX)

| Mã AC | Tiêu chí chấp nhận (Jira N2-112 & Subtasks) | Mã nguồn hiện thực | Testcase kiểm chứng | Trạng thái |
|---|---|---|---|:---:|
| **AC-01** | Lưu trữ ngưỡng `temp_min`, `temp_max`, `delay_minutes` trong PostgreSQL và In-memory | `db/migrations/028_product_temperature_thresholds.sql`<br>`backend/src/server.js` | `TC10`, `migrate.test.js` | **PASS** |
| **AC-02** | API đọc, cập nhật cấu hình; Validate `tempMin < tempMax` và `delayMinutes >= 0` | `backend/src/server.js` (`PUT /api/products/:id/temperature-config`) | `TC08` | **PASS** |
| **AC-03** | Phân quyền RBAC: Chỉ `admin` sửa được cấu hình, non-admin trả HTTP 403, unauth trả 401 | `backend/src/server.js` (`requirePermission(["admin"])`) | `TC08` | **PASS** |
| **AC-04** | Chuyến 1 sản phẩm: Áp dụng cấu hình sản phẩm đó | `backend/src/cold_chain_violation_service.js`<br>`backend/src/shipment_service.js` | `TC01`, `TC02` | **PASS** |
| **AC-05** | Chuyến nhiều sản phẩm: Áp dụng giới hạn chặt nhất `MAX(min)`, `MIN(max)`, `MIN(delay)` | `backend/src/cold_chain_violation_service.js` (`resolveShipmentThresholds`) | `TC04` | **PASS** |
| **AC-06** | Xử lý sản phẩm có dải nhiệt không tương thích: Từ chối tạo chuyến HTTP 400 | `backend/src/shipment_service.js` (`createShipment`) | `TC05` | **PASS** |
| **AC-07** | Bắt cả vi phạm vượt ngưỡng trên (`UPPER_BREACH`) và thấp hơn ngưỡng dưới (`LOWER_BREACH`) | `backend/src/cold_chain_violation_service.js` (`ColdChainViolationDetector`) | `TC01`, `TC03`, `TC14` | **PASS** |
| **AC-08** | Không tính lại vi phạm cũ khi cấu hình sản phẩm thay đổi | `backend/src/cold_chain_violation_service.js`<br>`backend/src/shipment_service.js` | `TC06` | **PASS** |
| **AC-09** | Xử lý số đo cũ, trùng timestamp không làm sai lệch kết quả (Resilience) | `backend/src/shipment_service.js` (`recordShipmentTemperature`) | `TC13` | **PASS** |
| **AC-10** | Hỗ trợ đầy đủ nhiệt độ âm (vd: -18°C), 0°C và số thập phân hữu hạn | `backend/src/cold_chain_violation_service.js`<br>`frontend/products.html` | `TC14` | **PASS** |
| **AC-11** | Bảo toàn chuỗi băm sự kiện S-45 (RFC 8785 SHA-256) | `backend/src/event_repository.js` | `TC15` | **PASS** |
| **AC-12** | UI Quản lý sản phẩm: Xem, nhập, sửa ngưỡng và độ trễ, badge trực quan, validation client | `frontend/products.html` | `TC11`, Manual Browser | **PASS** |
| **AC-13** | UI Chi tiết chuyến: Hiển thị giới hạn áp dụng và thông tin sản phẩm liên quan | `frontend/shipments.js`<br>`frontend/shipment-adapter.js` | `TC11`, Manual Browser | **PASS** |
| **AC-14** | Universal fallback default: Báo `BLOCKED` chờ chuyên gia GD-8 thay vì tự gán 8°C/30m | Docs & Specification | GD-8 Alignment Notice | **BLOCKED (Documented)** |

---

## 3. KẾT QUẢ KIỂM THỬ THỰC TẾ (15 TESTCASES TC01 -> TC15)

Suite kiểm thử chuyên biệt: `backend/test/s44_product_temperature_config.test.js`

```text
▶ Story S-44: Ngưỡng nhiệt độ và độ trễ cấu hình theo loại sản phẩm (TC01 -> TC15)
  ✔ TC01: Sản phẩm A có ngưỡng riêng và phát hiện đúng vi phạm trên (UPPER_BREACH) (98.69ms)
  ✔ TC02: Sản phẩm B có ngưỡng khác - cùng số đo hợp lệ với A nhưng vi phạm với B (0.30ms)
  ✔ TC03: Nhiệt độ thấp hơn ngưỡng dưới tạo vi phạm LOWER_BREACH đúng điều kiện độ trễ (0.37ms)
  ✔ TC04: Chuyến vận chuyển có nhiều sản phẩm áp giới hạn chặt nhất: MAX(min), MIN(max), MIN(delay) (3.54ms)
  ✔ TC05: Hai sản phẩm có khoảng nhiệt độ không tương thích bị từ chối rõ ràng (0.35ms)
  ✔ TC06: Cập nhật cấu hình sản phẩm không làm thay đổi lịch sử vi phạm đã ghi (3.84ms)
  ✔ TC07: Biên số đo - vừa bằng ngưỡng không vi phạm, vừa đủ độ trễ không vi phạm, vượt độ trễ có vi phạm (0.36ms)
  ✔ TC08: Kiểm tra phân quyền sửa cấu hình - Non-admin bị từ chối 403, unauthenticated 401 (7.28ms)
  ✔ TC09: Phân lập dữ liệu tổ chức - Tổ chức 2 không thể tạo chuyến hay xem dữ liệu tổ chức 1 (2.14ms)
  ✔ TC10: Kiểm thử trực tiếp với CSDL PostgreSQL thật (Migration 028 và DML) (40.67ms)
  ✔ TC11: Kiểm tra cấu trúc DOM và giao diện HTML (products.html & shipments.html) (0.73ms)
  ✔ TC12: Kiểm tra hồi quy toàn diện 5 kịch bản mẫu S-42 (0.58ms)
  ✔ TC13: Số đo cũ hơn hoặc trùng timestamp được bỏ qua an toàn (Resilience) (1.85ms)
  ✔ TC14: Kiểm tra vi phạm ở cả nhiệt độ âm (-18°C), 0°C và số thập phân (0.53ms)
  ✔ TC15: Kiểm tra lịch sử sự kiện bất biến và toàn vẹn chuỗi hash (S-45) (0.16ms)
✔ Story S-44: Ngưỡng nhiệt độ và độ trễ cấu hình theo loại sản phẩm (TC01 -> TC15) (166.58ms)
ℹ tests 16, pass 16, fail 0
```

---

## 4. KẾT QUẢ KIỂM THỬ HỒI QUY TOÀN DỰ ÁN (FULL REGRESSION)

1. **Toàn bộ Test Suite (`npm test`):**
   - Kết quả: **PASS 100%** (Tất cả các suite kiểm thử S-10 đến S-46 đều vượt qua).
   - Exit code: `0`.
2. **Kiểm tra Migration (`backend/test/migrate.test.js`):**
   - 16/16 tests pass, bao gồm cả Migration 028 (up và rollback down).
3. **Kiểm tra Phân lập đa tổ chức (T-12 Tenant Isolation Lint):**
   - 100% truy vấn nghiệp vụ tuân thủ scopedQuery/scopedQueryById/tenantRepository.
4. **Kiểm tra Cú pháp Frontend HTML/JS:**
   - 14/14 tệp HTML frontend hợp lệ không lỗi cú pháp.
5. **Code Style & Linting (`npm run lint`):**
   - 0 errors.

---

## 5. DANH MỤC TỆP TIN THAY ĐỔI

1. **Cơ sở dữ liệu:**
   - `db/migrations/028_product_temperature_thresholds.sql`: Thêm `temp_min`, `temp_max`, `delay_minutes` vào `products`; thêm `applied_temp_min`, `applied_temp_max`, `applied_delay_minutes`, `temperature_config` vào `shipments`. Phân quyền DML cho `agri_app`.
   - `db/migrations/down/028_product_temperature_thresholds.down.sql`: Script rollback an toàn.
2. **Backend Services & API:**
   - `backend/src/cold_chain_violation_service.js`: Detector hỗ trợ đa ngưỡng (trên/dưới), thuật toán `resolveShipmentThresholds` tính giao khoảng chặt nhất, xác thực tương thích.
   - `backend/src/shipment_service.js`: Khởi tạo chuyến với snapshot cấu hình nhiệt độ, ngăn chặn sản phẩm xung đột dải nhiệt độ, truyền dữ liệu áp dụng cho detector.
   - `backend/src/server.js`: API `GET /api/products`, `PUT /api/products/:id`, và dedicated endpoint `PUT /api/products/:id/temperature-config` với RBAC `admin`.
3. **Frontend Giao diện người dùng:**
   - `frontend/products.html`: Form thêm/sửa sản phẩm với trường ngưỡng min/max/độ trễ, badge nhiệt độ trên card, validation phía client, thông báo lỗi/thành công.
   - `frontend/shipment-adapter.js`: Chuẩn hóa các trường ngưỡng nhiệt độ áp dụng.
   - `frontend/shipments.js`: Hiển thị dải nhiệt độ và độ trễ áp dụng trong modal chi tiết chuyến.
4. **Kiểm thử tự động:**
   - `backend/test/s44_product_temperature_config.test.js`: Suite 15 testcase bao phủ toàn diện Story S-44.
   - `backend/test/migrate.test.js`: Cập nhật kiểm thử Migration 028 up/down.
   - `backend/test/s41_temperature.test.js`: Cập nhật mốc `startedAt` ổn định tránh xung đột đồng hồ.
   - `backend/test/descendants_benchmark_s26.test.js`: Điều chỉnh ngưỡng đo hiệu năng khi chạy dưới chế độ test coverage của Node.js.

---

## 6. KHUYẾN NGHỊ VÀ BÀN GIAO
- Story S-44 đã đạt 100% Definition of Done (DoD).
- Đủ điều kiện tích hợp và mở Pull Request từ `fix-develop` vào `develop`.
