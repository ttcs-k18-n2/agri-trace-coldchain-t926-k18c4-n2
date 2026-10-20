# BÁO CÁO NGHIỆM THU STORY S-48 (ACCEPTANCE REPORT)
## Jira: [N2-117](https://nhom02.atlassian.net/browse/N2-117) — Trang công khai chỉ trả về trường được đánh dấu công khai
### Nhánh: `feature/S-48]-Trang-công-khai-chỉ-trả-về-trường-được-đánh-dấu-công-khai`
### Ngày nghiệm thu: 17/10/2026

---

## 1. TỔNG QUAN STORY & PHÂN CÔNG THỰC HIỆN

- **Mục tiêu:** Đảm bảo toàn bộ các endpoint công khai phục vụ người tiêu dùng (truy xuất nguồn gốc qua quét mã QR hoặc nhập mã tra cứu) chỉ trả về các trường thông tin được đánh dấu công khai. Bảo vệ tuyệt đối bí mật kinh doanh, sản lượng, giá cả, và dữ liệu định danh nội bộ theo nguyên tắc Default-Deny.
- **Phân công Subtask:**
  - **N2-229 (Backend):** Lọc trường dữ liệu được phép công khai qua danh mục tập trung và bộ tuần tự hóa đệ quy.
  - **N2-230 (Tester/Security):** Bộ kiểm thử an ninh tự động đối chiếu từng trường trả về với danh mục cho phép và quét từ khóa nhạy cảm.
  - **N2-281 (Security/Backend):** Phân loại dữ liệu công khai/nội bộ (`docs/DATA_CLASSIFICATION_S48.md`), thiết kế chính sách che giấu đối tác trung gian và bảo vệ tọa độ nông hộ.

---

## 2. BẢNG ĐỐI CHIẾU TIÊU CHÍ CHẤP NHẬN (AC MAPPING TABLE)

| Mã AC | Tiêu chí chấp nhận (Jira AC) | Mã nguồn thực hiện | Testcase kiểm thử | Kết quả |
| :---: | :--- | :--- | :--- | :---: |
| **AC-01** | Danh sách cho phép (Allowlist) tập trung duy nhất | `backend/src/public_allowlist.js` | `s48_public_fields.test.js` (TC02, TC03, TC04) | **PASS** |
| **AC-02** | Mặc định từ chối (Default-Deny), chỉ xuất trường công khai | `backend/src/public_trace_map.js` (`sanitizePublicTracePayload`) | `s48_public_fields.test.js` (TC06) | **PASS** |
| **AC-03** | Không rò rỉ khối lượng (`quantity`, `weight`), diện tích | `backend/src/public_allowlist.js`, `public_trace_map.js` | `s48_public_fields.test.js` (TC09) | **PASS** |
| **AC-04** | Không rò rỉ giá bán, giá nhập (`price`, `cost`) | `backend/src/public_allowlist.js` | `s48_public_fields.test.js` (TC09) | **PASS** |
| **AC-05** | Che giấu tên đối tác trung gian theo vai trò (Role Types) | `backend/src/public_trace_map.js` (`getSafeIntermediatePartnerName`) | `s48_public_fields.test.js` (TC08) | **PASS** |
| **AC-06** | Ngoại lệ thông tin HTX / vùng trồng gốc minh bạch | `backend/src/public_trace_map.js` (`getSafePublicProducerName`) | `s48_public_fields.test.js` (TC02, TC08) | **PASS** |
| **AC-07** | Không rò rỉ mã định danh nội bộ, token, điện thoại, biển số xe | `backend/src/public_trace_map.js` | `s48_public_fields.test.js` (TC04, TC05) | **PASS** |
| **AC-08** | Áp dụng kiểm soát tại Backend, không chỉ ẩn HTML/CSS | `backend/src/server.js`, `public_trace_map.js` | `s48_public_fields.test.js` (TC01, TC06) | **PASS** |
| **AC-09** | Truy xuất công khai không cần xác thực / token | `backend/src/server.js` (`/api/public/lots/:code/*`) | `s48_public_fields.test.js` (TC01) | **PASS** |
| **AC-10** | Tương thích S-47, S-60 (bản đồ) và S-21 (phả hệ đa nguồn) | `frontend/public-trace-map.js`, `public-trace.html` | Toàn bộ suite hồi quy hệ thống | **PASS** |
| **AC-11** | Tài liệu phân loại dữ liệu đầy đủ | `docs/DATA_CLASSIFICATION_S48.md` | Tài liệu dự án | **PASS** |

---

## 3. KẾT QUẢ KIỂM THỬ TỰ ĐỘNG (AUTOMATED TEST EXECUTION)

```
▶ Story S-48: Trang công khai chỉ trả về trường được đánh dấu công khai (Whitelisting)
  ✔ TC01: Các endpoint công khai hoạt động không cần đăng nhập (33.7ms)
  ✔ TC02: Đối tượng lot chỉ chứa các trường được phép công khai (6.1ms)
  ✔ TC03: Danh sách origins chỉ chứa các trường công khai và tọa độ đại diện cấp xã (4.3ms)
  ✔ TC04: Hành trình journey chỉ chứa thông tin công khai, không lộ ghi chú nội bộ hay danh tính cá nhân (3.3ms)
  ✔ TC05: Chuỗi JSON toàn bộ phản hồi không chứa bất kỳ từ khóa nhạy cảm nào (3.1ms)
  ✔ TC06: sanitizePublicTracePayload lọc triệt để các trường nhạy cảm ngay cả khi đầu vào bị ô nhiễm (0.3ms)
  ✔ TC07: Validation định dạng mã lô - chặn ký tự đặc biệt và quá dài (Issue 33) (9.0ms)
  ✔ TC08: Che giấu tên thương mại của đối tác trung gian, chỉ hiển thị theo loại vai trò (S-48) (3.7ms)
  ✔ TC09: Tuyệt đối không xuất khối lượng hàng hóa và giá bán/nhập trong API công khai (S-48) (5.6ms)
✔ Story S-48: Trang công khai chỉ trả về trường được đánh dấu công khai (Whitelisting) (73.4ms)

ℹ tests 10
ℹ pass 10
ℹ fail 0
```

---

## 4. KẾT LUẬN & ĐỀ NGHỊ

Story **S-48 (N2-117)** đã hoàn thành đầy đủ 100% các tiêu chí chấp nhận theo Jira và nguyên tắc an ninh dữ liệu. Code đã sẵn sàng tạo Pull Request tích hợp vào nhánh `develop`.
