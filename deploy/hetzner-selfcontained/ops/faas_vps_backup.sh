#!/usr/bin/env bash
# FaaS VPS Backup (B10): taeglicher ballastfreier Directus-Dump + Rotation + optionales Off-Site.
# Off-Site aktivieren: eine Zeile "user@host:/pfad/" in /root/faas/backups/.offsite_target ablegen.
set -euo pipefail
cd /root/faas/deploy/hetzner-selfcontained
BDIR=/root/faas/backups
mkdir -p "$BDIR"
STAMP=$(date +%Y%m%d_%H%M)
OUT="$BDIR/directus_db_${STAMP}.dump"

docker compose exec -T postgres pg_dump -U directus -d directus_db -Fc --no-owner --no-privileges \
  --exclude-table-data=public.directus_revisions \
  --exclude-table-data=public.directus_activity \
  --exclude-table-data=public.match_results_backup_2026_05_15 \
  </dev/null > "$OUT"

if [ ! -s "$OUT" ]; then echo "$(date -Is) FEHLER: leerer Dump $OUT" >&2; exit 1; fi
echo "$(date -Is) local dump ok: $OUT ($(du -h "$OUT" | cut -f1))"

# Rotation: 14 neueste lokale Dumps behalten
ls -1t "$BDIR"/directus_db_*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f

# Off-Site (optional): Ziel aus .offsite_target "host:/dir/".
# UGREEN NAS wrappt rsync (ug_start_server) und mappt SFTP-Pfade -> beides bricht.
# Robust: Datei per cat ueber den SSH-Exec-Kanal streamen, dann sha256 verifizieren.
if [ -s "$BDIR/.offsite_target" ]; then
  TGT=$(head -1 "$BDIR/.offsite_target")
  OHOST=${TGT%%:*}; ODIR=${TGT#*:}; ODIR=${ODIR%/}; BN=$(basename "$OUT")
  if ssh -o BatchMode=yes -o ConnectTimeout=30 "$OHOST" "cat > '$ODIR/$BN'" < "$OUT"; then
    LSHA=$(sha256sum "$OUT" | cut -d' ' -f1)
    RSHA=$(ssh -n -o BatchMode=yes "$OHOST" "sha256sum '$ODIR/$BN' 2>/dev/null | cut -d' ' -f1")
    if [ "$LSHA" = "$RSHA" ]; then
      echo "$(date -Is) offsite ok+verified -> $TGT"
      ssh -n -o BatchMode=yes "$OHOST" "ls -1t '$ODIR'/directus_db_*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f"
    else
      echo "$(date -Is) offsite SHA-MISMATCH -> $TGT" >&2
    fi
  else
    echo "$(date -Is) offsite COPY FAILED -> $TGT" >&2
  fi
fi
