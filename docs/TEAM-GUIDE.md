# Hướng dẫn GitHub cho thành viên — Main-only

Tài liệu này hướng dẫn thành viên nhóm **TTCS_T926_K18C4_N2** làm việc theo mô hình chỉ có một nhánh lâu dài là `main`.

## 1. Luồng làm việc

```text
main mới nhất
   ↓ tạo branch tạm
feature/fix/docs branch
   ↓ push
Pull Request vào main
   ↓ reviewer + CI
merge main
   ↓
xóa branch tạm
```

- `main` = nhánh tích hợp, demo, release và staging.
- Không có `develop`.
- Thành viên không code/push trực tiếp lên `main`.
- Mỗi công việc làm trên branch riêng rồi mở PR vào `main`.

## 2. Lần đầu lấy dự án

```bash
git clone https://github.com/ttcs-k18-n2/agri-trace-coldchain-t926-k18c4-n2.git
cd agri-trace-coldchain-t926-k18c4-n2
git checkout main
git pull origin main
```

## 3. Tạo branch để làm việc

Ví dụ làm S-13:

```bash
git checkout main
git pull origin main
git checkout -b feature/s2-s13-timeline
git push -u origin feature/s2-s13-timeline
```

Ví dụ làm S-15:

```bash
git checkout main
git pull origin main
git checkout -b feature/s2-s15-handover
git push -u origin feature/s2-s15-handover
```

Tên branch khuyến nghị:

```text
feature/s<sprint>-s<story>-<short-name>
fix/s<sprint>-s<story>-<short-name>
docs/<short-name>
```

Không đặt branch theo tên cá nhân.

## 4. Trước và trong khi code

Kiểm tra branch:

```bash
git branch
git status
```

Nếu `main` có code mới:

```bash
git fetch origin
git checkout <branch-cua-ban>
git merge origin/main
```

Nếu conflict, xử lý conflict rồi mới tiếp tục. Không tự xóa code người khác để hết conflict.

## 5. Commit và push

```bash
git status
git diff
git add .
git commit -m "feat(S-13): T-31 add timeline query"
git push
```

Có thể push nhiều commit lên cùng branch cho tới khi Story xong.

## 6. Tạo Pull Request

Trên GitHub:

```text
base: main
compare: <branch-cua-ban>
```

PR cần ghi:

- Sprint / Story / Task / Jira.
- Thay đổi đã làm.
- Acceptance Criteria.
- Cách kiểm tra.
- Kết quả test/CI.
- Ảnh nếu thay đổi UI.
- Blocker/dependency nếu còn.

## 7. Reviewer

Reviewer kiểm:

1. `Files changed`.
2. Đúng Story/Task và AC.
3. Test.
4. CI.
5. Secret/file nhạy cảm.
6. Conflict.
7. Rủi ro dữ liệu/bảo mật.

Nếu chưa đạt: **Request changes**.

Nếu đạt: **Approve**.

Approve không tự động gộp code. Sau khi đủ điều kiện, người có quyền merge mới bấm Merge.

## 8. Sau khi merge

Cập nhật máy:

```bash
git checkout main
git pull origin main
```

Branch đã merge có thể xóa:

```bash
git branch -d <branch>
git push origin --delete <branch>
```

Chỉ xóa khi chắc chắn code cần thiết đã merge hoặc không còn dùng.

## 9. Những điều không được làm

- Không push trực tiếp lên `main`.
- Không force-push `main`.
- Không tự merge khi CI đỏ, conflict hoặc chưa đủ review.
- Không commit `.env`, password, token, key, credential.
- Không sửa/xóa code ngoài phạm vi Story nếu không có lý do.
- Không xóa branch của người khác khi chưa chắc code đã được merge/backup.

## 10. Lệnh nhanh

```bash
git checkout main
git pull origin main
git checkout -b feature/s2-sXX-ten-ngan
# code...
git add .
git commit -m "feat(S-XX): T-XX mo ta"
git push -u origin feature/s2-sXX-ten-ngan
```

Sau đó:

```text
GitHub → New Pull Request
base: main
compare: feature/s2-sXX-ten-ngan
→ request reviewer
→ Approve
→ CI xanh
→ Merge
```

## 11. Staging

Branch tạm không deploy staging.

Khi PR merge vào `main`, workflow staging và Render theo branch `main` sẽ triển khai bản mới.
