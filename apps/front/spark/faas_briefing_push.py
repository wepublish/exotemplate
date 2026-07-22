#!/usr/bin/env python3
"""
FaaS-Morgenbriefing-Push — holt das strukturierte Briefing vom Chat-Adapter
(«Der Gerät», 127.0.0.1:9200, POST /briefing) und postet es nach Slack #faas-admin.
Macht aus der Hol-Schuld (Briefing nur in der App sichtbar) eine Bring-Schuld.

Der Adapter cacht das Briefing pro Tag — der Push kostet also genau einen
Sonnet-Call pro Morgen (~CHF 0.01), App-Aufrufe danach sind gratis aus dem Cache.

Modi:  --dry-run (Default, zeigt den Text)  |  --apply (postet nach Slack)
Cron-Empfehlung:  30 7 * * *  python3 .../faas_briefing_push.py --apply
"""
from __future__ import annotations
import json, re, sys, urllib.request
from datetime import date
from pathlib import Path

CHANNEL = "C0B7SD7JCEM"  # #faas-admin
ADAPTER = "http://127.0.0.1:9200/briefing"
APP_URL = "https://matching.winkelriedtoechter.ch"

AKTION_HINWEIS = {
    "matching_liste": "Matching-Liste",
    "datensuppe": "Datensuppe/Onboarding",
    "gesuch": "Anträge",
    "nachfassen": "Anträge",
    "frist": "Ausschreibungen",
}


def hole_briefing() -> dict:
    req = urllib.request.Request(ADAPTER, data=b"{}",
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.loads(r.read().decode())
    b = d.get("briefing") or {}
    if not b.get("todos") and not b.get("gruss"):
        raise RuntimeError(f"Adapter lieferte kein Briefing: {str(d)[:200]}")
    return b


def baue_text(b: dict) -> str:
    zeilen = [f"*Morgenbriefing FaaS — {date.today().strftime('%d.%m.%Y')}*"]
    if b.get("gruss"):
        zeilen.append(b["gruss"])
    for t in b.get("todos", []):
        text = t.get("text", "").strip()
        if not text:
            continue
        ort = AKTION_HINWEIS.get(t.get("aktion", ""), "")
        zeilen.append(f"• {text}" + (f"  _({ort})_" if ort else ""))
    zeilen.append(f"→ {APP_URL}")
    return "\n".join(zeilen)


def slack_token():
    cfg = (Path.home() / ".hermes" / "config.yaml").read_text()
    m = re.search(r"xoxb-[A-Za-z0-9-]+", cfg)
    if not m:
        raise RuntimeError("Kein xoxb-Token in ~/.hermes/config.yaml")
    return m.group(0)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--dry-run"
    text = baue_text(hole_briefing())
    if mode != "--apply":
        print("(dry-run)\n" + text)
        return
    data = json.dumps({"channel": CHANNEL, "text": text}).encode()
    req = urllib.request.Request("https://slack.com/api/chat.postMessage", data=data,
        headers={"Authorization": f"Bearer {slack_token()}",
                 "Content-Type": "application/json; charset=utf-8"})
    r = json.loads(urllib.request.urlopen(req, timeout=15).read().decode())
    print("slack:", "ok" if r.get("ok") else r)
    if not r.get("ok"):
        sys.exit(1)


if __name__ == "__main__":
    main()
