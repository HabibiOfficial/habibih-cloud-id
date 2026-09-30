#!/usr/bin/env bash
# =========================================================
#  Deploy / update HABI API Web
#  Pakai: bash scripts/deploy.sh
# =========================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/apps/habi-api-web}"
APP_NAME="${APP_NAME:-habi-api-web}"
BIN_DIR="${BIN_DIR:-/home/deploy/bin}"

echo "▶ 1/5 Install dependency"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3

echo "▶ 2/5 Pastikan yt-dlp tersedia (dipakai endpoint native)"
mkdir -p "$BIN_DIR"
if [ ! -x "$BIN_DIR/yt-dlp" ]; then
  echo "   mengunduh yt-dlp…"
  curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    -o "$BIN_DIR/yt-dlp" && chmod +x "$BIN_DIR/yt-dlp" \
    && echo "   yt-dlp terpasang" || echo "   ⚠ gagal — endpoint native tidak akan jalan"
else
  echo "   yt-dlp sudah ada"
fi

echo "▶ 3/5 Restart via PM2"
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
if [ -f ecosystem.config.cjs ]; then
  pm2 start ecosystem.config.cjs >/dev/null 2>&1
else
  pm2 start server.js --name "$APP_NAME" --cwd "$APP_DIR" --env production >/dev/null 2>&1
fi
pm2 save >/dev/null 2>&1

echo "▶ 4/5 Reload Nginx"
sudo systemctl reload nginx 2>/dev/null || true

echo "▶ 5/5 Verifikasi"
sleep 3
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/healthz || echo 000)
echo "   healthz → HTTP $CODE"

if [ "$CODE" = "200" ]; then
  echo "✅ Deploy berhasil"
else
  echo "❌ Deploy gagal — cek 'pm2 logs $APP_NAME'"
  exit 1
fi
