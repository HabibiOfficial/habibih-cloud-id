#!/usr/bin/env bash
# =========================================================
#  Deploy / update HABI API Web
#  Pakai: bash scripts/deploy.sh
# =========================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/apps/habi-api-web}"
APP_NAME="${APP_NAME:-habi-api-web}"

echo "▶ 1/4 Install dependency"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3

echo "▶ 2/4 Restart via PM2"
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start server.js --name "$APP_NAME" --cwd "$APP_DIR" --env production
pm2 save >/dev/null 2>&1

echo "▶ 3/4 Reload Nginx"
sudo systemctl reload nginx 2>/dev/null || true

echo "▶ 4/4 Verifikasi"
sleep 2
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/healthz || echo 000)
echo "   healthz → HTTP $CODE"

if [ "$CODE" = "200" ]; then
  echo "✅ Deploy berhasil"
else
  echo "❌ Deploy gagal — cek 'pm2 logs $APP_NAME'"
  exit 1
fi
