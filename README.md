# TTCS K18 N2 - Agri Traceability

Hệ thống truy xuất nguồn gốc và giám sát chuỗi lạnh nông sản của nhóm **TTCS_T926_K18C4_N2**.

## Nguồn chuẩn của dự án

Khi có khác nhau giữa các tài liệu, dùng thứ tự sau:

1. **Backlog Excel**: Sprint Goal, Story Point, Acceptance Criteria, dependency, NFR, Task, DoD/DoR.
2. **Team Charter / Lịch 8 Sprint**: vai trò, đầu mối nghiệp vụ, reviewer và Scrum Master.
3. **Jira**: Sprint hiện tại, assignee, trạng thái và tiến độ thực thi.
4. **GitHub**: source code, branch, commit, Pull Request, CI và tài liệu kỹ thuật.

## Sprint hiện tại: Sprint 2

**Sprint Goal:** Lô thu hoạch được ghi nhận, bàn giao được, và lịch sử của nó không ai sửa lén được mà không bị phát hiện.

Jira hiện có **21 công việc** nằm trong **N2 Sprint 2**. Hai công việc `K-01` và `S-04` được kéo từ Sprint 1 sang nên được quản lý như phạm vi Sprint 2 hiện tại.

Chi tiết đầy đủ: [docs/SPRINT-2.md](docs/SPRINT-2.md).

### Ba branch làm việc chính

| Branch | Phạm vi chính |
|---|---|
| `feature/s2-frontend` | S-13, S-14, S-25 và phần UI của S-07, S-08, S-15, S-16, S-24 |
| `feature/s2-backend` | S-04, S-07, S-08, S-09, S-15, S-16, S-17, S-18, S-19, S-21, S-23, S-24, S-25 |
| `feature/s2-data-integrity` | K-01, S-10, S-11, S-12, S-20, S-22 |

Một Story có thể chạm nhiều tầng. Khi đó code được tách theo đúng trách nhiệm của từng branch, nhưng commit phải ghi rõ mã Story, ví dụ:

```text
feat(S-15): add transfer API
feat(S-15): add transfer form UI
test(S-12): verify broken hash chain detection
```

### Trạng thái tích hợp hiện tại

Phần **S-07 + S-08** từ branch cũ `feature/s2-s07-s08-products-harvest` đã được merge vào `develop` qua **PR #43**.

Ba branch Sprint 2 mới phải luôn đồng bộ từ `develop` trước khi tiếp tục phát triển.

## Git workflow

Không code trực tiếp lên `main` hoặc `develop`.

```text
feature/s2-frontend ---------\
feature/s2-backend -----------+--> Pull Request --> develop --> release PR --> main
feature/s2-data-integrity ----/
```

Quy trình:

1. Cập nhật `develop` mới nhất.
2. Đồng bộ branch Sprint 2 đang làm với `develop`.
3. Code đúng phạm vi branch.
4. Commit có mã Story/Task.
5. Push branch lên GitHub.
6. Mở Pull Request vào `develop`.
7. Chỉ merge khi CI xanh và review đạt yêu cầu.
8. Khi bản tích hợp ổn định, mở PR `develop -> main`.

Không tạo thêm branch riêng cho từng Story trong Sprint 2 nếu Story đã thuộc một trong ba branch chính ở trên.

## Chạy ứng dụng local

### Yêu cầu

- Git
- Docker Desktop hoặc Docker Engine có Docker Compose

### Windows PowerShell

```powershell
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git checkout develop
Copy-Item .env.example .env
docker compose up --build
```

### Linux/macOS

```bash
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git checkout develop
cp .env.example .env
docker compose up --build
```

Sau khi hệ thống sẵn sàng:

- Frontend: `http://localhost:8080`
- Backend: `http://localhost:3000`
- Health check: `http://localhost:3000/health`
- PostgreSQL: `localhost:5432`

## Migration

Migration được đặt tại:

```text
db/migrations/
db/migrations/down/
```

Chạy migration thủ công:

```bash
docker compose exec backend npm run migrate:up
docker compose exec backend npm run migrate:down
```

Reset môi trường local:

```bash
docker compose down -v
docker compose up --build
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
│   ├── index.html
│   ├── farms.html
│   ├── lots.html
│   ├── products.html
│   ├── harvest.html
│   ├── styles.css
│   ├── nginx.conf
│   └── Dockerfile
├── db/
│   └── migrations/
├── deploy/
├── docs/
│   ├── SPRINT-1.md
│   ├── SPRINT-2.md
│   ├── TEAM-GUIDE.md
│   └── WORKFLOW.md
├── .github/workflows/
├── docker-compose.yml
├── render.yaml
└── README.md
```

## CI và triển khai

- Pull Request/push được kiểm tra bằng GitHub Actions CI theo cấu hình của repo.
- `develop` là nhánh tích hợp.
- `main` là nhánh release/staging của workflow GitHub Actions hiện tại.
- Repo có `render.yaml` với auto deploy theo commit; Render sẽ triển khai theo branch đang được service/Blueprint cấu hình trên Render.

## Tài liệu

- [Sprint 2 hiện tại](docs/SPRINT-2.md)
- [Sprint 1 - lịch sử](docs/SPRINT-1.md)
- [Hướng dẫn thành viên](docs/TEAM-GUIDE.md)
- [Git workflow](docs/WORKFLOW.md)
- [K-01 - quyết định toàn vẹn dữ liệu](docs/K-01-INTEGRITY.md)

## Definition of Done

Một Story/Task chỉ được coi là Done khi các mục áp dụng đều đạt:

- Code review đạt yêu cầu.
- CI xanh.
- Có test cho logic mới.
- Acceptance Criteria đạt.
- Không đưa secret vào source code.
- Story chạm chuỗi sự kiện phải giữ toàn vẹn hash chain.
- Story chạm khối lượng phải có test trường hợp đồng thời khi cần.
- README/tài liệu được cập nhật nếu thay đổi hành vi công khai hoặc workflow.
