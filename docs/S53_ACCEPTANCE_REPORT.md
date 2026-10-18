# BÁO CÁO NGHIỆM THU STORY S-53 (JIRA N2-121)

## Thông tin Story
- **Mã Story:** S-53
- **Mã Jira:** [N2-121](https://nhom02.atlassian.net/browse/N2-121)
- **Tên Story:** Xuất hồ sơ truy xuất đầy đủ của một lô ra PDF kèm kết quả kiểm toàn vẹn
- **Epic:** E-09 — Báo cáo và hồ sơ kiểm tra
- **Branch:** `feature/S-53-Xuất-hồ-sơ-truy-xuất-đầy-đủ-của-một-lô-ra-PDF-kèm-kết-quả-kiểm-toàn-vẹn`
- **Base:** `develop` (trên nền S-52 đã tích hợp ổn định)

## Mục tiêu và Tiêu chí chấp nhận (Acceptance Criteria)
1. **Kết xuất hồ sơ PDF nhị phân thực sự (`backend/src/lot_pdf_export_service.js`):**
   - Tạo luồng nhị phân tuân thủ chuẩn PDF-1.4 RFC (Header `%PDF-1.4`, Catalog `/Root`, Pages, Fonts Type1 chuẩn Helvetica/Courier, bảng `xref` và trailer `%%EOF`).
   - Tương thích 100% không phụ thuộc thư viện native nặng hoặc phông chữ bên ngoài.
   - Hỗ trợ phân trang 2 trang hoàn chỉnh (Trang 1: Thông tin cơ bản, Kiểm tra toàn vẹn, Bảng sự kiện chuỗi cung ứng; Trang 2: Phả hệ tổ tiên/hậu duệ DAG, Giám sát chuỗi lạnh, Trạng thái thu hồi và Mục ký xác nhận thanh tra).
2. **Nội dung hồ sơ truy xuất toàn diện:**
   - **Thông tin lô hàng:** Mã lô, tên sản phẩm, tổ chức sở hữu, vùng trồng/thửa đất, ngày thu hoạch, khối lượng ban đầu và khối lượng còn lại, trạng thái hoạt động.
   - **Dòng thời gian sự kiện (Ledger events):** Bảng chi tiết thứ tự chuỗi sự kiện, loại sự kiện (`HARVEST_CREATED`, `TEMPERATURE_RECORDED`, `DISPATCHED`,...), thời điểm và mã băm từng sự kiện.
   - **Phả hệ tổ tiên và hậu duệ (Genealogy):** Danh sách các lô mẹ nguồn gốc ban đầu (`origins`) và các lô con phân tách/gộp (`descendants`).
   - **Giám sát chuỗi lạnh & Vi phạm:** Báo cáo các sự cố vượt ngưỡng nhiệt độ, thời lượng vi phạm tính bằng phút theo từng chuyến vận chuyển.
   - **Tình trạng thu hồi:** Cảnh báo lệnh thu hồi khẩn cấp hoặc xác nhận an toàn đủ điều kiện lưu thông.
   - **Kết quả kiểm tra toàn vẹn chuỗi Hash (S-12 Audit):**
     - Trạng thái kiểm tra: Toàn vẹn (Đạt tiêu chuẩn) hoặc Cảnh báo đứt chuỗi / sửa đổi trái phép.
     - **In mã băm đỉnh cuối chuỗi (Head Hash / Cryptographic Signature):** Mã băm SHA-256 64 ký tự hex được in trực tiếp lên tệp hồ sơ PDF theo đúng NFR để phục vụ đối soát độc lập ngoại tuyến.
     - Thời điểm trích xuất (`exportedAt`) và thông tin cán bộ thanh tra thực hiện (`actorEmail`).
3. **REST API Endpoint (`GET /api/lots/:id/export-pdf`):**
   - Trả về mã HTTP 200 kèm `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="..."`.
   - Trả về HTTP Headers tùy biến: `X-Lot-Head-Hash` và `X-Integrity-Valid`.
   - Xử lý mã lỗi 404 `LOT_NOT_FOUND` an toàn khi mã lô không tồn tại.
   - Kiểm tra phân quyền RBAC (yêu cầu đăng nhập, cấm truy cập ẩn danh 401).
   - Tự động ghi nhận nhật ký kiểm toán S-31 (`INSPECTOR_LOT_PDF_EXPORT`) khi cán bộ thanh tra thực hiện xuất hồ sơ.
4. **Tích hợp giao diện người dùng (`frontend/lot-detail.html`):**
   - Bổ sung nút **"Xuất PDF"** trực tiếp trên thanh công cụ chính và trong menu mở rộng của trang chi tiết lô hàng.

## Bảng đối chiếu kết quả kiểm thử (Test Suite: `s53_export_pdf.test.js`)
| Mã nhiệm vụ | Tiêu chí nghiệm thu | Kết quả |
|-------------|---------------------|---------|
| N2-237 | Kết xuất tệp PDF nhị phân chuẩn PDF-1.4, cấu trúc Header %PDF, Catalog, Pages, xref, %%EOF | PASS |
| N2-238 | Nội dung PDF đầy đủ thông tin lô, dòng thời gian, phả hệ, chuỗi lạnh, thu hồi và in Head Hash 64 hex | PASS |
| N2-284 | REST API `GET /api/lots/:id/export-pdf`, headers `X-Lot-Head-Hash`, `X-Integrity-Valid`, kiểm tra RBAC (401/200/404) | PASS |
| N2-284 / S-31 | Ghi nhận nhật ký kiểm toán `INSPECTOR_LOT_PDF_EXPORT` vào S-31 khi cán bộ kiểm tra xuất tệp | PASS |
| Toàn bộ Suite | 4/4 automated test cases đạt 100% | PASS |
