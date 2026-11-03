#!/usr/bin/env bash
# Runs on the VM as root after the repo is synced to /opt/blast-door. Idempotent.
set -euo pipefail
cd /opt/blast-door
IP="$(curl -fsS4 --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
HOST="${IP//./-}.sslip.io"

id blastdoor >/dev/null 2>&1 || useradd --system --home /var/lib/blast-door --shell /usr/sbin/nologin blastdoor
usermod -aG docker blastdoor
install -d -o blastdoor -g blastdoor -m 750 /var/lib/blast-door
install -d -o root -g root -m 755 /etc/blast-door
if [ ! -f /etc/blast-door/app.env ]; then
  sed "s#https://66-135-31-133.sslip.io#https://$HOST#" deploy/app.env.example > /etc/blast-door/app.env
  echo "BLASTDOOR_OPERATOR_KEY=$(openssl rand -hex 16)" >> /etc/blast-door/app.env
fi
chmod 640 /etc/blast-door/app.env && chgrp blastdoor /etc/blast-door/app.env
[ -f /etc/blast-door/env ] || { echo "missing /etc/blast-door/env (VULTR_INFERENCE_API_KEY)"; exit 1; }
chown root:root /etc/blast-door/env && chmod 600 /etc/blast-door/env

if ! command -v caddy >/dev/null; then
  apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q >/dev/null && apt-get install -y -q caddy >/dev/null
fi
install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=BLASTDOOR_HOST=%s\n' "$HOST" > /etc/systemd/system/caddy.service.d/blastdoor.conf

chown -R blastdoor:blastdoor /opt/blast-door
sudo -u blastdoor -H bash -c 'cd /opt/blast-door && npm ci --no-audit --no-fund --loglevel=error && npx next build >/tmp/bd-build.log 2>&1 || { tail -40 /tmp/bd-build.log; exit 1; }'
docker build -q -t blastdoor/sandbox:1 sandbox >/dev/null

for u in blast-door-net blast-door-worker blast-door-app blast-door-fixtures; do install -m 644 deploy/$u.service /etc/systemd/system/; done
systemctl daemon-reload
systemctl enable --now blast-door-net >/dev/null
systemctl enable blast-door-worker blast-door-app blast-door-fixtures caddy >/dev/null 2>&1
systemctl restart blast-door-fixtures blast-door-worker blast-door-app caddy
echo "deployed: https://$HOST"
