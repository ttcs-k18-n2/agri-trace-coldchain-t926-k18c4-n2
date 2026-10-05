# Development Workflow — Main-only

Tài liệu này quy định cách team làm việc trên GitHub cho toàn dự án. Phạm vi nghiệp vụ, SP, AC và DoD/DoR vẫn lấy từ Backlog Excel/Jira.

## 1. Mô hình branch

Repo chỉ có một nhánh lâu dài:

- `main`: nhánh tích hợp, release, demo và staging.

Các nhánh còn lại chỉ là **branch làm việc tạm thời** và được tạo từ `main`:

- `feature/s<sprint>-s<story>-<short-name>`: phát triển Story.
- `fix/s<sprint>-s<story>-<short-name>`: sửa lỗi.
- `docs/<short-name>`: thay đổi tài liệu/quy trình.

Không sử dụng `develop`.

```text
main
 ├─ feature/...
 ├─ fix/...
 └─ docs/...
       ↓
   Pull Request
       ↓
 review + CI
       ↓
      main
```

## 2. Quy tắc đặt tên branch

Ví dụ:

```text
feature/s2-s13-timeline
feature/s2-s15-handover
fix/s2-s14-search
docs/main-only-workflow
```

Không đặt branch theo tên thành viên. Một Story có thể có nhiều Task nhưng ưu tiên một Story branch; Task được truy vết bằng commit.

## 3. Bắt đầu công việc

Luôn bắt đầu từ `main` mới nhất:

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b feature/s2-s13-timeline
```

Nếu branch đã có trên GitHub:

```bash
git fetch origin
git checkout -b <branch> origin/<branch>
```

Nếu `main` có thay đổi mới trong lúc đang làm:

```bash
git fetch origin
git checkout <branch>
git merge origin/main
```

Giải quyết conflict trước khi tiếp tục.

## 4. Commit và push

```bash
git status
git diff
git add .
git commit -m "feat(S-13): T-31 add timeline query"
git push -u origin <branch>
```

Loại commit:

```text
feat:     thêm/chỉnh chức năng
fix:      sửa lỗi
docs:     tài liệu
refactor: đổi cấu trúc code, không đổi hành vi
test:     test
chore:    CI/cấu hình
```

## 5. Pull Request

Mọi PR đều có:

```text
base: main
compare: <branch-tạm>
```

PR phải nêu:

- Sprint, Story, Task, Jira liên quan.
- Mô tả thay đổi.
- Acceptance Criteria đã đáp ứng.
- Cách kiểm tra.
- Kết quả test/CI.
- Ảnh chụp nếu thay đổi UI.
- Dependency/blocker còn lại nếu có.

## 6. Review và merge

Reviewer:

1. Đọc `Files changed`.
2. Đối chiếu Story/Task và Acceptance Criteria.
3. Kiểm tra test.
4. Kiểm tra CI.
5. Kiểm tra rủi ro bảo mật/dữ liệu.
6. Request changes nếu chưa đạt; Approve nếu đạt.

Không merge khi:

- CI đỏ.
- Còn conflict.
- Chưa có approval theo ruleset.
- Acceptance Criteria chưa đạt.
- Có secret/file nhạy cảm.
- Thay đổi cần staging nhưng chưa có kế hoạch kiểm tra sau merge.

Repo **không tự động merge PR**. Merge chỉ thực hiện sau khi review/CI đạt yêu cầu.

## 7. Sau khi merge

Sau khi PR đã vào `main`:

```bash
git checkout main
git pull origin main
```

Branch tạm có thể xóa nếu không còn sử dụng. Xóa branch không làm mất code đã merge vào `main`.

## 8. CI/CD và staging

- Push vào `main`, `feature/**`, `fix/**`, `docs/**`: CI chạy.
- Pull Request vào `main`: CI chạy.
- Các check hiện tại: **build, lint, test**.
- Story branch không tự triển khai staging.
- Push/merge vào `main` kích hoạt `.github/workflows/staging.yml`.
- `render.yaml` cũng deploy theo `main`.
- Migration chạy trước khi bản mới nhận request theo cấu hình deploy.
- Health check thất bại phải làm pipeline báo lỗi/rollback theo cơ chế staging.
- Secret chỉ nằm trong GitHub/Render secrets, không commit vào repo.

## 9. Branch protection cho main

`main` phải được bảo vệ:

- Không push trực tiếp đối với thành viên thông thường.
- Bắt buộc Pull Request.
- Yêu cầu ít nhất 1 approval.
- Yêu cầu các check bắt buộc xanh: build, lint, test.
- Không merge khi còn conflict.
- Không force-push.
- Không cho xóa `main`.

Admin chỉ bypass trong trường hợp khẩn cấp và phải có lý do rõ ràng.

## 10. Definition of Done áp dụng khi review

- Review bởi ít nhất một thành viên khác khi ruleset yêu cầu.
- Unit/integration test cho logic mới phù hợp.
- CI xanh: build, lint, test.
- Không có secret.
- Acceptance Criteria đạt.
- Không log dữ liệu định danh nông hộ.
- README/tài liệu cập nhật khi đổi hành vi công khai, workflow hoặc biến môi trường.
- Story đặc thù phải có test integrity/graph/concurrency tương ứng theo Backlog.

## 11. Quy tắc ngắn gọn cho thành viên

```text
pull main mới nhất
→ tạo branch
→ code + test
→ push branch
→ PR vào main
→ reviewer Approve
→ CI xanh
→ merge main
→ xóa branch tạm
```
