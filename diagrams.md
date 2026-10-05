# DIAGRAMS — S-16

## Use Case Diagram

```mermaid
flowchart LR
    R[Bên nhận]
    A[API / Hệ thống]
    E[Chuỗi sự kiện]

    R --> U1((Xác nhận bàn giao))
    R --> U2((Từ chối bàn giao))
    R --> U3((Nhập lý do))
    A --> U4((Kiểm tra quyền))
    U1 --> E1((Ghi event xác nhận))
    U2 --> E2((Ghi event từ chối))
    U4 --> E3((403 nếu trái quyền))
