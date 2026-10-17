# TÀI LIỆU PHÂN LOẠI DỮ LIỆU CÔNG KHAI VÀ NỘI BỘ (DATA CLASSIFICATION SPECIFICATION)
## Story S-48 (Jira N2-117): Trang công khai chỉ trả về trường được đánh dấu công khai
### Subtasks: N2-229 (Backend), N2-230 (Tester/Security), N2-281 (Security/Backend)

---

## 1. NGUYÊN TẮC THIẾT KẾ & BẢO MẬT (SECURITY ARCHITECTURE)

1. **Default-Deny (Mặc định từ chối):**
   - Toàn bộ cơ sở dữ liệu và thuộc tính nghiệp vụ mặc định là dữ liệu nội bộ (Internal/Confidential).
   - Chỉ những trường được định nghĩa minh bạch trong Danh mục Cho phép (`PUBLIC_*_ALLOWLIST` tại `backend/src/public_allowlist.js`) mới được phép tuần tự hóa và trả về cho người tiêu dùng.

2. **Cơ chế kiểm soát tại tầng Backend (Backend Enforcement):**
   - Tuyệt đối không chỉ ẩn dữ liệu bằng HTML/CSS trên giao diện Frontend.
   - Hàm tuần tự hóa đệ quy `sanitizePublicTracePayload` được thực thi ở tầng Backend trước khi gửi phản hồi HTTP JSON, triệt tiêu mọi khả năng rò rỉ qua DevTools Network tab hoặc API scraping.

3. **Bảo vệ bí mật kinh doanh & thông tin thương mại nhạy cảm:**
   - **Tuyệt đối KHÔNG xuất khối lượng:** `initialQuantity`, `remainingQuantity`, `weight`, `volume`, `area`.
   - **Tuyệt đối KHÔNG xuất giá bán/nhập:** `price`, `importPrice`, `exportPrice`, `unitPrice`, `totalAmount`.
   - **Che giấu tên đối tác trung gian:** Không tiết lộ tên công ty thương mại cụ thể của các đơn vị trung gian (ví dụ: công ty logistics, tổng kho tư nhân, nhà phân phối trung gian). Chỉ hiển thị tên theo danh mục vai trò chuẩn hóa (Role Types): `Hợp tác xã`, `Đơn vị vận chuyển`, `Nhà phân phối`, `Kho bảo quản`.

4. **Ngoại lệ Vùng trồng gốc & HTX sản xuất (Producer Exception):**
   - Theo đặc thù truy xuất nguồn gốc nông sản và yêu cầu Jira, tên cơ sở sản xuất / Hợp tác xã ban đầu tại vùng trồng gốc (`farmName`, `organizationName`) được phép hiển thị công khai để người tiêu dùng xác thực xuất xứ vùng trồng.

5. **Bảo vệ tọa độ riêng tư nông hộ (S-06 / N2-290):**
   - Không xuất tọa độ GPS chi tiết của thửa đất riêng tư hoặc sai số GPS nội bộ.
   - Chỉ xuất tọa độ tâm khu vực hành chính cấp xã/phường (`commune`/`district`/`province`) đại diện cho vùng trồng.

---

## 2. BẢNG PHÂN LOẠI CHI TIẾT CÁC THỰC THỂ & TRƯỜNG DỮ LIỆU

### A. Thực thể Lô hàng (`Lot`)

| Trường dữ liệu | Kiểu dữ liệu | Phân loại | Public API | Quy tắc xử lý & Lý do bảo mật |
| :--- | :--- | :--- | :---: | :--- |
| `code` / `id` | String | **Public** | **CÓ** | Mã truy xuất công khai in trên tem nhãn / mã QR (ví dụ: `LOT-001`). |
| `name` | String | **Public** | **CÓ** | Tên mô tả lô nông sản phục vụ nhận diện. |
| `status` | String | **Public** | **CÓ** | Trạng thái vòng đời sản phẩm (ví dụ: `Đang lưu kho`, `Đã thu hoạch`). |
| `productName` | String | **Public** | **CÓ** | Tên loại nông sản (ví dụ: Cà chua VietGAP, Chè Tân Cương). |
| `productUnit` | String | **Public** | **CÓ** | Đơn vị tính nông sản (hộp, kg, túi). |
| `organizationName` | String | **Public** | **CÓ** | Tên HTX / Nông trại sản xuất ban đầu (Ngoại lệ vùng trồng theo Jira). |
| `harvestedAt` | ISO String | **Public** | **CÓ** | Thời gian thu hoạch minh bạch chất lượng cho người tiêu dùng. |
| `isMerged` | Boolean | **Public** | **CÓ** | Đánh dấu lô đơn nguồn hay lô gộp nhiều nguồn gốc. |
| `recall` | Object | **Public** | **CÓ** | Cảnh báo thu hồi nông sản (S-49). |
| `coldChain` | Object | **Public** | **CÓ** | Trạng thái tuân thủ chuỗi lạnh (S-49). |
| `safetyStatus` | String | **Public** | **CÓ** | Đánh giá an toàn tổng thể (S-49). |
| `initialQuantity` | Number | **Confidential** | **KHÔNG** | Khối lượng ban đầu là bí mật thương mại sản lượng. |
| `remainingQuantity` | Number | **Confidential** | **KHÔNG** | Khối lượng tồn kho là bí mật kinh doanh. |
| `price` / `cost` | Number | **Confidential** | **KHÔNG** | Giá bán, giá vốn nội bộ không được công khai. |
| `organizationId` | UUID / String | **Internal** | **KHÔNG** | Mã định danh tổ chức nội bộ trong CSDL. |
| `farmId` | UUID / String | **Internal** | **KHÔNG** | Mã định danh nông trại nội bộ. |
| `productId` | UUID / String | **Internal** | **KHÔNG** | Khóa ngoại sản phẩm nội bộ. |
| `locationId` | UUID / String | **Internal** | **KHÔNG** | Khóa ngoại vị trí kho nội bộ. |
| `parentLotId` | UUID / String | **Internal** | **KHÔNG** | Mã định danh quan hệ cha con trong CSDL. |
| `actorUserId` | UUID / String | **Internal** | **KHÔNG** | Danh tính nhân viên thực hiện thao tác. |
| `createdBy` / `updatedBy`| UUID / String | **Internal** | **KHÔNG** | Thông tin người tạo bản ghi. |
| `createdAt` / `updatedAt`| ISO String | **Internal** | **KHÔNG** | Dấu thời gian kỹ thuật hệ thống. |

---

### B. Vùng trồng gốc (`Origins`)

| Trường dữ liệu | Kiểu dữ liệu | Phân loại | Public API | Quy tắc xử lý & Lý do bảo mật |
| :--- | :--- | :--- | :---: | :--- |
| `farmName` | String | **Public** | **CÓ** | Tên vùng trồng/nông trại gốc (Ngoại lệ vùng trồng theo Jira). |
| `organizationName` | String | **Public** | **CÓ** | Tên HTX phụ trách vùng trồng. |
| `regionName` | String | **Public** | **CÓ** | Tên khu vực hành chính (ví dụ: Xã La Bằng, Huyện Đại Từ). |
| `commune` | String | **Public** | **CÓ** | Xã/phường vùng trồng. |
| `district` | String | **Public** | **CÓ** | Huyện/quận vùng trồng. |
| `province` | String | **Public** | **CÓ** | Tỉnh/thành phố vùng trồng. |
| `coordinates` | `{lat, lng}` | **Public** | **CÓ** | Tọa độ đại diện cấp xã (S-06), đã làm sạch sai số thửa đất. |
| `hasCoordinates` | Boolean | **Public** | **CÓ** | Cờ kiểm tra trạng thái số hóa tọa độ. |
| `verified` | Boolean | **Public** | **CÓ** | Đã xác thực tọa độ qua danh mục hành chính chuẩn. |
| `harvestedAt` | ISO String | **Public** | **CÓ** | Ngày thu hoạch tại vùng trồng. |
| `area` / `farmArea` | Number | **Confidential** | **KHÔNG** | Diện tích thửa đất/quy mô nông hộ không được công khai. |
| `originLotId` | UUID / String | **Internal** | **KHÔNG** | Mã định danh kỹ thuật của lô gốc trong phả hệ. |
| `farmId` | UUID / String | **Internal** | **KHÔNG** | ID nội bộ bảng farms. |
| `rawCoordinates` | Object | **Confidential** | **KHÔNG** | Tọa độ GPS thửa đất chi tiết cần bảo vệ quyền riêng tư. |
| `farmerPhone` / `contact` | String | **Confidential** | **KHÔNG** | Số điện thoại cá nhân người nông dân. |

---

### C. Mốc hành trình chuỗi cung ứng (`Journey Milestones`)

| Trường dữ liệu | Kiểu dữ liệu | Phân loại | Public API | Quy tắc xử lý & Lý do bảo mật |
| :--- | :--- | :--- | :---: | :--- |
| `step` | Number | **Public** | **CÓ** | Số thứ tự chặng hành trình từ 1..N. |
| `type` | String | **Public** | **CÓ** | Phân loại mốc (`farm`, `cold_storage`, `transit`, `store`). |
| `typeLabel` | String | **Public** | **CÓ** | Nhãn tiếng Việt thân thiện với người tiêu dùng. |
| `title` | String | **Public** | **CÓ** | Tiêu đề chặng (đối tác trung gian chỉ hiển thị theo loại). |
| `locationName` | String | **Public** | **CÓ** | Tên địa điểm điểm đến/lưu kho. |
| `organizationName` | String | **Public** | **CÓ** | **Chỉ hiển thị loại vai trò:** `Hợp tác xã`, `Đơn vị vận chuyển`, `Nhà phân phối`, `Kho bảo quản`. |
| `address` | String | **Public** | **CÓ** | Địa chỉ công cộng của kho/điểm phân phối. |
| `coordinates` | `{lat, lng}` | **Public** | **CÓ** | Tọa độ điểm kho/phân phối đã công khai. |
| `hasCoordinates` | Boolean | **Public** | **CÓ** | Trạng thái hiển thị trên bản đồ số. |
| `verified` | Boolean | **Public** | **CÓ** | Điểm đã chứng thực trên hệ thống. |
| `occurredAt` | ISO String | **Public** | **CÓ** | Thời gian ghi nhận sự kiện chuyển giao hoặc lưu kho. |
| `description` | String | **Public** | **CÓ** | Mô tả hành trình thân thiện. |
| `isOrigin` | Boolean | **Public** | **CÓ** | Phân biệt điểm xuất phát hay chặng trung gian. |
| `isTransfer` | Boolean | **Public** | **CÓ** | Đánh dấu chặng vận chuyển trung gian. |
| `isCurrentLocation` | Boolean | **Public** | **CÓ** | Đánh dấu vị trí hiện tại của lô nông sản. |
| `hasViolation` | Boolean | **Public** | **CÓ** | Cờ cảnh báo vi phạm chuỗi lạnh (S-49). |
| `warning` | String | **Public** | **CÓ** | Thông điệp cảnh báo trung tính (S-49). |
| `locationId` | UUID / String | **Internal** | **KHÔNG** | Mã địa điểm nội bộ CSDL. |
| `organizationId` | UUID / String | **Internal** | **KHÔNG** | Mã tổ chức nội bộ. |
| `driverPhone` | String | **Confidential** | **KHÔNG** | Số điện thoại tài xế xe lạnh. |
| `vehiclePlate` | String | **Internal** | **KHÔNG** | Biển số xe vận chuyển nội bộ. |
| `driverName` | String | **Confidential** | **KHÔNG** | Tên tài xế riêng tư. |
| `notes` / `internalAudit` | String | **Internal** | **KHÔNG** | Biên bản giao nhận hoặc ghi chú nội bộ. |

---

### D. Tuyến đường sơ đồ hóa (`Routes`) & Tổng hợp (`Summary`)

| Trường dữ liệu | Kiểu dữ liệu | Phân loại | Public API | Quy tắc xử lý & Lý do bảo mật |
| :--- | :--- | :--- | :---: | :--- |
| `fromStep` / `toStep` | Number | **Public** | **CÓ** | Liên kết thứ tự giữa hai mốc hành trình. |
| `fromTitle` / `toTitle` | String | **Public** | **CÓ** | Tiêu đề đoạn di chuyển. |
| `coordinates` | Array of `[lng, lat]` | **Public** | **CÓ** | Tuyến đường sơ đồ nối các điểm đã xác minh. |
| `isSchematic` | Boolean | **Public** | **CÓ** | Luôn `true` để người dùng hiểu đây là sơ đồ chuỗi cung ứng. |
| `summary.totalOrigins` | Number | **Public** | **CÓ** | Tổng số vùng trồng gốc tham gia. |
| `summary.totalStops` | Number | **Public** | **CÓ** | Tổng số mốc hành trình. |
| `summary.verifiedStops` | Number | **Public** | **CÓ** | Số điểm đã định vị. |
| `summary.unverifiedStops` | Number | **Public** | **CÓ** | Số điểm chưa định vị. |
| `summary.disclaimer` | String | **Public** | **CÓ** | Tuyên bố miễn trừ trách nhiệm pháp lý và bảo vệ quyền riêng tư nông hộ. |
| `secretRouteDistanceKm`| Number | **Internal** | **KHÔNG** | Độ dài tuyến đường vận chuyển chi tiết nội bộ. |
| `serverUptime` / `debug`| Object | **Internal** | **KHÔNG** | Dữ liệu hạ tầng máy chủ. |

---

## 3. DANH MỤC TRUY VẾT & CHỨNG THỰC (VERIFICATION CHECKLIST)

- [x] **Khai báo tập trung:** Tệp `backend/src/public_allowlist.js` là nơi duy nhất khai báo danh sách cho phép (Allowlist).
- [x] **Backend Whitelisting:** Hàm `sanitizePublicTracePayload` áp dụng tuần tự hóa sâu cho toàn bộ API công khai `/api/public/lots/:code/*`.
- [x] **Zero Quantities:** Loại bỏ hoàn toàn `initialQuantity`, `remainingQuantity`, `area`, `weight`.
- [x] **Zero Commercial Pricing:** Không có bất kỳ trường giá cả nào xuất hiện trong JSON công khai.
- [x] **Masked Partner Names:** Tên đối tác trung gian được ánh xạ về danh mục vai trò (`Hợp tác xã`, `Đơn vị vận chuyển`, `Nhà phân phối`, `Kho bảo quản`).
- [x] **No Internal PII / IDs:** Toàn bộ UUIDs, số điện thoại, biển số xe, hash mật khẩu, email nội bộ bị loại bỏ hoàn toàn.
- [x] **Test tự động bao phủ:** Bộ kiểm thử `backend/test/s48_public_fields.test.js` kiểm tra 100% các tiêu chí trên (10/10 PASS).
