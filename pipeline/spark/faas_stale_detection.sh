#!/usr/bin/env bash
# faas_stale_detection.sh — Woechentliche Stale-Pruefung der wichtigsten Stiftungen.
#
# Holt Top-N Stiftungen nach Schaerfe/Match-Frequenz aus Directus,
# macht HEAD-Request gegen ihre Webseite, vergleicht Last-Modified mit dem
# letzten gespeicherten Wert, und postet Aenderungen an Jolandas Slack-DM.
#
# Cache-Datei: ~/scripts/.faas_stale_cache.json (host -> last_modified_iso)
#
# Aufruf:
#   ./faas_stale_detection.sh [--top N] [--no-slack] [--dry-run]
#
# Cron (Sonntag 04:00):
#   0 4 * * 0 /usr/bin/bash $HOME/scripts/faas_stale_detection.sh --top 200 >> $HOME/logs/stale.log 2>&1

set -euo pipefail

TOP=${TOP:-200}
NO_SLACK=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --top) TOP="$2"; shift 2;;
    --no-slack) NO_SLACK=1; shift;;
    --dry-run) DRY_RUN=1; shift;;
    *) echo "unknown arg $1"; exit 2;;
  esac
done

# Env laden
if [[ -f "$HOME/.hermes/.env" ]]; then
  set -a; source "$HOME/.hermes/.env"; set +a
fi

DIRECTUS_URL="${DIRECTUS_URL:-http://localhost:8055}"
: "${DIRECTUS_TOKEN:?DIRECTUS_TOKEN missing}"

CACHE="$HOME/scripts/.faas_stale_cache.json"
mkdir -p "$(dirname "$CACHE")"
[[ -f "$CACHE" ]] || echo "{}" > "$CACHE"

JOLANDA_DM="U09PXNV7JS3"

# SLACK_BOT_TOKEN aus bridge-mcp-config holen wenn nicht gesetzt
if [[ -z "${SLACK_BOT_TOKEN:-}" && -f "$HOME/claude-bridge/mcp-config.json" ]]; then
  SLACK_BOT_TOKEN=$(python3 -c "
import json,sys
cfg = json.load(open('$HOME/claude-bridge/mcp-config.json'))
print((cfg.get('mcpServers',{}).get('slack',{}).get('env',{}) or {}).get('SLACK_BOT_TOKEN',''))
" || true)
fi

echo "[$(date -Iseconds)] stale-detection: holen Top $TOP Foerderstiftungen mit webseite"

# Hole Top-N: ist_foerderstiftung=true mit webseite, sortiert nach datenqualitaet (verifiziert zuerst)
FILTER='{"_and":[{"ist_foerderstiftung":{"_eq":true}},{"webseite":{"_nempty":true}}]}'
LIST_JSON=$(curl -s -G \
  -H "Authorization: Bearer $DIRECTUS_TOKEN" \
  --data-urlencode "filter=$FILTER" \
  --data-urlencode "fields=id,Stiftungsname,webseite,datenqualitaet" \
  --data-urlencode "sort=datenqualitaet,Stiftungsname" \
  --data-urlencode "limit=$TOP" \
  "$DIRECTUS_URL/items/stiftungen")

CHECKED=0
CHANGED=0
FAILED=0
CHANGES_FILE=$(mktemp)
echo "[]" > "$CHANGES_FILE"

# Iterate stiftungen (jq notation; falls jq nicht da, python fallback)
python3 - "$LIST_JSON" "$CACHE" "$CHANGES_FILE" "$DRY_RUN" << 'PYEOF'
import json, sys, urllib.request, urllib.error
from urllib.parse import urlsplit

list_json, cache_path, changes_path, dry = sys.argv[1:5]
data = json.loads(list_json).get("data", [])
cache = json.load(open(cache_path))

def head(url):
    try:
        req = urllib.request.Request(url, method="HEAD",
            headers={"User-Agent": "FaaS-StaleDetection/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            lm = r.headers.get("Last-Modified") or r.headers.get("ETag") or "200-no-modtime"
            return lm
    except urllib.error.HTTPError as e:
        # Try GET if HEAD blocked
        if e.code in (403, 405, 501):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=15) as r:
                    return r.headers.get("Last-Modified") or r.headers.get("ETag") or f"GET-{r.status}"
            except Exception as ee:
                return f"ERR:{ee.__class__.__name__}"
        return f"HTTP-{e.code}"
    except Exception as e:
        return f"ERR:{e.__class__.__name__}"

changes = []
checked = 0
for st in data:
    url = (st.get("webseite") or "").strip()
    if not url:
        continue
    if not url.startswith(("http://", "https://")):
        url = "https://" + url.lstrip("/")
    host = urlsplit(url).netloc.lower()
    if not host:
        continue
    sig = head(url)
    checked += 1
    prev = cache.get(host)
    cache[host] = sig
    if prev and prev != sig and not sig.startswith(("ERR", "HTTP")):
        changes.append({
            "id": st.get("id"),
            "name": st.get("Stiftungsname"),
            "url": url,
            "old": prev,
            "new": sig,
        })

print(f"checked={checked} changes={len(changes)}", file=sys.stderr)

if dry == "1":
    print("[DRY-RUN] cache nicht geschrieben", file=sys.stderr)
else:
    json.dump(cache, open(cache_path, "w"), indent=2)

json.dump(changes, open(changes_path, "w"), ensure_ascii=False)
PYEOF

CHANGES_COUNT=$(python3 -c "import json; print(len(json.load(open('$CHANGES_FILE'))))")

echo "[$(date -Iseconds)] stale-detection fertig. $CHANGES_COUNT Aenderungen entdeckt."

# Slack-Post wenn Aenderungen
if [[ "$CHANGES_COUNT" -gt 0 && "$NO_SLACK" -eq 0 && -n "${SLACK_BOT_TOKEN:-}" ]]; then
  MSG=$(python3 -c "
import json
ch = json.load(open('$CHANGES_FILE'))
top = ch[:15]
lines = [f'*Stale-Detection: $CHANGES_COUNT Stiftungen-Webseiten haben sich geaendert*', '']
for c in top:
    lines.append(f'- *{c[\"name\"]}* — {c[\"url\"]}')
if len(ch) > 15:
    lines.append(f'  ... +{len(ch)-15} weitere')
print('\\n'.join(lines))
")
  curl -s -X POST https://slack.com/api/chat.postMessage \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    --data-binary @<(python3 -c "import json,sys; print(json.dumps({'channel':'$JOLANDA_DM','text':sys.stdin.read()}))" <<< "$MSG") \
    > /dev/null
  echo "Slack-DM gesendet."
fi

rm -f "$CHANGES_FILE"
