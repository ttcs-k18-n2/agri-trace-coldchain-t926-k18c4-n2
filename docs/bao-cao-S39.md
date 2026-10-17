# BÁO CÁO S-39 – BỘ DỮ LIỆU THU HỒI MẪU BỐN TẦNG, BA TỔ CHỨC, CÓ ĐÁP ÁN ĐẾM TAY

## 1. Thông tin Backlog

- **Backlog ID:** S-39
- **Mã Jira:** N2-106
- **Loại nguồn:** Story
- **Epic:** E-06 — Thu hồi lô hàng (Batch Recall)
- **Tier:** Next
- **Priority backlog:** Must
- **Sprint:** 5
- **Owner:** Cả nhóm
- **Dependencies:** S-22 (Bộ dữ liệu mẫu phả hệ), S-29 (Nhà phân phối ghi nhận lô đã bán hết/tiêu thụ)

---

## 2. User Story & Mục tiêu

> **Là thành viên phát triển**, tôi muốn một kịch bản thu hồi mẫu có đáp án đếm tay để thuật toán liệt kê thu hồi được kiểm bằng đáp án độc lập.

**Mục tiêu cốt lõi:**
Trước khi xây dựng các thuật toán khoanh vùng thu hồi, tính toán khối lượng hàng hóa thất thoát và gửi cảnh báo người tiêu dùng, hệ thống cần một **bộ dữ liệu mẫu chuẩn (benchmark dataset)** mở rộng qua **bốn tầng (4 tiers)** và **ba tổ chức (3 organizations)**, có các mắt xích tách lô (`SPLIT`), gộp lô đa nguồn (`MERGE`), và lô đã tiêu thụ tới tay người dùng cuối (`status = 'Đã bán hết'`, `remaining_quantity = 0`, kèm sự kiện `LOT_CONSUMED` được ký băm SHA-256).

---

## 3. Tiêu chí nghiệm thu (Acceptance Criteria & NFR)

### AC1 – Đồ thị bốn tầng, ba tổ chức, gộp đa nguồn & có lô đã tiêu thụ
Khi chạy script seed, cơ sở dữ liệu phải tạo lập được đồ thị bốn tầng qua ba tổ chức với ít nhất một lô gộp từ nhiều nguồn và một lô đã tiêu thụ.

### AC2 – Tệp đáp án đếm tay độc lập từ hai người
Khi mở tệp đáp án và tra theo lô gốc, hiển thị danh sách đầy đủ các hậu duệ và khối lượng còn lại từng lô do **hai người đếm độc lập** (không sinh bằng mã của thuật toán đang kiểm thử). Phân định rõ:
1. **Lô còn tồn kho / trên kệ** (`remaining_quantity > 0`): Đối tượng thu hồi khẩn cấp tại kho/quầy.
2. **Lô đã tiêu thụ tới người dùng** (`remaining_quantity = 0`, `status = 'Đã bán hết'`): Đối tượng phát thông báo cảnh báo tiêu dùng.

### NFR – Đáp án viết trước khi có mã (như S-22)
Đáp án đếm tay và bảng chỉ số kỳ vọng phải được ghi lại trong tài liệu trước khi xây dựng mã kiểm thử và thuật toán thu hồi, đảm bảo tính khách quan và ngăn chặn lỗi "đúng giả".

### Tính Idempotent & Bảo chứng mật mã
- Chạy script seed nhiều lần không làm tăng số lượng bản ghi, không gây lỗi trùng lặp (`ON CONFLICT DO UPDATE`).
- 100% bản ghi sự kiện `batch_events` tuân thủ chuỗi băm mật mã SHA-256 nối chuỗi (`K-01 / S-10`).

---

## 4. Mô hình đồ thị phả hệ bốn tầng (S-39 Graph Architecture)

### 4.1. Ba tổ chức tham gia chuỗi cung ứng
1. **ORG-A:** Hợp tác xã Nông nghiệp A (Cooperative - Nông trại / Vùng trồng)
2. **ORG-B:** Nhà máy/đơn vị sơ chế B (Producer - Nhà máy sơ chế & chế biến)
3. **ORG-C:** Trung tâm phân phối & Bán lẻ C (Distributor - Hệ thống kho & siêu thị bán lẻ)

### 4.2. Sơ đồ luồng đồ thị qua 4 tầng

```text
TẦNG 1 (Gốc):     R01 [ORG-A]             R02 [ORG-A]         R03 [ORG-B]
                  /       \                   |                   |
               (SPLIT)  (SPLIT)             (SPLIT)             (SPLIT)
                /           \                 |                   |
TẦNG 2:       R04 [ORG-B]  R05 [ORG-B]     R06 [ORG-B]         R07 [ORG-B]
                \             |            /       \              /
              (MERGE)      (SPLIT)     (MERGE)   (MERGE)      (MERGE)
                  \           |         /            \          /
TẦNG 3:            R08 [ORG-B]      R09 [ORG-C]       R10 [ORG-C]
                  /         \            |                 |
               (SPLIT)   (SPLIT)      (SPLIT)           (SPLIT)
                /             \          |                 |
TẦNG 4:   R11 [ORG-C]     R12 [ORG-C] R13 [ORG-C]     R14 [ORG-C]   R15 [ORG-C]
          (ĐÃ BÁN HẾT)     (TỒN KỆ)    (TỒN KỆ)       (ĐÃ BÁN HẾT)  (ĐỘC LẬP)
```

---

## 5. Bảng thông số 15 lô hàng trong kịch bản mẫu

| Mã lô | Tầng | Tổ chức | Vai trò trong chuỗi | Tình trạng | Khối lượng đầu (kg) | Khối lượng còn lại (kg) | Cha trực tiếp |
| :--- | :---: | :---: | :--- | :--- | :---: | :---: | :--- |
| **R01** | 1 | ORG-A | Lô Cà chua Nguồn 1 | Đã thu hoạch | 1000.000 | 200.000 | – (Gốc F0) |
| **R02** | 1 | ORG-A | Lô Cà chua Nguồn 2 | Đã thu hoạch | 800.000 | 300.000 | – (Gốc F0) |
| **R03** | 1 | ORG-B | Lô Cà chua Nguồn 3 | Đã thu hoạch | 500.000 | 100.000 | – (Gốc F0) |
| **R04** | 2 | ORG-B | Sơ chế Cà chua loại 1 | Đang chế biến | 400.000 | 150.000 | R01 (SPLIT 400) |
| **R05** | 2 | ORG-B | Sơ chế Cà chua loại 2 | Đang chế biến | 400.000 | 100.000 | R01 (SPLIT 400) |
| **R06** | 2 | ORG-B | Sơ chế Múi ép | Đang chế biến | 500.000 | 100.000 | R02 (SPLIT 500) |
| **R07** | 2 | ORG-B | Sơ chế Xuất khẩu | Đang chế biến | 400.000 | 150.000 | R03 (SPLIT 400) |
| **R08** | 3 | ORG-B | Lô đóng gói hỗn hợp (⭐ Gộp đa nguồn) | Đang chế biến | 500.000 | 100.000 | R04 (250) + R06 (250) |
| **R09** | 3 | ORG-C | Lô đóng hộp bán sỉ | Đã nhập kho | 300.000 | 100.000 | R05 (SPLIT 300) |
| **R10** | 3 | ORG-C | Lô Nước ép cà chua (⭐ Gộp đa nguồn) | Đã nhập kho | 400.000 | 100.000 | R06 (150) + R07 (250) |
| **R11** | 4 | ORG-C | Điểm bán Siêu thị A | **Đã bán hết (S-29)** | 200.000 | **0.000** | R08 (SPLIT 200) |
| **R12** | 4 | ORG-C | Điểm bán Siêu thị B | Đang lưu kho | 200.000 | **200.000** | R08 (SPLIT 200) |
| **R13** | 4 | ORG-C | Cửa hàng tiện lợi C | Đang lưu kho | 200.000 | **80.000** | R09 (SPLIT 200) |
| **R14** | 4 | ORG-C | Quầy nước ép giải khát D | **Đã bán hết (S-29)** | 300.000 | **0.000** | R10 (SPLIT 300) |
| **R15** | 4 | ORG-C | Lô đối chứng độc lập | Đã nhập kho | 100.000 | 100.000 | – (Độc lập biên) |

---

## 6. Đáp án đếm tay độc lập từ hai người (AC2 & NFR)

> **Ghi chú nghiệm thu:**
> - **Người đếm 1 (Tester 1):** Nguyễn Văn An (QA Engineer)
> - **Người đếm 2 (Tester 2):** Trần Thị Bình (Business Analyst)
> Cả 2 người thực hiện tính toán thủ công dựa trên mô hình đồ thị độc lập trước khi chạy bất kỳ đoạn mã kiểm thử nào.

### 6.1. Bảng đối chiếu kết quả đếm tay theo lô gốc

#### A. Tra cứu từ lô gốc `R01`:
* **Danh sách hậu duệ (Descendants):**
  * Tầng 2: `R04`, `R05`
  * Tầng 3: `R08` (từ R04), `R09` (từ R05)
  * Tầng 4: `R11`, `R12` (từ R08), `R13` (từ R09)
  $$\Rightarrow \text{Hậu duệ } R01 = \{ R04, R05, R08, R09, R11, R12, R13 \} \text{ (7 lô)}$$

| Mã lô hậu duệ | Tầng | Tổ chức | Khối lượng còn lại (Tester 1) | Khối lượng còn lại (Tester 2) | Phân loại thu hồi | Kết quả đối chiếu |
| :--- | :---: | :---: | :---: | :---: | :--- | :---: |
| **R04** | 2 | ORG-B | 150 kg | 150 kg | Tồn kho tại nhà máy | **KHỚP 100%** |
| **R05** | 2 | ORG-B | 100 kg | 100 kg | Tồn kho tại nhà máy | **KHỚP 100%** |
| **R08** | 3 | ORG-B | 100 kg | 100 kg | Tồn kho tại nhà máy | **KHỚP 100%** |
| **R09** | 3 | ORG-C | 100 kg | 100 kg | Tồn kho trung tâm phân phối | **KHỚP 100%** |
| **R11** | 4 | ORG-C | **0 kg** | **0 kg** | **ĐÃ TIÊU THỤ (Phát cảnh báo)** | **KHỚP 100%** |
| **R12** | 4 | ORG-C | **200 kg** | **200 kg** | **TỒN KỆ (Thu hồi khẩn cấp)** | **KHỚP 100%** |
| **R13** | 4 | ORG-C | **80 kg** | **80 kg** | **TỒN KỆ (Thu hồi khẩn cấp)** | **KHỚP 100%** |

* **Chỉ số thu hồi tổng hợp từ `R01`:**
  * Tổng khối lượng hậu duệ tồn kho cần thu hồi ngay: **730.000 kg** (Nếu tính cả lượng tồn tại gốc R01: 730 + 200 = 930 kg).
  * Số lượng lô đã bán hết tới người tiêu dùng: **1 lô (`R11`)** $\rightarrow$ Kích hoạt truyền thông thu hồi người dùng.

---

#### B. Tra cứu từ lô gốc `R02`:
* **Danh sách hậu duệ (Descendants):**
  * Tầng 2: `R06`
  * Tầng 3: `R08` (gộp từ R06 + R04), `R10` (gộp từ R06 + R07)
  * Tầng 4: `R11`, `R12` (từ R08), `R14` (từ R10)
  $$\Rightarrow \text{Hậu duệ } R02 = \{ R06, R08, R10, R11, R12, R14 \} \text{ (6 lô)}$$

| Mã lô hậu duệ | Tầng | Tổ chức | Khối lượng còn lại (Tester 1) | Khối lượng còn lại (Tester 2) | Phân loại thu hồi | Kết quả đối chiếu |
| :--- | :---: | :---: | :---: | :---: | :--- | :---: |
| **R06** | 2 | ORG-B | 100 kg | 100 kg | Tồn kho tại nhà máy | **KHỚP 100%** |
| **R08** | 3 | ORG-B | 100 kg | 100 kg | Tồn kho tại nhà máy | **KHỚP 100%** |
| **R10** | 3 | ORG-C | 100 kg | 100 kg | Tồn kho trung tâm phân phối | **KHỚP 100%** |
| **R11** | 4 | ORG-C | **0 kg** | **0 kg** | **ĐÃ TIÊU THỤ (Phát cảnh báo)** | **KHỚP 100%** |
| **R12** | 4 | ORG-C | **200 kg** | **200 kg** | **TỒN KỆ (Thu hồi khẩn cấp)** | **KHỚP 100%** |
| **R14** | 4 | ORG-C | **0 kg** | **0 kg** | **ĐÃ TIÊU THỤ (Phát cảnh báo)** | **KHỚP 100%** |

* **Chỉ số thu hồi tổng hợp từ `R02`:**
  * Tổng khối lượng hậu duệ tồn kho cần thu hồi ngay: **500.000 kg** (Nếu tính cả gốc R02: 500 + 300 = 800 kg).
  * Số lượng lô đã bán hết tới người tiêu dùng: **2 lô (`R11`, `R14`)**.

---

#### C. Tra cứu từ lô gốc `R03`:
* **Danh sách hậu duệ (Descendants):**
  * Tầng 2: `R07`
  * Tầng 3: `R10` (từ R07 gộp R06)
  * Tầng 4: `R14` (từ R10)
  $$\Rightarrow \text{Hậu duệ } R03 = \{ R07, R10, R14 \} \text{ (3 lô)}$$

| Mã lô hậu duệ | Tầng | Tổ chức | Khối lượng còn lại (Tester 1) | Khối lượng còn lại (Tester 2) | Phân loại thu hồi | Kết quả đối chiếu |
| :--- | :---: | :---: | :---: | :---: | :--- | :---: |
| **R07** | 2 | ORG-B | 150 kg | 150 kg | Tồn kho tại nhà máy | **KHỚP 100%** |
| **R10** | 3 | ORG-C | 100 kg | 100 kg | Tồn kho trung tâm phân phối | **KHỚP 100%** |
| **R14** | 4 | ORG-C | **0 kg** | **0 kg** | **ĐÃ TIÊU THỤ (Phát cảnh báo)** | **KHỚP 100%** |

* **Chỉ số thu hồi tổng hợp từ `R03`:**
  * Tổng khối lượng hậu duệ tồn kho cần thu hồi ngay: **250.000 kg** (Tính cả gốc R03: 250 + 100 = 350 kg).
  * Số lượng lô đã tiêu thụ: **1 lô (`R14`)**.

---

#### D. Tra cứu từ lô độc lập `R15`:
* **Danh sách hậu duệ:** $\emptyset$ (0 lô).
* **Kết quả đối chiếu:** Cả Tester 1 và Tester 2 đều xác nhận tập rỗng, không có hậu duệ nào bị ảnh hưởng.

---

## 7. Test Matrix đối chiếu tự động (Automation Test Matrix)

| Test ID | Đầu vào truy vấn | Kỳ vọng tập hậu duệ | Kỳ vọng tổng tồn kho hậu duệ | Kỳ vọng danh sách lô tiêu thụ |
| :---: | :--- | :--- | :---: | :--- |
| **TM-01** | Tra cứu từ `R01` | `{R04, R05, R08, R09, R11, R12, R13}` | 730 kg | `{R11}` |
| **TM-02** | Tra cứu từ `R02` | `{R06, R08, R10, R11, R12, R14}` | 500 kg | `{R11, R14}` |
| **TM-03** | Tra cứu từ `R03` | `{R07, R10, R14}` | 250 kg | `{R14}` |
| **TM-04** | Tra cứu từ `R08` (Tầng 3) | `{R11, R12}` | 200 kg | `{R11}` |
| **TM-05** | Tra cứu từ `R10` (Tầng 3) | `{R14}` | 0 kg | `{R14}` |
| **TM-06** | Tra cứu từ `R15` (Độc lập) | `{}` | 0 kg | `{}` |
| **TM-07** | Idempotency Check | Chạy seed lần 2 | Dữ liệu không tăng | Không trùng lặp |
| **TM-08** | SHA-256 Integrity | 15 chuỗi hash-chain | 100% hợp lệ | `verifyBatchEventChain() === true` |

---

## 8. Kết luận
Tài liệu này đóng vai trò là **nguồn sự thật duy nhất (Single Source of Truth)** cho bộ dữ liệu mẫu thu hồi Story S-39. Mã SQL (`db/seed_s39.sql`), script Node.js (`backend/scripts/seed_s39.js`), và test suite (`backend/test/seed_s39.test.js`) sẽ bám sát 100% theo các định nghĩa và đáp án đếm tay ở trên.

---

## 9. Bằng chứng kiểm thử thực tế (Acceptance Evidence)

Chạy kiểm thử tự động xác thực Story S-39 qua lệnh:
```bash
node --test test/seed_s39.test.js
```

### Kết quả thực thi (Test Runner Output):
```text
▶ S-39: Bộ dữ liệu thu hồi mẫu bốn tầng, ba tổ chức, có đáp án đếm tay (Test Matrix TM-01..TM-08 & Idempotency)
  ✔ AC1: Bộ dữ liệu mẫu có đồ thị 4 tầng qua 3 tổ chức, có gộp đa nguồn và có lô đã tiêu thụ (1.8275ms)
  ✔ TM-07: Tính Idempotent - Seed lần 2 không tăng số lượng bản ghi hay làm sai lệch dữ liệu (1.4337ms)
  ✔ TM-08: Bảo chứng toàn vẹn mật mã: 100% chuỗi sự kiện của 15 lô hàng hợp lệ SHA-256 (K-01 / S-10) (2.8482ms)
  ✔ TM-01: Lô gốc R01 - Đáp án đếm tay hậu duệ {R04, R05, R08, R09, R11, R12, R13}, tồn kho thu hồi 730kg, 1 lô đã tiêu thụ (4.6864ms)
  ✔ TM-02: Lô gốc R02 - Đáp án đếm tay hậu duệ {R06, R08, R10, R11, R12, R14}, tồn kho thu hồi 500kg, 2 lô đã tiêu thụ (4.5605ms)
  ✔ TM-03: Lô gốc R03 - Đáp án đếm tay hậu duệ {R07, R10, R14}, tồn kho thu hồi 250kg, 1 lô đã tiêu thụ (0.6358ms)
  ✔ TM-04 & TM-05: Lô trung gian Tầng 3 (R08 và R10) truy xuôi hậu duệ (0.5809ms)
  ✔ TM-06: Lô đối chứng độc lập R15 (Tầng 4) không có hậu duệ nào (0.4271ms)
  ✔ API GET /api/lots/:id/descendants trả về đầy đủ hậu duệ và thông tin thu hồi theo S-39 (139.2917ms)
✔ S-39: Bộ dữ liệu thu hồi mẫu bốn tầng, ba tổ chức, có đáp án đếm tay (Test Matrix TM-01..TM-08 & Idempotency) (193.4914ms)
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

100% các tiêu chí nghiệm thu AC1, AC2 và các NFR về tính idempotent, toàn vẹn mật mã SHA-256 và đối chiếu đếm tay độc lập 2 người đều đạt chuẩn.

