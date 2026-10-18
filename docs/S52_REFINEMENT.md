# TÀI LIỆU PHÂN TÍCH TINH CHỈNH VÀ THIẾT KẾ KỸ THUẬT (REFINEMENT & ARCHITECTURAL DESIGN)
## Story S-52: Cán bộ kiểm tra tra cứu lô hàng theo mã, vùng trồng hoặc khoảng ngày thu hoạch

---

## 1. THÔNG TIN BACKLOG

- **Mã Story:** `S-52`
- **Epic:** `E-09 — Báo cáo và hồ sơ kiểm tra`
- **Loại nguồn:** Story
- **Tier:** Later (Đề xuất kích hoạt Sprint 8)
- **Priority:** Should
- **Sprint dự kiến:** Sprint 8
- **Dependencies:** `S-31` (Nhật ký thao tác nghiệp vụ / Operational Audit Log Engine)
- **Ước lượng thô:** 3 Story Points (SP)

### Nội dung User Story:
> *"Là cán bộ kiểm tra tôi muốn tìm lô theo mã, theo vùng trồng hoặc theo khoảng ngày thu hoạch để kiểm tra nhanh khi có phản ánh"*

### Acceptance Criteria gốc:
> *"Vai trò kiểm tra tìm được trên mọi tổ chức ở chế độ chỉ đọc; tìm theo mã ra đúng lô; tìm theo vùng trồng và khoảng ngày ra danh sách phân trang; mọi lượt tra cứu ghi vào nhật ký S-31. Chưa refine chi tiết — tier Later, ước lượng thô 3 SP"*

### NFR gốc:
> *"Chưa refine — cần chốt cán bộ kiểm tra thuộc cơ quan nào được xem tổ chức nào 'làm chức năng này'"*

---

## 2. GIẢI QUYẾT VẤN ĐỀ NFR (INSPECTION JURISDICTION & GOVERNANCE)

Backlog hiện đang treo câu hỏi NFR: **"cần chốt cán bộ kiểm tra thuộc cơ quan nào được xem tổ chức nào 'làm chức năng này'"**.

### 2.1. Phân tích 3 mô hình thẩm quyền kiểm tra
1. **Phương án A — Thẩm quyền Toàn cục (Global Jurisdiction):**
   - Cán bộ kiểm tra thuộc `org-inspector` (Cục Kiểm tra An toàn Nông sản) có thẩm quyền tra cứu dữ liệu của tất cả tổ chức trên toàn quốc.
   - Phù hợp với đặc thù chuỗi lạnh: Nông sản thu hoạch tại Thái Nguyên, sơ chế tại Bắc Giang, vận chuyển qua nhiều tỉnh và bán lẻ tại Hà Nội.
   - Thống nhất tuyệt đối với cơ chế RBAC hiện có trong codebase (`req.auth.isInspector`).
2. **Phương án B — Thẩm quyền theo Địa phương (Territorial Jurisdiction):**
   - Cán bộ thuộc Chi cục tỉnh nào chỉ xem doanh nghiệp/vùng trồng ở tỉnh đó.
   - Nhược điểm: Tạo ra "điểm mù" khi lô hàng di chuyển qua ranh giới tỉnh, cản trở việc truy vết nhanh khi có ngộ độc hoặc phản ánh.
3. **Phương án C — Mô hình kết hợp (Hybrid Scoped Delegation - Khuyến nghị):**
   - **Mặc định (Sprint 8 / S-52):** Cho phép Cán bộ kiểm tra tra cứu toàn diện liên tổ chức (`isInspector: true`), nhưng **bắt buộc ghi nhận vết kiểm toán S-31 bất biến** lưu rõ mã cán bộ, đơn vị thanh tra (`organizationId: 'org-inspector'`) và tiêu chí tìm kiếm để chống lạm quyền soi mói dữ liệu.
   - **Mở rộng tương lai:** Khi mở rộng cho nhiều cơ quan thanh tra khác nhau (Chi cục thú y, quản lý thị trường...), bổ sung bảng cấu hình phân vùng địa bàn mà không phải sửa logic tìm kiếm lõi.

---

## 3. BẢNG TIÊU CHÍ NGHIỆM THU CHI TIẾT (AC MATRIX)

| Mã AC | Tiêu chí chấp nhận | Chi tiết kiểm chứng kỹ thuật |
|---|---|---|
| **AC-01** | **Chế độ chỉ đọc toàn cục** | Cán bộ kiểm tra (`roleId: 'inspector'`) tìm được lô hàng trên tất cả tổ chức; giao diện chỉ đọc, không có nút sửa, xóa, bàn giao, tách/gộp hay tiêu thụ. |
| **AC-02** | **Tìm theo mã ra đúng lô** | Tìm kiếm theo mã lô (ví dụ: `LOT-001`, `LOT-X82KP92A`) trả về đúng lô tương ứng (hỗ trợ case-insensitive ILIKE). |
| **AC-03** | **Tìm theo vùng trồng (Farm)** | Lọc theo `farmId` trả về danh sách các lô được thu hoạch từ vùng trồng/thửa đất đó. |
| **AC-04** | **Tìm theo khoảng ngày thu hoạch** | Lọc theo `harvestedFrom` và `harvestedTo` trả về danh sách các lô có `harvested_at` nằm trong khoảng thời gian (bao gồm 2 mốc biên). |
| **AC-05** | **Kết hợp đa tiêu chí & Phân trang** | Cho phép kết hợp đồng thời mã lô, vùng trồng, khoảng ngày và phân trang (cursor pagination) với `limit` và cờ `hasMore`. |
| **AC-06** | **Ghi nhận Audit Log S-31** | Mỗi lượt tìm kiếm của inspector được ghi tự động vào `audit_logs` với `action: 'INSPECTOR_LOT_SEARCH'`, lưu chi tiết tham số lọc và số kết quả trả về. |
| **AC-07** | **Bảo toàn phân lập đa tổ chức (T-12)** | Người dùng doanh nghiệp thông thường (`producer`, `cooperative`...) vẫn bị giới hạn nghiêm ngặt trong tổ chức của mình. |

---

## 4. THIẾT KẾ HỢP ĐỒNG API (API CONTRACT)

### Endpoint:
```http
GET /api/lots
GET /api/organization/lots
```

### Query Parameters:
- `search` *(string, optional)*: Tìm kiếm theo mã lô.
- `farmId` *(string, optional)*: Lọc theo mã vùng trồng.
- `harvestedFrom` *(YYYY-MM-DD, optional)*: Ngày bắt đầu khoảng thu hoạch.
- `harvestedTo` *(YYYY-MM-DD, optional)*: Ngày kết thúc khoảng thu hoạch.
- `limit` *(integer, default 20, max 50)*: Giới hạn kết quả mỗi trang.
- `cursor` *(string base64url, optional)*: Con trỏ phân trang.

### Định dạng Audit Log ghi nhận vào S-31:
- `action`: `INSPECTOR_LOT_SEARCH`
- `resourceType`: `lot`
- `resourceId`: Giá trị `search` nếu có, hoặc `null`
- `actorUserId`: ID cán bộ kiểm tra
- `actorEmail`: Email cán bộ kiểm tra
- `organizationId`: Tổ chức của cán bộ (`org-inspector`)
- `details`: `{ criteria: { search, farmId, harvestedFrom, harvestedTo }, resultCount: N, hasMore: boolean }`

---

## 5. PHÂN RÃ CÔNG VIỆC VÀ KẾ HOẠCH TRIỂN KHAI SPRINT 8

- **Subtask 1 (Backend API & S-31 Logging):** Mở rộng `GET /api/lots` hỗ trợ `farmId`, `harvestedFrom`, `harvestedTo` và ghi audit log S-31 khi `isInspector = true` (1.5 SP).
- **Subtask 2 (Frontend UI):** Bổ sung bộ lọc vùng trồng và khoảng ngày thu hoạch trên giao diện `lots.html` cho role `inspector` (1.0 SP).
- **Subtask 3 (Automated Tests & Regression):** Xây dựng test suite `s52_inspector_lot_search.test.js` kiểm tra đủ 7 ACs và hồi quy linter (0.5 SP).
- **Tổng ước lượng:** **3 Story Points (SP)**.
