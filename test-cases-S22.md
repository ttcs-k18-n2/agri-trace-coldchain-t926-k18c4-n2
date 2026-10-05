# Test Cases — S-22

| ID | Mục tiêu | Tiền điều kiện | Thao tác | Expected |
|---|---|---|---|---|
| TC22-01 | Seed dữ liệu | DB trống | Chạy seed | >=12 lô, 3 tầng, 3 tổ chức |
| TC22-02 | Tách | Seed hoàn tất | Kiểm tra quan hệ tách | Quan hệ cha-con đúng |
| TC22-03 | Gộp | Seed hoàn tất | Kiểm tra quan hệ gộp | Quan hệ nhiều nguồn đúng |
| TC22-04 | Idempotent | Đã seed lần 1 | Chạy seed lần 2 | Không phát sinh bản ghi trùng |
| TC22-05 | Ancestors | Có đáp án vàng | Tra một lô | Khớp đáp án viết tay |
| TC22-06 | Descendants | Có đáp án vàng | Tra một lô | Khớp đáp án viết tay |
| TC22-07 | Ba tổ chức | Seed hoàn tất | Kiểm tra owner/org | Đủ 3 tổ chức |
| TC22-08 | Độc lập đáp án | Có đáp án vàng | Đối chiếu với truy vấn | Đáp án không được sinh từ code đang test |
