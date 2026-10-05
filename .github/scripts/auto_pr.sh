#!/usr/bin/env bash
set -e

echo "Processing auto PR for branch: $BRANCH_NAME (actor: $ACTOR)"

# 1. Kiểm tra PR đã tồn tại chưa
EXISTING_PR=$(gh pr list --head "$BRANCH_NAME" --base main --state open --json number --jq '.[0].number' || true)

if [ -n "$EXISTING_PR" ]; then
  echo "PR #$EXISTING_PR is already open for $BRANCH_NAME -> main."
  exit 0
fi

echo "No open PR found for $BRANCH_NAME -> main. Preparing to create..."

# 2. Tạo tiêu đề
TAG=$(echo "$BRANCH_NAME" | grep -o -iE '[sk][0-9]+' | tr '[:lower:]' '[:upper:]' | tail -n 1 || true)
if [ -n "$TAG" ]; then
  TITLE="[$TAG] Đề xuất gộp $BRANCH_NAME vào main"
else
  TITLE="Đề xuất gộp $BRANCH_NAME vào main"
fi

COMMIT_MSG=$(git log -1 --pretty=%s || echo "Cập nhật code")

BODY="## 🚀 Đề xuất gộp nhánh \`$BRANCH_NAME\` vào \`main\`

- **Nhánh nguồn:** \`$BRANCH_NAME\`
- **Nhánh đích:** \`main\`
- **Người thực hiện:** @$ACTOR
- **Người duyệt:** @dtc245200494-hue
- **Commit mới nhất:** \`$COMMIT_MSG\`

---
### 📋 Trạng thái kiểm tra
- [ ] Pipeline CI (\`build\`, \`lint\`, \`test\`) báo xanh \`✅\`
- [ ] Reviewer (@dtc245200494-hue) đã kiểm tra code và bấm **Approve**

> ℹ️ *Pull Request này được hệ thống tự động khởi tạo khi có commit đẩy lên nhánh. Thành viên có thể tiếp tục push code lên nhánh này, GitHub sẽ tự động cập nhật vào PR này mà không tạo mới.*"

# 3. Tạo PR và tự động gán reviewer dtc245200494-hue (bắt lỗi nếu đã tồn tại)
CREATE_ARGS=(--base main --head "$BRANCH_NAME" --title "$TITLE" --body "$BODY")
if [ "$ACTOR" != "dtc245200494-hue" ]; then
  CREATE_ARGS+=(--reviewer "dtc245200494-hue")
fi

if OUTPUT=$(gh pr create "${CREATE_ARGS[@]}" 2>&1); then
  echo "$OUTPUT"
  echo "Created Pull Request successfully! Awaiting manual review and approval."
elif echo "$OUTPUT" | grep -qi "already exists"; then
  echo "Pull Request already exists: $OUTPUT"
  exit 0
else
  echo "$OUTPUT" >&2
  exit 1
fi

