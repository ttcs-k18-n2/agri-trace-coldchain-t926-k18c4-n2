# BÁO CÁO NGHIỆM THU STORY S-57 (JIRA N2-125)

## Thông tin Story
- **Mã Story:** S-57
- **Mã Jira:** [N2-125](https://nhom02.atlassian.net/browse/N2-125)
- **Tên Story:** Sao lưu cơ sở dữ liệu hằng đêm và diễn tập khôi phục
- **Epic:** E-10 — Vận hành và bảo vệ dữ liệu
- **Branch:** `feature/S-57]-Sao-lưu-cơ-sở-dữ-liệu-hằng-đêm-và-diễn-tập-khôi-phục`
- **Base:** `develop`

## Mục tiêu và Tiêu chí chấp nhận (Acceptance Criteria)
1. **Script sao lưu tự động hằng đêm (`backend/scripts/backup_nightly.js`):**
   - Trích xuất toàn diện mọi bảng dữ liệu chuỗi lạnh: tổ chức, người dùng, lô hàng, sự kiện băm (hash chain), chuyển giao, mối quan hệ phân tách/gộp lô, thùng lạnh, chỉ số nhiệt độ, vi phạm chuỗi lạnh, thu hồi và nhật ký kiểm toán.
   - Mã hóa nâng cao theo chuẩn **AES-256-GCM** với 96-bit IV ngẫu nhiên và 128-bit Authentication Tag để bảo vệ dữ liệu định danh nông hộ (NFR Security).
   - Tính toán và lưu trữ mã băm kiểm tra toàn vẹn SHA-256 độc lập cho cả Plaintext và Ciphertext.
   - Lưu trữ tại thư mục bên ngoài máy chủ ứng dụng (`BACKUP_DIR` / `../../backups`).
   - Tự động duy trì đúng **14 bản sao lưu gần nhất**, tự động xoay vòng và dọn dẹp các bản ghi cũ hơn.
   - Tạo và cập nhật siêu dữ liệu tệp `backup-manifest.json`.
2. **Script phục hồi và kiểm tra toàn vẹn sau khôi phục (`backend/scripts/restore_backup.js`):**
   - Giải mã an toàn bằng AES-256-GCM, đối soát Authentication Tag để ngăn chặn triệt để hành vi giả mạo (Tampering detection).
   - Kiểm chứng mã băm SHA-256 so với bản gốc.
   - Nạp dữ liệu vào cơ sở dữ liệu đích / môi trường tạm.
   - Tự động kiểm tra tính liên tục và tính toàn vẹn của chuỗi mã băm sự kiện (S-12) trên mọi lô nông sản sau khôi phục.
3. **Diễn tập khôi phục thảm họa định kỳ (`backend/scripts/verify_restore_drill.js`):**
   - Thực hiện diễn tập khôi phục lên môi trường tạm biệt lập ít nhất 1 lần.
   - Đo lường chính xác thời gian gián đoạn thực tế (RTO - Recovery Time Objective) đạt chuẩn < 1 giây trên môi trường kiểm thử.
   - Đối soát 100% dữ liệu trước và sau khôi phục.
   - Xuất biên bản bằng chứng diễn tập tự động tại `docs/DRILL_RESTORE_EVIDENCE.json`.
4. **Tài liệu hướng dẫn khôi phục từng bước (`docs/BACKUP_AND_DISASTER_RECOVERY_S57.md`):**
   - Đầy đủ quy trình vận hành sao lưu, khôi phục khi gặp thảm họa, kịch bản cron, chỉ số RTO/RPO và cơ chế kiểm soát mã hóa.

## Bảng đối chiếu kết quả kiểm thử (Test Suite: `s57_backup_restore.test.js`)
| Mã nhiệm vụ | Tiêu chí nghiệm thu | Kết quả |
|-------------|---------------------|---------|
| N2-245 | Tự động sao lưu dữ liệu, mã hóa AES-256-GCM, tính SHA-256 checksum và tạo `backup-manifest.json` | PASS |
| N2-245 | Quy tắc xoay vòng Retention Policy: Giữ đúng 14 bản gần nhất ngoài máy chủ, tự động xóa bản cũ | PASS |
| N2-287 | Script phục hồi giải mã thành công và đối soát chuỗi hash toàn vẹn (S-12) | PASS |
| N2-287 / Bảo mật | Chặn đứng phục hồi khi mật khẩu sai hoặc tệp bị can thiệp (Tamper detection qua authTag) | PASS |
| N2-246 | Diễn tập khôi phục bản sao lưu lên môi trường tạm, đo thời gian gián đoạn RTO (< 5 phút) | PASS |
| Toàn bộ Suite | 6/6 automated test cases đạt 100% | PASS |
