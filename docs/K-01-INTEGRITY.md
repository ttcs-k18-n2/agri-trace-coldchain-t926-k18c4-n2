# K-01 — Tài liệu Quyết định Kiến trúc: Chống sửa lén bản ghi sự kiện (Event Integrity)

## 1. Bối cảnh, Mục tiêu và Ranh giới Spike

Hệ thống truy xuất nguồn gốc nông sản và giám sát chuỗi lạnh cần đảm bảo rằng hồ sơ sự kiện (thu hoạch, sơ chế, bàn giao, đo nhiệt độ vận chuyển, thu hồi) **không thể bị sửa lén hoặc làm giả**. Lời cam kết "không thể sửa đổi" phải được bảo chứng bằng toán học mật mã, không phụ thuộc vào lòng tin đối với lập trình viên hay quản trị viên hệ thống.

### Ranh giới Spike K-01:
- Nhiệm vụ K-01 giữ vai trò **Spike chọn giải pháp kiến trúc** (Architectural Spike & Feasibility Benchmark).
- **Nguyên tắc backlog**: Nhánh `docs/s1-k01-integrity` được giữ nguyên làm bằng chứng nghiên cứu thực nghiệm và tài liệu quyết định kiến trúc, **tuyệt đối không biến mã thử nghiệm của K-01 thành mã sản phẩm trong Sprint 1**.
- Toàn bộ chức năng chống sửa lén hoàn chỉnh sẽ được phát triển chính thức trong **Sprint 2**, bám sát chuỗi nhiệm vụ Jira từ **T-23 đến T-30** (thuộc các Story S-10, S-11, S-12) trên nhánh tính năng chuyên biệt và mở Pull Request vào `develop`.

---

## 2. Bảng so sánh 3 phương án kiến trúc

| Tiêu chí so sánh | Phương án 1: Chuỗi Hash (Cryptographic Hash Chain) | Phương án 2: Quyền CSDL (DB Permissions & Trigger) | Phương án 3: Blockchain (DLT / Smart Contract) |
|---|---|---|---|
| **Cơ chế hoạt động** | Mỗi sự kiện băm kèm hash của sự kiện trước ($H_n = \text{Hash}(H_{n-1} \parallel \text{CanonicalJSON}(\text{Data}_n))$) | Phân quyền `GRANT INSERT, SELECT` (thu hồi `UPDATE, DELETE`) cho user ứng dụng + Trigger | Lưu sự kiện lên sổ cái phân tán qua giao thức đồng thuận (Consensus) |
| **Phát hiện sửa lén** | **100% bằng chứng toán học**, bất kỳ ai cũng có thể tự xác minh độc lập | **Không**. Quản trị viên (DBA/root) có thể can thiệp trực tiếp vào database file | **100%**, phân tán nhiều node |
| **Tốc độ ghi (1.000 sự kiện)** | **~25 - 35 ms** (~30.000 - 40.000 sự kiện/giây) | ~500 - 1.200 ms (giao dịch CSDL) | 2.000 - 15.000 ms (độ trễ đóng khối) |
| **Tốc độ kiểm tra (1.000 sự kiện)** | **~12 - 16 ms** (~60.000 - 80.000 sự kiện/giây) | Phải quét log hoặc audit table | Vài chục giây phụ thuộc RPC / Node |
| **Mức độ phức tạp & Chi phí** | **Rất thấp**. Dùng thư viện mật mã chuẩn có sẵn, chi phí hạ tầng $0 | **Rất thấp**. Cấu hình PostgreSQL có sẵn | **Rất cao**. Vận hành cụm node, phí mạng, smart contract |
| **Tuân thủ Nghị định 13/2023/NĐ-CP** | **Tuân thủ tốt**. Có thể ẩn/xóa dữ liệu định danh nông hộ mà không phá vỡ liên kết hash | **Tuân thủ tốt** | **Vi phạm nghiêm trọng**. Tính chất bất biến tuyệt đối ngăn cản quyền được xóa dữ liệu cá nhân |
| **Quyết định** | **ĐƯỢC CHỌN (Core Engine)** | **ĐƯỢC CHỌN (Vòng bảo vệ phụ DB-level)** | **LOẠI BỎ (REJECTED)** |

> [!IMPORTANT]
> **Quyết định phòng thủ theo chiều sâu (Defense-in-Depth):** Dự án kết hợp **Phương án 1 (Chuỗi Hash SHA-256)** làm lõi kiểm toán toán học và **Phương án 2 (Phân quyền PostgreSQL Append-only)** làm chốt chặn bảo vệ tầng cơ sở dữ liệu.

---

## 3. Kết quả đo lường thực nghiệm (Benchmark với 1.000 sự kiện)

Thử nghiệm được thực hiện trên môi trường dự án với bộ dữ liệu mẫu 1.000 sự kiện chuỗi lạnh thực tế (`backend/benchmark/integrity_benchmark.js`):

- **Số lượng sự kiện thử nghiệm:** 1.000 sự kiện (nhiệt độ, bàn giao, đóng gói, điều chuyển).
- **Thời gian tạo & gắn chuỗi hash:** **~30 ms** (trung bình **~0.03 ms / sự kiện**).
- **Thông lượng ghi:** **> 30.000 sự kiện / giây**.
- **Thời gian xác minh toàn vẹn toàn bộ chuỗi:** **~15 ms** (trung bình **~0.015 ms / sự kiện**).
- **Thông lượng xác minh:** **> 60.000 sự kiện / giây**.
- **Khả năng phát hiện can thiệp nội dung (`CONTENT_TAMPERED`):** **100%**. Khi sửa đổi thử nghiệm trường nhiệt độ từ `4.2°C` thành `99.9°C` ở sự kiện thứ 500, hàm kiểm tra phát hiện ngay lập tức vị trí bị sửa và ngắt chuỗi xác thực.
- **Khả năng phát hiện xóa lén sự kiện (`BROKEN_CHAIN`):** **100%**. Khi xóa sự kiện thứ 500 ra khỏi chuỗi, sự kiện thứ 501 có `previous_hash` không khớp với con trỏ của sự kiện 499, hệ thống báo lỗi phá vỡ chuỗi ngay lập tức.

---

## 4. Thuật toán băm và Chuẩn hóa nội dung

### 4.1. Thuật toán băm: SHA-256
- Dự án chọn **SHA-256** (FIPS PUB 180-4, chuẩn NIST).
- Lý do: Thuật toán mật mã một chiều tiêu chuẩn công nghiệp, độ dài hash cố định 64 ký tự hex (256-bit), tối ưu hóa tập lệnh phần cứng trên mọi CPU hiện đại, có sẵn trong module `node:crypto` chuẩn của Node.js mà không phụ thuộc gói bên ngoài.

### 4.2. Chuẩn hóa nội dung: Canonical JSON nội bộ (Deterministic JSON)
Để đảm bảo hai môi trường hoặc hai tiến trình độc lập tính toán cùng một sự kiện luôn cho ra chính xác cùng một mã băm, payload JSON phải được chuẩn hóa trước khi băm theo quy chuẩn **Canonical JSON nội bộ**:
1. **Sắp xếp khóa từ điển đệ quy (Recursive Key Sorting):** Toàn bộ các key trong object được sắp xếp theo thứ tự bảng mã Unicode (alphabetical), kể cả các object lồng nhau.
2. **Loại bỏ khoảng trắng dư thừa:** Không chứa ký tự cách thừa, tab hoặc ký tự xuống dòng `\r\n`.
3. **Mã hóa UTF-8 chuẩn:** Đảm bảo tiếng Việt có dấu được biểu diễn đồng nhất.
4. **Thời gian chuẩn hóa ISO-8601:** Toàn bộ trường ngày tháng được chuyển thành chuỗi chuẩn ISO-8601 UTC trước khi tính băm.

> [!NOTE]
> **Lưu ý về thuật ngữ:** Hàm chuẩn hóa nội bộ của dự án được định danh chính xác là **"Canonical JSON nội bộ"**. Tài liệu kỹ thuật không gọi đây là RFC 8785 (JSON Canonicalization Scheme - JCS) hoàn chỉnh của IETF vì chưa bao gồm toàn bộ xử lý số thực IEEE 754 phức tạp. Trong trường hợp có yêu cầu kiểm toán nghiêm ngặt bắt buộc chuẩn IETF RFC 8785, nhóm sẽ tích hợp thư viện JCS chuẩn thay vì tự code.

- **Công thức nối chuỗi băm sự kiện:**
$$\text{event\_hash}_n = \text{SHA-256}(\text{previous\_hash}_{n-1} \parallel \text{"\|"} \parallel \text{CanonicalJSON}(\text{hash\_payload}_n))$$

---

## 5. Giải thích lý do loại Blockchain bằng ngôn ngữ dễ hiểu

Theo quyết định nguyên tắc **GD-5**, nhóm thống nhất **loại bỏ hoàn toàn blockchain** vì 4 lý do thực tế sau:

1. **Tốc độ và hiệu năng thực tế:**
   Cảm biến xe lạnh gửi dữ liệu nhiệt độ liên tục mỗi vài phút. Hệ thống chuỗi hash thông thường chỉ mất **dưới 0,05 mili-giây** để ghi nhận một bản ghi. Trong khi đó, blockchain cần các máy chủ bỏ phiếu đồng thuận (consensus), mất từ vài giây đến hàng chục giây cho mỗi lượt xác nhận, gây nghẽn toàn bộ hệ thống khi có hàng trăm xe và hàng ngàn lô hàng vận chuyển đồng thời.
2. **Chi phí vận hành khổng lồ:**
   Để duy trì hệ thống blockchain cần rất nhiều máy chủ hoạt động liên tục hoặc phải trả phí giao dịch (gas fee) cho từng giao dịch. Với mô hình nông sản Việt Nam, chi phí này đội giá thành của mớ rau, cân quả lên mức phi thực tế đối với nông dân và hợp tác xã.
3. **Xung đột pháp lý về quyền riêng tư (Nghị định 13/2023/NĐ-CP):**
   Pháp luật Việt Nam quy định chủ thể dữ liệu (nông hộ) có quyền yêu cầu chỉnh sửa hoặc xóa thông tin cá nhân (tên, số điện thoại, vị trí thửa đất) khi rút khỏi hợp tác xã. Bản chất của Blockchain là "bất biến tuyệt đối - đã ghi vào thì vĩnh viễn không thể xóa". Ghi dữ liệu nông hộ lên blockchain sẽ **vi phạm pháp luật** do không thể thực thi quyền được xóa dữ liệu cá nhân. Ngược lại, với chuỗi hash trong CSDL, ta có thể mã hóa thông tin nhạy cảm hoặc ẩn danh trường dữ liệu mà chuỗi kiểm tra tính toàn vẹn của lô hàng vẫn nguyên vẹn.
4. **Bản chất của chuỗi cung ứng là sự ràng buộc pháp lý:**
   Nông dân, hợp tác xã và chuỗi bán lẻ hợp tác dựa trên hợp đồng kinh tế và sự giám sát của cơ quan quản lý nhà nước (cán bộ kiểm tra ATTP). Chuỗi hash kết hợp kiểm toán CSDL đã cung cấp đầy đủ bằng chứng toán học chống chối cãi khi thanh tra hoặc ra tòa án, không cần thiết phải đánh đổi lấy sự phức tạp và lãng phí của blockchain.

---

## 6. Kiến trúc Kỹ thuật Triển khai Sprint 2 (Jira T-23 → T-30)

Chức năng chống sửa lén chính thức sẽ được triển khai trong Sprint 2 theo luồng kiến trúc chặt chẽ sau:

```
Người dùng thao tác với lô hàng
              ↓
Backend tạo sự kiện nghiệp vụ
              ↓
Chuẩn hóa payload (Canonical JSON nội bộ)
              ↓
Lấy event_hash của sự kiện liền trước (prev_hash)
              ↓
SHA-256(prev_hash + "|" + payload chuẩn hóa)
              ↓
INSERT vào bảng batch_events
              ↓
PostgreSQL chặn UPDATE / DELETE (Chỉ cho phép INSERT đối với agri_app)
              ↓
Khi kiểm tra toàn vẹn:
Đọc toàn bộ chuỗi theo sequence_no → Tính lại hash từng mắt xích → So sánh
```

### 6.1. T-23 — Thiết kế Bảng `batch_events`
Bảng lưu trữ sự kiện bất biến được thiết kế với khóa tuần tự `sequence_no` và ràng buộc duy nhất:

```sql
CREATE TABLE batch_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id VARCHAR(50) NOT NULL REFERENCES lots(id),
    sequence_no BIGINT NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    organization_id VARCHAR(50) NOT NULL,
    actor_user_id VARCHAR(50),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    previous_hash CHAR(64),
    event_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(batch_id, sequence_no)
);

CREATE INDEX idx_batch_events_batch_sequence ON batch_events(batch_id, sequence_no);
```

> [!IMPORTANT]
> **Vai trò của `sequence_no`:** Bắt buộc sử dụng `sequence_no` (số nguyên tăng dần cho mỗi lô) thay vì chỉ dựa vào `occurred_at` / `created_at`. Dưới tải cao, hai giao dịch có thể có timestamp bằng nhau đến cấp độ microsecond; `sequence_no` đảm bảo xác định chính xác 100% thứ tự nối chuỗi hash và chống race condition.

---

### 6.2. T-24 — Module Băm và Chuẩn hóa Dùng chung (`backend/src/integrity.js`)
Tách logic băm khỏi file benchmark thành module dùng chung trong `backend/src/`:

```javascript
const crypto = require("node:crypto");

function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function calculateEventHash(previousHash, eventData) {
  const canonical = canonicalize(eventData);
  return crypto
    .createHash("sha256")
    .update(`${previousHash || ""}|${canonical}`, "utf8")
    .digest("hex");
}

module.exports = {
  canonicalize,
  calculateEventHash,
};
```

---

### 6.3. T-25 — Ghi Sự kiện Tập trung & Transaction Nguyên tử (`backend/src/event_repository.js`)
Mọi hành động nghiệp vụ (Thu hoạch, Bàn giao, Đo nhiệt độ, Thu hồi, v.v.) đều phải đi qua một hàm ghi duy nhất `appendBatchEvent` để đảm bảo tính đồng nhất thuật toán:

```javascript
async function appendBatchEvent(client, { batchId, eventType, payload, organizationId, actorUserId, occurredAt = new Date().toISOString() }) {
  // 1. Khóa hàng sự kiện cuối cùng của lô để chống ghi đè đồng thời
  const lastRes = await client.query(
    `SELECT sequence_no, event_hash
     FROM batch_events
     WHERE batch_id = $1
     ORDER BY sequence_no DESC
     LIMIT 1
     FOR UPDATE`,
    [batchId]
  );

  const lastEvent = lastRes.rows[0];
  const sequenceNo = lastEvent ? Number(lastEvent.sequence_no) + 1 : 1;
  const previousHash = lastEvent ? lastEvent.event_hash : null;

  const hashPayload = {
    batchId,
    sequenceNo,
    eventType,
    payload,
    organizationId,
    actorUserId,
    occurredAt,
  };

  const eventHash = calculateEventHash(previousHash, hashPayload);

  // 2. Chèn sự kiện mới vào CSDL
  const insertRes = await client.query(
    `INSERT INTO batch_events (
       batch_id, sequence_no, event_type, payload,
       organization_id, actor_user_id, occurred_at,
       previous_hash, event_hash
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [batchId, sequenceNo, eventType, payload, organizationId, actorUserId, occurredAt, previousHash, eventHash]
  );

  return insertRes.rows[0];
}
```

> [!TIP]
> **Đảm bảo tính nguyên tử (Atomicity):** Khi tạo lô mới, câu lệnh `INSERT INTO lots` và `appendBatchEvent('HARVEST_CREATED')` phải nằm trong **cùng một transaction CSDL** (`BEGIN` ... `COMMIT`). Nếu một trong hai thất bại thì `ROLLBACK` toàn bộ, không bao giờ xảy ra tình trạng lô có mà mất sự kiện hoặc ngược lại.

---

### 6.4. T-26 & T-27 — Phòng thủ 2 lớp CSDL: User Append-only
Bảo vệ chống sửa/xóa ngay từ tầng quyền cơ sở dữ liệu:
- Phân tách 2 tài khoản CSDL:
  1. `agri_migration`: Dành riêng cho tiến trình migration (có quyền `CREATE`, `ALTER`, `DROP`, `UPDATE`).
  2. `agri_app`: Backend chạy dưới tài khoản này.
- Cấu hình quyền cho `agri_app`:
  ```sql
  GRANT SELECT, INSERT ON batch_events TO agri_app;
  REVOKE UPDATE, DELETE, TRUNCATE ON batch_events FROM agri_app;
  ```
- Kết quả: Kể cả mã nguồn backend có lỗi logic hoặc bị khai thác SQL Injection, câu lệnh `UPDATE batch_events` hoặc `DELETE FROM batch_events` đều bị CSDL từ chối ngay lập tức: `ERROR: permission denied for table batch_events`.

---

### 6.5. T-28 — Module Xác minh Toàn vẹn Chuỗi (`backend/src/integrity_verifier.js`)
Cung cấp hàm xác minh độc lập `verifyBatchIntegrity(batchId)` quét toàn bộ chuỗi sự kiện của một lô:

```javascript
async function verifyBatchIntegrity(client, batchId) {
  const res = await client.query(
    `SELECT * FROM batch_events WHERE batch_id = $1 ORDER BY sequence_no ASC`,
    [batchId]
  );
  const events = res.rows;

  if (events.length === 0) {
    return { valid: true, eventCount: 0, finalHash: null };
  }

  let previousHash = null;

  for (const event of events) {
    // 1. Kiểm tra tính liên tục của mắt xích hash
    if (event.previous_hash !== previousHash) {
      return {
        valid: false,
        sequence: Number(event.sequence_no),
        eventId: event.id,
        type: "BROKEN_CHAIN",
        expectedPreviousHash: previousHash,
        actualPreviousHash: event.previous_hash,
      };
    }

    // 2. Tính lại hash dựa trên nội dung lưu trữ
    const hashPayload = {
      batchId: event.batch_id,
      sequenceNo: Number(event.sequence_no),
      eventType: event.event_type,
      payload: event.payload,
      organizationId: event.organization_id,
      actorUserId: event.actor_user_id,
      occurredAt: new Date(event.occurred_at).toISOString(),
    };

    const recalculated = calculateEventHash(previousHash, hashPayload);
    if (recalculated !== event.event_hash) {
      return {
        valid: false,
        sequence: Number(event.sequence_no),
        eventId: event.id,
        type: "CONTENT_TAMPERED",
        recalculatedHash: recalculated,
        storedHash: event.event_hash,
        suspiciousFrom: Number(event.sequence_no),
      };
    }

    previousHash = event.event_hash;
  }

  return {
    valid: true,
    eventCount: events.length,
    finalHash: previousHash,
  };
}
```

---

### 6.6. T-29 — Tách biệt 2 API & Kiến trúc Xử lý "Lịch sử Chỉnh sửa"

Khi phát sinh yêu cầu chỉnh sửa dữ liệu lô hàng (ví dụ: cán bộ nhập nhầm số lượng, sửa kho lưu trữ), kiến trúc xử lý rõ ràng 2 trường hợp:

#### 1. Chỉnh sửa hợp lệ trong ứng dụng (Event Sourcing / Business Audit)
- Ứng dụng **tuyệt đối không chạy lệnh `UPDATE`** đè lên sự kiện hoặc lô cũ.
- Hệ thống ghi một sự kiện mới loại `CORRECTION` vào chuỗi:
  ```json
  {
    "event_type": "CORRECTION",
    "payload": {
      "field": "storage_location",
      "old_value": "Kho A",
      "new_value": "Kho B",
      "reason": "Nhập nhầm mã kho khi giao nhận"
    },
    "actor_user_id": "user-123",
    "occurred_at": "2026-09-30T15:20:00Z"
  }
  ```
- Dữ liệu cũ được giữ nguyên 100%, ghi nhận rõ ràng ai sửa, sửa lúc nào, sửa trường nào, vì sao sửa.

#### 2. Sửa lén trực tiếp trong CSDL (Direct SQL Tampering)
- DBA hoặc kẻ xấu can thiệp ngầm vào database file. Hàm băm phát hiện ngay sự sai lệch tại đúng vị trí mắt xích bị can thiệp.

#### Tách biệt 2 API độc lập:
1. `GET /api/lots/:id/timeline`:
   - Phục vụ hiển thị nghiệp vụ: dòng thời gian toàn bộ các sự kiện từ lúc thu hoạch, bàn giao, cập nhật nhiệt độ cho đến các lần hiệu chỉnh (`CORRECTION`).
2. `GET /api/lots/:id/integrity`:
   - Phục vụ kiểm toán bảo mật: trả về trạng thái toàn vẹn mật mã (`valid: true/false`, `firstInvalidSequence`, `type`).

#### Giao diện người dùng (Frontend):
Trên màn hình chi tiết lô hàng:
- **Phía trên**: Huy hiệu kiểm toán nổi bật:
  - ✅ **Chuỗi dữ liệu toàn vẹn**: 14 sự kiện, Hash cuối: `a18d...`, kiểm tra lúc 15:25.
  - ⚠️ **Cảnh báo can thiệp**: Phát hiện dữ liệu bị sửa đổi tại sự kiện #6. Các sự kiện từ #6 trở đi cần thanh tra.
- **Phía dưới**: Dòng thời gian trực quan của lô hàng (Timeline).

---

### 6.7. T-30 — Bộ Kiểm thử Tích hợp Bắt buộc trên PostgreSQL Thật
Tất cả các trường hợp sau bắt buộc phải có automated integration test chạy trực tiếp với PostgreSQL:
1. **Case 1 (Chuỗi nguyên vẹn):** Tạo 1 lô và 10 sự kiện liên tiếp → `verifyBatchIntegrity` trả về `valid = true`.
2. **Case 2 (Sửa SQL trực tiếp):** Dùng tài khoản admin sửa payload của sự kiện #5 (`UPDATE batch_events SET payload = ...`) → `verifyBatchIntegrity` trả về `valid = false`, `firstInvalid = 5`, `type = "CONTENT_TAMPERED"`.
3. **Case 3 (Xóa SQL trực tiếp):** Dùng tài khoản admin xóa sự kiện #5 (`DELETE FROM batch_events WHERE sequence_no = 5`) → `verifyBatchIntegrity` trả về `valid = false`, `type = "BROKEN_CHAIN"`.
4. **Case 4 (Chặn quyền sửa/xóa của Backend user):** Dùng tài khoản `agri_app` chạy lệnh `UPDATE batch_events` hoặc `DELETE FROM batch_events` → PostgreSQL báo lỗi `permission denied`.

---

### 6.8. Tái sử dụng cho Sprint 3 (T-47 / T-48: Tách & Gộp lô hàng)
Thiết kế tập trung của `appendBatchEvent` và `verifyBatchIntegrity` trong Sprint 2 sẽ được tái sử dụng trực tiếp cho các nghiệp vụ phức tạp của Sprint 3:
- **Tách lô (Split):**
  Trong 1 transaction: Trừ số lượng lô mẹ → Tạo lô con A & B → `appendBatchEvent(lô mẹ, 'SPLIT')` → `appendBatchEvent(lô A, 'CREATED_FROM_SPLIT')` → `appendBatchEvent(lô B, 'CREATED_FROM_SPLIT')`.
- **Gộp lô (Merge):**
  Trong 1 transaction: Khóa các lô thành phần A, B, C → Tạo lô mới D → `appendBatchEvent` cho từng lô A, B, C (`MERGED_INTO`) và lô D (`CREATED_FROM_MERGE`).
- **Nghiệm thu T-48:** Chỉ cần gọi lại hàm `verifyBatchIntegrity` cho từng lô liên quan mà không phải viết lại logic băm.

---

## 7. Lộ trình Thực hiện Tuần tự

```
K-01 (Hoàn thành Spike, ADR & Benchmark)
       ↓
T-23: Migration bảng batch_events (sequence_no, previous_hash, event_hash)
       ↓
T-24: Module backend/src/integrity.js (canonicalize + SHA-256)
       ↓
T-25: Module backend/src/event_repository.js (appendBatchEvent với FOR UPDATE)
       ↓
T-26: Phân quyền DB user agri_app (chỉ SELECT, INSERT)
       ↓
T-27: Test tự động xác nhận UPDATE / DELETE bị chặn ở tầng CSDL
       ↓
T-28: Module backend/src/integrity_verifier.js (verifyBatchIntegrity)
       ↓
T-29: Cung cấp API /integrity & /timeline + Màn hình giao diện kiểm tra
       ↓
T-30: Bộ kiểm thử tích hợp 4 kịch bản can thiệp dữ liệu trên PostgreSQL thật
       ↓
Sprint 3: Tái sử dụng cho T-47 & T-48 (Tách / Gộp lô)
```
