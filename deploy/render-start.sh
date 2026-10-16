#!/usr/bin/env sh
set -e

# ==============================================================================
# S-11 Render Container Startup Script
# 1. Runs database schema migrations as agri_migration (via MIGRATION_DATABASE_URL)
# 2. Configures runtime DATABASE_URL strictly as agri_app role
# 3. Starts the backend application server
# ==============================================================================

if [ -n "$MIGRATION_DATABASE_URL" ]; then
  echo "[Render Bootstrap] Running schema migrations with MIGRATION_DATABASE_URL..."
  node src/migrate.js up || echo "[Render Bootstrap] Migration notice: continuing..."
fi

if [ -n "$MIGRATION_DATABASE_URL" ] && [ -n "$APP_DB_PASSWORD" ]; then
  APP_DATABASE_URL=$(echo "$MIGRATION_DATABASE_URL" | sed -E "s|postgresql://[^:]+:[^@]+@|postgresql://agri_app:${APP_DB_PASSWORD}@|")
  export DATABASE_URL="$APP_DATABASE_URL"
  echo "[Render Bootstrap] Configured backend DATABASE_URL with restricted 'agri_app' user."
fi

exec node src/server.js
