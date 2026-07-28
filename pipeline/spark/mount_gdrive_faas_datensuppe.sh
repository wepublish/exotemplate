#!/bin/bash
# Google Drive Mount – FaaS-datensuppe (read-only)
# Quelle: Shared Drive "Admin" → Fundraising/FaaS (pro Medium ein Ordner mit 01_datensuppe/)
# Ziel:   /home/dergeraet/faas_datensuppe   (vom faas-matching-Container read-only gemountet)
MOUNT_DIR=/home/dergeraet/faas_datensuppe

if mountpoint -q "$MOUNT_DIR"; then
  echo 'Bereits gemountet.'
  exit 0
fi

mkdir -p "$MOUNT_DIR" /home/dergeraet/logs
nohup rclone mount 'gdrive-faas:Fundraising/FaaS' "$MOUNT_DIR" \
  --vfs-cache-mode minimal \
  --vfs-cache-max-size 2G \
  --allow-other \
  --read-only \
  --dir-cache-time 5m \
  --log-file /home/dergeraet/logs/rclone-faas-datensuppe.log \
  --log-level INFO < /dev/null >> /dev/null 2>&1 & disown
sleep 4
mountpoint -q "$MOUNT_DIR" && echo 'Mount OK' || echo 'Mount FEHLER'
