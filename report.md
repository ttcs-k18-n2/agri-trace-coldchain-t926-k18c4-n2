# BÁO CÁO S-16

## 1. Tổng quan

S-16 xây dựng cơ chế để bên nhận chủ động xác nhận hoặc từ chối một bản giao. Mục tiêu chính là tránh việc một lô hàng bị ghi nhận là đã nhận khi bên nhận thực tế chưa nhận hàng.

## 2. Phân tích yêu cầu

### 2.1. Actor chính
- **Bên nhận:** xác nhận hoặc từ chối bàn giao.
- **API/Hệ thống:** kiểm tra quyền và ghi nhận sự kiện.
- **Bên giao:** là bên đang giữ lô khi chờ xác nhận.

### 2.2. Business rules

1. Chỉ bên nhận hợp lệ mới được xác nhận.
2. Xác nhận thành công làm chuyển quyền giữ lô sang bên nhận.
3. Từ chối không làm chuyển quyền.
4. Từ chối bắt buộc có lý do.
5. Lý do từ chối phải được lưu vào chuỗi sự kiện.
6. Người không thuộc tổ chức nhận không được gọi API xác nhận và phải nhận HTTP 403.
7. Chức năng phụ thuộc vào S-15.

## 3. Thiết kế luồng

### Trường hợp xác nhận

```text
Bản giao
   ↓
Kiểm tra người nhận
   ↓
Người nhận chọn "Xác nhận"
   ↓
Chuyển quyền giữ lô
   ↓
Ghi sự kiện xác nhận
   ↓
Hoàn tất
```

### Trường hợp từ chối

```text
Bản giao
   ↓
Người nhận chọn "Từ chối"
   ↓
Nhập lý do
   ↓
Lý do rỗng?
 ┌──────┴──────┐
Có            Không
 ↓              ↓
Chặn          Giữ lô ở bên giao
               ↓
         Ghi lý do vào chuỗi
```

## 4. Kiểm soát phân quyền API

Khi API nhận yêu cầu xác nhận, hệ thống cần kiểm tra:
- Người gọi là ai.
- Người gọi thuộc tổ chức nào.
- Bản giao đang dành cho tổ chức nào.
- Người gọi có quyền thao tác hay không.

Nếu không đúng tổ chức nhận:

**HTTP 403 Forbidden**

## 5. Kết quả mong đợi

Sau khi hoàn thành S-16:
- Không thể tự ý chuyển trách nhiệm lô hàng sang bên nhận.
- Bên nhận có quyền xác nhận rõ ràng.
- Bên nhận có quyền từ chối và phải nêu lý do.
- Lịch sử xác nhận/từ chối được lưu thành sự kiện.
- API hạn chế truy cập trái phép.

## 6. Rủi ro và xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Từ chối không có lý do | Validate bắt buộc trước khi gửi |
| Người ngoài tổ chức gọi API | Kiểm tra quyền, trả 403 |
| Xác nhận nhưng không chuyển quyền | Test transaction và trạng thái lô |
| Sự kiện không được ghi | Kiểm tra event log sau thao tác |
| Gọi lại nhiều lần | Kiểm tra trạng thái bản giao trước khi xử lý |

## 7. Kết luận

S-16 hoàn thiện quy trình bàn giao theo hướng có xác nhận của bên nhận, bảo đảm trách nhiệm đối với lô hàng chỉ được chuyển khi bên nhận thực sự chấp thuận.
