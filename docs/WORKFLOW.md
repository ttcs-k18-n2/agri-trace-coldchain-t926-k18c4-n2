# Development Workflow

Tài liệu này quy định cách team làm việc trên GitHub cho toàn dự án. Phạm vi nghiệp vụ, SP, AC và DoD/DoR vẫn lấy từ Backlog Excel.

## 1. Vai trò của các branch

- `main`: phiên bản ổn định dùng cho demo/release.
- `develop`: nhánh tích hợp chính của Sprint; mọi Story đã review được merge vào đây.
- `feature/s<sprint>-s<story>-<short-name>`: phát triển Story.
- `fix/s<sprint>-s<story>-<short-name>`: sửa lỗi của Story.
- `docs/s<sprint>-k<spike>-<short-name>`: Spike/tài liệu kỹ thuật.
- `docs/s<sprint>-<short-name>`: tài liệu quản lý Sprint.

Trong repo này, khi Backlog dùng cụm từ **"nhánh chính"** cho CI/CD của Sprint thì team quy ước `develop` là **nhánh tích hợp chính của Sprint**; `main` là **nhánh triển khai staging & release**. Sau khi các Story trên `develop` được kiểm tra, PR vào `main` sẽ kích hoạt pipeline tự động triển khai staging.

## 2. Cấu trúc tên branch

Mẫu:

```text
feature/s<sprint>-s<story>-<short-name>
fix/s<sprint>-s<story>-<short-name>
docs/s<sprint>-k<spike>-<short-name>
docs/s<sprint>-<short-name>
```

Sprint 1:

```text
feature/s1-s01-app-setup
feature/s1-s02-ci
feature/s1-s03-staging
docs/s1-k01-integrity
feature/s1-s04-login
feature/s1-s05-org-access
feature/s1-s06-farm
```

Khi sang Sprint 2 chỉ thay số Sprint/Story, không đổi cách đặt tên.

Tên branch không chứa tên thành viên. Khi đổi người phụ trách, branch vẫn giữ nguyên.

## 3. Story và Task

Một Story có thể có nhiều Task nhưng dùng **một Story branch**.

Ví dụ:

```text
S-01
├── T-01 Khởi tạo dự án + Docker Compose + PostgreSQL
└── T-02 Migration đầu tiên + hướng dẫn chạy

=> feature/s1-s01-app-setup
```

Task được truy vết bằng commit:

```text
feat: T-01 add docker compose with PostgreSQL
feat: T-02 add initial migration and setup guide
```

Không tạo branch `T-01`, `T-02` riêng nếu các Task cùng thuộc một Story.

## 4. Lấy dự án về máy và bắt đầu làm Story

### 4.1. Thành viên clone repo lần đầu

Mỗi thành viên clone **toàn bộ repository** về máy. Sau đó chỉ checkout đúng Story branch được giao để làm việc.

```bash
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git fetch origin
git checkout -b <story-branch> origin/<story-branch>
```

Ví dụ người được giao S-04:

```bash
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git fetch origin
git checkout -b feature/s1-s04-login origin/feature/s1-s04-login
```

Kiểm tra đang đứng đúng branch:

```bash
git branch
```

Dòng có dấu `*` phải là Story branch được giao.

### 4.2. Đồng bộ code mới từ `develop`

Trước khi bắt đầu hoặc tiếp tục một Story:

```bash
git fetch origin
git checkout <story-branch>
git pull origin <story-branch>
git merge origin/develop
```

Nhờ vậy thành viên vẫn nhận được phần code mới đã được các Story khác merge vào `develop`, nhưng commit tiếp theo trên Story branch chỉ ghi nhận những thay đổi mà thành viên thực sự sửa.

Nếu branch chưa có ở local nhưng đã tồn tại trên GitHub:

```bash
git checkout -b <story-branch> origin/<story-branch>
```

Không tạo branch mới theo tên cá nhân hoặc Task nếu Story branch chính thức đã tồn tại trên GitHub. Không code trực tiếp trên `develop` hoặc `main`.

## 5. Commit và push

```bash
git add .
git commit -m "feat: T-xx mô tả ngắn"
git push origin <story-branch>
```

Loại commit:

```text
feat:     thêm/chỉnh chức năng
fix:      sửa lỗi
docs:     tài liệu
refactor: cấu trúc code, không đổi hành vi
test:     test
chore:    CI, cấu hình, công việc kỹ thuật
```

## 6. Pull Request

Luồng bình thường:

```text
<story-branch> -> develop
```

Cuối Sprint:

```text
develop -> main
```

PR phải có:

- Story và Task liên quan.
- Mô tả thay đổi.
- Acceptance Criteria nào được đáp ứng.
- Cách kiểm tra.
- Kết quả test/CI.
- Kết quả kiểm tra trên staging khi áp dụng.
- Ảnh chụp nếu có thay đổi giao diện.
- Dependency/blocker còn lại nếu có.

Mẫu tiêu đề:

```text
[S-02] Configure CI pipeline
[S-04] Add login and lockout
```

## 7. Review và merge

Reviewer:

1. Đọc `Files changed`.
2. Đối chiếu Story/Task và Acceptance Criteria.
3. Kiểm tra test.
4. Kiểm tra CI.
5. Kiểm tra rủi ro bảo mật/dữ liệu nếu có.
6. Request changes khi chưa đạt; Approve khi đạt.

Không merge khi:

- CI đỏ.
- Còn conflict.
- Chưa có ít nhất một người khác review.
- Acceptance Criteria chưa đạt.
- Có secret/file nhạy cảm bị commit.
- Story yêu cầu staging nhưng chưa kiểm trên staging.

Người tạo PR không tự tính review của mình thay cho review chéo.

## 8. CI/CD và staging

Mục tiêu Sprint 1 yêu cầu CI và staging chạy thật.

- Push/PR: chạy build, lint, typecheck và test theo cấu hình dự án.
- Story branch không tự triển khai staging.
- Khi thay đổi được đưa vào `main` (qua PR từ `develop`), pipeline của `main` tự động đóng gói image và triển khai staging.
- Migration phải chạy trước khi bản mới nhận request.
- Health check thất bại thì giữ/khôi phục bản cũ và pipeline báo đỏ.
- Secret triển khai nằm trong CI secret, không commit vào repo.
- `main` chỉ nhận bản Sprint đã tích hợp ổn định.

## 9. Branch protection

Ít nhất `develop` phải được bảo vệ trong Sprint 1 để đáp ứng S-02:

- Không push trực tiếp.
- Yêu cầu CI xanh.
- Yêu cầu ít nhất 1 approval từ người khác.
- Không merge khi còn conflict.

`main` cũng nên áp dụng cùng mức bảo vệ vì là nhánh ổn định/release.

## 10. Definition of Done áp dụng khi review

- Review bởi ít nhất một thành viên khác.
- Unit test cho logic mới; coverage phần thay đổi không giảm.
- CI xanh: build, lint, typecheck, test.
- Không có secret; dependency scan sạch.
- AC pass trên staging.
- Không log dữ liệu định danh nông hộ.
- README cập nhật khi đổi hành vi công khai hoặc biến môi trường.
- Các Story đặc thù phải có test integrity/graph/concurrency tương ứng theo Backlog.

## 11. Branch cũ

Các branch thử nghiệm theo Jira Task hoặc theo tên thành viên tạo trong giai đoạn setup không còn là quy ước chính thức.

Thành viên chỉ bắt đầu công việc mới trên branch theo **Sprint + Story**. Branch cũ chỉ được giữ tạm nếu còn dữ liệu cần đối chiếu, sau đó xóa.
