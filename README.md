# TTCS K18 N2 - Agri Traceability

Hệ thống truy xuất nguồn gốc và giám sát chuỗi lạnh nông sản của nhóm **TTCS_T926_K18C4_N2**.

## Nguồn chuẩn của dự án

Khi có khác nhau giữa các tài liệu, dùng thứ tự sau:

1. **Backlog Excel**: Sprint Goal, Story Point, Acceptance Criteria, dependency, NFR, Task, DoD/DoR.
2. **Team Charter / Lịch 8 Sprint**: vai trò, đầu mối nghiệp vụ, reviewer và Scrum Master.
3. **Jira**: Sprint hiện tại, assignee, trạng thái và tiến độ thực thi.
4. **GitHub**: source code, commit, Pull Request, CI và tài liệu kỹ thuật.

## Sprint hiện tại: Sprint 2

**Sprint Goal:** Lô thu hoạch được ghi nhận, bàn giao được, và lịch sử của nó không ai sửa lén được mà không bị phát hiện.

Phạm vi Sprint 2 chuẩn được xác định theo label **`sprint-2`** trên Jira, gồm 10 Story: **S-07 → S-16** (không gồm S-23/S-24/S-25 và S-17 → S-22 vì các Story này mang label `sprint-3`).

Snapshot hiện tại:
- **Done trên Jira:** S-07, S-08, S-09, S-10, S-11, S-12, S-14, S-16.
- **To Do:** S-13, S-15.
- S-16 đang Done trên Jira nhưng phụ thuộc S-15, vì vậy cần đối chiếu lại luồng bàn giao sau khi S-15 hoàn tất.

Chi tiết: [docs/SPRINT-2.md](docs/SPRINT-2.md).

## Git workflow hiện tại: main-only

Repo chỉ dùng **`main` làm nhánh lâu dài**. Không dùng `develop`.

Mỗi Story/bug/tài liệu được làm trên branch tạm tạo từ `main`:

```text
main
 ├─ feature/s2-s13-timeline
 ├─ feature/s2-s15-handover
 ├─ fix/s2-s14-search
 └─ docs/main-only-workflow

branch tạm --> Pull Request --> review + CI --> main
```

Quy trình:

1. Cập nhật `main` mới nhất.
2. Tạo branch tạm từ `main`.
3. Code đúng phạm vi Story/Task.
4. Commit ghi rõ mã Story/Task.
5. Push branch lên GitHub.
6. Mở Pull Request với **base: `main`**.
7. Chỉ merge khi CI xanh, không conflict và có review/approval theo ruleset.
8. Merge xong thì xóa branch tạm nếu không còn dùng.

**Không push trực tiếp lên `main`. Không force-push `main`.**

Ví dụ commit:

```text
feat(S-15): add pending handover API
feat(S-15): add handover form UI
test(S-12): verify broken hash chain detection
fix(S-14): correct lot search behavior
```

## Chạy ứng dụng local

### Yêu cầu

- Git
- Docker Desktop hoặc Docker Engine có Docker Compose

### Windows PowerShell

```powershell
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git checkout main
git pull origin main
Copy-Item .env.example .env
docker compose up --build
```

### Linux/macOS

```bash
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git checkout main
git pull origin main
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
│   ├── lot-detail.html
│   ├── products.html
│   ├── harvest.html
│   ├── integrity.html
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

- CI chạy trên push vào `main`, `feature/**`, `fix/**`, `docs/**` và Pull Request vào `main`.
- Các check hiện tại: **build, lint, test**.
- Không có job tự động merge PR.
- `main` là nhánh release/staging.
- `.github/workflows/staging.yml` triển khai khi có push vào `main`.
- `render.yaml` cũng cấu hình deploy từ branch `main`.

## Tài liệu

- [Sprint 2 hiện tại](docs/SPRINT-2.md)
- [Sprint 1 - lịch sử](docs/SPRINT-1.md)
- [Hướng dẫn thành viên](docs/TEAM-GUIDE.md)
- [Git workflow](docs/WORKFLOW.md)
- [K-01 - quyết định toàn vẹn dữ liệu](docs/K-01-INTEGRITY.md)

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
- Không đưa secret vào source code.
- Story chạm chuỗi sự kiện phải giữ toàn vẹn hash chain.
- Story chạm khối lượng phải có test trường hợp đồng thời khi cần.
- README/tài liệu được cập nhật nếu thay đổi hành vi công khai hoặc workflow.
