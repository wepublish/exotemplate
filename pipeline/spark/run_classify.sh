#!/usr/bin/env bash
# FaaS Vor-Klassifikator: erst LI, dann DE. Autonom, resumierbar, vLLM (kein OOM neben web_enrich).
# Lock verhindert Doppellauf (initialer nohup + Cron-Resume teilen sich den Lock).
set -u
cd "$HOME/faas_classify" || exit 1
export DIRECTUS_URL=http://localhost:8055
export LLM_URL=http://127.0.0.1:8001/v1
export LLM_MODEL=qwen3.6-27b

LOCK="$HOME/faas_classify/classify.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date -Is) classify: schon aktiv (lock), exit"
  exit 0
fi

echo "=== $(date -Is) classify START (LI -> DE) ==="
python3 classify_runner.py --land LI --workers 3 --run-id classify_li
echo "--- $(date -Is) LI durch, weiter mit DE ---"
python3 classify_runner.py --land DE --workers 3 --run-id classify_de
echo "=== $(date -Is) classify FERTIG (LI+DE) ==="
