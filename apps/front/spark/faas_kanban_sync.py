#!/usr/bin/env python3
"""
FaaS-Kanban-Sync — spiegelt den Antrags-Kanban aus Directus in einen Slack-Canvas.

Einbahn (Push): Directus `applications` ist die Wahrheit, der Slack-Canvas ist die
automatisch gepflegte Anzeige. Menschen geben über die App ein, nicht über den Canvas.

Mandantenrein: spiegelt nur Anträge des eigenen Mandanten (Default wepublish).

Modi:
  --dry-run  (Default) baut das Markdown + zeigt es, schreibt NICHTS nach Slack.
  --apply    legt den Canvas an (einmalig) bzw. aktualisiert ihn.

Slack-App: @faas (Bot-Token xoxb- in ~/.hermes/config.yaml), Scopes canvases:write/read,
chat:write. Kein neues Token in der App nötig — der Agent (Hermes) hält es.

Env / Quellen:
  ~/.hermes/.env       DIRECTUS_TOKEN (Directus lokal: localhost:8055)
  ~/.hermes/config.yaml  xoxb-Bot-Token
  WAECHTER_MANDANT     (Default wepublish)
  KANBAN_CHANNEL       Slack-Channel-ID fuer den Canvas (Default #faas-admin C0B7SD7JCEM)
  Canvas-ID wird in ~/faas_classify/kanban_canvas_<mandant>.id gemerkt.

Crontab-Beispiel (stuendlich; Antraege aendern selten):
  17 * * * * /usr/bin/python3 /home/dergeraet/faas-matching-wepublish/spark/faas_kanban_sync.py --apply >> /home/dergeraet/faas_classify/kanban_sync.log 2>&1
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-7s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger("kanban-sync")

MANDANT = os.environ.get("WAECHTER_MANDANT", "wepublish")
KANBAN_CHANNEL = os.environ.get("KANBAN_CHANNEL", "C0B7SD7JCEM")  # #faas-admin
DIRECTUS_URL = os.environ.get("WAECHTER_DIRECTUS_URL", "http://localhost:8055").rstrip("/")
STATE = Path.home() / "faas_classify" / f"kanban_canvas_{MANDANT}.id"

# Kanban-Spalten (Status -> Titel), in Reihenfolge. archiviert/ausgeblendet weggelassen.
SPALTEN = [
    ("identifiziert", "Identifiziert"),
    ("in_arbeit", "In Arbeit"),
    ("eingereicht", "Eingereicht"),
    ("zugesagt", "Zugesagt"),
    ("abgelehnt", "Abgelehnt"),
]


def _directus_token() -> str:
    for l in (Path.home() / ".hermes" / ".env").read_text().splitlines():
        if l.startswith("DIRECTUS_TOKEN"):
            return l.split("=", 1)[1].strip().strip('"')
    return ""


def _slack_token() -> str:
    cfg = (Path.home() / ".hermes" / "config.yaml").read_text()
    m = re.search(r"xoxb-[A-Za-z0-9-]+", cfg)
    return m.group(0) if m else ""


def _directus_get(path: str, token: str) -> list[dict[str, Any]]:
    r = urllib.request.Request(f"{DIRECTUS_URL}{path}", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(r, timeout=30) as resp:
        d = json.loads(resp.read().decode()).get("data", [])
        return d if isinstance(d, list) else [d]


def _slack(method: str, payload: dict, token: str) -> dict:
    r = urllib.request.Request(
        f"https://slack.com/api/{method}",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(r, timeout=20) as resp:
        return json.loads(resp.read().decode())


def baue_markdown(antraege: list[dict]) -> str:
    """Baut das Kanban-Markdown aus den Antraegen."""
    nach_status: dict[str, list[dict]] = {k: [] for k, _ in SPALTEN}
    for a in antraege:
        s = a.get("status")
        if s in nach_status:
            nach_status[s].append(a)
    heute = datetime.now(timezone.utc).strftime("%d.%m.%Y %H:%M UTC")
    zeilen = [f"# FaaS — Antrags-Kanban ({MANDANT})", "", f"_Automatisch aus der App gespiegelt · Stand {heute}_", ""]
    for key, titel in SPALTEN:
        items = nach_status[key]
        zeilen.append(f"## {titel} ({len(items)})")
        if not items:
            zeilen.append("_(leer)_")
        for a in items:
            name = a.get("stiftung_name") or f"Stiftung {a.get('stiftung_id')}"
            med = a.get("medium_id") or "?"
            betrag = a.get("betrag_chf")
            frist = a.get("frist")
            extra = []
            if betrag:
                extra.append(f"CHF {int(betrag):,}".replace(",", "'"))
            if frist:
                extra.append(f"Frist {str(frist)[:10]}")
            suffix = f" — {', '.join(extra)}" if extra else ""
            zeilen.append(f"- **{name}** ({med}){suffix}")
        zeilen.append("")
    return "\n".join(zeilen)


def ensure_canvas(token: str) -> str | None:
    """Liest die gemerkte Canvas-ID oder legt einen Channel-Canvas in #faas-admin an."""
    if STATE.exists():
        cid = STATE.read_text().strip()
        if cid:
            return cid
    res = _slack("conversations.canvases.create", {"channel_id": KANBAN_CHANNEL,
                 "document_content": {"type": "markdown", "markdown": "# FaaS — Antrags-Kanban\n\n_wird gleich befuellt_"}}, token)
    if not res.get("ok"):
        log.error("conversations.canvases.create fehlgeschlagen: %s", res.get("error"))
        return None
    cid = res.get("canvas_id")
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(cid)
    log.info("Channel-Canvas angelegt: %s", cid)
    return cid


def update_canvas(canvas_id: str, markdown: str, token: str) -> bool:
    res = _slack("canvases.edit", {"canvas_id": canvas_id,
                 "changes": [{"operation": "replace",
                              "document_content": {"type": "markdown", "markdown": markdown}}]}, token)
    if not res.get("ok"):
        log.error("canvases.edit fehlgeschlagen: %s", res.get("error"))
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="FaaS-Kanban → Slack-Canvas-Spiegel")
    ap.add_argument("--apply", action="store_true", help="Canvas wirklich schreiben (sonst dry-run)")
    args = ap.parse_args()

    dtok = _directus_token()
    if not dtok:
        log.error("Kein DIRECTUS_TOKEN.")
        return 2
    antraege = _directus_get(
        f"/items/applications?limit=-1&filter[mandant][_eq]={MANDANT}"
        f"&filter[status][_nin]=archiviert,ausgeblendet"
        f"&fields=medium_id,stiftung_id,stiftung_name,status,betrag_chf,frist",
        dtok,
    )
    md = baue_markdown(antraege)
    log.info("Mandant %s | Anträge: %d", MANDANT, len(antraege))

    if not args.apply:
        print("\n----- KANBAN-MARKDOWN (dry-run) -----\n")
        print(md)
        print("\n----- (nichts nach Slack geschrieben; mit --apply schreiben) -----")
        return 0

    stok = _slack_token()
    if not stok:
        log.error("Kein Slack-Bot-Token (xoxb) in ~/.hermes/config.yaml.")
        return 2
    cid = ensure_canvas(stok)
    if not cid:
        return 1
    ok = update_canvas(cid, md, stok)
    log.info("Canvas %s aktualisiert: %s", cid, ok)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
