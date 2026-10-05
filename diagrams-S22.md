# Sơ đồ S-22

```text
                 S-19
                   |
                   v
             +-----------+
             | Seed Data |
             +-----------+
                   |
          +--------+--------+
          |                 |
       TÁCH LÔ            GỘP LÔ
          |                 |
          +--------+--------+
                   |
                   v
        3 tầng / >=12 lô
                   |
                   v
        +------------------+
        | Đáp án đếm tay   |
        | Ancestors        |
        | Descendants      |
        +------------------+
                   |
                   v
            Kiểm thử độc lập
```

## Chuỗi kiểm thử

```text
DB trống
  -> Seed lần 1
  -> Kiểm tra dữ liệu
  -> Đối chiếu đáp án vàng
  -> Seed lần 2
  -> So sánh
  -> PASS nếu không thay đổi
```
