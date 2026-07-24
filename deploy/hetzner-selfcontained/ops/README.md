# Ops-Artefakte (Hetzner-VPS + Spark-Interim)

Stand: Cutover Spark -> Hetzner am 2026-07-24. Diese Dateien sind auf den Hosts
aktiv installiert und liegen hier versioniert, damit nichts nur "live" existiert.

## VPS `faas-hetzner` (`root@167.233.56.27`)

- `faas_vps_backup.sh` -> installiert als `/root/faas/backups/faas_vps_backup.sh`.
  Taeglicher, ballastfreier Directus-Dump + Rotation (14) + Off-Site auf die NAS.
- `faas-backup.service` / `faas-backup.timer` -> `/etc/systemd/system/`.
  Timer laeuft taeglich 02:30 UTC. Aktivieren: `systemctl enable --now faas-backup.timer`.
- Off-Site-Ziel steht in `/root/faas/backups/.offsite_target`
  (`nas-winkelried:/home/jolandaspiess/faas-hetzner-backup/`). Transfer per `cat`
  ueber SSH-Exec + sha256-Verify, weil die UGREEN-NAS rsync und SFTP wrappt/bricht.

## Spark `dergeraet@100.80.47.49` (Interim-Schreibpfad)

- `spark-faas_directus_forward.py` -> `/home/dergeraet/faas_directus_forward.py`.
  TCP-Proxy 127.0.0.1:8055 -> 100.120.78.79:8055 (VPS-Directus ueber Tailscale).
  Alle Pipeline-Schreiber zielen auf localhost:8055 und treffen so die VPS.
- `spark-faas-directus-forward.service` -> `~/.config/systemd/user/faas-directus-forward.service`
  (User-Service, Lingering aktiv -> reboot-fest). Faellt weg, sobald die Python-
  Pipeline nach TypeScript portiert ist.

## Deploy (App-Code)

Kein Git auf der VPS. Deploy laeuft vom Mac aus:
`scripts/deploy-front.sh` synct `apps/front` per rsync und baut den Front neu.
