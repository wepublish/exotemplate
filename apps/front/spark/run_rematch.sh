#!/usr/bin/env bash
# Periodischer Re-Match: holt web-veredelte/neu gemessene Stiftungen in die Matches.
# Warmer Cache -> nur geaenderte DNA-Versionen werden frisch gescort (Auto-Invalidierung),
# der Rest sind Cache-Treffer. MATCH_MIN_SCORE=10 (Floor; App zeigt ab 20).
#
# Medienliste DYNAMISCH aus Directus: alle aktiven Medien mit aktiver medium_dna.
# Die hartkodierte Liste (bis 07/2026) liess neue Medien (zwolf) dauerhaft ohne
# Treffer. Fallback auf die alte statische Liste, falls Directus nicht antwortet.
set -uo pipefail
pgrep -f "[r]un_rematch.sh.*childlock" >/dev/null && exit 0
set -a; source /home/dergeraet/.hermes/.env; set +a
export MATCH_MIN_SCORE=10
export FAAS_LLM_BACKEND=vllm
export TOP_N_PER_MEDIUM=400

MEDIEN=$(python3 - <<'PY'
import json, os, urllib.request
tok = os.environ.get("DIRECTUS_TOKEN", "")
base = "http://localhost:8055"

def get(path):
    r = urllib.request.Request(base + path, headers={"Authorization": f"Bearer {tok}"})
    with urllib.request.urlopen(r, timeout=20) as x:
        return json.load(x).get("data", [])

try:
    dna = {d.get("medium_id") for d in get(
        "/items/medium_dna?filter[is_active][_eq]=true&fields=medium_id&limit=-1")}
    aktiv = [m.get("slug") for m in get(
        "/items/faas_medien?filter[is_active][_eq]=true&fields=slug&limit=-1")]
    slugs = [s for s in aktiv if s and s in dna]
    if not slugs:
        raise RuntimeError("leere Medienliste")
    print(" ".join(slugs))
except Exception:
    # Fallback: statische Liste, damit der Cron nie leer laeuft
    print("wepublish cueltuer neue_wege bajour ee-news ganzgraz")
PY
)

cd /home/dergeraet/.hermes/data/faas
echo "--- run_rematch $(date +%F_%H:%M) | Medien: $MEDIEN ---" >> /home/dergeraet/faas_classify/rematch_cron.log
for m in $MEDIEN; do
  python3 match_engine.py --medium "$m" >> /home/dergeraet/faas_classify/rematch_cron.log 2>&1
done
echo "--- run_rematch fertig $(date +%F_%H:%M) ---" >> /home/dergeraet/faas_classify/rematch_cron.log
