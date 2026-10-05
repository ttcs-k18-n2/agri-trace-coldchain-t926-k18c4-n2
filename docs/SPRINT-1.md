# Sprint 1 — Hạ tầng + đăng nhập + thửa đất

> **Lưu ý workflow hiện tại (05/10/2026):** tài liệu này lưu lại cách thực thi lịch sử của Sprint 1. Repo hiện đã chuyển sang **main-only**: branch công việc tạm → Pull Request → review + CI → `main`. Không còn sử dụng `develop`. Quy trình hiện hành xem tại [WORKFLOW.md](WORKFLOW.md).


## 1. Sprint Goal

**Vùng trồng khai báo được thửa đất của mình trên môi trường staging chạy thật, và mọi thay đổi mã đều đi qua CI.**

**Capacity:** 12 SP.

Nguồn nghiệp vụ của Sprint này là Backlog Excel. Tài liệu này chỉ khai báo cách team thực thi trên GitHub và phân công theo Team Charter/Lịch 8 Sprint.

## 2. Mapping Story → branch → người

| Story | SP | Branch chính thức | Đầu mối nghiệp vụ | Hỗ trợ triển khai | Review chéo |
|---|---:|---|---|---|---|
| S-01 — Khung ứng dụng chạy được trên máy cá nhân bằng một lệnh | 2 | `feature/s1-s01-app-setup` | Nguyễn Viết Cường | Nguyễn Đức Dũng; Bùi Duy Hưng | Nguyễn Thanh Hải |
| S-02 — Pipeline CI chặn merge khi build, lint hoặc test đỏ | 1 | `feature/s1-s02-ci` | Nguyễn Viết Cường | Trần Quang Dự; Nguyễn Văn Dũng | Phan Ngô Huy Hoàng |
| S-03 — Merge vào nhánh tích hợp Sprint thì staging tự cập nhật | 2 | `feature/s1-s03-staging` | Nguyễn Viết Cường | Nguyễn Thanh Hải; Trần Quang Dự | Nguyễn Văn Dũng |
| K-01 — Chọn cách chống sửa lén bản ghi sự kiện | 2 | `docs/s1-k01-integrity` | Trần Quang Dự | Nguyễn Viết Cường; Phan Ngô Huy Hoàng | Nguyễn Thanh Hải |
| S-04 — Đăng nhập email/mật khẩu, khóa sau 5 lần sai | 2 | `feature/s1-s04-login` | Nguyễn Văn Dũng | Bùi Duy Hưng; Nguyễn Viết Cường | Trần Quang Dự |
| S-05 — Mỗi tổ chức chỉ thấy dữ liệu của mình | 2 | `feature/s1-s05-org-access` | Nguyễn Văn Dũng | Trần Quang Dự; Nguyễn Đức Dũng | Nguyễn Thanh Hải |
| S-06 — Vùng trồng khai báo thửa đất | 1 | `feature/s1-s06-farm` | Nguyễn Đức Dũng | Bùi Duy Hưng; Nguyễn Văn Dũng | Phan Ngô Huy Hoàng |

**Scrum Master:** Hoàng Trang Hiên — theo dõi Jira/Daily, branch, PR, CI, dependency, blocker và tích hợp; không thay người thực hiện.

## 3. Quy ước "nhánh chính" cho Sprint 1

Backlog dùng cụm từ "nhánh chính" trong S-02/S-03/T-04/T-06. Với repo này team quy ước:

- `develop` = **nhánh tích hợp chính của Sprint**, được bảo vệ bởi CI và ruleset, nhận PR từ các nhánh Story sau khi qua review.
- `main` = **nhánh triển khai staging & release**, chỉ nhận PR từ `develop` khi các Story đã được review và kiểm tra; pipeline tự động đóng gói Docker image và triển khai môi trường staging khi có thay đổi trên `main`.

Nhờ vậy từng Story sau khi hoàn tất trên `develop` được kiểm tra kỹ lưỡng trước khi đồng bộ sang `main` để kích hoạt triển khai staging tự động.

## 4. Task Sprint 1

### S-01 — `feature/s1-s01-app-setup`

**T-01 — Khởi tạo dự án và `docker-compose.yml` có PostgreSQL**

- `docker-compose.yml` có ứng dụng và PostgreSQL.
- Có `.env.example` liệt kê biến cần thiết.
- `.env` không commit.
- Máy mới chỉ có Docker + Git có thể chạy dự án bằng lệnh trong README.

**T-02 — Migration đầu tiên và lệnh khởi động ghi trong README**

- Chốt công cụ/quy ước migration.
- Migration tiến và lùi được.
- README có mục "Chạy dự án" với một lệnh chính.
- Thành viên khác làm theo README chạy được mà không phải hỏi người viết.

### S-02 — `feature/s1-s02-ci`

**T-03 — Cấu hình pipeline chạy build, lint, test trên mỗi push/PR**

- Pipeline chạy build, lint, test; typecheck được thêm khi stack có bước này.
- Commit cố ý sai lint/test phải làm pipeline đỏ.
- Commit sạch phải xanh.

**T-04 — Bật luật bảo vệ nhánh tích hợp: CI xanh và một người duyệt**

- `develop` không cho push trực tiếp.
- PR CI đỏ không merge được.
- PR chưa có ít nhất một approval từ người khác không merge được.
- Người tạo PR không dùng approval của chính mình thay review chéo.
- `main` áp dụng cùng nguyên tắc vì là nhánh release.

### S-03 — `feature/s1-s03-staging`

**T-05 — Dockerfile đóng gói ứng dụng thành image**

- Image chạy độc lập với thư mục source.
- Không chứa `.env` hay tool build không cần thiết ở runtime.
- Có thể truy vết image về commit qua nhãn (LABEL/ARG `GIT_COMMIT`).

**T-06 — Pipeline triển khai staging từ main**

- Sau khi PR từ `develop` được merge vào `main`, pipeline tự động đóng gói Docker image, đẩy lên registry và triển khai staging.
- Migration chạy trước khi bản mới nhận request.
- Secret triển khai (SSH, Registry) lưu trong GitHub Secrets, không nằm trong repo.
- Thay đổi nhìn thấy được phải xuất hiện trên staging trong giới hạn AC của Backlog.

**T-07 — Health check và rollback**

- Có endpoint health kiểm kết nối cần thiết (`/health`, `/api/health`).
- Pipeline kiểm health sau deploy.
- Bản mới lỗi không thay bản đang chạy; tự động khôi phục (rollback) về bản trước và pipeline báo đỏ.
- Health endpoint không lộ thông tin cấu hình nhạy cảm.

### K-01 — `docs/s1-k01-integrity`

Spike timebox 1 ngày công, so sánh:

- Chuỗi hash trong bảng thường.
- Quyền cơ sở dữ liệu chặn sửa/xóa.
- Blockchain.

Đầu ra bắt buộc:

- Một trang tài liệu quyết định.
- Thử với 1000 sự kiện và ghi số đo.
- Nêu thuật toán băm và cách chuẩn hóa nội dung.
- Giải thích lý do loại blockchain bằng ngôn ngữ người không chuyên.
- Không biến mã thử nghiệm thành mã sản phẩm nếu chưa có Story triển khai.

### S-04 — `feature/s1-s04-login`

**T-08 — Bảng `organizations`, `users`, `roles` + migration + seed 7 vai trò**

- Migration tiến/lùi được.
- `users.email` unique.
- Seed chạy lại không tạo trùng.
- Mật khẩu đủ chỗ cho hash Argon2id.
- `organization_id` có chỉ mục.

**T-09 — Form đăng nhập, Argon2id, tạo phiên**

- Dùng thư viện Argon2id của stack, không tự cài thuật toán.
- Đăng nhập đúng tạo phiên.
- Sai email và sai mật khẩu trả thông báo chung như nhau.

**T-10 — Khóa 15 phút sau 5 lần sai**

- Lưu số lần sai và thời điểm khóa.
- Đăng nhập thành công reset số lần sai.
- Sau 5 lần sai, lần tiếp theo bị khóa kể cả mật khẩu đúng.
- Hết 15 phút mới đăng nhập lại được.
- Thời gian khóa là cấu hình, không hard-code.

### S-05 — `feature/s1-s05-org-access`

**T-11 — Middleware tổ chức/vai trò, mặc định từ chối**

- Đọc phiên và gắn `organization_id` + role vào request context.
- Route chưa khai quyền trả 403.
- Cán bộ kiểm tra có quyền đọc theo quy định nhưng không được ghi.

**T-12 — Lớp truy vấn tự lọc `organization_id`**

- Truy vấn nghiệp vụ dùng hàm/lớp chung.
- Không có context tổ chức thì ném lỗi, không trả toàn bộ dữ liệu.
- Bảng dùng chung phải khai báo rõ ngoại lệ.

**T-13 — Test tích hợp truy cập chéo tổ chức**

- Tạo hai tổ chức và dữ liệu riêng.
- Đọc của mình trả 200.
- Đọc dữ liệu tổ chức khác trả 403.
- Test chạy trong CI và tự dọn dữ liệu.

### S-06 — `feature/s1-s06-farm`

**T-14 — Bảng `farms` gắn tổ chức + migration**

- Có tên, diện tích, tọa độ, khóa ngoại tổ chức.
- Migration tiến/lùi được.
- Có index `organization_id`.
- Diện tích > 0 ở tầng cơ sở dữ liệu.

**T-15 — Form tạo/sửa và danh sách thửa**

- Tạo, sửa, xem danh sách chạy trên staging.
- Danh sách chỉ hiện thửa thuộc tổ chức hiện tại.
- Diện tích 0 bị chặn.
- Lỗi hiện tại đúng trường.
- Chặn gửi form hai lần liên tiếp.

## 5. Definition of Done Sprint 1

Áp dụng đúng DoD của Backlog:

- Code review bởi ít nhất một thành viên khác.
- Unit test cho logic mới; coverage phần thay đổi không giảm.
- CI xanh: build, lint, typecheck, test.
- Không có secret trong source; dependency scan sạch.
- Acceptance Criteria pass trên staging, không chỉ local.
- Story chạm sự kiện lô: integrity chain vẫn hợp lệ.
- Story chạm phả hệ: dataset có đáp án đếm tay + ca chu trình.
- Story chạm khối lượng: test hai giao dịch đồng thời.
- Không log dữ liệu định danh nông hộ.
- README cập nhật nếu thay đổi hành vi công khai hoặc thêm biến môi trường.

## 6. Definition of Ready

- Đủ nhỏ để Done trong Sprint.
- Dependency ngoài đã có cam kết.
- AC dạng Giả sử / Khi / Thì khi phù hợp.
- Team đã ước lượng SP.
- Team hiểu Story.
- Task cho team thực tập được chẻ nhỏ, mục tiêu ≤ nửa ngày.

## 7. Cách team sử dụng tài liệu này

- Mỗi người chỉ code trên branch Story được phân công.
- Task không tạo branch riêng; commit ghi T-xx.
- Hỗ trợ có thể cùng làm trên Story branch nhưng đầu mối chịu trách nhiệm theo dõi AC.
- Reviewer là người kiểm PR; không thay người thực hiện.
- Scrum Master quan sát tiến độ, blocker, dependency, PR, CI và staging.
- Mọi Story branch PR vào `develop`.
- Cuối Sprint mới PR `develop -> main`.
