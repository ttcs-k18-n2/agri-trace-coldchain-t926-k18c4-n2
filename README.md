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
- Mỗi Backlog dùng một branch riêng, ví dụ `feature/s3-s19-merge-lots`.
- Branch mới luôn tạo từ `main` mới nhất.
- Story PR mở **trực tiếp vào `main`**.
- Không dùng `develop` trong quy trình hiện tại.
- Các tài liệu cũ có nhắc `develop` chỉ là lịch sử của quy trình trước đây.
- Commit nên ghi rõ Story/Task, ví dụ:

```text
feat(S-19): implement lot merge transaction
feat(S-22): implement idempotent 3-tier sample dataset with hand-checked answers
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

---

## Tính năng S-19 – Gộp lô hàng (Lot Merge)

Nghiệp vụ cho phép sáp nhập nhiều lô hàng cùng loại sản phẩm thành một lô lớn tập trung:
- **API Backend**: `POST /api/lots/merge`
  - Kiểm tra điều kiện đầu vào: tối thiểu 2 lô, cùng sản phẩm, cùng quyền quản lý của tổ chức, không có bàn giao PENDING, khối lượng lấy hợp lệ.
  - Chống deadlock (NFR): Tự động sắp xếp các mã lô cha tăng dần trước khi khoá dòng (`SELECT ... FOR UPDATE`).
  - Giao dịch nguyên tử: Trừ `remaining_quantity` của các lô mẹ, tạo lô mới, ghi liên kết vào bảng `batch_relations` (loại `MERGE`).
  - Bảo chứng mật mã: Ghi sự kiện `LOT_MERGED_FROM` vào chuỗi từng lô mẹ và `CREATED_FROM_MERGE` vào lô mới tạo với hash SHA-256 bất biến.
- **Frontend**:
  - Giao diện chọn nhiều lô (multi-select) trên `lots.html` kèm thanh tác vụ gộp nhanh dưới chân trang.
  - Modal gộp trực tiếp trên `lot-detail.html` kế thừa lô hiện tại.
  - Hiển thị danh sách đầy đủ tất cả các lô mẹ (`parentLots`) và các lô con (`childLots`) trong tab Nguồn gốc.

---

## Tính năng S-22 – Bộ dữ liệu mẫu 3 tầng có đáp án đếm tay

Cung cấp bộ dữ liệu mẫu độc lập qua 3 tầng (12 lô L01 đến L12) với đáp án tổ tiên/hậu duệ tính sẵn bằng tay để kiểm tra mọi thuật toán truy vấn phả hệ (S-21, S-26, S-27, S-28):
- **File seed SQL thực thi**: `db/seed_s22.sql` (100% idempotent với `ON CONFLICT DO UPDATE/DO NOTHING`).
- **3 tổ chức**: `ORG-A` (Hợp tác xã), `ORG-B` (Nhà máy sơ chế), `ORG-C` (Trung tâm phân phối).
- **Mô hình phả hệ 3 tầng**:
  ```text
  TẦNG 1:  L01   L02   L03   L04
             |    / \    |    |
             |   /   \   |    |
  TẦNG 2:  L05 L06   L07 L08 L09
               \      /   \  /
                \    /     \/
  TẦNG 3:       L10       L11 L12
  ```
- **Đáp án đếm tay độc lập**:
  - Tổ tiên: `L07={L01,L03}`, `L10={L05,L08,L02,L04}`, `L11={L06,L09,L02,L04}`, `L12={}`
  - Hậu duệ: `L01={L07}`, `L02={L05,L06,L10,L11}`, `L04={L08,L09,L10,L11}`, `L10={}`, `L12={}`
- **Chạy seed**:
  ```bash
  cd backend
  npm run seed:s22
  ```
- **API truy xuất phả hệ toàn diện**: `GET /api/lots/:id/genealogy`
  - Trả về `ancestorIds`, `descendantIds`, `ancestorCount`, `descendantCount` và đồ thị `graph` (nodes, edges) phục vụ sơ đồ phả hệ.
- **Báo cáo chi tiết**: Xem [docs/bao-cao-S22.md](docs/bao-cao-S22.md).

---

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

## Migration & Seed

Migration nằm tại:

```text
db/migrations/
db/migrations/down/
```

Chạy migration và seed thủ công:

```bash
docker compose exec backend npm run migrate:up
docker compose exec backend npm run migrate:down
docker compose exec backend npm run seed:s22
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
│   ├── migrations/
│   └── seed_s22.sql
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
