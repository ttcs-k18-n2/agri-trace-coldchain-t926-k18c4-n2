# Hướng dẫn GitHub cho thành viên

Tài liệu này dành cho thành viên nhóm **TTCS_T926_K18C4_N2** để biết cách lấy dự án về máy, làm đúng Story branch, đẩy code lên GitHub và tạo Pull Request.

## 1. Luồng làm việc của nhóm

```text
Máy cá nhân
   ↓ git push
Story branch
   ↓ Pull Request + reviewer
develop
   ↓ cuối Sprint, kiểm tra tổng thể
Pull Request
   ↓
main
```

Hiểu ngắn gọn:

- `git push` = đưa code từ máy lên **Story branch** của mình trên GitHub.
- Pull Request Story = xin ghép Story branch vào `develop`.
- `develop` = nơi tích hợp code của cả Sprint và triển khai staging.
- `main` = bản ổn định/demo/release; chỉ nhận từ `develop` vào cuối Sprint.
- Không code trực tiếp trên `develop` hoặc `main`.

## 2. Branch Sprint 1 và người phụ trách

| Story | Branch | Đầu mối | Hỗ trợ | Reviewer |
|---|---|---|---|---|
| S-01 | `feature/s1-s01-app-setup` | Nguyễn Viết Cường | Nguyễn Đức Dũng, Bùi Duy Hưng | Nguyễn Thanh Hải |
| S-02 | `feature/s1-s02-ci` | Nguyễn Viết Cường | Trần Quang Dự, Nguyễn Văn Dũng | Phan Ngô Huy Hoàng |
| S-03 | `feature/s1-s03-staging` | Nguyễn Viết Cường | Nguyễn Thanh Hải, Trần Quang Dự | Nguyễn Văn Dũng |
| K-01 | `docs/s1-k01-integrity` | Trần Quang Dự | Nguyễn Viết Cường, Phan Ngô Huy Hoàng | Nguyễn Thanh Hải |
| S-04 | `feature/s1-s04-login` | Nguyễn Văn Dũng | Bùi Duy Hưng, Nguyễn Viết Cường | Trần Quang Dự |
| S-05 | `feature/s1-s05-org-access` | Nguyễn Văn Dũng | Trần Quang Dự, Nguyễn Đức Dũng | Nguyễn Thanh Hải |
| S-06 | `feature/s1-s06-farm` | Nguyễn Đức Dũng | Bùi Duy Hưng, Nguyễn Văn Dũng | Phan Ngô Huy Hoàng |

Một Story dùng **một branch**. Không tạo branch riêng cho từng Task và không đặt branch theo tên thành viên.

## 3. Lần đầu lấy dự án về máy

Cài Git trước, sau đó mở Terminal/PowerShell:

```bash
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git fetch origin
```

Clone repo nghĩa là lấy **toàn bộ cấu trúc dự án** về máy. Sau đó chỉ checkout đúng Story branch được giao.

Ví dụ làm S-04:

```bash
git checkout -b feature/s1-s04-login origin/feature/s1-s04-login
```

Kiểm tra:

```bash
git branch
```

Phải thấy:

```text
* feature/s1-s04-login
```

Nếu branch đã có ở local thì chỉ cần:

```bash
git checkout feature/s1-s04-login
```

## 4. Trước khi bắt đầu code

Luôn lấy code mới nhất từ GitHub và đồng bộ phần đã được merge vào `develop`:

```bash
git fetch origin
git checkout <story-branch>
git pull origin <story-branch>
git merge origin/develop
```

Ví dụ S-04:

```bash
git fetch origin
git checkout feature/s1-s04-login
git pull origin feature/s1-s04-login
git merge origin/develop
```

Nếu có conflict thì dừng lại xử lý conflict trước khi code tiếp. Không tự xóa code người khác chỉ để hết conflict.

## 5. Code phần được giao

Mọi người đều nhìn thấy toàn bộ project:

```text
.github/
backend/
frontend/
docs/
README.md
...
```

Nhưng chỉ sửa file cần thiết cho Story/Task của mình.

Trước khi commit phải kiểm tra:

```bash
git status
git diff
```

Nếu thấy file không liên quan bị sửa thì kiểm tra lại trước khi commit.

## 6. Commit và push

Sau khi hoàn thành một phần công việc:

```bash
git add .
git commit -m "feat: T-xx mô tả ngắn"
git push origin <story-branch>
```

Ví dụ:

```bash
git add .
git commit -m "feat: T-09 add login session"
git push origin feature/s1-s04-login
```

Lần sau nếu upstream đã được thiết lập thì có thể dùng:

```bash
git push
```

Quy ước commit:

```text
feat:     thêm/chỉnh chức năng
fix:      sửa lỗi
docs:     tài liệu
refactor: đổi cấu trúc code, không đổi hành vi
test:     thêm/sửa test
chore:    CI, cấu hình, việc kỹ thuật
```

Ưu tiên ghi mã Task trong commit, ví dụ:

```text
feat: T-01 add docker compose
test: T-13 reject cross-organization access
docs: K-01 document integrity decision
```

## 7. Khi Story chưa xong

Có thể push nhiều lần lên cùng Story branch:

```text
máy cá nhân
→ commit 1
→ push
→ code tiếp
→ commit 2
→ push
→ ...
```

Push **không làm code tự vào `develop` hoặc `main`**. Nó chỉ cập nhật Story branch trên GitHub.

## 8. Khi Story đã xong: tạo Pull Request

Trên GitHub chọn:

```text
base: develop
compare: <story-branch>
```

Ví dụ:

```text
base: develop
compare: feature/s1-s04-login
```

Không chọn `main` làm base cho Story PR.

PR phải ghi:

- Story/Task/Jira liên quan.
- Thay đổi đã làm.
- Acceptance Criteria đã đáp ứng.
- Cách kiểm tra.
- Kết quả test/CI.
- Ảnh nếu thay đổi UI.
- Blocker/dependency nếu còn.

## 9. Reviewer làm gì?

Reviewer mở PR và kiểm:

1. `Files changed`.
2. Story/Task có đúng phạm vi không.
3. Acceptance Criteria.
4. Test và CI.
5. Secret/file nhạy cảm.
6. Conflict.
7. Staging nếu Story yêu cầu.

Nếu chưa đạt: **Request changes**.

Nếu đạt: **Approve**.

Sau khi đủ điều kiện mới merge Story branch vào `develop`.

## 10. Sau khi merge vào develop

Khi PR được merge:

```text
Story branch
   ↓
develop
```

Code của Story trở thành một phần của bản tích hợp Sprint.

Story branch khác muốn lấy phần mới này thì chạy:

```bash
git fetch origin
git checkout <story-branch>
git merge origin/develop
```

## 11. Cuối Sprint mới vào main

Sau khi các Story hoàn thành và `develop` đã được test/CI/staging:

```text
develop
   ↓ Pull Request cuối Sprint
main
```

Không merge từng Story trực tiếp vào `main`.

`main` là bản ổn định dùng cho demo/release.

## 12. Những điều không được làm

- Không code trực tiếp trên `main`.
- Không code trực tiếp trên `develop`.
- Không tạo branch theo tên cá nhân.
- Không tạo branch riêng cho mỗi Task nếu Story branch đã có.
- Không mở Story PR vào `main`.
- Không commit `.env`, password, token, key hoặc secret.
- Không sửa/xóa code của Story khác nếu không có lý do rõ ràng.
- Không merge khi CI đỏ, còn conflict hoặc chưa có review.

## 13. Lệnh nhanh để thành viên copy

Lần đầu:

```bash
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git fetch origin
git checkout -b <story-branch> origin/<story-branch>
```

Mỗi lần bắt đầu làm:

```bash
git fetch origin
git checkout <story-branch>
git pull origin <story-branch>
git merge origin/develop
```

Sau khi code:

```bash
git status
git diff
git add .
git commit -m "feat: T-xx mô tả ngắn"
git push origin <story-branch>
```

Khi Story xong:

```text
GitHub → Pull Request
base: develop
compare: <story-branch>
→ request reviewer
→ approve
→ merge vào develop
```

Cuối Sprint:

```text
develop → Pull Request → main
```

## 14. Khi gặp lỗi

Nếu chưa chắc mình đang ở branch nào:

```bash
git branch
```

Nếu muốn xem file nào đã thay đổi:

```bash
git status
```

Nếu muốn xem nội dung thay đổi:

```bash
git diff
```

Nếu Git báo conflict, push bị từ chối hoặc không checkout được branch: chụp nguyên màn hình/lỗi Terminal và gửi vào nhóm trước khi tự xử lý mạnh tay.
