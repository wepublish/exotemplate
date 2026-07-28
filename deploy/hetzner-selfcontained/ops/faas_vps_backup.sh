#!/usr/bin/env bash
# FaaS VPS Backup (B10): taeglicher ballastfreier Directus-Dump + Rotation + optionales Off-Site.
# Off-Site aktivieren: eine Zeile "user@host:/pfad/" in /root/faas/backups/.offsite_target ablegen.
#
# Seit 28.07.2026 sichert das Skript zusaetzlich die Directus-Dateien
# (data/uploads): die Bytes der Uploads liegen NICHT in der Datenbank
# (directus_files hat keine Blob-Spalte, storage=local), ein Dump allein
# ergaebe beim Restore 41+ Dateizeilen ohne Inhalt. Reihenfolge bewusst:
# erst Dump, dann Dateien - so entsteht schlimmstenfalls eine Datei ohne
# DB-Zeile (harmlos, naechster Lauf erfasst sie), nie eine DB-Zeile ohne Bytes.
set -euo pipefail
cd /root/faas/deploy/hetzner-selfcontained
BDIR=/root/faas/backups
mkdir -p "$BDIR"
STAMP=$(date +%Y%m%d_%H%M)
OUT="$BDIR/directus_db_${STAMP}.dump"
UPL="$BDIR/uploads_${STAMP}.tgz"

docker compose exec -T postgres pg_dump -U directus -d directus_db -Fc --no-owner --no-privileges \
  --exclude-table-data=public.directus_revisions \
  --exclude-table-data=public.directus_activity \
  --exclude-table-data=public.match_results_backup_2026_05_15 \
  </dev/null > "$OUT"

if [ ! -s "$OUT" ]; then echo "$(date -Is) FEHLER: leerer Dump $OUT" >&2; exit 1; fi
echo "$(date -Is) local dump ok: $OUT ($(du -h "$OUT" | cut -f1))"

# Dateien (Directus-Uploads) als tgz, mit Bestandskontrolle: Anzahl im Archiv
# muss der Anzahl im Verzeichnis entsprechen, sonst gilt der Lauf als Fehler.
tar czf "$UPL" -C data uploads
ANZ_FS=$(find data/uploads -type f | wc -l)
ANZ_TAR=$(tar tzf "$UPL" | grep -cv '/$')
if [ ! -s "$UPL" ] || [ "$ANZ_FS" != "$ANZ_TAR" ]; then
  echo "$(date -Is) FEHLER: uploads-Archiv unvollstaendig ($ANZ_TAR von $ANZ_FS Dateien)" >&2
  exit 1
fi
echo "$(date -Is) local uploads ok: $UPL ($(du -h "$UPL" | cut -f1), $ANZ_TAR Dateien)"

# Rotation: 14 neueste lokale Dumps behalten; Uploads-Archive ebenso.
ls -1t "$BDIR"/directus_db_*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$BDIR"/uploads_*.tgz 2>/dev/null | tail -n +15 | xargs -r rm -f

# Off-Site (optional): Ziel aus .offsite_target "host:/dir/".
# UGREEN NAS wrappt rsync (ug_start_server) und mappt SFTP-Pfade -> beides bricht.
# Robust: Datei per cat ueber den SSH-Exec-Kanal streamen, dann sha256 verifizieren.
offsite_datei() {
  # $1 = lokale Datei, $2 = Rotations-Glob auf der Gegenseite
  local SRC="$1" GLOB="$2" BN LSHA RSHA
  BN=$(basename "$SRC")
  if ssh -o BatchMode=yes -o ConnectTimeout=30 "$OHOST" "cat > '$ODIR/$BN'" < "$SRC"; then
    LSHA=$(sha256sum "$SRC" | cut -d' ' -f1)
    RSHA=$(ssh -n -o BatchMode=yes "$OHOST" "sha256sum '$ODIR/$BN' 2>/dev/null | cut -d' ' -f1")
    if [ "$LSHA" = "$RSHA" ]; then
      echo "$(date -Is) offsite ok+verified -> $OHOST:$ODIR/$BN"
      ssh -n -o BatchMode=yes "$OHOST" "ls -1t $ODIR/$GLOB 2>/dev/null | tail -n +15 | xargs -r rm -f"
    else
      echo "$(date -Is) offsite SHA-MISMATCH -> $OHOST:$ODIR/$BN" >&2
    fi
  else
    echo "$(date -Is) offsite COPY FAILED -> $OHOST:$ODIR/$BN" >&2
  fi
}

if [ -s "$BDIR/.offsite_target" ]; then
  TGT=$(head -1 "$BDIR/.offsite_target")
  OHOST=${TGT%%:*}; ODIR=${TGT#*:}; ODIR=${ODIR%/}
  offsite_datei "$OUT" "directus_db_*.dump"
  offsite_datei "$UPL" "uploads_*.tgz"
fi
