#!/usr/bin/env python3
"""
faas_roadmap_render — interaktives Roadmap-Pult im internen Kanal #faas-admin.

Postet bzw. aktualisiert pro Medium GENAU EINE interaktive Block-Kit-Nachricht im
internen Kanal (#faas-admin). Pro Medium-Station (nr 1/3/5/7) ein Freigabe-Knopf,
pro offenem Antrag ein Status-Overflow. Die Block-Action-IDs tragen kompaktes JSON,
das der Socket-Mode-Daemon (faas_slack_daemon.py) parst und auf die gegateten
faas_actions zurueckfuehrt.

NIE an #p-faas-* (medien-sichtbar, tabu). Nur das interne Pult.

Quellen / Env:
  ~/.hermes/.env       DIRECTUS_TOKEN (Directus lokal: localhost:8055)
  ~/.hermes/config.yaml  xoxb-Bot-Token (wie faas_kanban_sync)
  FAAS_ROADMAP_CHANNEL   Channel-ID des Pults (Default #faas-admin C0B7SD7JCEM)
  FAAS_APP_BASE          App-Basis fuer /api/roadmap (Default http://localhost:3009)
  WAECHTER_MANDANT       (Default wepublish)

Der ts der geposteten Pult-Nachricht wird in faas_roadmap.action_ts gemerkt
(fuer chat.update).

CLI:
  python3 faas_roadmap_render.py [--medium <slug>] [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-7s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger("roadmap-render")

MANDANT = os.environ.get("WAECHTER_MANDANT", "wepublish")
ADMIN_CHANNEL = os.environ.get("FAAS_ROADMAP_CHANNEL", "C0B7SD7JCEM")  # #faas-admin
APP_BASE = os.environ.get("FAAS_APP_BASE", "http://localhost:3009").rstrip("/")
DIRECTUS_URL = os.environ.get("DIRECTUS_URL_LOCAL", "http://localhost:8055").rstrip("/")

# Lesbare Labels.
STATUS_LABEL = {
    "offen": "Offen",
    "euer_auftrag": "Euer Auftrag",
    "in_arbeit": "In Arbeit",
    "erledigt": "Erledigt",
}
ROLLE_LABEL = {"medium": "Medium", "wepublish": "We.Publish", "gemeinsam": "gemeinsam"}

# Antrags-Status, die als Overflow-Optionen angeboten werden.
ANTRAG_OPTIONEN = [
    ("In Arbeit", "in_arbeit"),
    ("Eingereicht", "eingereicht"),
    ("Zugesagt", "zugesagt"),
    ("Abgelehnt", "abgelehnt"),
]


# ─── Token / HTTP ───────────────────────────────────────────────────────────

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


def _directus_patch(path: str, body: dict, token: str) -> dict:
    r = urllib.request.Request(
        f"{DIRECTUS_URL}{path}", data=json.dumps(body).encode(), method="PATCH",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=30) as resp:
        return json.loads(resp.read().decode()).get("data", {})


def _slack(method: str, payload: dict, token: str) -> dict:
    r = urllib.request.Request(
        f"https://slack.com/api/{method}",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(r, timeout=20) as resp:
        return json.loads(resp.read().decode())


# ─── Daten holen ─────────────────────────────────────────────────────────────

def hole_roadmap(medium: str) -> dict:
    """Holt den berechneten Roadmap-Stand eines Mediums von der App-Route."""
    url = f"{APP_BASE}/api/roadmap?medium={urllib.parse.quote(medium)}"
    r = urllib.request.Request(url)
    with urllib.request.urlopen(r, timeout=20) as resp:
        return json.loads(resp.read().decode())


# ─── Block-Kit aufbauen ────────────────────────────────────────────────────────

def baue_blocks(medium: str, daten: dict) -> list[dict]:
    """Baut die Block-Kit-Bloecke fuer das Pult eines Mediums.

    Medium-Stationen (wer == 'medium') bekommen einen Freigabe-Button; abgeleitete
    We.Publish-Stationen nicht. Antraege bekommen je ein Status-Overflow.
    Gesamtzahl der Bloecke bleibt unter 50.
    """
    stationen = daten.get("stationen") or []
    antraege = daten.get("antraege") or []

    blocks: list[dict] = [
        {"type": "header", "text": {"type": "plain_text", "text": f"{medium} · Roadmap"}},
    ]

    for st in stationen:
        nr = st.get("nr")
        titel = st.get("titel", "")
        wer = st.get("wer", "")
        status = st.get("status", "")
        freigegeben = bool(st.get("freigegeben"))
        rolle = ROLLE_LABEL.get(wer, wer)
        status_txt = STATUS_LABEL.get(status, status)
        block: dict = {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*{nr}. {titel}*  ·  {rolle}  ·  {status_txt}"},
        }
        if wer == "medium":
            wert = not freigegeben
            aid = json.dumps({"k": "frei", "m": medium, "s": nr, "v": wert}, separators=(",", ":"))
            block["accessory"] = {
                "type": "button",
                "text": {"type": "plain_text",
                         "text": "Zuruecknehmen" if freigegeben else "Freigeben"},
                "action_id": aid,
                "value": aid,
            }
        blocks.append(block)

    if antraege:
        blocks.append({"type": "divider"})
        gekuerzt = len(antraege) > 8
        zeige = antraege[:8]
        kopf = f"*Anträge mit Gesuch ({len(antraege)})*"
        if gekuerzt:
            kopf += f"  ·  zeige erste 8 von {len(antraege)}"
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": kopf}})
        for a in zeige:
            name = a.get("stiftung_name") or f"Stiftung {a.get('stiftung_id')}"
            # /api/roadmap liefert nur Anträge mit gesetztem drive_link → direkt
            # ins Drive-Dossier verlinken (Slack-mrkdwn <url|text>).
            link = a.get("drive_link")
            label = f"<{link}|{name}>" if link else name
            status_txt = STATUS_LABEL.get(a.get("status", ""), a.get("status", ""))
            aid = json.dumps({"k": "astat", "a": a.get("id")}, separators=(",", ":"))
            blocks.append({
                "type": "section",
                "text": {"type": "mrkdwn", "text": f"{label}  ·  {status_txt}"},
                "accessory": {
                    "type": "overflow",
                    "action_id": aid,
                    "options": [
                        {"text": {"type": "plain_text", "text": label}, "value": value}
                        for label, value in ANTRAG_OPTIONEN
                    ],
                },
            })

    return blocks


# ─── Rendern ───────────────────────────────────────────────────────────────────

def _roadmap_zeile(medium: str, dtok: str) -> dict | None:
    rows = _directus_get(
        f"/items/faas_roadmap?limit=1&filter[medium_id][_eq]={urllib.parse.quote(medium)}"
        f"&filter[mandant][_eq]={MANDANT}&fields=id,action_ts", dtok)
    return rows[0] if rows else None


def render_medium(medium: str, dry_run: bool = False) -> bool:
    """Postet bzw. aktualisiert das Pult eines Mediums. Gibt True bei Erfolg."""
    daten = hole_roadmap(medium)
    blocks = baue_blocks(medium, daten)

    if dry_run:
        print(f"\n----- BLOCKS {medium} (dry-run) -----")
        print(json.dumps(blocks, ensure_ascii=False, indent=2))
        return True

    dtok = _directus_token()
    stok = _slack_token()
    if not dtok or not stok:
        log.error("Kein Directus- oder Slack-Token vorhanden; %s uebersprungen.", medium)
        return False

    row = _roadmap_zeile(medium, dtok)
    if not row:
        log.error("Keine faas_roadmap-Zeile fuer %s; uebersprungen.", medium)
        return False

    text = f"Roadmap {medium}"
    action_ts = row.get("action_ts")
    try:
        if action_ts:
            res = _slack("chat.update",
                         {"channel": ADMIN_CHANNEL, "ts": action_ts, "blocks": blocks, "text": text}, stok)
        else:
            res = _slack("chat.postMessage",
                         {"channel": ADMIN_CHANNEL, "blocks": blocks, "text": text}, stok)
    except urllib.error.URLError as e:
        log.error("Slack-Aufruf fuer %s fehlgeschlagen: %s", medium, e)
        return False

    if not res.get("ok"):
        log.error("Slack-Fehler fuer %s: %s", medium, res.get("error"))
        return False

    if not action_ts:
        ts = res.get("ts")
        if ts:
            _directus_patch(f"/items/faas_roadmap/{row['id']}", {"action_ts": ts}, dtok)
            log.info("Pult fuer %s gepostet, action_ts %s gemerkt.", medium, ts)
    else:
        log.info("Pult fuer %s aktualisiert (ts %s).", medium, action_ts)
    return True


def render_all(dry_run: bool = False) -> None:
    dtok = _directus_token()
    if not dtok:
        log.error("Kein DIRECTUS_TOKEN.")
        return
    medien = _directus_get(
        f"/items/faas_medien?limit=-1&filter[is_active][_eq]=true&filter[mandant][_eq]={MANDANT}"
        f"&fields=slug", dtok)
    for m in medien:
        slug = m.get("slug")
        if slug:
            try:
                render_medium(slug, dry_run=dry_run)
            except Exception as e:
                log.error("render_medium(%s) fehlgeschlagen: %s", slug, e)


def main() -> int:
    ap = argparse.ArgumentParser(description="FaaS-Roadmap-Pult (#faas-admin)")
    ap.add_argument("--medium", help="Nur dieses Medium rendern (sonst alle aktiven).")
    ap.add_argument("--dry-run", action="store_true", help="Bloecke als JSON drucken, NICHT posten.")
    args = ap.parse_args()
    if args.medium:
        render_medium(args.medium, dry_run=args.dry_run)
    else:
        render_all(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
