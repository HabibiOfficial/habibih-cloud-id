#!/usr/bin/env bash
# =========================================================
#  Setup VPS Habibih Cloud ID — Ubuntu 24.04/26.04
#  Dipakai lewat SSH. Idempoten: aman diulang.
# =========================================================
set -euo pipefail

echo "▶ 1/7 Update paket sistem"
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl ca-certificates gnupg git build-essential python3 python3-pip \
  ffmpeg tmux htop ufw fail2ban >/dev/null

echo "▶ 2/7 Swap (server kecil butuh)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "   swap 2GB aktif"
else
  echo "   swap sudah ada"
fi

echo "▶ 3/7 Node.js 20 LTS"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null 2>&1
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi
echo "   node $(node -v) | npm $(npm -v)"

echo "▶ 4/7 PM2"
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2 --silent >/dev/null 2>&1
fi
pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true
echo "   pm2 $(pm2 -v 2>/dev/null | tail -1)"

echo "▶ 5/7 User deploy (non-root)"
if ! id deploy >/dev/null 2>&1; then
  sudo useradd -m -s /bin/bash deploy
  sudo usermod -aG sudo deploy
  echo "   user 'deploy' dibuat"
else
  echo "   user 'deploy' sudah ada"
fi
sudo mkdir -p /home/deploy/apps
sudo chown -R deploy:deploy /home/deploy
echo "   /home/deploy/apps siap"

echo "▶ 6/7 Firewall (hanya 22, 80, 443)"
sudo ufw allow 22/tcp  >/dev/null
sudo ufw allow 80/tcp  >/dev/null
sudo ufw allow 443/tcp >/dev/null
sudo ufw --force enable >/dev/null
echo "   ufw: $(sudo ufw status | head -1 | sed 's/Status: //')"

echo "▶ 7/7 Batas memorable untuk proses"
if ! grep -q 'vm.swappiness' /etc/sysctl.conf; then
  echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf >/dev/null
  echo 'vm.vfs.cache_pressure=50' | sudo tee -a /etc/sysctl.conf >/dev/null
fi
sudo sysctl -p >/dev/null 2>&1 || true

echo
echo "✅ SETUP VPS SELESAI"
echo "   IP : $(curl -s -m 8 ifconfig.me)"
echo "   Node: $(node -v)   PM2: $(pm2 -v 2>/dev/null | tail -1)"
