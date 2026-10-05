# Sprint 2 - TTCS_T926_K18C4_N2

## Sprint Goal

**Lô thu hoạch được ghi nhận, bàn giao được, và lịch sử của nó không ai sửa lén được mà không bị phát hiện.**

- Sprint Jira: **N2 Sprint 2**
- Thời gian: **30/09/2026 - 07/10/2026**
- Phạm vi chuẩn của tài liệu này: các Story mang label **`sprint-2`**
- Tổng: **10 Story / 20 SP**

> Jira Sprint field hiện có một số Story mang label `sprint-3`. Các Story đó không được tính vào phạm vi Sprint 2 trong tài liệu này.

## Phạm vi Sprint 2

| Jira | Story | Nội dung | SP | Assignee | Trạng thái Jira |
|---|---|---|---:|---|---|
| N2-81 | S-07 | Khai báo danh mục sản phẩm và đơn vị tính | 1 | HOANG NGOC HUY | Done |
| N2-82 | S-08 | Ghi nhận lô thu hoạch với mã lô sinh tự động | 3 | TRAN QUANG DU | Done |
| N2-83 | S-09 | Dữ liệu thu hoạch không hợp lệ bị chặn ở máy chủ | 1 | BUI DUY HUNG | Done |
| N2-75 | S-10 | Mọi thay đổi của lô được ghi thành sự kiện nối tiếp có hash | 3 | HOANG TRANG HIEN | Done |
| N2-76 | S-11 | Không đường nào trong ứng dụng sửa hay xoá được sự kiện đã ghi | 1 | NGUYEN THANH HAI | Done |
| N2-77 | S-12 | Kiểm tra toàn vẹn chuỗi sự kiện của một lô chỉ ra đúng chỗ đứt mạch | 3 | PHAN NGO HUY HOANG | Done |
| N2-78 | S-13 | Xem dòng thời gian sự kiện của một lô | 2 | DAM VIET HOANG | To Do |
| N2-84 | S-14 | Danh sách lô tổ chức tôi đang giữ, tìm theo mã lô | 2 | HOANG TRANG HIEN | Done |
| N2-79 | S-15 | Bàn giao lô sang tổ chức khác ở trạng thái chờ xác nhận | 2 | dtc245200406 | To Do |
| N2-80 | S-16 | Bên nhận xác nhận hoặc từ chối bàn giao kèm lý do | 2 | Nguyen Van Dung | Done* |

**Tiến độ Jira:** 8/10 Story = **16/20 SP (80%)**.

`S-16` đang được Jira đánh Done nhưng phụ thuộc vào S-15 đang To Do. Trước khi chốt Sprint cần kiểm tra lại luồng S-15 → S-16 trên code/staging.

## Story ngoài phạm vi Sprint 2

Các Story **S-17 → S-25** mang label `sprint-3` và không được tính vào Sprint 2, kể cả khi Jira Sprint field tạm thời đang hiển thị chúng trong N2 Sprint 2.

S-23 đã có code và Jira Done nhưng vẫn thuộc nhóm label `sprint-3`.

K-01 và S-04 là công việc Sprint 1/carry-over; không tính vào 20 SP cốt lõi của Sprint 2 ở bảng trên.

## Git workflow của Sprint 2

Repo sử dụng **main-only**:

```text
main
 ├─ feature/s2-s13-timeline
 ├─ feature/s2-s15-handover
 └─ fix/s2-...

branch tạm --> PR --> review + CI --> main
```

Không sử dụng `develop`.

Quy trình:

1. `git checkout main && git pull origin main`
2. Tạo branch tạm theo Story.
3. Code + test + commit có mã Story/Task.
4. Push branch.
5. Mở PR với base `main`.
6. CI build/lint/test phải xanh.
7. Có review/approval theo ruleset.
8. Merge vào `main`.
9. Kiểm staging sau merge; xóa branch tạm khi không còn dùng.

## Công việc ưu tiên còn lại

1. **S-13** — hoàn thiện timeline sự kiện của lô.
2. **S-15** — hoàn thiện bàn giao lô trạng thái chờ.
3. **S-16** — re-check end-to-end sau khi S-15 hoàn tất.
4. Chốt Acceptance Criteria, CI và staging trước khi kết thúc Sprint.

## Quy ước commit

```text
feat(S-13): add batch event timeline UI
feat(S-15): add pending handover API
fix(S-09): reject future harvest date
test(S-12): detect modified event in hash chain
```

## Lưu ý cập nhật

Jira là nguồn theo dõi trạng thái thực thi. Khi status/assignee/SP thay đổi, cập nhật tài liệu trong PR phù hợp.
