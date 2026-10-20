# BÁO CÁO NGHIỆM THU STORY S-49 (ACCEPTANCE REPORT)
## Jira: [N2-118](https://nhom02.atlassian.net/browse/N2-118) — Trang công khai cảnh báo nếu lô bị thu hồi hoặc từng vi phạm chuỗi lạnh
### Nhánh: `feature/S-49]-Trang-công-khai-cảnh-báo-nếu-lô-bị-thu-hồi-hoặc-từng-vi-phạm-chuỗi-lạnh`
### Ngày nghiệm thu: 17/10/2026

---

## 1. TỔNG QUAN STORY & PHÂN CÔNG THỰC HIỆN

- **Mục tiêu:** Cung cấp thông tin cảnh báo minh bạch, kịp thời cho người tiêu dùng khi tra cứu hoặc quét mã QR đối với các lô nông sản đang có lệnh thu hồi mở (`OPEN` recall order) hoặc từng ghi nhận sự cố vi phạm chuỗi lạnh trong quá trình vận chuyển lưu kho.
- **Phân công Subtask:**
  - **N2-305 (Backend):** Cung cấp trạng thái thu hồi kế thừa phả hệ (`checkLotRecallStatus`) và phát hiện vi phạm chuỗi lạnh (`TEMPERATURE_VIOLATION` từ `batch_events` và `temperature_violations`) thông qua API `/api/public/lots/:code/*`.
  - **N2-231 (Frontend):** Thiết kế và hiển thị banner cảnh báo tiếp cận được (Accessibility `role="alert"`), ưu tiên hiển thị cảnh báo thu hồi ở đầu trang, định dạng trung tính cho vi phạm chuỗi lạnh, tối ưu hiển thị trên thiết bị di động.
  - **N2-232 (Tester):** Bộ kiểm thử tự động toàn diện kiểm tra mọi tổ hợp trạng thái (thu hồi đơn lẻ, vi phạm chuỗi lạnh đơn lẻ, cả hai sự cố, lô sạch bình thường).

---

## 2. BẢNG ĐỐI CHIẾU TIÊU CHÍ CHẤP NHẬN (AC MAPPING TABLE)

| Mã AC | Tiêu chí chấp nhận (Jira AC) | Mã nguồn thực hiện | Testcase kiểm thử | Kết quả |
| :---: | :--- | :--- | :--- | :---: |
| **AC-01** | Lệnh thu hồi mở hiển thị cảnh báo đỏ nổi bật ở đầu trang | `frontend/public-trace.html` (`#lot-recall-alert`), `public-trace-map.css` | `s49_public_warnings.test.js` (TC02, TC08) | **PASS** |
| **AC-02** | Có hướng dẫn xử lý rõ ràng, dễ đọc trên di động | `frontend/public-trace.html` (`#recall-reason-message`) | `s49_public_warnings.test.js` (TC02, TC08) | **PASS** |
| **AC-03** | Vi phạm chuỗi lạnh hiển thị thông báo trung tính | `backend/src/public_trace_map.js` (`coldChainInfo.message`) | `s49_public_warnings.test.js` (TC05) | **PASS** |
| **AC-04** | Tuyệt đối không công khai số đo nhiệt độ chi tiết (sensor readings) | `backend/src/public_allowlist.js`, `public_trace_map.js` | `s49_public_warnings.test.js` (TC05, TC07) | **PASS** |
| **AC-05** | Không tiết lộ thông tin nội bộ của chuyến xe và đối tác | `backend/src/public_trace_map.js` (`getSafeIntermediatePartnerName`) | `s49_public_warnings.test.js` (TC05, TC07) | **PASS** |
| **AC-06** | Khi vừa bị thu hồi vừa vi phạm nhiệt độ: Cảnh báo thu hồi ưu tiên cao nhất | `frontend/public-trace.html`, `backend/src/public_trace_map.js` | `s49_public_warnings.test.js` (TC06) | **PASS** |
| **AC-07** | Không che khuất hoặc làm mất ghi chú vi phạm chuỗi lạnh | `frontend/public-trace.html` (đồng hiển thị cả 2 banner theo thứ tự) | `s49_public_warnings.test.js` (TC06) | **PASS** |
| **AC-08** | Lô bình thường hiển thị chứng nhận an toàn, không cảnh báo sai | `frontend/public-trace.html` (`#lot-safety-banner`) | `s49_public_warnings.test.js` (TC01) | **PASS** |
| **AC-09** | Kế thừa trạng thái thu hồi phả hệ từ lô mẹ sang lô con | `backend/src/public_trace_map.js` (`relevantLotIds`) | `s49_public_warnings.test.js` (TC03) | **PASS** |
| **AC-10** | Chuẩn trợ năng (Accessibility): `role="alert"`, `aria-live="assertive/polite"` | `frontend/public-trace.html` | `s49_public_warnings.test.js` (TC08) | **PASS** |

---

## 3. PHƯƠNG ÁN XIN Ý KIẾN VỀ CÂU CHỮ CẢNH BÁO (LEGAL & PR WORDING PROPOSAL)
> **Lưu ý Pháp lý (Legal Compliance):** Nhằm bảo vệ tối đa quyền lợi người tiêu dùng theo Luật Bảo vệ Quyền lợi Người tiêu dùng và Luật An toàn Thực phẩm, đồng thời tránh gây tâm lý hoang mang quá mức đối với các sự cố kỹ thuật thông thường, đội ngũ phát triển đệ trình 4 phương án câu chữ chuẩn hóa dưới đây để Product Owner và Bộ phận Pháp chế/Truyền thông phê duyệt:

### Phương án 1: Cảnh báo Lệnh Thu Hồi Mở (Critical Recall Alert - Đỏ `#ef4444`)
- **Tiêu đề:** `🚨 CẢNH BÁO THU HỒI NÔNG SẢN`
- **Nội dung hiển thị:**
  > *"Lô nông sản này đang thuộc diện thu hồi chính thức theo quyết định của cơ quan quản lý/Hợp tác xã do ghi nhận sự cố về tiêu chuẩn chất lượng. Người tiêu dùng khuyến cáo tạm dừng sử dụng sản phẩm và liên hệ điểm bán hoặc bộ phận chăm sóc khách hàng của Hợp tác xã để được hỗ trợ đổi trả theo quy định."*
- **Hướng dẫn cho người tiêu dùng:**
  1. Tạm dừng sử dụng sản phẩm.
  2. Giữ lại bao bì và nhãn có mã truy xuất QR.
  3. Liên hệ điểm mua hàng để nhận hoàn tiền hoặc đổi lô sản phẩm an toàn mới.

### Phương án 2: Lưu ý Sự cố Chuỗi Lạnh (Cold Chain Notice - Vàng hổ phách `#f59e0b`)
- **Tiêu đề:** `⚠️ LƯU Ý VẬN CHUYỂN CHUỖI LẠNH`
- **Nội dung hiển thị (Trung tính, không lộ số đo cảm biến chi tiết):**
  > *"Lô hàng từng ghi nhận sự cố chênh lệch nhiệt độ bảo quản trong quá trình vận chuyển chuỗi lạnh. Chất lượng và độ tươi của sản phẩm có thể bị ảnh hưởng. Người tiêu dùng nên kiểm tra kỹ cảm quan trước khi sử dụng."*
- **Căn cứ bảo mật:** Không hiển thị số đo nhiệt độ cảm biến cụ thể (ví dụ: không đưa con số `14.5°C`), không hiển thị biển số xe hay tên công ty vận tải, đảm bảo bí mật kinh doanh đối tác nhưng bảo toàn quyền được biết của khách hàng.

### Phương án 3: Đồng thời Thu Hồi & Vi phạm Chuỗi Lạnh
- **Ưu tiên hiển thị:** Banner Thu Hồi màu đỏ được ghim ở vị trí cao nhất (Top Priority Banner) với hiệu ứng cảnh báo khẩn cấp (`aria-live="assertive"`).
- **Banner thứ hai:** Banner Lưu ý chuỗi lạnh màu vàng hiển thị ngay phía dưới, cung cấp thêm thông tin minh bạch mà không che khuất banner thu hồi.

### Phương án 4: Lô nông sản chuẩn an toàn (Verified Safe)
- **Tiêu đề / Huy hiệu:** `Truy xuất được & Chuỗi lạnh an toàn` (Xanh lá `#16a34a`).
- **Nội dung:** Lô hàng tuân thủ đầy đủ hành trình chuỗi lạnh khép kín từ vùng trồng đến điểm phân phối.

---

## 4. KẾT QUẢ KIỂM THỬ TỰ ĐỘNG (AUTOMATED TEST EXECUTION)

```
▶ Story S-49: Trang công khai cảnh báo thu hồi và vi phạm chuỗi lạnh
  ✔ TC01: Lô sạch bình thường - Không có cảnh báo thu hồi, không vi phạm chuỗi lạnh (25.1ms)
  ✔ TC02: Lô hàng đang có lệnh thu hồi trực tiếp (ACTIVE RECALL) - Hiển thị cảnh báo thu hồi (5.7ms)
  ✔ TC03: Lô con thừa kế cảnh báo thu hồi từ lô mẹ (Descendant Recall) (4.5ms)
  ✔ TC04: Lô hàng có trạng thái Có sự cố / Đang thu hồi / Đã thu hồi (4.7ms)
  ✔ TC05: Lô hàng từng ghi nhận vi phạm chuỗi lạnh (TEMPERATURE_VIOLATION) (5.9ms)
  ✔ TC06: Lô hàng bị CẢ HAI sự cố: Thu hồi VÀ Vi phạm chuỗi lạnh (9.2ms)
  ✔ TC07: Bảo đảm Whitelisting dữ liệu khi có cảnh báo thu hồi & vi phạm nhiệt độ (S-48 + S-49) (6.1ms)
  ✔ TC08: Kiểm tra giao diện HTML và CSS có đầy đủ banner cảnh báo chuẩn trợ năng (Accessibility) (2.5ms)
✔ Story S-49: Trang công khai cảnh báo thu hồi và vi phạm chuỗi lạnh (66.1ms)

ℹ tests 9
ℹ pass 9
ℹ fail 0
```

---

## 5. KẾT LUẬN & ĐỀ NGHỊ

Story **S-49 (N2-118)** đã đạt 100% Định nghĩa Hoàn thành (DoD), bảo đảm tuân thủ nghiêm ngặt cả về mặt chức năng, an ninh dữ liệu, trợ năng và pháp lý. Code đã sẵn sàng tạo Pull Request tích hợp vào nhánh `develop`.
