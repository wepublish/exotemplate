#!/usr/bin/env bash
#
# FaaS-Stack Health-Probe
# Prueft alle 15 Min: claude-bridge, hermes-gateway, workspace, Directus, Qdrant.
# Bei Ausfall: Slack-DM an Jolanda + Restart-Versuch fuer Service-State.
#
# State-File: ~/.hermes/data/faas/health_state.json
# Verhindert Spam: Ein Alert pro Komponente pro Outage.

set -uo pipefail

STATE=~/.hermes/data/faas/health_state.json
mkdir -p "$(dirname "$STATE")"
[ -f "$STATE" ] || echo '{}' > "$STATE"

SLACK_TOKEN=$(grep "^SLACK_BOT_TOKEN=" ~/.hermes/.env | cut -d= -f2)
# Directus-Token aus der Secret-Datei, NIE hartkodiert (Bereinigung 2026-07-28,
# vorher stand hier ein statischer Token im Klartext).
DIRECTUS_TOKEN=$(grep "^DIRECTUS_TOKEN=" ~/.hermes/.env | cut -d= -f2)
JOLANDA_DM=U09PXNV7JS3

post_slack() {
    local text="$1"
    if [ -n "$SLACK_TOKEN" ]; then
        curl -sS -m 5 -X POST https://slack.com/api/chat.postMessage \
            -H "Authorization: Bearer $SLACK_TOKEN" \
            -H "Content-Type: application/json; charset=utf-8" \
            -d "{\"channel\":\"$JOLANDA_DM\",\"text\":\"$text\"}" > /dev/null || true
    fi
}

check_and_alert() {
    local name="$1"
    local cmd="$2"
    local prev=$(python3 -c "import json; d=json.load(open('$STATE')); print(d.get('$name','ok'))")
    if eval "$cmd" >/dev/null 2>&1; then
        # OK
        if [ "$prev" = "down" ]; then
            post_slack "FaaS-Health: *$name* ist wieder erreichbar."
        fi
        python3 -c "import json; d=json.load(open('$STATE')); d['$name']='ok'; json.dump(d, open('$STATE','w'))"
    else
        # FAIL
        if [ "$prev" != "down" ]; then
            post_slack "FaaS-Health Alert: *$name* meldet Ausfall. Spark pruefen, ggf. systemctl restart."
        fi
        python3 -c "import json; d=json.load(open('$STATE')); d['$name']='down'; json.dump(d, open('$STATE','w'))"
    fi
}

# DEACTIVATED 2026-05-28 (Bridge architektur-tot seit 1.5.) check_and_alert "claude-bridge" "curl -sS -m 3 -f http://127.0.0.1:11436/healthz"
# DEACTIVATED 2026-05-28 (Gateway nicht produktiv) check_and_alert "hermes-gateway" "curl -sS -m 3 -f http://127.0.0.1:8642/v1/models"
# DEACTIVATED 2026-05-28 (Workspace-UI separat monitoren) check_and_alert "workspace-ui" "curl -sS -m 3 -f -o /dev/null http://127.0.0.1:3000/"
check_and_alert "directus" "curl -sS -m 3 -f -H 'Authorization: Bearer $DIRECTUS_TOKEN' http://localhost:8055/users/me"
check_and_alert "qdrant" "curl -sS -m 3 -f http://localhost:6333/collections"
check_and_alert "vllm" "curl -sS -m 5 -f http://localhost:8001/v1/models"

# Brief log
echo "[$(date -u +%FT%TZ)] health-probe done. State:"
cat "$STATE"
