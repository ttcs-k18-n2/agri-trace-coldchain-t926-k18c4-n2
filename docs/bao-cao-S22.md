# BÁO CÁO S-22 – BỘ DỮ LIỆU MẪU PHÂN HỆ BA TẦNG CÓ ĐÁP ÁN ĐẾM TAY

## 1. Thông tin Backlog

- **Backlog ID:** S-22
- **Loại nguồn:** Story
- **Epic:** E-05 – Phá hệ lô hàng: tách và gộp
- **Tier:** Ready
- **Priority backlog:** Must
- **Sprint:** 3
- **Owner:** cả team
- **Dependency:** S-19

## 2. User Story

Là thành viên phát triển, tôi muốn có một bộ dữ liệu mẫu với đáp án tính sẵn bằng tay để mọi thuật toán phá hệ được kiểm bằng đáp án độc lập, không phụ thuộc vào chính mã truy vấn đang kiểm thử.

Phạm vi S-22 tập trung vào dữ liệu mẫu cho lô hàng theo **ba tầng**, có các trường hợp **tách** và **gộp**, đồng thời cho phép kiểm tra tính đúng đắn của thuật toán bằng cách đối chiếu với đáp án đã được tính thủ công.

## 3. Acceptance Criteria

### AC1 – CSDL trống
Khi cơ sở dữ liệu trống và chạy script seed, dữ liệu phải tạo được **ít nhất 12 lô qua ba tầng**, có cả thao tác tách và gộp, thuộc **ba tổ chức**.

### AC2 – Seed idempotent
Khi chạy script seed lần đầu và chạy lại lần thứ hai, trạng thái dữ liệu cuối cùng phải giống nhau; không được nhân đôi bản ghi.

### AC3 – Đáp án độc lập
Đáp án kiểm thử được tính và ghi trước bằng tay, không được lấy kết quả từ chính truy vấn/thuật toán đang cần kiểm thử.

### AC4 – Mẫu đếm lô
Khi chọn một lô bất kỳ, tập tiền tổ tiên và hậu duệ phải được xác định rõ. Các lô có quan hệ qua tách/gộp phải được phân biệt với lô không liên quan.

### AC5 – Không trùng tập đáp án
Các tập ID dùng làm đáp án phải được liệt kê rõ ràng, có thể đối chiếu bằng mắt và bằng test tự động.

## 4. NFR

**Đáp án viết tay trước khi có mã truy vấn, không sinh bằng mã.**

Điều này giúp tránh trường hợp test bị “đúng giả” vì expected value được sinh từ cùng logic với implementation.

## 5. Bộ dữ liệu mẫu đề xuất

Mô hình minh họa:

```text
TẦNG 1:  L01   L02   L03   L04
           |    / \    |    |
           |   /   \   |    |
TẦNG 2:  L05 L06   L07 L08 L09
             \      /   \  /
              \    /     \/
TẦNG 3:       L10       L11 L12
```

Ba tổ chức:

- **ORG-A:** Hợp tác xã Nông nghiệp A
- **ORG-B:** Nhà máy/đơn vị sơ chế B
- **ORG-C:** Trung tâm phân phối C

### Danh sách lô

| ID | Tầng | Tổ chức | Vai trò |
|---|---:|---|---|
| L01 | 1 | ORG-A | Lô nguồn |
| L02 | 1 | ORG-A | Lô nguồn |
| L03 | 1 | ORG-A | Lô nguồn |
| L04 | 1 | ORG-B | Lô nguồn |
| L05 | 2 | ORG-B | Tách từ L02 |
| L06 | 2 | ORG-B | Tách từ L02 |
| L07 | 2 | ORG-B | Gộp từ L01 + L03 |
| L08 | 2 | ORG-C | Tách từ L04 |
| L09 | 2 | ORG-C | Tách từ L04 |
| L10 | 3 | ORG-C | Gộp từ L05 + L08 |
| L11 | 3 | ORG-C | Gộp từ L06 + L09 |
| L12 | 3 | ORG-C | Lô cuối nhánh độc lập |

## 6. Đáp án đếm tay

> Đây là expected data viết độc lập, dùng làm chuẩn để kiểm tra thuật toán.

### 6.1. Quan hệ trực tiếp

| Lô | Cha trực tiếp | Con trực tiếp |
|---|---|---|
| L01 | – | L07 |
| L02 | – | L05, L06 |
| L03 | – | L07 |
| L04 | – | L08, L09 |
| L05 | L02 | L10 |
| L06 | L02 | L11 |
| L07 | L01, L03 | – |
| L08 | L04 | L10 |
| L09 | L04 | L11 |
| L10 | L05, L08 | – |
| L11 | L06, L09 | – |
| L12 | – | – |

### 6.2. Đáp án tổ tiên

- **L10:** {L05, L08, L02, L04}
- **L11:** {L06, L09, L02, L04}
- **L07:** {L01, L03}
- **L05:** {L02}
- **L06:** {L02}
- **L08:** {L04}
- **L09:** {L04}

### 6.3. Đáp án hậu duệ

- **L02:** {L05, L06, L10, L11}
- **L04:** {L08, L09, L10, L11}
- **L01:** {L07}
- **L03:** {L07}
- **L05:** {L10}
- **L06:** {L11}
- **L08:** {L10}
- **L09:** {L11}

### 6.4. Đáp án độc lập

- **L12:** không có tổ tiên, không có hậu duệ.
- Không được tính chính lô đang truy vấn vào tập tổ tiên/hậu duệ.
- Thứ tự trả về không được dùng làm tiêu chí đúng/sai; so sánh theo tập ID.

## 7. Kiểm tra idempotency

Quy trình:

1. Xóa dữ liệu mẫu của môi trường test hoặc dùng DB trống.
2. Chạy seed lần 1.
3. Ghi nhận số bản ghi theo từng bảng.
4. Chạy seed lần 2.
5. So sánh với lần 1.
6. Kết quả phải bằng nhau và không phát sinh bản ghi trùng.

Ví dụ expected:

```text
Sau seed lần 1:
- 12 lô
- Các quan hệ tách/gộp đúng theo bảng trên

Sau seed lần 2:
- Vẫn 12 lô
- Quan hệ không tăng thêm
- Không có duplicate
```

## 8. Test matrix

| Test | Input | Expected |
|---|---|---|
| T01 | L01 – descendants | {L07} |
| T02 | L02 – descendants | {L05,L06,L10,L11} |
| T03 | L04 – descendants | {L08,L09,L10,L11} |
| T04 | L10 – ancestors | {L05,L08,L02,L04} |
| T05 | L11 – ancestors | {L06,L09,L02,L04} |
| T06 | L12 – ancestors | {} |
| T07 | L12 – descendants | {} |
| T08 | Seed lần 2 | Không tăng dữ liệu |
| T09 | L07 – ancestors | {L01,L03} |
| T10 | L10 – descendants | {} |

## 9. Sơ đồ luồng dữ liệu

```text
              +-------------------+
              |   Seed dữ liệu    |
              +---------+---------+
                        |
                        v
              +-------------------+
              | 12+ lô / 3 tầng  |
              | 3 tổ chức        |
              +---------+---------+
                        |
             +----------+----------+
             |                     |
             v                     v
        Tách (split)          Gộp (merge)
             |                     |
             +----------+----------+
                        v
              +-------------------+
              | Quan hệ genealogy |
              +---------+---------+
                        |
                        v
              +-------------------+
              | Thuật toán truy   |
              | vấn tổ tiên/hậu duệ|
              +---------+---------+
                        |
                        v
              +-------------------+
              | So với đáp án     |
              | đếm tay độc lập   |
              +-------------------+
```

## 10. Kết luận

Bộ dữ liệu S-22 đáp ứng các yêu cầu chính: tối thiểu 12 lô, ba tầng, ba tổ chức, có cả tách và gộp, có đáp án đếm tay độc lập và có kiểm tra idempotency.

Khi tích hợp vào repository, cần ánh xạ các ID mẫu và các quan hệ trên vào đúng schema/migration hiện có của dự án. Không nên tự tạo một schema mới nếu repository đã có schema cho S-19/E-05.
