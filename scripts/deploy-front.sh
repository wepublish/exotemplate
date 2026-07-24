#!/usr/bin/env bash
# deploy-front.sh - Front-Code auf die Hetzner-VPS spielen und Container neu bauen.
# Synct NUR den App-Code (apps/front). Ruehrt .env, data/ (uploads/DB) und backups/
# NICHT an - die liegen ausschliesslich auf der VPS.
# Voraussetzung: SSH-Zugang zur VPS (Mac ist die Quelle der Wahrheit).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

VPS="${FAAS_VPS:-root@167.233.56.27}"
VDIR=/root/faas

echo ">> Sync apps/front  ->  $VPS:$VDIR/apps/front"
# NIE Secrets (.env*) oder OS-spezifische Build-Caches (.swc/.next) mitschicken.
rsync -az --delete \
  --exclude 'node_modules' --exclude '.next' --exclude '.swc' \
  --exclude '.git' --exclude '.env*' --exclude '.DS_Store' \
  apps/front/ "$VPS:$VDIR/apps/front/"

echo ">> Front-Container neu bauen"
ssh "$VPS" "cd $VDIR/deploy/hetzner-selfcontained && docker compose up -d --build front"

echo ">> Verifikation (auf Front-Readiness warten)"
ssh "$VPS" 'cd /root/faas/deploy/hetzner-selfcontained; c=000; for i in $(seq 1 30); do c=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 2>/dev/null); [ "$c" = "200" ] && break; sleep 2; done; echo "VPS  front 127.0.0.1:3000 -> $c"'
curl -sS -o /dev/null -w 'PUBLIC /portal/login -> %{http_code}\n' --max-time 20 https://fundraising.wepublish.cloud/portal/login
echo "OK -> Deploy fertig."
