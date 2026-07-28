#!/usr/bin/env bash
# verify-spark.sh - vergleicht die auf dem Spark DEPLOYTEN Pipeline-Dateien mit
# dem Repo-Stand und meldet jede Abweichung.
#
# WARUM: Am 27.07.2026 galt der Engine-Teil von Welle 1 drei Tage als «live» und
# war wirkungslos. Die deployte Datei stimmte mit dem Repo ueberein, alle Tests
# waren gruen - nur fuehrte der Cron eine ANDERE Kopie aus. Der Fehler war
# unsichtbar, weil niemand «was laeuft wirklich» gegen «was steht im Repo»
# gehalten hat. Genau das macht dieses Skript, und zwar aus pipeline/MANIFEST.tsv,
# das fuer jede Datei den tatsaechlichen Deploy-Pfad festhaelt.
#
# Aufruf:  scripts/verify-spark.sh            (nur pruefen)
#          scripts/verify-spark.sh --leise    (nur Abweichungen zeigen)
# Rueckgabe: 0 = alles deckungsgleich, 1 = Abweichung oder fehlende Datei.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

SPARK="${FAAS_SPARK:-spark-tailscale}"
MANIFEST=pipeline/MANIFEST.tsv
LEISE=0
[ "${1:-}" = "--leise" ] && LEISE=1

[ -f "$MANIFEST" ] || { echo "FEHLER: $MANIFEST fehlt."; exit 1; }
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SPARK" true 2>/dev/null \
  || { echo "FEHLER: kein SSH-Zugang zu $SPARK (Tailscale laeuft?)."; exit 1; }

# Repo-Kopie einer Manifest-Datei finden (spark/ oder systemd/).
repo_pfad() {
  if   [ -f "pipeline/spark/$1" ];   then echo "pipeline/spark/$1"
  elif [ -f "pipeline/systemd/$1" ]; then echo "pipeline/systemd/$1"
  else echo ""; fi
}

# Alle Deploy-Pfade in EINEM ssh-Aufruf hashen (sonst dauert es ewig).
PFADE=$(awk -F'\t' '!/^#/ && NR>1 && $2 != "-" && $2 != "" {print $2}' "$MANIFEST")
REMOTE=$(printf '%s\n' "$PFADE" | ssh -o BatchMode=yes "$SPARK" \
  'while read -r p; do if [ -f "$p" ]; then echo "$(md5sum "$p" | cut -d" " -f1) $p"; else echo "FEHLT $p"; fi; done')

ok=0; drift=0; fehlt=0; ohne_repo=0
while IFS=$'\t' read -r datei deploy takt zweck; do
  case "$datei" in ''|'#'*|datei) continue;; esac
  [ "$deploy" = "-" ] && continue

  rp="$(repo_pfad "$datei")"
  if [ -z "$rp" ]; then
    echo "OHNE REPO-KOPIE  $datei"; ohne_repo=$((ohne_repo+1)); continue
  fi

  rhash=$(printf '%s\n' "$REMOTE" | awk -v p="$deploy" '$2==p {print $1; exit}')
  if [ "$rhash" = "FEHLT" ] || [ -z "$rhash" ]; then
    echo "FEHLT AUF SPARK  $datei  ($deploy)"; fehlt=$((fehlt+1)); continue
  fi

  lhash=$(md5 -q "$rp" 2>/dev/null || md5sum "$rp" | cut -d' ' -f1)
  if [ "$rhash" = "$lhash" ]; then
    ok=$((ok+1)); [ "$LEISE" = 1 ] || echo "ok               $datei"
  else
    echo "ABWEICHEND       $datei"
    echo "                 Repo:  $rp"
    echo "                 Spark: $deploy"
    drift=$((drift+1))
  fi
done < "$MANIFEST"

echo
echo "deckungsgleich: $ok | abweichend: $drift | fehlt auf dem Spark: $fehlt | ohne Repo-Kopie: $ohne_repo"
if [ "$drift" -gt 0 ] || [ "$fehlt" -gt 0 ] || [ "$ohne_repo" -gt 0 ]; then
  echo
  echo "Abweichung heisst: der Spark fuehrt etwas anderes aus als im Repo steht."
  echo "Erst klaeren WELCHE Fassung gilt, dann angleichen - nicht blind ueberschreiben."
  exit 1
fi
echo "Der Spark fuehrt genau den Repo-Stand aus."
