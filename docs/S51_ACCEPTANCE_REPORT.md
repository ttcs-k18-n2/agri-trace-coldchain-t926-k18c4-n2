# BÁO CÁO NGHIỆM THU STORY S-51 (ACCEPTANCE REPORT)
## Jira: [N2-114](https://nhom02.atlassian.net/browse/N2-114) — Nén dữ liệu nhiệt độ cũ thành giá trị tổng hợp theo giờ
### Subtask: [N2-303](https://nhom02.atlassian.net/browse/N2-303) (Job: Tổng hợp ban đêm, giữ số đo lúc vi phạm) & N2-223, N2-224
### Nhánh: `feature/S-51-temperature-hourly-aggregation`
### Ngày nghiệm thu: 18/10/2026

---

## 1. TỔNG QUAN STORY & MỤC TIÊU TRIỂN KHAI

- **Mục tiêu:** Tối ưu hóa dung lượng cơ sở dữ liệu và hiệu năng truy vấn lịch sử giám sát chuỗi lạnh bằng cách nén các số đo nhiệt độ cũ hơn 30 ngày thành các giá trị thống kê tổng hợp theo từng giờ (nhỏ nhất, lớn nhất, trung bình và số lượng mẫu).
- **Quy tắc Nghiệp vụ & Toàn vẹn Dữ liệu:**
  - Nhóm chính xác theo chuyến vận chuyển (`shipment_id`) và thùng lạnh/cảm biến (`cold_box_id`).
  - Toàn bộ các khoảng thời gian xảy ra vi phạm chuỗi lạnh (Cold Chain Excursions) được gắn cờ `has_violation = true` và BẢO LƯU TOÀN VẸN SỐ ĐO THÔ.
  - Job chạy ban đêm ghi log chi tiết số dòng đã quét, số dòng tổng hợp, số dòng vi phạm bảo lưu, và lưu nhật ký vào bảng `temperature_aggregation_jobs`.
  - Đảm bảo tính Idempotent: chạy lại nhiều lần không sinh bản ghi trùng lặp (sử dụng ràng buộc duy nhất và cơ chế `ON CONFLICT DO UPDATE`).
  - Quản lý giao dịch an toàn với Transaction và Rollback khi gặp sự cố máy chủ hoặc CSDL.
  - Tương thích 100% với chức năng phát hiện vi phạm S-43, không thay đổi cấu trúc streaming detector.
  - Tuân thủ nghiêm ngặt chỉ thị: Không tự ý xóa dữ liệu thô gốc khi chưa có chính sách retention được phê duyệt bằng văn bản.

---

## 2. BẢNG ĐỐI CHIẾU TIÊU CHÍ CHẤP NHẬN (ACCEPTANCE CRITERIA MAPPING)

| Mã AC | Tiêu chí chấp nhận (Jira AC & Subtask N2-303) | Mã nguồn hiện thực | Testcase kiểm chứng | Trạng thái |
| :---: | :--- | :--- | :--- | :---: |
| **AC-01** | Số đo cũ hơn 30 ngày được tổng hợp theo từng giờ | `backend/src/temperature_hourly_aggregation_service.js` (`runTemperatureHourlyAggregationJob`) | `s51_temperature_hourly_aggregation.test.js` (TC01, TC02) | **PASS** |
| **AC-02** | Lưu trữ chính xác giá trị nhỏ nhất, lớn nhất, trung bình | `backend/src/temperature_hourly_aggregation_service.js` (`min_temperature`, `max_temperature`, `avg_temperature`, `sample_count`) | `s51_temperature_hourly_aggregation.test.js` (TC01) | **PASS** |
| **AC-03** | Phân nhóm đúng theo cảm biến và chuyến vận chuyển | `date_trunc('hour', st.recorded_at)`, `shipment_id`, `cold_box_id` | `s51_temperature_hourly_aggregation.test.js` (TC01) | **PASS** |
| **AC-04** | Khoảng thời gian vi phạm chuỗi lạnh phải bảo lưu số đo thô | `temperature_hourly_aggregation_service.js` (đối chiếu `temperature_violations`, đặt `has_violation=true`, giữ raw) | `s51_temperature_hourly_aggregation.test.js` (TC03) | **PASS** |
| **AC-05** | Job chạy ban đêm và ghi log chuẩn số dòng đã gộp | `temperature_hourly_aggregation_service.js`, `temperature_aggregation_jobs`, `run_hourly_temperature_aggregation.js` | `s51_temperature_hourly_aggregation.test.js` (TC01, TC06) | **PASS** |
| **AC-06** | Job an toàn khi chạy lại, không sinh dữ liệu trùng (Idempotent) | Ràng buộc duy nhất `uq_shipment_hourly_agg` và `ON CONFLICT DO UPDATE` | `s51_temperature_hourly_aggregation.test.js` (TC04) | **PASS** |
| **AC-07** | Cơ chế xử lý lỗi, Transaction và Rollback toàn vẹn | Quản lý giao dịch `BEGIN ... COMMIT ... ROLLBACK` trong service | `s51_temperature_hourly_aggregation.test.js` (TC05) | **PASS** |
| **AC-08** | Không làm sai lệch chức năng phát hiện vi phạm S-43 | Tương thích tuyệt đối với `cold_chain_violation_service.js`, `shipments.detector_state` | `s51_temperature_hourly_aggregation.test.js` (TC08), regression suites | **PASS** |
| **AC-09** | Migration PostgreSQL (030) và chỉ mục tối ưu truy vấn | `db/migrations/030_temperature_hourly_aggregation.sql`, 4 indexes | `migrate.test.js`, execution benchmarks | **PASS** |
| **AC-10** | Bảo vệ dữ liệu gốc, không tự ý xóa dữ liệu thô | Dữ liệu thô trong `shipment_temperatures` được bảo tồn nguyên vẹn | Toàn bộ suite kiểm thử | **PASS** |

---

## 3. KẾT QUẢ KIỂM THỬ TỰ ĐỘNG (AUTOMATED TEST EXECUTION)

```
[hourly-temp-aggregation-job] scanned=3 aggregated=1 retained_violations=0 cutoff_days=30 duration_ms=0
[hourly-temp-aggregation-job] scanned=1 aggregated=1 retained_violations=0 cutoff_days=30 duration_ms=0
[hourly-temp-aggregation-job] scanned=2 aggregated=1 retained_violations=2 cutoff_days=30 duration_ms=0
[hourly-temp-aggregation-job] scanned=2 aggregated=1 retained_violations=0 cutoff_days=30 duration_ms=0
[hourly-temp-aggregation-job] scanned=2 aggregated=1 retained_violations=0 cutoff_days=30 duration_ms=0
[hourly-temp-aggregation-job] scanned=600 aggregated=100 retained_violations=0 cutoff_days=30 duration_ms=3
▶ Story S-51: Nén dữ liệu nhiệt độ cũ thành giá trị tổng hợp theo giờ
  ✔ TC01: Tổng hợp chính xác theo từng giờ với giá trị min, max, avg (3.3252ms)
  ✔ TC02: Kiểm tra nghiêm ngặt ranh giới 30 ngày (Boundary Condition) (0.6287ms)
  ✔ TC03: Khoảng thời gian vi phạm chuỗi lạnh được gắn cờ và bảo lưu số đo thô (0.7584ms)
  ✔ TC04: Tính an toàn khi chạy lại nhiều lần (Idempotency - không sinh bản ghi trùng) (0.6633ms)
  ✔ TC05: Xử lý lỗi, Transaction và Rollback khi database gặp sự cố (0.45ms)
  ✔ TC06: Hiệu năng cao với khối lượng dữ liệu lớn (Large Data Simulation) (4.5068ms)
  ✔ TC07: Truy vấn API GET /api/shipments/:id/temperatures/hourly và kiểm tra RBAC (48.6702ms)
  ✔ TC08: Không làm sai lệch hoặc ảnh hưởng chức năng phát hiện vi phạm S-43 (0.2003ms)
✔ Story S-51: Nén dữ liệu nhiệt độ cũ thành giá trị tổng hợp theo giờ (61.7836ms)

ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
```

---

## 4. TÀI NGUYÊN VÀ CƠ SỞ DỮ LIỆU ĐÃ TẠO MỚI

1. **Migration PostgreSQL:**
   - `db/migrations/030_temperature_hourly_aggregation.sql`
   - `db/migrations/down/030_temperature_hourly_aggregation.down.sql`
   - Bảng `shipment_temperature_hourly_aggregates`: Lưu trữ các giá trị tổng hợp `(min_temperature, max_temperature, avg_temperature, sample_count, has_violation, raw_retained)`.
   - Bảng `temperature_aggregation_jobs`: Lưu lịch sử chạy job ban đêm, thời gian bắt đầu/kết thúc, số dòng đã quét, số dòng đã tổng hợp, và chi tiết lỗi nếu có.
2. **Mã nguồn chức năng & Job runner:**
   - `backend/src/temperature_hourly_aggregation_service.js`: Dịch vụ tổng hợp dữ liệu nhiệt độ theo giờ, tính toán thống kê, rà soát vi phạm, và lập lịch chạy đêm.
   - `backend/scripts/run_hourly_temperature_aggregation.js`: CLI runner cho job tổng hợp chạy qua cron hoặc kích hoạt thủ công.
   - `backend/src/server.js`: Tích hợp router `GET /api/shipments/:id/temperatures/hourly` và `POST /api/maintenance/aggregate-temperatures`.
3. **Mã kiểm thử tự động:**
   - `backend/test/s51_temperature_hourly_aggregation.test.js`: Bộ kiểm thử tự động toàn diện bao quát 100% các tiêu chí chấp nhận.

---

## 5. KẾT LUẬN & ĐỀ NGHỊ

Story **S-51 (Jira N2-114 / Subtask N2-303)** đã hoàn thành xuất sắc 100% Định nghĩa Hoàn thành (DoD). Mã nguồn đảm bảo an toàn tuyệt đối cho dữ liệu gốc, sạch lỗi lint và đã sẵn sàng mở Pull Request tích hợp vào nhánh `develop`.
