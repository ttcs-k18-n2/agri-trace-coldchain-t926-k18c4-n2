# TTCS K18 N2 - Agri Traceability

Hệ thống truy xuất nguồn gốc và giám sát chuỗi lạnh nông sản của nhóm **TTCS_T926_K18C4_N2**.

## Nguồn chuẩn của dự án

Khi có khác nhau giữa các tài liệu, dùng thứ tự sau:

1. **Backlog Excel**: Sprint Goal, Story Point, Acceptance Criteria, dependency, NFR, Task, DoD/DoR.
2. **Team Charter / Lịch 8 Sprint**: vai trò, đầu mối nghiệp vụ, reviewer và Scrum Master.
3. **Jira**: Sprint hiện tại, assignee, trạng thái và tiến độ thực thi.
4. **GitHub**: source code, branch, commit, Pull Request, CI và tài liệu kỹ thuật.

## Quy trình Git hiện tại

Repo hiện dùng **main làm nhánh tích hợp + staging/release**.

Luồng chuẩn:

```text
main mới nhất
   ↓
feature/* hoặc fix/*
   ↓ code + test local
git push
   ↓
CI chạy trên branch
   ↓
Pull Request
   ↓ review + CI xanh
main
   ↓
Deploy staging tự động
```

Quy tắc:

- Thành viên **không code/push trực tiếp vào `main`**.
- Mỗi Story dùng một branch riêng, ví dụ `feature/s3-s19-merge-lots`.
- Branch mới luôn tạo từ `main` mới nhất.
- Story PR mở **trực tiếp vào `main`**.
- Không dùng `develop` trong quy trình hiện tại.
- Các tài liệu cũ có nhắc `develop` chỉ là lịch sử của quy trình trước đây.
- Commit nên ghi rõ Story/Task, ví dụ:

```text
feat(S-19): implement lot merge transaction
fix(S-24): fix overdue badge
test(S-19): add merge rollback tests
```

Chi tiết: [docs/WORKFLOW.md](docs/WORKFLOW.md) và [docs/TEAM-GUIDE.md](docs/TEAM-GUIDE.md).

## Bắt đầu một nhiệm vụ mới

```bash
git fetch origin
git switch main
git pull origin main
git switch -c feature/s<sprint>-s<story>-<short-name>
```

Ví dụ:

```bash
git switch main
git pull origin main
git switch -c feature/s3-s19-merge-lots
```

Sau khi code và test:

```bash
git status
git add .
git commit -m "feat(S-19): implement lot merge"
git push -u origin feature/s3-s19-merge-lots
```

Sau đó tạo Pull Request:

```text
base: main
compare: feature/s3-s19-merge-lots
```

Chỉ merge khi CI xanh, không conflict và review/Acceptance Criteria đạt.

## Chạy ứng dụng local

### Yêu cầu

- Git
- Docker Desktop hoặc Docker Engine có Docker Compose

### Windows PowerShell

```powershell
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git switch main
git pull origin main
Copy-Item .env.example .env
```

Khi chạy local bằng HTTP, sửa trong `.env`:

```env
COOKIE_SECURE=false
```

Sau đó:

```powershell
docker compose up -d --build
docker compose ps
```

### Linux/macOS

```bash
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git switch main
git pull origin main
cp .env.example .env
```

Trong `.env` đặt:

```env
COOKIE_SECURE=false
```

Sau đó:

```bash
docker compose up -d --build
docker compose ps
```

Địa chỉ local:

- Frontend: `http://localhost:8080`
- Backend: `http://localhost:3000`
- Health check: `http://localhost:3000/health`
- PostgreSQL: `localhost:5432`

## Cập nhật code main để test

Nếu repo đã clone sẵn:

```bash
git switch main
git pull origin main
docker compose down
docker compose up -d --build
```

Nếu muốn reset sạch database local:

```bash
docker compose down -v
docker compose up -d --build
```

Lưu ý: `down -v` xóa database **local của máy đó**, không ảnh hưởng server staging.

## Migration

Migration nằm tại:

```text
db/migrations/
db/migrations/down/
```

Chạy migration thủ công:

```bash
docker compose exec backend npm run migrate:up
docker compose exec backend npm run migrate:down
```

## Cấu trúc repository

```text
.
├── backend/
│   ├── src/
│   ├── test/
│   ├── scripts/
│   ├── benchmark/
│   ├── Dockerfile
│   └── package.json
├── frontend/
├── db/
│   └── migrations/
├── deploy/
├── docs/
├── .github/workflows/
├── docker-compose.yml
├── render.yaml
└── README.md
```

## CI/CD hiện tại

- Push lên `feature/**`, `fix/**`, `docs/**`: CI chạy.
- Pull Request vào `main`: CI chạy.
- Push/merge vào `main`: CI chạy và workflow staging được kích hoạt.
- Staging lấy đúng commit từ `main`, build Docker image, chạy migration/deploy và health check.
- Secret triển khai chỉ nằm trong GitHub Secrets/server environment, không commit vào repo.

## Bảng sự kiện chỉ-thêm

`batch_events` là bảng append-only.

Tài khoản ứng dụng (`agri_app`) chỉ được:

- `SELECT`
- `INSERT`

Không được:

- `UPDATE`
- `DELETE`
- `TRUNCATE`

Nếu cần hiệu chỉnh nghiệp vụ, phải ghi một sự kiện mới, không sửa sự kiện cũ.

## Definition of Done

Một Story/Task chỉ được coi là Done khi các mục áp dụng đều đạt:

- Code review đạt yêu cầu.
- CI xanh.
- Có test cho logic mới.
- Acceptance Criteria đạt.
- Test local/staging đạt khi áp dụng.
- Không đưa secret vào source code.
- Story chạm chuỗi sự kiện phải giữ toàn vẹn hash chain.
- Story chạm khối lượng phải có test concurrency khi Backlog yêu cầu.
- README/tài liệu được cập nhật nếu thay đổi hành vi công khai hoặc workflow.
