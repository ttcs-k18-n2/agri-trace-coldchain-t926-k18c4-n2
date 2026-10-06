# Tích hợp code hiện tại: Pull Request vào main

Tài liệu cũ của dự án từng mô tả cơ chế tự động tích hợp vào `develop`. Cơ chế đó **không còn là quy trình hiện tại**.

## Quy trình hiện tại

Khi thành viên push lên branch:

- `feature/**`
- `fix/**`
- `docs/**`

GitHub Actions chỉ chạy CI để kiểm tra code.

**Push branch không tự merge vào `main`.**

Luồng hiện tại:

```text
feature/fix/docs branch
        ↓ push
       CI
        ↓
Pull Request vào main
        ↓
review + CI xanh
        ↓
merge main
        ↓
deploy staging
```

## Cách dùng

Trước khi làm:

```bash
git switch main
git pull origin main
git switch -c feature/s3-sXX-ten-chuc-nang
```

Sau khi code/test:

```bash
git add .
git commit -m "feat(S-XX): mô tả thay đổi"
git push -u origin feature/s3-sXX-ten-chuc-nang
```

Sau đó mở Pull Request:

```text
base: main
compare: feature/s3-sXX-ten-chuc-nang
```

Không push trực tiếp vào `main`.

## CI/CD

Theo workflow hiện tại:

- push branch feature/fix/docs → CI;
- Pull Request vào `main` → CI;
- merge/push vào `main` → CI + deploy staging.

Nếu gặp tài liệu lịch sử còn nhắc `develop`, dùng [WORKFLOW.md](WORKFLOW.md) và [TEAM-GUIDE.md](TEAM-GUIDE.md) làm hướng dẫn hiện tại.
