#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script Triển khai Môi trường Staging (S-03)
# Hỗ trợ: Pre-migration, Zero-downtime startup, Health check & Automated Rollback
# ==============================================================================

DEPLOY_DIR="${DEPLOY_DIR:-$(pwd)}"
cd "$DEPLOY_DIR"

NEW_TAG="${1:-latest}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-8080}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://localhost:${FRONTEND_PORT}/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-15}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
STATE_DIR="${DEPLOY_DIR}/.staging"
PREV_STATE_FILE="${STATE_DIR}/prev_tag"
CURRENT_STATE_FILE="${STATE_DIR}/current_tag"

mkdir -p "$STATE_DIR"

echo "========================================================"
echo " [STAGING DEPLOY] Bat dau trien khai Staging"
echo " Target Tag: ${NEW_TAG}"
echo " Time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "========================================================"

# 1. Ghi nhan phien ban hien tai de ho tro rollback neu co loi
if [ -f "$CURRENT_STATE_FILE" ]; then
  PREV_TAG=$(cat "$CURRENT_STATE_FILE")
else
  PREV_TAG="latest"
fi
echo "$PREV_TAG" > "$PREV_STATE_FILE"
echo "[Step 0/4] Ghi nhan phien ban truoc do: ${PREV_TAG}"

# 2. Dam bao co so du lieu Postgres san sang
echo "[Step 1/4] Kiem tra ket noi PostgreSQL..."
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose up -d postgres
  # Cho postgres san sang
  for i in {1..10}; do
    if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-agri_user}" -d "${POSTGRES_DB:-agri_trace}" >/dev/null 2>&1; then
      echo "PostgreSQL san sang."
      break
    fi
    sleep 2
  done

  # 3. Chay migration truoc khi khoi dong ban moi (T-06: Migration chay truoc)
  echo "[Step 2/4] Thuc hien database migration truoc khi deploy..."
  if docker compose run --rm -e NODE_ENV=production backend npm run migrate:up; then
    echo "Migration hoan tat thanh cong."
  else
    echo "LOI NGHIEM TRONG: Migration that bai! Huy trien khai ngay lap tuc de bao ve du lieu."
    exit 1
  fi

  # 4. Khoi dong ban moi
  echo "[Step 3/4] Khoi dong ban moi voi tag ${NEW_TAG}..."
  export BACKEND_TAG="${NEW_TAG}"
  export FRONTEND_TAG="${NEW_TAG}"
  docker compose up -d --remove-orphans backend frontend
else
  echo "Moi truong khong co Docker, thuc hien kiem tra migration cuc bo..."
  npm --prefix backend run migrate:up
fi

# 5. Kiem tra suc khoe (Health Check)
echo "[Step 4/4] Kiem tra suc khoe ung dung tai ${HEALTH_CHECK_URL}..."
HEALTH_OK=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  echo "Thu ket noi health check ($i/${HEALTH_RETRIES})..."
  if response=$(curl -s -f -m 5 "${HEALTH_CHECK_URL}" 2>/dev/null); then
    if echo "$response" | grep -q '"status":"ok"' && echo "$response" | grep -q '"database":"connected"'; then
      echo "Health check THANH CONG: Ung dung hoat dong tot va ket noi CSDL on dinh."
      echo "Chi tiet phan hoi: $response"
      HEALTH_OK=1
      break
    fi
  fi
  sleep "$HEALTH_INTERVAL"
done

# 6. Rollback neu Health Check that bai
if [ "$HEALTH_OK" -ne 1 ]; then
  echo "========================================================"
  echo "CANH BAO NGUY HIEM: Ban moi ${NEW_TAG} khong vuot qua Health Check!"
  echo "Tien hanh TU DONG KHOI PHUC (Rollback) ve ban cu: ${PREV_TAG}..."
  echo "========================================================"

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    export BACKEND_TAG="${PREV_TAG}"
    export FRONTEND_TAG="${PREV_TAG}"
    docker compose up -d --remove-orphans backend frontend
    echo "Da phat lenh khoi phuc ban cu ${PREV_TAG}."
    sleep 5
    if curl -s -f -m 5 "${HEALTH_CHECK_URL}" >/dev/null 2>&1; then
      echo "Khoi phuc thanh cong ban truoc: ${PREV_TAG} dang phuc vu."
    fi
  fi

  echo "Danh dau pipeline THAT BAI (Do) de canh bao doi ngu phat trien."
  exit 1
fi

echo "$NEW_TAG" > "$CURRENT_STATE_FILE"
echo "========================================================"
echo " Trien khai Staging THANH CONG TOAN DIEN!"
echo " Phien ban hien tai: ${NEW_TAG}"
echo "========================================================"
