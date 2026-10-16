# Sprint 2 - TTCS_T926_K18C4_N2

> **Lưu ý quy trình Git hiện tại:** tài liệu Sprint này có các thông tin lịch sử từ giai đoạn nhóm từng dùng `develop`/branch dùng chung. Từ quy trình hiện tại, **không dùng `develop` và không dùng ba branch Sprint dùng chung cho công việc mới**. Mọi Story mới tạo branch từ `main`, mở Pull Request trực tiếp vào `main`. Xem [WORKFLOW.md](WORKFLOW.md).

## Sprint Goal

**Lô thu hoạch được ghi nhận, bàn giao được, và lịch sử của nó không ai sửa lén được mà không bị phát hiện.**

- Sprint Jira: **N2 Sprint 2**
- Thời gian: **30/09/2026 - 07/10/2026**
- Jira là nguồn chuẩn cho trạng thái/assignee hiện tại.

## Quy tắc branch đang áp dụng

Mỗi Story dùng branch riêng:

```text
feature/s<sprint>-s<story>-<short-name>
fix/s<sprint>-s<story>-<short-name>
```

Ví dụ:

```text
feature/s3-s17-split-lots
feature/s3-s19-merge-lots
fix/s3-s24-overdue-badge
```

Luồng:

```text
main mới nhất
   ↓
Story branch
   ↓
code + test + push
   ↓
Pull Request vào main
   ↓
CI + review
   ↓
main
   ↓
staging
```

Không push trực tiếp vào `main`.

## Danh sách công việc

Danh sách dưới đây là **snapshot lịch sử khi tài liệu Sprint được lập**. Trạng thái hiện tại phải xem trên Jira, không dùng bảng này để kết luận Done/To Do.

| Jira | ID | Nội dung |
|---|---|---|
| N2-56 | K-01 | Chọn cách chống sửa lén bản ghi sự kiện |
| N2-57 | S-04 | Đăng nhập bằng email và mật khẩu, khoá tạm sau 5 lần sai |
| N2-75 | S-10 | Mọi thay đổi của lô được ghi thành sự kiện nối tiếp có hash |
| N2-76 | S-11 | Không đường nào trong ứng dụng sửa hay xoá được sự kiện đã ghi |
| N2-77 | S-12 | Kiểm tra toàn vẹn chuỗi sự kiện của một lô chỉ ra đúng chỗ đứt mạch |
| N2-78 | S-13 | Xem dòng thời gian sự kiện của một lô |
| N2-79 | S-15 | Bàn giao lô sang tổ chức khác ở trạng thái chờ xác nhận |
| N2-80 | S-16 | Bên nhận xác nhận hoặc từ chối bàn giao kèm lý do |
| N2-81 | S-07 | Khai báo danh mục sản phẩm và đơn vị tính |
| N2-82 | S-08 | Ghi nhận lô thu hoạch với mã lô sinh tự động |
| N2-83 | S-09 | Dữ liệu thu hoạch không hợp lệ bị chặn ở máy chủ |
| N2-84 | S-14 | Danh sách lô tổ chức tôi đang giữ, tìm theo mã lô |
| N2-85 | S-24 | Bàn giao quá hạn chưa xác nhận bị đánh dấu cho cả hai bên |
| N2-86 | S-23 | Lô có nguồn gốc từ tổ chức khác thì xem được phần lịch sử trước đó |
| N2-87 | S-25 | Trang chi tiết lô: sản phẩm, khối lượng còn lại, nơi giữ, lô mẹ và lô con trực tiếp |
| N2-88 | S-17 | Tách một lô thành nhiều lô con |
| N2-89 | S-18 | Tổng khối lượng lô con không vượt lô mẹ, kể cả khi hai người tách cùng lúc |
| N2-90 | S-19 | Gộp nhiều lô cùng sản phẩm thành một lô lớn |
| N2-91 | S-20 | Sự kiện tách và gộp ghi vào chuỗi của mọi lô liên quan |
| N2-92 | S-21 | Truy ngược nguồn gốc: từ lô hiện tại về tới các lô thu hoạch gốc |
| N2-93 | S-22 | Bộ dữ liệu mẫu phả hệ ba tầng có đáp án đếm tay |

## Quy ước commit hiện tại

```text
feat(S-13): add batch event timeline UI
feat(S-15): add pending transfer API
fix(S-24): fix overdue transfer badge
test(S-19): verify merge rollback
```

Có thể ghi cả Task khi cần:

```text
feat(S-19/T-44): add merge transaction
```

## Bắt đầu Story

```bash
git fetch origin
git switch main
git pull origin main
git switch -c feature/s<sprint>-s<story>-<short-name>
```

Sau khi hoàn thành:

```bash
git add .
git commit -m "feat(S-XX): mô tả ngắn"
git push -u origin <story-branch>
```

Sau đó tạo PR:

```text
base: main
compare: <story-branch>
```

CI xanh + review đạt + Acceptance Criteria đạt mới merge.

## Tài liệu áp dụng

- [WORKFLOW.md](WORKFLOW.md): quy trình đầy đủ.
- [TEAM-GUIDE.md](TEAM-GUIDE.md): hướng dẫn nhanh cho thành viên.
- Jira: trạng thái/assignee hiện tại.
- Backlog Excel: AC, dependency, NFR, DoD/DoR.
