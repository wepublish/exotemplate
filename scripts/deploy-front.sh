#!/usr/bin/env bash
# deploy-front.sh - Front live schalten, OHNE auf der VPS zu bauen.
#
# WARUM: Am 24.07.2026 hat `docker compose up -d --build front` auf der VPS
# `next build` gestartet. Die 2-GB-VPS ging dabei ins Swapping, SSH war tot und
# das Portal lieferte HTTP 530. Bestaetigt: der Build stirbt dort per OOM auch
# MIT 4 GB Swap. Deshalb gilt: der Build passiert IMMER hier auf dem Mac
# (linux/amd64 per buildx), das fertige Image wird uebertragen und die VPS
# startet den Container nur noch neu (`--no-build`).
#
# Synct zusaetzlich den App-Code (apps/front), damit der VPS-Baum dem Repo
# entspricht. Ruehrt .env, data/ (uploads/DB) und backups/ NICHT an - die liegen
# ausschliesslich auf der VPS.
# Voraussetzungen: laufendes Docker Desktop auf dem Mac + SSH-Zugang zur VPS.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

VPS="${FAAS_VPS:-root@167.233.56.27}"
VDIR=/root/faas
IMAGE=faas-front
TAG="$(git rev-parse --short HEAD)"
[ -z "$(git status --porcelain -- apps/front)" ] || TAG="${TAG}-dirty"

echo ">> Preflight"
docker info >/dev/null 2>&1 || { echo "FEHLER: Docker Desktop laeuft nicht (open -a Docker)."; exit 1; }
ssh -o BatchMode=yes -o ConnectTimeout=10 "$VPS" true || { echo "FEHLER: keine SSH-Verbindung zu $VPS."; exit 1; }

echo ">> Build linux/amd64 auf dem Mac  ->  $IMAGE:$TAG"
# Der Mac ist arm64, die VPS amd64 -> Cross-Build (Emulation, dauert ein paar
# Minuten). Bewusst langsamer, dafuer faellt auf der Produktion keine Last an.
docker buildx build --platform linux/amd64 \
  --build-arg "BUILD_SHA=$TAG" \
  -t "$IMAGE:$TAG" -t "$IMAGE:latest" --load apps/front

echo ">> Image uebertragen (gzip ueber ssh)"
docker save "$IMAGE:$TAG" "$IMAGE:latest" \
  | gzip -1 \
  | ssh "$VPS" 'gunzip | docker load'

echo ">> Sync apps/front  ->  $VPS:$VDIR/apps/front  (nur Code-Parity, kein Build)"
# NIE Secrets (.env*) oder OS-spezifische Build-Caches (.swc/.next) mitschicken.
rsync -az --delete \
  --exclude 'node_modules' --exclude '.next' --exclude '.swc' \
  --exclude '.git' --exclude '.env*' --exclude '.DS_Store' \
  apps/front/ "$VPS:$VDIR/apps/front/"

echo ">> docker-compose.yml angleichen (NUR diese Datei - .env und data/ bleiben unberuehrt)"
scp -q deploy/hetzner-selfcontained/docker-compose.yml "$VPS:$VDIR/deploy/hetzner-selfcontained/docker-compose.yml"

echo ">> Container auf das neue Image umstellen (KEIN Build auf der VPS)"
ssh "$VPS" "cd $VDIR/deploy/hetzner-selfcontained && docker compose up -d --no-build front"

echo ">> Verifikation (auf Front-Readiness warten)"
ssh "$VPS" 'c=000; for i in $(seq 1 30); do c=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 2>/dev/null); [ "$c" = "200" ] && break; sleep 2; done; echo "VPS  front 127.0.0.1:3000 -> $c"'
curl -sS -o /dev/null -w 'PUBLIC /portal/login -> %{http_code}\n' --max-time 20 https://fundraising.wepublish.cloud/portal/login

# Aufraeumen: jeder Deploy hinterlaesst ein getaggtes Image von ~1,5 GB.
# `docker image prune -f` erwischt die NICHT (es loescht nur unbenannte Layer) —
# darum lief die VPS-Platte am 29.07.2026 von 56 % auf 80 %, mit 16 Front-Tags.
# Jetzt: die BEHALTEN jungsten Tags bleiben (Rollback-Ziele), dazu `latest` und
# alles, was `rollback-` heisst; der Rest fliegt. Ein Image, das ein Container
# benutzt, laesst sich ohnehin nicht loeschen — docker rmi scheitert dann still.
BEHALTEN=3
echo ">> Alte faas-front-Images aufraeumen (behaelt latest, rollback-*, die $BEHALTEN jungsten)"
ssh "$VPS" "
  docker image prune -f >/dev/null
  JUNG=\$(docker images '$IMAGE' --format '{{.Tag}}' | grep -vE '^(latest|rollback-)' | head -$BEHALTEN | paste -sd'|' -)
  for T in \$(docker images '$IMAGE' --format '{{.Tag}}' | grep -vE \"^(latest|rollback-|\$JUNG)\$\"); do
    docker rmi '$IMAGE':\$T >/dev/null 2>&1 && echo \"  entfernt: \$T\"
  done
  echo '  --- verbleibend:'
  docker images '$IMAGE' --format '  {{.Repository}}:{{.Tag}} {{.Size}}'
  echo '  --- Platte:'
  df -h / | tail -1 | awk '{print \"  \" \$5 \" belegt, \" \$4 \" frei\"}'
"

echo "OK -> Deploy fertig (Image $IMAGE:$TAG)."
echo "   Build-Marke in der App (Sidebar unten): build $TAG"
echo "   Zeigt der Browser eine andere Marke, haelt der Tab einen alten Stand:"
echo "   privates Fenster oeffnen (Next.js holt das HTML-Dokument beim Navigieren nicht neu)."
echo "   Rollback: auf der VPS  FRONT_TAG=<alter-sha> docker compose up -d --no-build front"
