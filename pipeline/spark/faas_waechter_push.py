#!/usr/bin/env python3
"""
Waechter-Push — stellt offene Eintraege aus `agent_vorschlaege` nach Slack zu.

WARUM: Der Waechter erkennt Probleme zuverlaessig, aber seine Meldungen landen
nur in einer Directus-Collection, die niemand oeffnet. Befund 2026-07-27: die
Meldungen «Medium solvio hat keine aktive DNA» (4. Juni), dasselbe fuer vmz
(4. Juni) und zwolf (8. Juli) standen seit Monaten unveraendert auf «offen» —
drei onboardete Medien waren die ganze Zeit fuer das Matching unsichtbar.
Dieses Skript macht aus der Hol-Schuld eine Bring-Schuld, analog zu
`faas_briefing_push.py`.

Gemeldet wird jeder offene Vorschlag GENAU EINMAL. Welche schon draussen sind,
steht in einer lokalen Zustandsdatei (dedup_key, wie beim webenrich-Manifest) —
bewusst nicht in `agent_outbox`, damit der Push den Waechter-Datenfluss nicht
beruehrt. Gibt es nichts Neues, wird auch nichts gepostet.

Modi:  --dry-run (Default, zeigt den Text)  |  --apply (postet nach Slack)
       --alle    (ignoriert den Zustand, meldet alles Offene erneut)
Cron-Empfehlung:  45 7 * * *  python3 .../faas_waechter_push.py --apply
"""
from __future__ import annotations
import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

CHANNEL = "C0B7SD7JCEM"  # #faas-admin
DIRECTUS = os.environ.get("DIRECTUS_URL", "http://localhost:8055").rstrip("/")
TOKEN = os.environ.get("DIRECTUS_TOKEN", "")
STATE = Path.home() / "faas_classify" / "waechter_push_state.json"
MAX_MELDUNGEN = 10  # Deckel, damit ein Rueckstau keine Textwand erzeugt

PRIO_RANG = {"hoch": 0, "mittel": 1, "niedrig": 2, "tief": 2}
PRIO_MARKE = {"hoch": "!", "mittel": "·", "niedrig": " ", "tief": " "}

# Reihenfolge und Behandlung je Meldungstyp. `zeige` = wie viele Eintraege
# ausgeschrieben werden; 0 = nur als Zaehler nennen.
# Fristen sind zeitkritisch, Hygiene verrottet unbemerkt (genau der solvio/vmz/zwolf-Fall).
# Entwuerfe sind Routine aus dem Gesuch-Loop und wuerden alles andere zudecken:
# beim ersten Lauf waren es 77 von 95 Meldungen.
TYP_ORDNUNG = [
    ("frist", "Fristen", 6),
    ("hygiene", "Hygiene", 6),
    ("entwurf", "Gesuch-Entwürfe", 0),
]


def dget(pfad: str) -> list:
    req = urllib.request.Request(DIRECTUS + pfad,
                                 headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r).get("data", [])
    return d if isinstance(d, list) else [d]


def hole_offene() -> list:
    return dget("/items/agent_vorschlaege?filter[status][_eq]=offen"
                "&fields=id,ts,typ,prioritaet,medium_id,titel,beschreibung,dedup_key"
                "&sort=-ts&limit=-1")


def lade_zustand() -> set:
    try:
        return set(json.loads(STATE.read_text()).get("gemeldet", []))
    except Exception:
        return set()


def speichere_zustand(gemeldet: set) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(
        {"gemeldet": sorted(gemeldet), "zuletzt": datetime.now(timezone.utc).isoformat()},
        ensure_ascii=False))


def schluessel(v: dict) -> str:
    """dedup_key, wenn der Waechter einen gesetzt hat, sonst die id."""
    return v.get("dedup_key") or f"id:{v.get('id')}"


def baue_text(neu: list, offen_gesamt: int) -> str:
    """Nach Typ gruppiert, damit Fristen und Hygiene nicht unter der
    Entwurfs-Routine verschwinden."""
    kopf = (f"*Waechter — {date.today().strftime('%d.%m.%Y')}*  "
            f"{len(neu)} neue Meldung{'en' if len(neu) != 1 else ''}, "
            f"{offen_gesamt} offen insgesamt")
    zeilen = [kopf]
    gezeigt = set()

    for typ, label, zeige in TYP_ORDNUNG:
        gruppe = sorted([v for v in neu if v.get("typ") == typ],
                        key=lambda v: (PRIO_RANG.get(v.get("prioritaet"), 1), v.get("ts") or ""))
        if not gruppe:
            continue
        gezeigt.add(typ)
        if zeige == 0:
            zeilen.append(f"\n*{label}:* {len(gruppe)} neu — in der App unter Anträge sichten")
            continue
        zeilen.append(f"\n*{label}* ({len(gruppe)} neu)")
        for v in gruppe[:zeige]:
            marke = PRIO_MARKE.get(v.get("prioritaet"), " ")
            wo = f" [{v['medium_id']}]" if v.get("medium_id") else ""
            zeilen.append(f"{marke} {(v.get('titel') or '').strip()}{wo}")
            besch = (v.get("beschreibung") or "").strip()
            if besch:
                zeilen.append(f"    _{besch[:140]}_")
        if len(gruppe) > zeige:
            zeilen.append(f"    … und {len(gruppe) - zeige} weitere")

    # Typen, die in TYP_ORDNUNG nicht vorkommen, gehen nicht verloren.
    rest = [v for v in neu if v.get("typ") not in gezeigt]
    if rest:
        zeilen.append(f"\n*Übrige:* {len(rest)}")
        for v in sorted(rest, key=lambda v: PRIO_RANG.get(v.get("prioritaet"), 1))[:MAX_MELDUNGEN]:
            zeilen.append(f"· {(v.get('titel') or '').strip()}")
    return "\n".join(zeilen)


def slack_token() -> str:
    cfg = (Path.home() / ".hermes" / "config.yaml").read_text()
    m = re.search(r"xoxb-[A-Za-z0-9-]+", cfg)
    if not m:
        raise RuntimeError("Kein xoxb-Token in ~/.hermes/config.yaml")
    return m.group(0)


def poste(text: str) -> None:
    data = json.dumps({"channel": CHANNEL, "text": text}).encode()
    req = urllib.request.Request("https://slack.com/api/chat.postMessage", data=data,
                                 headers={"Authorization": f"Bearer {slack_token()}",
                                          "Content-Type": "application/json; charset=utf-8"})
    r = json.loads(urllib.request.urlopen(req, timeout=15).read().decode())
    print("slack:", "ok" if r.get("ok") else r)
    if not r.get("ok"):
        sys.exit(1)


def main() -> None:
    if not TOKEN:
        sys.exit("DIRECTUS_TOKEN fehlt")
    argv = sys.argv[1:]
    apply_ = "--apply" in argv
    alle = "--alle" in argv

    offen = hole_offene()
    gemeldet = set() if alle else lade_zustand()
    neu = [v for v in offen if schluessel(v) not in gemeldet]

    if not neu:
        print(f"Nichts Neues ({len(offen)} offen, alle bereits gemeldet).")
        return

    text = baue_text(neu, len(offen))
    if not apply_:
        print("(dry-run — nichts gepostet, Zustand unveraendert)\n")
        print(text)
        return

    poste(text)
    speichere_zustand(gemeldet | {schluessel(v) for v in neu})
    print(f"{len(neu)} Meldung(en) zugestellt, Zustand fortgeschrieben in {STATE}.")


if __name__ == "__main__":
    main()
