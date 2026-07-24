#!/usr/bin/env bash
# ship.sh - In einem Schritt: committen+pushen (GitHub) UND auf die VPS deployen.
# So ist der deployte Stand immer identisch mit dem auf GitHub.
# Nutzung:  ./scripts/ship.sh "kurze Beschreibung der Aenderung"
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
"$D/save.sh" "$@"
"$D/deploy-front.sh"
