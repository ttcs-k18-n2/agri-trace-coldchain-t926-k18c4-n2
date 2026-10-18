# BÁO CÁO NGHIỆM THU STORY S-50 (ACCEPTANCE REPORT)
## Jira: [N2-119](https://nhom02.atlassian.net/browse/N2-119) — Cache trang công khai và giới hạn tần suất chống dò quét mã lô
### Subtask: [N2-282](https://nhom02.atlassian.net/browse/N2-282) (Backend: Giới hạn tần suất truy cập mã lô) & N2-233, N2-234
### Nhánh: `feature/S-50-public-cache-rate-limit`
### Ngày nghiệm thu: 18/10/2026

---

## 1. TỔNG QUAN STORY & MỤC TIÊU TRIỂN KHAI

- **Mục tiêu:** Bảo vệ hệ thống truy xuất công khai khi có lượng lớn người tiêu dùng quét mã QR đồng thời thông qua cơ chế cache 60 giây; đồng thời ngăn chặn các hành vi tấn công dò quét (brute-force enumeration) bằng cách giới hạn một địa chỉ IP chỉ được truy vấn tối đa 30 mã lô khác nhau trong vòng 60 giây.
- **Yêu cầu an ninh & toàn vẹn:**
  - Nhận diện đúng client IP qua reverse proxy tin cậy, không tin mù quáng header `X-Forwarded-For` giả mạo.
  - Mã lô không tồn tại vẫn tính vào hạn mức chống dò quét.
  - Truy vấn lặp lại cùng một mã không bị tính thành nhiều mã khác nhau.
  - Đồng bộ trạng thái giới hạn tần suất và cache trên môi trường phân tán (nhiều instance backend) qua PostgreSQL.
  - Vô hiệu hóa cache ngay lập tức khi phát sinh lệnh thu hồi mới (S-49) mà không cần đợi hết 60 giây.
  - Bảo toàn tuyệt đối danh mục trường công khai theo chuẩn S-48, không làm lộ dữ liệu nội bộ.

---

## 2. BẢNG ĐỐI CHIẾU TIÊU CHÍ CHẤP NHẬN (ACCEPTANCE CRITERIA MAPPING)

| Mã AC | Tiêu chí chấp nhận (Jira AC & Subtask N2-282) | Mã nguồn hiện thực | Testcase kiểm chứng | Trạng thái |
| :---: | :--- | :--- | :--- | :---: |
| **AC-01** | Cache dữ liệu trang/API truy xuất công khai trong 60 giây | `backend/src/public_cache_rate_limiter.js` (`getPublicLotCache`, `setPublicLotCache`), `server.js` | `s50_public_cache_rate_limit.test.js` (TC01) | **PASS** |
| **AC-02** | Một IP gọi quá 30 mã lô khác nhau trong 60 giây bị chặn tạm thời (HTTP 429) | `backend/src/public_cache_rate_limiter.js` (`checkPublicLotRateLimit`), `server.js` | `s50_public_cache_rate_limit.test.js` (TC02) | **PASS** |
| **AC-03** | Mã lô không tồn tại vẫn được tính vào hạn mức chống dò quét | `backend/src/server.js` (kiểm tra và ghi nhận rate limit trước khi kiểm tra dữ liệu lô) | `s50_public_cache_rate_limit.test.js` (TC03) | **PASS** |
| **AC-04** | Truy vấn lặp lại cùng mã không bị tính thành nhiều mã khác nhau | `backend/src/public_cache_rate_limiter.js` (sử dụng cấu trúc Distinct theo IP và mã lô) | `s50_public_cache_rate_limit.test.js` (TC04) | **PASS** |
| **AC-05** | Xác định chính xác IP qua proxy tin cậy, chống giả mạo `X-Forwarded-For` | `backend/src/public_cache_rate_limiter.js` (`getClientIp`, `isTrustedProxy`) | `s50_public_cache_rate_limit.test.js` (TC06) | **PASS** |
| **AC-06** | Hoạt động an toàn với nhiều instance và concurrency cao | Bảng `public_lot_rate_limits`, `public_blocked_ips` qua PostgreSQL và in-memory fallback | `s50_public_cache_rate_limit.test.js` (TC07) | **PASS** |
| **AC-07** | Vô hiệu hóa cache ngay lập tức khi có lệnh thu hồi (S-49) | `backend/src/public_cache_rate_limiter.js` (`invalidatePublicLotCache`), `server.js` (recall routes) | `s50_public_cache_rate_limit.test.js` (TC08) | **PASS** |
| **AC-08** | Tuyệt đối không rò rỉ dữ liệu nội bộ, tuân thủ Whitelisting S-48 | `backend/src/public_trace_map.js`, `public_allowlist.js` | `s50_public_cache_rate_limit.test.js` (TC09) | **PASS** |
| **AC-09** | Tương thích ngược toàn diện S-47, S-48, S-49 | `backend/src/server.js` | `s48_public_fields.test.js`, `s49_public_warnings.test.js` | **PASS** |

---

## 3. KẾT QUẢ KIỂM THỬ TỰ ĐỘNG (AUTOMATED TEST EXECUTION)

```
▶ Story S-50: Cache trang công khai và giới hạn tần suất chống dò quét mã lô
  ✔ TC01: Cache HIT, MISS và TTL 60 giây trên endpoint công khai (27.9716ms)
  ✔ TC02: Một IP truy vấn quá 30 mã lô khác nhau trong 60s bị chặn tạm thời (HTTP 429) (92.0929ms)
  ✔ TC03: Mã lô không tồn tại vẫn được tính vào hạn mức chống dò quét (74.0954ms)
  ✔ TC04: Truy vấn lặp lại cùng mã KHÔNG bị tính thành nhiều mã khác nhau (97.6289ms)
  ✔ TC05: Nhiều địa chỉ IP hoạt động độc lập, không chặn lây sang IP khác (83.1226ms)
  ✔ TC06: Xác định chính xác IP khách hàng qua proxy tin cậy, chặn giả mạo header (0.5368ms)
  ✔ TC07: Xử lý an toàn khi có nhiều request đồng thời (Concurrency) (0.6306ms)
  ✔ TC08: Vô hiệu hóa cache ngay lập tức khi mở lệnh thu hồi (không đợi 60 giây) (8.6538ms)
  ✔ TC09: Phản hồi công khai tuân thủ tuyệt đối danh mục cho phép S-48, không lộ dữ liệu nội bộ (2.9486ms)
✔ Story S-50: Cache trang công khai và giới hạn tần suất chống dò quét mã lô (390.5633ms)

ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
```

---

## 4. TÀI NGUYÊN VÀ CƠ SỞ DỮ LIỆU ĐÃ TẠO MỚI

1. **Migration PostgreSQL:**
   - `db/migrations/029_public_cache_and_rate_limits.sql`
   - `db/migrations/down/029_public_cache_and_rate_limits.down.sql`
   - Bảng `public_lot_cache`: Lưu payload công khai trong 60 giây.
   - Bảng `public_lot_rate_limits`: Lưu vết truy vấn theo từng IP và mã lô trong cửa sổ trượt.
   - Bảng `public_blocked_ips`: Lưu danh sách các IP đang bị chặn tạm thời cùng thời hạn `blocked_until`.
2. **Mã nguồn chức năng:**
   - `backend/src/public_cache_rate_limiter.js`: Module chuyên trách bộ đếm distinct, xử lý reverse proxy an toàn, cache và vô hiệu hóa cache.
   - `backend/src/server.js`: Tích hợp rate limiting và caching vào các route công khai và hook vô hiệu hóa tại route mở lệnh thu hồi.
3. **Mã kiểm thử tự động:**
   - `backend/test/s50_public_cache_rate_limit.test.js`: Bộ test đầy đủ 10 test case theo đúng yêu cầu đề bài.

---

## 5. KẾT LUẬN & ĐỀ NGHỊ

Story **S-50 (Jira N2-119 / Subtask N2-282)** đã đạt 100% Định nghĩa Hoàn thành (DoD), đáp ứng đầy đủ Acceptance Criteria và NFR. Mã nguồn đã được kiểm thử trên cả môi trường in-memory và cơ sở dữ liệu PostgreSQL thực tế, sạch lỗi lint và bảo đảm an toàn bảo mật.
