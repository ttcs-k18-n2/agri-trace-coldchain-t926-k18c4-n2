# S-22 – Bộ dữ liệu mẫu phân hệ ba tầng

Phạm vi:
- 12 lô mẫu qua 3 tầng
- 3 tổ chức
- Có split và merge
- Expected ancestors/descendants được đếm tay
- Kiểm tra seed idempotent
- Dependency: S-19

## Files

- `docs/bao-cao-S22.md`: báo cáo đầy đủ.
- `db/seed_s22.sql`: ghi nhận bộ dữ liệu/quan hệ chuẩn để ánh xạ vào schema hiện tại.

## Lưu ý tích hợp

Repository đã có `db/migrations` và backlog S-19. Vì vậy S-22 phải dùng schema hiện có thay vì tạo một schema độc lập. Sau khi xác định đúng tên bảng/cột của migration S-19, ánh xạ L01–L12 và các quan hệ split/merge vào seed chính của dự án.

## Git

Branch mục tiêu: `S-22-Văn-Dũng`
