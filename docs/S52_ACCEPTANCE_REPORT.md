# BÁO CÁO NGHIỆM THU STORY S-52 (EPIC E-09)
**Cán bộ kiểm tra tra cứu lô theo mã, vùng trồng hoặc khoảng ngày thu hoạch**

- **Dự án:** AgriTrace ColdChain
- **Backlog ID:** `S-52`
- **Epic:** `E-09 — Báo cáo và hồ sơ kiểm tra`
- **Tier:** Later (Đã tinh chỉnh và kích hoạt triển khai)
- **Priority:** Should
- **Sprint:** 8
- **Ngày hoàn thành:** 17/10/2026
- **Trạng thái:** **100% HOÀN THÀNH — ĐẠT ĐẦY ĐỦ TIÊU CHÍ DoD**

---

## 1. TỔNG QUAN VÀ GIẢI PHÁP STORY S-52

### 1.1. Mục tiêu cốt lõi
Story S-52 giải quyết bài toán nghiệp vụ cho vai trò **Cán bộ kiểm tra (Inspector)**:
1. **Tra cứu toàn cục (Cross-tenant Search):** Khi có phản ánh từ người tiêu dùng, cơ quan kiểm nghiệm hoặc phát hiện sự cố an toàn thực phẩm / đứt gãy chuỗi lạnh, Cán bộ kiểm tra có quyền tra cứu lô hàng trên toàn bộ các tổ chức (nông trại, HTX, vận tải, phân phối) mà không bị rào cản multi-tenant ngăn chặn.
2. **Chế độ chỉ đọc tuyệt đối (Strict Read-only):** Cán bộ kiểm tra chỉ có quyền xem (SELECT), nghiêm cấm mọi thao tác ghi (POST/PUT/DELETE) như tạo lô, tách lô, gộp lô, bàn giao hay đổi trạng thái.
3. **Đa tiêu chí tra cứu linh hoạt:**
   - Tìm kiếm chính xác hoặc theo từ khóa mã lô / tên lô (`search`).
   - Lọc theo vùng trồng / thửa đất cụ thể (`farmId`).
   - Lọc theo khoảng thời gian thu hoạch (`harvestedFrom` - `harvestedTo`).
4. **Trách nhiệm giải trình qua Nhật ký kiểm toán S-31 (Audit Log):** 100% các lượt tra cứu của Cán bộ kiểm tra được ghi vết bất biến vào bảng `audit_logs` (`action = 'INSPECTOR_LOT_SEARCH'` và `'INSPECTOR_LOT_VIEW'`) lưu trữ đầy đủ tiêu chí tra cứu, số lượng kết quả, IP và User-Agent để chống lạm quyền soi mói thông tin thương mại.
5. **Chốt bài toán NFR Thẩm quyền:** Áp dụng mô hình **Thẩm quyền Toàn quốc (Global Jurisdiction)** cho cơ quan kiểm tra cấp cục (`org-inspector`), kết hợp giám sát chặt chẽ qua S-31 Audit Trail.

---

## 2. MA TRẬN ĐỐI CHIẾU ACCEPTANCE CRITERIA (AC MATRIX)

| Mã AC | Tiêu chí chấp nhận (Acceptance Criteria) | Mã nguồn hiện thực | Testcase kiểm chứng | Trạng thái |
|---|---|---|---|:---:|
| **AC-01** | **Tra cứu toàn cục ở chế độ chỉ đọc:** Cán bộ kiểm tra xem được lô của mọi tổ chức; cấm mọi thao tác ghi (POST/PUT 403) | `backend/src/server.js`<br>`frontend/lots.html` | `TC01`, `TC08` | **PASS** |
| **AC-02** | **Tìm theo mã ra đúng lô:** Hỗ trợ tìm kiếm theo mã lô chính xác và dạng không phân biệt hoa/thường | `backend/src/server.js` (`search` ILIKE) | `TC01`, `TC02` | **PASS** |
| **AC-03** | **Tìm theo vùng trồng:** Lọc chính xác theo mã thửa đất / vùng trồng `farmId` | `backend/src/server.js` (`l.farm_id = $farmId`) | `TC03` | **PASS** |
| **AC-04** | **Tìm theo khoảng ngày thu hoạch:** Lọc `harvestedFrom <= harvested_at <= harvestedTo` | `backend/src/server.js` (`l.harvested_at >= $1 AND <= $2`) | `TC04` | **PASS** |
| **AC-05** | **Kết hợp đa tiêu chí & Phân trang:** Hỗ trợ kết hợp đồng thời tiêu chí kèm cursor pagination | `backend/src/server.js` (`limit`, `cursor`, `nextCursor`) | `TC05` | **PASS** |
| **AC-06** | **Ghi nhận Nhật ký S-31:** Mọi lượt tra cứu ghi tự động vào `audit_logs` với action `INSPECTOR_LOT_SEARCH` | `backend/src/server.js` (`recordAuditLog`) | `TC06`, `TC09` | **PASS** |
| **AC-07** | **Bảo toàn cách ly đa tổ chức (T-12):** Doanh nghiệp thông thường chỉ xem được lô của tổ chức mình | `backend/src/server.js` (`organization_id = $orgId`) | `TC07`, `npm run check:tenant` | **PASS** |
| **AC-08** | **Chỉ mục CSDL tối ưu (Migration 029):** Index `idx_lots_farm_harvested` và `idx_lots_harvested_at` | `db/migrations/029_lots_inspector_search_indices.sql` | `migrate.test.js` | **PASS** |
| **AC-09** | **UI Thanh lọc Cán bộ kiểm tra:** Banner chỉ đọc, dropdown vùng trồng, bộ chọn khoảng ngày thu hoạch | `frontend/lots.html` | `check:frontend` | **PASS** |

---

## 3. KẾT QUẢ KIỂM THỬ THỰC TẾ (9 TESTCASES TC01 -> TC09)

Suite kiểm thử chuyên biệt: `backend/test/s52_inspector_lot_search.test.js`

```text
✔ TC01: Cán bộ kiểm tra tìm kiếm theo mã lô chính xác (cross-tenant) (86.30ms)
✔ TC02: Cán bộ kiểm tra tìm kiếm theo tiền tố hoặc không phân biệt chữ hoa/thường (51.91ms)
✔ TC03: Cán bộ kiểm tra lọc theo vùng trồng (farmId) (55.35ms)
✔ TC04: Cán bộ kiểm tra lọc theo khoảng ngày thu hoạch (harvestedFrom, harvestedTo) (41.31ms)
✔ TC05: Kết hợp đa tiêu chí (farmId + khoảng ngày) kèm phân trang (limit, cursor) (41.40ms)
✔ TC06: Mọi lượt tra cứu của Cán bộ kiểm tra đều được ghi nhận vào nhật ký S-31 (38.78ms)
✔ TC07: Người dùng doanh nghiệp thông thường bị cách ly dữ liệu và KHÔNG ghi log inspector (40.51ms)
✔ TC08: Chế độ chỉ đọc - Cán bộ kiểm tra bị nghiêm cấm mọi thao tác ghi (403 Forbidden) (50.83ms)
✔ TC09: Cán bộ kiểm tra xem chi tiết lô hàng ghi nhận S-31 INSPECTOR_LOT_VIEW (36.42ms)
ℹ tests 9, pass 9, fail 0
```

---

## 4. KẾT QUẢ KIỂM THỬ HỒI QUY VÀ LINTER TOÀN DIỆN

1. **Kiểm tra Phân lập dữ liệu tầng truy vấn (T-12 Tenant Isolation Lint):**
   ```text
   ✔ [T-12 Check Passed] 100% truy vấn nghiệp vụ tuân thủ chặt chẽ cách ly đa tổ chức (scopedQuery/scopedQueryById/tenantRepository).
   ```
2. **Kiểm tra Cú pháp JavaScript Frontend (check:frontend):**
   ```text
   ✔ [Frontend Syntax Passed] Toàn bộ mã JavaScript trong các tệp HTML frontend đều hợp lệ!
   ```
3. **Kiểm tra Migration CSDL (migrate.test.js):**
   ```text
   ✔ 17/17 tests PASS (Bao gồm Migration 029 UP và DOWN rollback an toàn).
   ```
4. **Kiểm tra Hồi quy Phân quyền và Tìm kiếm phân trang:**
   ```text
   ✔ lots_search_cursor.test.js: 7/7 PASS
   ✔ permission_matrix.test.js: 8/8 PASS
   ```
