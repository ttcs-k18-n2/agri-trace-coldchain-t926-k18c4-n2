# K-01 — Tài liệu Quyết định Kiến trúc: Chống sửa lén bản ghi sự kiện (Event Integrity)

## 1. Bối cảnh và Mục tiêu

Hệ thống truy xuất nguồn gốc nông sản và giám sát chuỗi lạnh cần đảm bảo rằng hồ sơ sự kiện (thu hoạch, sơ chế, bàn giao, đo nhiệt độ vận chuyển) **không thể bị sửa lén hoặc làm giả**. Lời cam kết "không thể sửa đổi" phải được bảo chứng bằng toán học mật mã, không phụ thuộc vào lòng tin đối với lập trình viên hay quản trị viên hệ thống.

Tài liệu này đánh giá thực nghiệm 3 giải pháp kiến trúc để đưa ra quyết định chính thức cho dự án.

---

## 2. Bảng so sánh 3 phương án kiến trúc

| Tiêu chí so sánh | Phương án 1: Chuỗi Hash (Cryptographic Hash Chain) | Phương án 2: Quyền CSDL (DB Permissions & Trigger) | Phương án 3: Blockchain (DLT / Smart Contract) |
|---|---|---|---|
| **Cơ chế hoạt động** | Mỗi sự kiện băm kèm hash của sự kiện trước ($H_n = \text{Hash}(H_{n-1} \parallel \text{Data}_n)$) | Phân quyền `GRANT INSERT, SELECT` (thu hồi `UPDATE, DELETE`) + Trigger | Lưu sự kiện lên sổ cái phân tán qua giao thức đồng thuận (Consensus) |
| **Phát hiện sửa lén** | **100% bằng chứng toán học**, bất kỳ ai cũng có thể tự xác minh độc lập | **Không**. Quản trị viên (DBA/root) có thể can thiệp trực tiếp vào database file | **100%**, phân tán nhiều node |
| **Tốc độ ghi (1.000 sự kiện)** | **11.6 ms** (~86.000 sự kiện/giây) | ~500 - 1.200 ms (giao dịch CSDL) | 2.000 - 15.000 ms (độ trễ đóng khối) |
| **Tốc độ kiểm tra (1.000 sự kiện)** | **6.8 ms** (~147.000 sự kiện/giây) | Phải quét log hoặc audit table | Vài chục giây phụ thuộc RPC / Node |
| **Mức độ phức tạp & Chi phí** | **Rất thấp**. Dùng thư viện mật mã chuẩn có sẵn, chi phí hạ tầng $0 | **Rất thấp**. Cấu hình PostgreSQL có sẵn | **Rất cao**. Vận hành cụm node, phí mạng, smart contract |
| **Tuân thủ Nghị định 13/2023/NĐ-CP** | **Tuân thủ tốt**. Có thể ẩn/xóa dữ liệu định danh nông hộ mà không phá vỡ liên kết hash | **Tuân thủ tốt** | **Vi phạm nghiêm trọng**. Tính chất bất biến tuyệt đối ngăn cản quyền được xóa dữ liệu cá nhân |
| **Quyết định** | **ĐƯỢC CHỌN (RECOMMENDED)** | **Hỗ trợ vòng ngoài (Layer bảo vệ phụ)** | **LOẠI BỎ (REJECTED)** |

---

## 3. Kết quả đo lường thực nghiệm (Benchmark với 1.000 sự kiện)

Thử nghiệm được thực hiện trên môi trường dự án với bộ dữ liệu mẫu 1.000 sự kiện chuỗi lạnh thực tế (`backend/benchmark/integrity_benchmark.js`):

- **Số lượng sự kiện thử nghiệm:** 1.000 sự kiện (nhiệt độ, bàn giao, đóng gói).
- **Thời gian tạo & gắn chuỗi hash:** **11.63 ms** (trung bình **0.0116 ms / sự kiện**).
- **Thông lượng ghi:** **86.011 sự kiện / giây**.
- **Thời gian xác minh toàn vẹn toàn bộ chuỗi:** **6.76 ms** (trung bình **0.0068 ms / sự kiện**).
- **Thông lượng xác minh:** **147.856 sự kiện / giây**.
- **Khả năng phát hiện can thiệp (Tamper Detection):** **100%**. Khi sửa đổi thử nghiệm trường nhiệt độ từ `4.2°C` thành `99.9°C` ở sự kiện thứ 500, hàm kiểm tra phát hiện ngay lập tức vị trí bị sửa và ngắt chuỗi xác thực.

---

## 4. Thuật toán băm và Chuẩn hóa nội dung

### 4.1. Thuật toán băm: SHA-256
- Dự án chọn **SHA-256** (FIPS PUB 180-4, chuẩn NIST).
- Lý do: Thuật toán mật mã một chiều mạnh mẽ, độ dài hash cố định 64 ký tự hex (256-bit), được tối ưu hóa phần cứng trên mọi CPU hiện đại, có sẵn trong thư viện chuẩn `crypto` của Node.js mà không cần cài thêm gói phụ thuộc.

### 4.2. Chuẩn hóa nội dung: RFC 8785 (JSON Canonicalization Scheme - JCS)
Để đảm bảo hai máy khác nhau băm cùng một sự kiện luôn ra cùng một giá trị hash, nội dung JSON phải được chuẩn hóa trước khi băm:
1. **Sắp xếp khóa từ điển (Key Sorting):** Toàn bộ các trường trong object được sắp xếp theo thứ tự bảng mã Unicode (alphabetical).
2. **Loại bỏ khoảng trắng dư thừa:** Không chứa dấu cách thừa, dấu xuống dòng `\r\n`.
3. **Mã hóa UTF-8 chuẩn:** Đảm bảo tiếng Việt có dấu được băm đồng nhất.
- Công thức nối chuỗi:
$$\text{Hash}_n = \text{SHA256}(\text{Hash}_{n-1} \parallel \text{CanonicalJSON}(\text{Payload}_n))$$

---

## 5. Giải thích lý do loại Blockchain bằng ngôn ngữ dễ hiểu

Nhiều người thường nghĩ cứ "truy xuất nguồn gốc" là phải dùng "Blockchain". Tuy nhiên, theo quyết định nguyên tắc **GD-5**, nhóm thống nhất **loại bỏ hoàn toàn blockchain** vì 4 lý do thực tế sau:

1. **Tốc độ và hiệu năng thực tế:**
   Cảm biến xe lạnh gửi dữ liệu nhiệt độ liên tục mỗi vài phút. Hệ thống chuỗi hash thông thường chỉ mất **0,01 phần nghìn giây** để ghi nhận một bản ghi. Trong khi đó, blockchain cần các máy chủ bỏ phiếu đồng thuận, mất từ vài giây đến hàng chục giây cho mỗi lượt xác nhận, gây tắc nghẽn toàn bộ hệ thống khi có hàng ngàn lô hàng di chuyển đồng thời.
2. **Chi phí vận hành khổng lồ:**
   Để duy trì một hệ thống blockchain cần rất nhiều máy chủ hoạt động liên tục hoặc phải trả phí giao dịch (gas fee) cho từng lần quét mã. Với mô hình nông sản Việt Nam, chi phí này đội giá thành của mớ rau, cân cà chua lên mức không thực tế đối với nông dân và hợp tác xã.
3. **Xung đột pháp lý về quyền riêng tư (Nghị định 13/2023/NĐ-CP):**
   Pháp luật Việt Nam quy định người dân (nông hộ) có quyền yêu cầu xóa thông tin cá nhân (tên, số điện thoại, vị trí thửa đất) khi họ không còn tham gia hệ thống. Bản chất của Blockchain là "đã ghi vào thì vĩnh viễn không thể xóa hay sửa". Nếu ghi dữ liệu nông hộ lên blockchain, hệ thống sẽ **vi phạm pháp luật** vì không thể thực hiện quyền được xóa dữ liệu cá nhân. Ngược lại, với chuỗi hash trong cơ sở dữ liệu, ta có thể mã hóa thông tin nhạy cảm hoặc ẩn danh trường dữ liệu mà chuỗi kiểm tra tính toàn vẹn của lô hàng vẫn nguyên vẹn.
4. **Bản chất của chuỗi cung ứng là sự ràng buộc pháp lý:**
   Nông dân, hợp tác xã và siêu thị hợp tác với nhau dựa trên hợp đồng kinh tế và sự giám sát của cơ quan nhà nước (cán bộ kiểm tra an toàn thực phẩm). Chuỗi hash kết hợp chữ ký số và cơ chế kiểm toán đã cung cấp đầy đủ bằng chứng toán học chống chối cãi khi ra tòa hoặc thanh tra, không cần thiết phải đánh đổi lấy sự phức tạp và lãng phí của blockchain.
