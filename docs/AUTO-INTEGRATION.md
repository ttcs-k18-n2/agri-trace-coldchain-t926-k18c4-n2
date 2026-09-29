# Auto integration vào develop

Sau khi workflow này được merge vào `develop`, các branch feature/fix cần đồng bộ `develop` một lần để nhận workflow.

Khi thành viên push lên branch dạng:

- `feature/**`
- `fix/**`

GitHub Actions sẽ:

1. kiểm tra backend nếu có `backend/package.json`;
2. kiểm tra `docker-compose.yml` nếu có;
3. chỉ khi các bước kiểm tra thành công mới merge commit vừa push vào `develop`;
4. nếu có conflict hoặc kiểm tra lỗi, workflow dừng và `develop` không bị thay đổi.

Workflow dùng concurrency để các lần tích hợp vào `develop` chạy tuần tự, tránh hai branch đẩy vào `develop` cùng lúc.

## Cách dùng cho thành viên

Sau khi branch đã được cập nhật từ `develop`, chỉ cần:

```bash
git add .
git commit -m "feat: mô tả thay đổi"
git push origin <branch-của-mình>
```

Không cần push trực tiếp vào `develop`.
