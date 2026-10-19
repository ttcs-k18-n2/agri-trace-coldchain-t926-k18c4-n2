# HƯỚNG DẪN TRIỂN KHAI DỊCH VỤ SAO LƯU TỰ ĐỘNG S-57 (JIRA N2-125)

## 1. Giới thiệu & Mục tiêu Kiến trúc
Tài liệu này hướng dẫn triển khai, vận hành và giám sát dịch vụ sao lưu tự động cơ sở dữ liệu ban đêm (Story S-57 / Jira N2-125) trong chuỗi cung ứng lạnh nông sản Agri Trace Coldchain.

Hệ thống sao lưu đáp ứng các yêu cầu bảo mật và độ tin cậy cấp doanh nghiệp:
- **Mã hóa dữ liệu đầu cuối:** Thuật toán chuẩn `AES-256-GCM` kèm checksum `SHA-256` đối soát tính toàn vẹn.
- **Chống trùng lặp khi chạy đa bản sao (Multi-replica):** Sử dụng PostgreSQL Advisory Lock `pg_try_advisory_lock(hashtext('coldchain_backup_lock'))` để đảm bảo duy nhất một tiến trình thực thi tại một thời điểm.
- **Tự động xoay vòng (Retention Policy):** Giữ đúng **14 bản sao lưu gần nhất**, tự động dọn dẹp các tệp cũ và cập nhật tệp kê khai `backup-manifest.json`.
- **Hỗ trợ lưu trữ mount ngoài (External Storage Mount):** Cho phép gắn kết volume Docker hoặc mount ổ đĩa mạng (NAS/SAN/Cloud Storage) vào `/backups`.
- **Múi giờ chuẩn Việt Nam:** Lịch trình chạy mặc định theo múi giờ `Asia/Ho_Chi_Minh` (UTC+7).

---

## 2. Danh sách biến môi trường (Environment Variables)

| Tên biến | Kiểu dữ liệu | Giá trị mặc định | Bắt buộc | Mô tả |
| :--- | :--- | :--- | :--- | :--- |
| `BACKUP_ENCRYPTION_KEY` | String | *(Không có)* | **Có** | Khóa bí mật dùng để mã hóa AES-256-GCM (tối thiểu 16 ký tự, khuyến nghị 32+ ký tự ngẫu nhiên). |
| `BACKUP_DIR` | Path | `/backups` | Không | Đường dẫn thư mục lưu trữ các tệp sao lưu `.enc` và `backup-manifest.json`. |
| `ENABLE_BACKUP_CRON` | Boolean | `false` | Không | Nếu đặt `true`, backend server sẽ tự động kích hoạt tiến trình cron sao lưu nội bộ. Khuyến nghị đặt `false` khi chạy service `backup-scheduler` độc lập. |
| `TZ` | String | `Asia/Ho_Chi_Minh` | Không | Múi giờ hệ thống và lập lịch cron (mặc định giờ Việt Nam UTC+7). |
| `BACKUP_CRON_SCHEDULE` | Cron Exp | `0 2 * * *` | Không | Lịch trình sao lưu tự động ban đêm (mặc định lúc 02:00 AM mỗi đêm). |
| `DATABASE_URL` | URL | *(Chuỗi kết nối PG)* | **Có** | Kết nối cơ sở dữ liệu PostgreSQL thực tế để trích xuất dữ liệu. |

> [!IMPORTANT]
> **Khóa mã hóa `BACKUP_ENCRYPTION_KEY`:** Tuyệt đối không lưu khóa mã hóa cứng trong mã nguồn hoặc commit lên Git. Khóa phải được bảo vệ qua hệ thống quản lý bí mật (Docker Secrets, Vault, hoặc biến môi trường được mã hóa).

---

## 3. Kiến trúc triển khai & Chống trùng lặp (Concurrency Control)

### 3.1. Cơ chế PostgreSQL Advisory Lock
Khi triển khai môi trường phân tán với nhiều replica container của backend:
1. Khi đến lịch sao lưu (02:00 AM), mỗi tiến trình sẽ kết nối vào PostgreSQL và thực hiện truy vấn:
   ```sql
   SELECT pg_try_advisory_lock(hashtext('coldchain_backup_lock')) AS locked;
   ```
2. **Tiến trình đầu tiên** nhận được `locked = true` sẽ tiếp tục thu thập dữ liệu và đóng gói bản sao lưu.
3. **Các replica còn lại** nhận `locked = false` sẽ ngay lập tức bỏ qua tác vụ và ghi nhật ký cảnh báo an toàn (`skipped: true`, `reason: "ADVISORY_LOCK_HELD"`), chống xung đột I/O và tạo ra các tệp sao lưu trùng lặp.
4. Khi hoàn thành hoặc phát sinh lỗi ngoại lệ, tiến trình đang giữ khóa sẽ tự động giải phóng khóa trong khối `finally`:
   ```sql
   SELECT pg_advisory_unlock(hashtext('coldchain_backup_lock'));
   ```

### 3.2. Chế độ Scheduler độc lập (`--schedule`)
Hệ thống hỗ trợ chạy scheduler dưới dạng container chuyên dụng (dedicated service):
```bash
node scripts/backup_nightly.js --schedule
```
Tiến trình này duy trì kết nối nền, tự động lắng nghe theo múi giờ `Asia/Ho_Chi_Minh` và kích hoạt hàm sao lưu đúng 02:00 sáng.

---

## 4. Cấu hình Docker Compose & Mount Volume ngoài

### 4.1. Cấu hình dịch vụ trong `docker-compose.yml`
```yaml
services:
  # 1. Cơ sở dữ liệu chính
  postgres:
    image: postgres:16-alpine
    container_name: agri-trace-postgres
    restart: unless-stopped
    env_file: .env
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10

  # 2. Máy chủ ứng dụng Backend
  backend:
    image: agri-trace-backend:latest
    container_name: agri-trace-backend
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: ${DATABASE_URL}
      BACKUP_DIR: /backups
      ENABLE_BACKUP_CRON: "false" # Chuyển tác vụ sang service scheduler độc lập
      TZ: Asia/Ho_Chi_Minh
    volumes:
      - backup_data:/backups # Gắn volume để API admin có thể đọc manifest
    depends_on:
      postgres:
        condition: service_healthy

  # 3. Tiến trình lập lịch sao lưu nền S-57
  backup-scheduler:
    image: agri-trace-backend:latest
    container_name: agri-trace-backup-scheduler
    restart: unless-stopped
    command: ["node", "scripts/backup_nightly.js", "--schedule"]
    env_file: .env
    environment:
      DATABASE_URL: ${DATABASE_URL}
      BACKUP_ENCRYPTION_KEY: ${BACKUP_ENCRYPTION_KEY}
      BACKUP_DIR: /backups
      TZ: Asia/Ho_Chi_Minh
    volumes:
      - backup_data:/backups # Lưu trữ bản sao lưu ra volume ngoài
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
  backup_data:
```

### 4.2. Mount thư mục máy chủ vật lý (Host Path Mount)
Để lưu trực tiếp vào thư mục ngoài máy chủ (ví dụ `/data/backups/coldchain`):
```yaml
volumes:
  backup_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/backups/coldchain
```

---

## 5. Giám sát & Healthcheck Trạng thái Sao lưu

Hệ thống cung cấp API quản trị để giám sát trạng thái sao lưu và kiểm tra sự tồn tại của tệp kê khai `backup-manifest.json`:

### 5.1. Endpoint `GET /api/admin/backup-status`
- **Quyền hạn yêu cầu:** `admin` (Role-based access control, người dùng chưa xác thực nhận `401 Unauthorized`, người dùng khác nhận `403 Forbidden`).
- **Ví dụ gọi qua cURL:**
  ```bash
  curl -X GET "https://api.coldchain.internal/api/admin/backup-status" \
       -H "Cookie: connect.sid=s%3A..."
  ```

### 5.2. Cấu trúc phản hồi JSON
```json
{
  "status": "OK",
  "backupDir": "/backups",
  "manifestExists": true,
  "manifestLastUpdated": "2026-10-19T02:00:15.123Z",
  "totalBackups": 14,
  "latestBackup": {
    "filename": "backup-coldchain-2026-10-19T02-00-00-000Z.enc",
    "createdAt": "2026-10-19T02:00:00.000Z",
    "sizeBytes": 1048576,
    "plaintextSha256": "3a7b...8f",
    "ciphertextSha256": "9c1e...4a",
    "algorithm": "aes-256-gcm",
    "status": "SUCCESS"
  },
  "lastStatus": "SUCCESS",
  "lastBackupAt": "2026-10-19T02:00:00.000Z",
  "lastError": null
}
```

### 5.3. Cảnh báo khi có sự cố sao lưu
Nếu tác vụ ban đêm gặp lỗi (ví dụ cơ sở dữ liệu ngắt kết nối):
- `lastStatus` chuyển sang `"FAILED"`.
- Trường `lastError` ghi nhận thời điểm và chi tiết lỗi:
  ```json
  "lastError": {
    "failedAt": "2026-10-19T02:00:05.890Z",
    "errorMessage": "connection to server at \"postgres\" failed: Connection refused"
  }
  ```

---

## 6. Quy trình Vận hành Khôi phục Thảm họa (Runbook)

Khi xảy ra sự cố phần cứng hoặc thảm họa dữ liệu, đội ngũ vận hành thực hiện quy trình sau:
1. **Kiểm tra tệp sao lưu gần nhất:**
   ```bash
   cat /backups/backup-manifest.json
   ```
2. **Thực thi lệnh phục hồi dữ liệu:**
   ```bash
   node scripts/restore_backup.js /backups/backup-coldchain-2026-10-19T02-00-00-000Z.enc --confirm-production
   ```
3. **Thực hiện diễn tập định kỳ tự động:**
   ```bash
   node scripts/verify_restore_drill.js
   ```
   Kết quả diễn tập tự động lưu trữ tại `docs/DRILL_RESTORE_EVIDENCE.json`.
