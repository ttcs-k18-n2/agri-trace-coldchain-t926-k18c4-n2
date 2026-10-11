# Báo cáo Story S-28 — Sơ đồ phả hệ dạng cây

**Dự án:** Agri Trace Cold Chain  
**Story:** S-28 — Sơ đồ phả hệ dạng cây, thu gọn được, bấm mở chi tiết lô  
**Nhánh dự kiến:** `s-28-VD`  
**Trạng thái báo cáo:** Bản dự thảo — cần chạy kiểm thử trên dự án thật trước khi xác nhận hoàn thành.

## 1. Mục tiêu

Xây dựng giao diện giúp người dùng theo dõi quan hệ nguồn gốc của một lô nông sản. Lô đang xem nằm ở trung tâm; tổ tiên (các lô nguồn) hiển thị về bên trái; hậu duệ (các lô được tạo ra từ lô hiện tại) hiển thị về bên phải.

## 2. Phạm vi chức năng

- Hiển thị lô đang xem cùng các lô tổ tiên và hậu duệ.
- Cho phép thu gọn/mở rộng từng nhánh.
- Cho phép chọn một lô để xem thông tin chi tiết.
- Hỗ trợ cuộn ngang trên màn hình nhỏ.
- Hiển thị thông báo phù hợp khi lô không có tổ tiên hoặc hậu duệ.

## 3. Tiêu chí nghiệm thu

| Mã | Tiêu chí | Cách kiểm tra |
|---|---|---|
| AC-01 | Lô hiện tại được làm nổi bật | Mở sơ đồ và xác định nút trung tâm |
| AC-02 | Tổ tiên ở bên trái, hậu duệ ở bên phải | Dùng dữ liệu mẫu có nhiều cấp |
| AC-03 | Thu gọn/mở rộng nhánh | Bấm nút Thu gọn/Mở rộng và kiểm tra các nút con |
| AC-04 | Mở chi tiết lô | Chọn một nút và kiểm tra bảng chi tiết |
| AC-05 | Có thể cuộn ngang trên màn hình hẹp | Thu nhỏ cửa sổ hoặc kiểm tra trên điện thoại |
| AC-06 | Không lỗi khi không có nhánh | Kiểm tra lô gốc và lô cuối chuỗi |

## 4. Kế hoạch kiểm thử

| Test ID | Trường hợp | Kết quả mong đợi |
|---|---|---|
| TC-01 | Mở sơ đồ với dữ liệu đầy đủ | Thấy tổ tiên, lô hiện tại và hậu duệ |
| TC-02 | Thu gọn một nhánh | Các nút con của nhánh được ẩn |
| TC-03 | Mở lại nhánh đã thu gọn | Các nút con xuất hiện trở lại |
| TC-04 | Chọn một lô | Bảng chi tiết hiển thị đúng mã, tên và trạng thái của dữ liệu mẫu |
| TC-05 | Lô không có tổ tiên | Sơ đồ vẫn hiển thị hợp lệ |
| TC-06 | Lô không có hậu duệ | Sơ đồ vẫn hiển thị hợp lệ |
| TC-07 | Màn hình hẹp | Người dùng có thể cuộn ngang để xem sơ đồ |
| TC-08 | Dữ liệu thực từ API | Đối chiếu dữ liệu trả về với sơ đồ; cần thực hiện trên môi trường dự án |

**Lưu ý kết quả:** Các trường hợp trên là kế hoạch kiểm thử. Chưa được coi là đã chạy hoặc đã đạt trên hệ thống thật. Cần tích hợp với API và chạy test trong repository trước khi ghi nhận kết quả cuối cùng.

## 5. Chạy bản minh họa

Mở file `s28-genealogy-demo.html` bằng trình duyệt. Bản này dùng dữ liệu mẫu độc lập để minh họa tương tác thu gọn/mở rộng và xem chi tiết; không thay thế việc tích hợp vào ứng dụng thật.

## 6. Tích hợp vào dự án

1. Kiểm tra cấu trúc frontend hiện có và thư viện giao diện đang dùng.
2. Tìm trang chi tiết lô và API truy xuất phả hệ hiện có.
3. Thay dữ liệu mẫu bằng dữ liệu từ API; xử lý loading, lỗi và trường hợp không có dữ liệu.
4. Thêm test tự động phù hợp với framework hiện có.
5. Chạy bộ test liên quan và ghi lại đầu ra thực tế.
6. Kiểm tra `git diff`, chỉ commit các file thuộc Story S-28.

## 7. Đưa báo cáo lên GitHub

Sao chép hai file trong thư mục `docs` vào thư mục `docs` của repository. Tại terminal, từ thư mục gốc repository, chạy:

```bash
git status
git switch s-28-VD
git add docs/S28-report.md docs/s28-genealogy-demo.html
git commit -m "docs(S-28): add genealogy story report and demo"
git push origin s-28-VD
```

Nếu `git switch s-28-VD` báo nhánh chưa tồn tại ở máy, hãy kiểm tra nhánh trước bằng `git branch -a` và chỉ chuyển sang nhánh đúng của bạn. Nếu `git commit` báo không có thay đổi, kiểm tra đường dẫn file và `git status`.

## 8. Kết luận

Gói này cung cấp báo cáo và bản minh họa tương tác ban đầu cho Story S-28. Story chỉ nên được đánh dấu hoàn thành sau khi code được tích hợp vào ứng dụng, dữ liệu lấy từ API thật, các kiểm thử liên quan chạy thành công và thay đổi được review/đẩy lên GitHub.
