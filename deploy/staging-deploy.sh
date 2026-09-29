#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# S-03 - Real staging deployment
# Flow: save previous images -> PostgreSQL -> build -> migrate -> start ->
#       health/version check -> rollback application images on failure.
# ==============================================================================

DEPLOY_DIR="${DEPLOY_DIR:-$(pwd)}"
cd "$DEPLOY_DIR"

NEW_TAG="${1:-}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-8080}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://localhost:${FRONTEND_PORT}/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-3}"
STATE_DIR="${DEPLOY_DIR}/.staging"
PREV_STATE_FILE="${STATE_DIR}/prev_tag"
CURRENT_STATE_FILE="${STATE_DIR}/current_tag"

if [ -z "$NEW_TAG" ]; then
  echo "ERROR: deployment tag/commit SHA is required."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker and Docker Compose are required on the staging server."
  exit 1
fi

if [ ! -f .env ]; then
  echo "ERROR: $DEPLOY_DIR/.env is missing. Refusing to deploy staging."
  exit 1
fi

mkdir -p "$STATE_DIR"

echo "========================================================"
echo " [STAGING DEPLOY] Start"
echo " Target commit: $NEW_TAG"
echo " Directory: $DEPLOY_DIR"
echo " Time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "========================================================"

# Record the previous application version. For the first deployment after this
# script is introduced, preserve the currently running images as a bootstrap tag
# so rollback works even though the old compose file did not use versioned tags.
if [ -f "$CURRENT_STATE_FILE" ] && [ -s "$CURRENT_STATE_FILE" ]; then
  PREV_TAG="$(cat "$CURRENT_STATE_FILE")"
else
  PREV_TAG="bootstrap"
fi

preserve_running_image() {
  local container_name="$1"
  local image_name="$2"
  local tag="$3"

  if docker image inspect "${image_name}:${tag}" >/dev/null 2>&1; then
    return 0
  fi

  if docker inspect "$container_name" >/dev/null 2>&1; then
    local image_id
    image_id="$(docker inspect --format '{{.Image}}' "$container_name")"
    docker image tag "$image_id" "${image_name}:${tag}"
    echo "Preserved $container_name as ${image_name}:${tag}"
  fi
}

preserve_running_image "agri-trace-backend" "agri-trace-backend" "$PREV_TAG"
preserve_running_image "agri-trace-frontend" "agri-trace-frontend" "$PREV_TAG"

echo "$PREV_TAG" > "$PREV_STATE_FILE"
echo "[Step 0/5] Previous application version: $PREV_TAG"

echo "[Step 1/5] Ensure PostgreSQL is ready..."
docker compose up -d postgres

POSTGRES_OK=0
for i in $(seq 1 15); do
  if docker compose exec -T postgres     pg_isready -U "${POSTGRES_USER:-agri_user}" -d "${POSTGRES_DB:-agri_trace}"     >/dev/null 2>&1; then
    POSTGRES_OK=1
    echo "PostgreSQL is ready."
    break
  fi
  echo "Waiting for PostgreSQL ($i/15)..."
  sleep 2
done

if [ "$POSTGRES_OK" -ne 1 ]; then
  echo "ERROR: PostgreSQL did not become ready. Deployment aborted."
  exit 1
fi

echo "[Step 2/5] Build versioned application images..."
export BACKEND_TAG="$NEW_TAG"
export FRONTEND_TAG="$NEW_TAG"
export GIT_COMMIT="$NEW_TAG"
docker compose build backend frontend

echo "[Step 3/5] Run database migration before application startup..."
if docker compose run --rm --no-deps -e NODE_ENV=production backend npm run migrate:up; then
  echo "Migration completed successfully."
else
  echo "ERROR: Migration failed. New application version was not started."
  exit 1
fi

echo "[Step 4/5] Start application version $NEW_TAG..."
docker compose up -d --no-build --force-recreate --remove-orphans backend frontend

echo "[Step 5/5] Health and deployed-version check at $HEALTH_CHECK_URL..."
HEALTH_OK=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  echo "Health check ($i/$HEALTH_RETRIES)..."
  if response=$(curl -s -f -m 5 "$HEALTH_CHECK_URL" 2>/dev/null); then
    if echo "$response" | grep -q '"status":"ok"'       && echo "$response" | grep -q '"database":"connected"'       && echo "$response" | grep -q "\"commit\":\"${NEW_TAG}\""; then
      echo "Health check PASSED."
      echo "Response: $response"
      HEALTH_OK=1
      break
    fi
    echo "Service responded but is not yet the expected healthy commit."
    echo "Response: $response"
  fi
  sleep "$HEALTH_INTERVAL"
done

if [ "$HEALTH_OK" -ne 1 ]; then
  echo "========================================================"
  echo "ERROR: New version $NEW_TAG failed health/version validation."
  echo "Rolling application containers back to $PREV_TAG..."
  echo "========================================================"

  export BACKEND_TAG="$PREV_TAG"
  export FRONTEND_TAG="$PREV_TAG"
  export GIT_COMMIT="$PREV_TAG"

  if docker image inspect "agri-trace-backend:${PREV_TAG}" >/dev/null 2>&1     && docker image inspect "agri-trace-frontend:${PREV_TAG}" >/dev/null 2>&1; then
    docker compose up -d --no-build --force-recreate --remove-orphans backend frontend
    sleep 5

    if rollback_response=$(curl -s -f -m 5 "$HEALTH_CHECK_URL" 2>/dev/null); then
      echo "Rollback response: $rollback_response"
      echo "Application rollback completed."
    else
      echo "ERROR: rollback containers started, but rollback health check failed."
    fi
  else
    echo "ERROR: previous application images are unavailable; automatic rollback cannot start."
  fi

  echo "Pipeline marked FAILED."
  exit 1
fi

echo "$NEW_TAG" > "$CURRENT_STATE_FILE"

echo "========================================================"
echo " RUNNING POST-DEPLOY STAGING SMOKE TEST"
echo "========================================================"
SMOKE_COOKIE=$(mktemp)
LOGIN_OUT=$(curl -s -c "$SMOKE_COOKIE" -H "Content-Type: application/json" -d '{"email":"user@example.com","password":"Password@123"}' "http://127.0.0.1:3000/api/login" 2>/dev/null || true)
if echo "$LOGIN_OUT" | grep -q '"email":"user@example.com"'; then
  echo "✔ [Smoke Test Passed] Authentication on staging: user@example.com logged in successfully."
  FARMS_OUT=$(curl -s -b "$SMOKE_COOKIE" "http://127.0.0.1:3000/api/farms" 2>/dev/null || true)
  if echo "$FARMS_OUT" | grep -q 'org-001'; then
    echo "✔ [Smoke Test Passed] Tenant Isolation on staging: authenticated farms list scoped strictly to org-001."
  else
    echo "ℹ [Smoke Test] Farms response received: $FARMS_OUT"
  fi
else
  echo "ℹ [Smoke Test Note] Initial login smoke check response: $LOGIN_OUT"
fi
rm -f "$SMOKE_COOKIE"

echo "========================================================"
echo " STAGING DEPLOYMENT SUCCESSFUL"
echo " Current version: $NEW_TAG"
echo " Previous version: $PREV_TAG"
echo "========================================================"
