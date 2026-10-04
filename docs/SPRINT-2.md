# Sprint 2 - TTCS_T926_K18C4_N2

## Sprint Goal

**Lô thu hoạch được ghi nhận, bàn giao được, và lịch sử của nó không ai sửa lén được mà không bị phát hiện.**

- Sprint Jira: **N2 Sprint 2**
- Thời gian: **30/09/2026 - 07/10/2026**
- Tổng công việc hiện nằm trong Sprint: **21**
- `K-01` và `S-04` là công việc được kéo từ Sprint 1 sang Sprint 2 và vẫn tính trong phạm vi Sprint hiện tại.

## Branch Sprint 2

### `feature/s2-frontend`

Phụ trách giao diện và luồng tương tác người dùng:

- S-13 - dòng thời gian sự kiện
- S-14 - danh sách lô và tìm theo mã
- S-25 - trang chi tiết lô
- UI của S-07, S-08, S-15, S-16, S-24

### `feature/s2-backend`

Phụ trách API, nghiệp vụ, validation và giao dịch:

- S-04, S-07, S-08, S-09
- S-15, S-16
- S-17, S-18, S-19
- S-21, S-23, S-24, S-25

### `feature/s2-data-integrity`

Phụ trách migration, hash chain, chống sửa/xóa, kiểm tra toàn vẹn và dữ liệu kiểm thử:

- K-01
- S-10, S-11, S-12
- S-20
- S-22

> Một Story có thể có code ở nhiều branch. Cột “Branch chính” bên dưới chỉ thể hiện nơi chịu trách nhiệm chính.

## Danh sách 21 công việc trên Jira

| Jira | ID | Nội dung | Assignee | Trạng thái | Branch chính |
|---|---|---|---|---|---|
| N2-56 | K-01 | Chọn cách chống sửa lén bản ghi sự kiện | TRAN QUANG DU | Done | `feature/s2-data-integrity` |
| N2-57 | S-04 | Đăng nhập bằng email và mật khẩu, khoá tạm sau 5 lần sai | Nguyen Van Dung | Done | `feature/s2-backend` |
| N2-75 | S-10 | Mọi thay đổi của lô được ghi thành sự kiện nối tiếp có hash | HOANG TRANG HIEN | To Do | `feature/s2-data-integrity` |
| N2-76 | S-11 | Không đường nào trong ứng dụng sửa hay xoá được sự kiện đã ghi | NGUYEN THANH HAI | To Do | `feature/s2-data-integrity` |
| N2-77 | S-12 | Kiểm tra toàn vẹn chuỗi sự kiện của một lô chỉ ra đúng chỗ đứt mạch | PHAN NGO HUY HOANG | To Do | `feature/s2-data-integrity` |
| N2-78 | S-13 | Xem dòng thời gian sự kiện của một lô | DAM VIET HOANG | To Do | `feature/s2-frontend` |
| N2-79 | S-15 | Bàn giao lô sang tổ chức khác ở trạng thái chờ xác nhận | dtc245200406 | To Do | `feature/s2-backend` |
| N2-80 | S-16 | Bên nhận xác nhận hoặc từ chối bàn giao kèm lý do | Nguyen Van Dung | To Do | `feature/s2-backend` |
| N2-81 | S-07 | Khai báo danh mục sản phẩm và đơn vị tính | HOANG NGOC HUY | To Do | `feature/s2-backend` |
| N2-82 | S-08 | Ghi nhận lô thu hoạch với mã lô sinh tự động | TRAN QUANG DU | Done | `feature/s2-backend` |
| N2-83 | S-09 | Dữ liệu thu hoạch không hợp lệ bị chặn ở máy chủ | BUI DUY HUNG | Done | `feature/s2-backend` |
| N2-84 | S-14 | Danh sách lô tổ chức tôi đang giữ, tìm theo mã lô | HOANG TRANG HIEN | To Do | `feature/s2-frontend` |
| N2-85 | S-24 | Bàn giao quá hạn chưa xác nhận bị đánh dấu cho cả hai bên | HOANG TRANG HIEN | To Do | `feature/s2-backend` |
| N2-86 | S-23 | Lô có nguồn gốc từ tổ chức khác thì xem được phần lịch sử trước đó | NGUYEN THANH HAI | To Do | `feature/s2-backend` |
| N2-87 | S-25 | Trang chi tiết lô: sản phẩm, khối lượng còn lại, nơi giữ, lô mẹ và lô con trực tiếp | DAM VIET HOANG | To Do | `feature/s2-frontend` |
| N2-88 | S-17 | Tách một lô thành nhiều lô con | PHAN NGO HUY HOANG | To Do | `feature/s2-backend` |
| N2-89 | S-18 | Tổng khối lượng lô con không vượt lô mẹ, kể cả khi hai người tách cùng lúc | TRAN QUANG DU | To Do | `feature/s2-backend` |
| N2-90 | S-19 | Gộp nhiều lô cùng sản phẩm thành một lô lớn | BUI DUY HUNG | To Do | `feature/s2-backend` |
| N2-91 | S-20 | Sự kiện tách và gộp ghi vào chuỗi của mọi lô liên quan | dtc245200406 | To Do | `feature/s2-data-integrity` |
| N2-92 | S-21 | Truy ngược nguồn gốc: từ lô hiện tại về tới các lô thu hoạch gốc | HOANG TRANG HIEN | To Do | `feature/s2-backend` |
| N2-93 | S-22 | Bộ dữ liệu mẫu phả hệ ba tầng có đáp án đếm tay | Nguyen Van Dung | To Do | `feature/s2-data-integrity` |

## Trạng thái Git hiện tại

- S-07 + S-08 đã được tích hợp vào `develop` qua **PR #43**.
- Branch cũ `feature/s2-s07-s08-products-harvest` không còn commit riêng chưa vào `develop`.
- Ba branch làm việc chính của Sprint 2:
  - `feature/s2-frontend`
  - `feature/s2-backend`
  - `feature/s2-data-integrity`

## Quy ước commit

Commit phải ghi rõ Story hoặc Task:

```text
feat(S-13): add batch event timeline UI
feat(S-15): add pending transfer API
fix(S-09): reject future harvest date
test(S-12): detect modified event in hash chain
```

## Quy trình tích hợp

```text
feature/s2-frontend ---------\
feature/s2-backend -----------+--> PR --> develop --> PR --> main
feature/s2-data-integrity ----/
```

1. Không push thẳng vào `develop` hoặc `main`.
2. Đồng bộ branch với `develop` trước khi làm việc.
3. Push code lên branch Sprint 2 tương ứng.
4. Mở PR vào `develop`.
5. CI phải xanh.
6. Review đạt yêu cầu mới merge.
7. Khi bản tích hợp ổn định, merge `develop` sang `main` để release/staging theo workflow hiện tại.

## Lưu ý cập nhật tài liệu

Jira là nguồn theo dõi trạng thái thực thi. Bảng trên là snapshot khi tài liệu Sprint 2 được tạo; nếu trạng thái/assignee thay đổi thì cập nhật lại tài liệu trong PR phù hợp.
