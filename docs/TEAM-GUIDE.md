# Hướng dẫn GitHub cho thành viên

Tài liệu này là hướng dẫn ngắn cho thành viên nhóm **TTCS_T926_K18C4_N2** theo quy trình hiện tại.

## 1. Luồng làm việc hiện tại

```text
main mới nhất
   ↓
tạo branch Story
   ↓
code + test local
   ↓
git push branch
   ↓
CI
   ↓
Pull Request vào main
   ↓
review + CI xanh
   ↓
merge main
   ↓
deploy staging
```

Hiểu ngắn gọn:

- `main` = nhánh tích hợp chính và nguồn triển khai staging.
- Thành viên không code/push trực tiếp vào `main`.
- Không dùng `develop` cho công việc mới.
- Mỗi Story dùng branch riêng.
- Push branch **không tự đưa code vào main**.
- Muốn vào main phải qua Pull Request.

## 2. Lần đầu lấy project về máy

```bash
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git switch main
git pull origin main
```

## 3. Bắt đầu nhiệm vụ mới

Ví dụ làm S-19:

```bash
git switch main
git pull origin main
git switch -c feature/s3-s19-merge-lots
```

Mẫu branch:

```text
feature/s3-s17-split-lots
feature/s3-s19-merge-lots
fix/s3-s24-overdue-badge
```

Không đặt branch theo tên người.

## 4. Nếu branch đã tồn tại

```bash
git fetch origin
git switch <story-branch>
git pull origin <story-branch>
git merge origin/main
```

Việc merge `origin/main` giúp branch nhận code mới đã được các Story khác merge.

Nếu có conflict, xử lý conflict trước khi code tiếp.

## 5. Chạy local để test

Yêu cầu:

- Git
- Docker Desktop / Docker Engine + Docker Compose

Tạo file môi trường:

### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

### Linux/macOS

```bash
cp .env.example .env
```

Trong `.env` local sửa:

```env
COOKIE_SECURE=false
```

Chạy:

```bash
docker compose up -d --build
docker compose ps
```

Mở:

```text
http://localhost:8080
```

Health check:

```text
http://localhost:3000/health
```

## 6. Test chức năng

Test đúng Acceptance Criteria trên localhost.

Ví dụ chức năng bàn giao:

```text
tài khoản tổ chức A tạo/gửi bàn giao
→ tài khoản tổ chức B xem yêu cầu
→ xác nhận/từ chối
→ kiểm quyền sở hữu và event
```

Có thể dùng cửa sổ thường + cửa sổ ẩn danh để đăng nhập hai tài khoản cùng lúc.

Chạy test tự động:

```bash
docker compose exec backend npm test
```

Nếu có migration mới:

```bash
docker compose exec backend npm run migrate:up
```

## 7. Commit

Trước khi commit:

```bash
git status
git diff
```

Sau đó:

```bash
git add .
git commit -m "feat(S-19): implement lot merge"
```

Ví dụ khác:

```text
fix(S-24): fix overdue badge
test(S-19): add merge validation tests
docs: update current workflow
```

## 8. Push branch

Lần đầu:

```bash
git push -u origin <story-branch>
```

Các lần sau:

```bash
git push
```

Push **không tự merge**.

## 9. Tạo Pull Request

Trên GitHub:

```text
base: main
compare: <story-branch>
```

Ví dụ:

```text
base: main
compare: feature/s3-s19-merge-lots
```

PR phải ghi:

- Story/Task/Jira.
- Code đã làm.
- AC đã đạt.
- Cách test.
- Kết quả test.
- Ảnh nếu có UI.
- Migration/env mới nếu có.

## 10. Review

Reviewer kiểm:

1. `Files changed`.
2. Có đúng phạm vi Story/Task không.
3. Acceptance Criteria.
4. Test/CI.
5. Permission/multi-tenant.
6. Secret.
7. Conflict.
8. Migration và ảnh hưởng dữ liệu.

Nếu chưa đạt → **Request changes**.

Nếu đạt → **Approve**.

Sau đó merge vào `main`.

## 11. Sau khi Story khác được merge

Muốn lấy code mới:

```bash
git switch main
git pull origin main
```

Nếu đang có Story branch:

```bash
git fetch origin
git switch <story-branch>
git merge origin/main
```

## 12. Nếu chỉ được giao test chức năng đã merge

Không cần tạo branch:

```bash
git switch main
git pull origin main
docker compose down
docker compose up -d --build
```

Sau đó mở:

```text
http://localhost:8080
```

và test theo AC.

Muốn reset sạch database local:

```bash
docker compose down -v
docker compose up -d --build
```

Lệnh này chỉ xóa DB local của máy đó.

## 13. Nếu lỡ sửa trên main

Nếu chưa commit:

```bash
git switch -c feature/s<sprint>-s<story>-<short-name>
```

Code đang sửa vẫn được giữ.

Không push commit chức năng trực tiếp lên `main`.

## 14. Những điều không được làm

- Không push trực tiếp vào `main`.
- Không dùng `develop` cho nhiệm vụ mới.
- Không tạo branch theo tên cá nhân.
- Không commit `.env`, password, token hoặc key.
- Không merge khi CI đỏ.
- Không merge khi còn conflict.
- Không tự xóa code người khác để giải quyết conflict.
- Không đánh Jira Done khi code chưa merge/test đạt.

## 15. Bộ lệnh nhanh

Bắt đầu Story:

```bash
git switch main
git pull origin main
git switch -c feature/s3-sXX-ten-chuc-nang
```

Sau khi code:

```bash
git status
git add .
git commit -m "feat(S-XX): mô tả ngắn"
git push -u origin feature/s3-sXX-ten-chuc-nang
```

Sau đó trên GitHub:

```text
Pull Request
base: main
compare: feature/s3-sXX-ten-chuc-nang
→ CI
→ review
→ merge
```
