# Development Workflow

Tài liệu này quy định **quy trình Git hiện tại** của nhóm. Phạm vi nghiệp vụ, SP, AC, dependency và DoD/DoR vẫn lấy từ Backlog/Jira.

## 1. Branch hiện tại

- `main`: nhánh tích hợp chính, đồng thời là nguồn triển khai staging/release.
- `feature/s<sprint>-s<story>-<short-name>`: phát triển Story.
- `fix/s<sprint>-s<story>-<short-name>`: sửa lỗi.
- `docs/<short-name>`: cập nhật tài liệu/quy trình.

**Không dùng `develop` trong luồng làm việc hiện tại.** Nếu còn branch hoặc tài liệu lịch sử nhắc `develop`, không dùng chúng làm hướng dẫn cho công việc mới.

## 2. Luồng chuẩn

```text
origin/main mới nhất
      ↓
feature/* | fix/* | docs/*
      ↓
code + test local
      ↓
git push
      ↓
CI trên branch
      ↓
Pull Request vào main
      ↓
review + CI xanh + AC đạt
      ↓
merge main
      ↓
CI + deploy staging
```

Không có auto-merge từ feature branch vào `main`.

## 3. Tên branch

Mẫu:

```text
feature/s<sprint>-s<story>-<short-name>
fix/s<sprint>-s<story>-<short-name>
docs/<short-name>
```

Ví dụ:

```text
feature/s3-s17-split-lots
feature/s3-s19-merge-lots
fix/s3-s24-overdue-badge
docs/current-main-workflow
```

Tên branch không chứa tên thành viên.

## 4. Lần đầu clone repo

```bash
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git switch main
git pull origin main
```

Sau đó tạo branch Story từ `main`:

```bash
git switch -c feature/s3-s19-merge-lots
```

## 5. Trước khi bắt đầu một nhiệm vụ

Luôn lấy `main` mới nhất:

```bash
git fetch origin
git switch main
git pull origin main
git switch -c feature/s<sprint>-s<story>-<short-name>
```

Nếu branch đã tồn tại:

```bash
git fetch origin
git switch <story-branch>
git pull origin <story-branch>
git merge origin/main
```

Nếu có conflict, xử lý conflict rồi mới code tiếp.

Không code trực tiếp trên `main`.

## 6. Nếu lỡ sửa code khi đang đứng ở main

Nếu **chưa commit**, tạo branch ngay:

```bash
git switch -c feature/s<sprint>-s<story>-<short-name>
```

Các thay đổi chưa commit vẫn đi theo branch mới.

Nếu đã commit local vào `main` nhưng **chưa push**, chuyển commit sang branch rồi đưa local main về đúng origin/main:

```bash
git switch -c feature/s<sprint>-s<story>-<short-name>
git switch main
git reset --hard origin/main
git switch feature/s<sprint>-s<story>-<short-name>
```

Chỉ dùng `reset --hard` khi chắc chắn commit cần giữ đã nằm trên branch mới.

## 7. Chạy và test local

Tạo `.env` từ mẫu:

### Windows

```powershell
Copy-Item .env.example .env
```

### Linux/macOS

```bash
cp .env.example .env
```

Với local HTTP, đặt:

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
Frontend: http://localhost:8080
Backend:  http://localhost:3000
Health:   http://localhost:3000/health
```

Chạy test backend:

```bash
docker compose exec backend npm test
```

Chạy migration khi cần:

```bash
docker compose exec backend npm run migrate:up
```

Reset database local khi cần môi trường sạch:

```bash
docker compose down -v
docker compose up -d --build
```

## 8. Commit

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

Quy ước:

```text
feat(S-xx):     thêm/chỉnh chức năng
fix(S-xx):      sửa lỗi
test(S-xx):     thêm/sửa test
docs:           tài liệu
refactor:       đổi cấu trúc, không đổi hành vi
chore:          CI/cấu hình/công việc kỹ thuật
```

Nếu cần chỉ rõ Task:

```text
feat(S-19/T-44): add merge transaction
test(S-19/T-45): reject invalid parent lots
```

## 9. Push

Lần đầu push branch:

```bash
git push -u origin <story-branch>
```

Các lần sau:

```bash
git push
```

Push chỉ cập nhật branch trên GitHub. **Không tự merge vào main.**

## 10. Pull Request

Story/bug/documentation PR hiện tại đều target:

```text
base: main
compare: <branch-của-bạn>
```

Ví dụ:

```text
base: main
compare: feature/s3-s19-merge-lots
```

PR phải có:

- Story/Task/Jira liên quan.
- Thay đổi đã làm.
- Acceptance Criteria đã đáp ứng.
- Cách test.
- Kết quả test/CI.
- Ảnh nếu thay đổi UI.
- Migration hoặc biến môi trường mới nếu có.
- Blocker/dependency còn lại nếu có.

## 11. Review và merge

Không merge khi:

- CI đỏ.
- Còn conflict.
- AC chưa đạt.
- Test cần thiết chưa có/chưa chạy.
- Có secret/file nhạy cảm.
- Migration chưa kiểm tra.
- Chức năng cần staging nhưng staging chưa test.

Reviewer kiểm `Files changed`, AC, test, security/data isolation và rủi ro ảnh hưởng chức năng cũ.

Sau khi đạt, merge PR vào `main`.

## 12. Sau khi merge

`main` là nguồn chuẩn mới.

Các thành viên khác cập nhật:

```bash
git switch main
git pull origin main
```

Nếu đang làm branch khác:

```bash
git fetch origin
git switch <story-branch>
git merge origin/main
```

## 13. CI/CD hiện tại

Cấu hình hiện tại:

- Push `main`, `feature/**`, `fix/**`, `docs/**` → chạy CI.
- Pull Request vào `main` → chạy CI.
- Merge/push vào `main` → workflow staging được kích hoạt.
- Staging checkout đúng `origin/main`, build/push Docker image và deploy.
- Migration/health check phải thành công theo workflow deploy.

## 14. Branch protection

`main` phải là nhánh được bảo vệ:

- Thành viên không push trực tiếp.
- Thay đổi đi qua PR.
- CI phải xanh.
- Không merge khi conflict.
- Review theo quy định nhóm.

Tài khoản quản trị chỉ dùng quyền bypass khi thật sự cần xử lý khẩn cấp; công việc bình thường vẫn đi qua PR để giữ lịch sử và bằng chứng review.

## 15. Definition of Done

Một Story/Task chỉ Done khi các mục áp dụng đạt:

- Code đúng phạm vi Story/Task.
- AC đạt.
- Test logic mới có và chạy xanh.
- CI xanh.
- Review đạt.
- Không lộ secret.
- Multi-tenant/permission vẫn đúng.
- Story chạm hash-chain giữ toàn vẹn.
- Story chạm khối lượng có transaction/concurrency test khi backlog yêu cầu.
- Migration chạy được nếu có schema change.
- Staging smoke test đạt khi áp dụng.
- Jira được cập nhật sau khi code đã merge và kiểm thử đạt.
