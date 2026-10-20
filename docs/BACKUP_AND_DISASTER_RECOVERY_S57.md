# HƯỚNG DẪN VẬN HÀNH SAO LƯU & DIỄN TẬP PHỤC HỒI THẢM HỌA (S-57 / JIRA N2-125)

## 1. Tổng quan kiến trúc & Mục tiêu (Objectives)
- **Mã Story:** S-57
- **Mã Jira:** [N2-125](https://nhom02.atlassian.net/browse/N2-125)
- **Epic:** E-10 — Vận hành và bảo vệ dữ liệu
- **Mục tiêu chính:**
  - Thiết lập cơ chế tự động sao lưu dữ liệu toàn diện chuỗi lạnh hằng đêm (Cron/Scheduled Job).
  - Bảo vệ dữ liệu nhạy cảm & định danh nông hộ bằng mã hóa nâng cao **AES-256-GCM** (NFR Security).
  - Lưu trữ ngoài máy chủ ứng dụng (thư mục độc lập `/backups` hoặc Cloud Object Storage S3/GCS mount).
  - Cơ chế xoay vòng tự động duy trì đúng **14 bản sao lưu gần nhất**, tự động dọn dẹp các bản cũ hơn.
  - Cung cấp kịch bản khôi phục chuẩn (`restore_backup.js`) kèm kiểm tra Checksum SHA-256 và xác thực toàn vẹn chuỗi Hash (S-12 Cryptographic Chain).
  - Tổ chức diễn tập khôi phục thảm họa định kỳ lên môi trường tạm (`verify_restore_drill.js`) và đo lường thời gian gián đoạn thực tế (RTO).

## 2. Thông số chỉ tiêu RTO & RPO
- **RPO (Recovery Point Objective):** Tối đa 24 giờ (thực hiện sao lưu hằng đêm lúc 01:00 AM UTC+7).
- **RTO (Recovery Time Objective):** Dưới 5 phút (kết quả diễn tập thực tế trung bình < 1 giây trên tập dữ liệu kiểm thử, < 3 phút trên cơ sở dữ liệu lớn).

## 3. Quy trình mã hóa và bảo mật bản sao lưu
1. **Thuật toán:** `AES-256-GCM` (Galois/Counter Mode).
2. **Khóa dẫn xuất:** PBKDF2 / SHA-256 từ `BACKUP_ENCRYPTION_KEY`.
3. **IV:** 96-bit (12 bytes) ngẫu nhiên bằng `crypto.randomBytes(12)` sinh mới trên mỗi lần sao lưu.
4. **Tính toàn vẹn (Auth Tag):** 128-bit Authentication Tag ngăn chặn triệt để mọi hành vi sửa đổi dữ liệu ngoại vi (Tampering prevention). Nếu tệp sao lưu bị thay đổi dù chỉ 1 bit, quá trình khôi phục sẽ từ chối ngay lập tức.
5. **Checksum:** Băm SHA-256 độc lập cho cả nội dung Plaintext và Ciphertext, lưu trong `backup-manifest.json`.

## 4. Hướng dẫn vận hành từng bước (Step-by-step Procedures)

### 4.1. Thực hiện sao lưu hằng đêm (Manual hoặc Cron)
Lệnh chạy thủ công:
```bash
node backend/scripts/backup_nightly.js
```
Cấu hình Cron trên máy chủ Ubuntu/Debian (`crontab -e`):
```cron
# Chạy sao lưu vào lúc 01:00 AM mỗi đêm
0 1 * * * cd /opt/agri-trace/backend && /usr/bin/node scripts/backup_nightly.js >> /var/log/backup-nightly.log 2>&1
```

Biến môi trường hỗ trợ:
- `BACKUP_DIR`: Thư mục lưu trữ sao lưu ngoài máy chủ (Mặc định: `../../backups`).
- `BACKUP_ENCRYPTION_KEY`: Chuỗi khóa bí mật dùng để mã hóa AES-256-GCM.

### 4.2. Khôi phục cơ sở dữ liệu từ bản sao lưu
Khi xảy ra sự cố hỏng hóc hoặc mất dữ liệu:
1. Xác định tệp sao lưu cần khôi phục trong thư mục sao lưu hoặc tra cứu trong `backup-manifest.json`.
2. Chạy lệnh phục hồi:
```bash
node backend/scripts/restore_backup.js <duong-dan-tep-backup.enc>
```
Quy trình phục hồi sẽ tự động:
- Kiểm tra tính hợp lệ của tệp và đối soát Authentication Tag AES-256-GCM.
- Kiểm tra mã băm SHA-256 gốc.
- Nạp lại dữ liệu toàn bộ các bảng vào Database.
- Tự động chạy thuật toán kiểm tra toàn vẹn chuỗi hash (S-12) cho toàn bộ các lô nông sản để đảm bảo chuỗi cung ứng không bị đứt gãy.

### 4.3. Diễn tập khôi phục thảm họa định kỳ (Disaster Recovery Drill)
Chạy kịch bản diễn tập mô phỏng tự động:
```bash
node backend/scripts/verify_restore_drill.js
```
Kết quả diễn tập tự động xuất ra tệp `docs/DRILL_RESTORE_EVIDENCE.json` chứa:
- Trạng thái diễn tập (`DRILL_PASSED`).
- Thời gian khôi phục đo lường chính xác bằng mili-giây (`rtoDurationMs`).
- Đối soát 100% số lượng thực thể giữa trước và sau khôi phục.
- Kết quả kiểm chứng mật mã học chuỗi Hash lô nông sản.
