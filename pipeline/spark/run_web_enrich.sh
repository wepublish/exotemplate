#!/usr/bin/env bash
# Kontinuierlicher Web-Enricher (--pool --apply), GPU-poelt, resumierbar via Manifest.
# Lock: nur eine Instanz. Wird per @reboot + taeglich gestartet (resume, wenn gestoppt).
# MODUS ab 06.07.2026: Schritt D = DE/LI-Foerderer mit Zwecktext, Spark = Shard 0/2
# (Studio = Shard 1/2). Nach Abschluss von Schritt D zurueck auf --laender CH,AT ohne Shard.
set -uo pipefail
# laeuft schon? -> nichts tun (bracket verhindert Selbsttreffer)
pgrep -f "[w]eb_enrich_daemon.py" >/dev/null && exit 0
set -a; source /home/dergeraet/.hermes/.env; set +a
export FAAS_VLLM_URL=http://127.0.0.1:8001/v1
export FAAS_DNA_MODEL=qwen3.6-27b
export DIRECTUS_URL=http://localhost:8055
cd /home/dergeraet/faas-matching-wepublish/spark
echo "--- run_web_enrich $(date +%F_%H:%M) ---" >> /home/dergeraet/faas_classify/web_enrich.log
exec python3 -u web_enrich_daemon.py --pool --apply --laender DE,LI --nur-stammdaten >> /home/dergeraet/faas_classify/web_enrich.log 2>&1
