#!/usr/bin/env bash
# save.sh - Alles committen und zu GitHub (wepublish/faas) pushen.
# Zweck: nichts bleibt lokal uncommitted liegen; Lukas sieht denselben Stand.
# Nutzung:  ./scripts/save.sh "kurze Beschreibung der Aenderung"
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

MSG="${*:-WIP $(date +%F_%H:%M)}"
BR="$(git branch --show-current)"

git add -A
if git diff --cached --quiet; then
  echo "Keine neuen Aenderungen zum Committen."
else
  git commit -m "$MSG"
fi

# Push (setzt Upstream, falls der Branch neu ist)
git push -u origin "$BR"
echo "OK -> auf GitHub: wepublish/faas  ($BR)"
