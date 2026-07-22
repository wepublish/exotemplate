#!/usr/bin/env python3
"""
faas_lern_detektor — schliesst den Lern-Loop: erkennt abgeschlossene Verfahren
(applications mit status zugesagt/abgelehnt) und haelt sie als agent_lessons fest,
damit Betrag, Gesuch-Ton und Matching aus dem AUSGANG lernen.

Deterministisch, kein LLM, kein GPU. Dedup ueber State-Datei (verarbeitete Antrag-IDs),
damit jede Zusage/Absage genau EINMAL zur Lektion wird.

Env: WAECHTER_MANDANT (Default wepublish, via faas_actions), DIRECTUS_TOKEN (~/.hermes/.env).
Modi:  --dry-run (Default, zeigt nur)  |  --apply (schreibt agent_lessons)
Cron-tauglich (z.B. stuendlich).
"""
from __future__ import annotations
import json, os, sys
from pathlib import Path
import faas_actions as fa

STATE = os.path.expanduser("~/faas_classify/lern_detektor.state.json")


def _load_state() -> set:
    try:
        return set(json.loads(Path(STATE).read_text()).get("verarbeitet", []))
    except Exception:
        return set()


def _save_state(ids: set) -> None:
    try:
        Path(STATE).write_text(json.dumps({"verarbeitet": sorted(ids)}))
    except Exception:
        pass


def main() -> None:
    apply = "--apply" in sys.argv
    M = f"&filter[mandant][_eq]={fa.MANDANT}"
    apps = fa._dget(
        f"/items/applications?limit=-1&filter[status][_in]=zugesagt,abgelehnt{M}"
        "&fields=id,status,stiftung_id,stiftung_name,medium_id,betrag_zugesagt_chf,betrag_chf")
    verarbeitet = _load_state()
    neu = 0
    for a in apps:
        aid = str(a.get("id"))
        if not aid or aid in verarbeitet:
            continue
        status = a.get("status")
        sname = a.get("stiftung_name") or f"Stiftung {a.get('stiftung_id')}"
        medium = a.get("medium_id") or "-"
        if status == "zugesagt":
            betrag = a.get("betrag_zugesagt_chf") or a.get("betrag_chf")
            notiz = (f"«{sname}» hat fuer {medium} ZUGESAGT"
                     + (f": CHF {betrag}" if betrag else "")
                     + ". Aehnliche Gesuche an diesem Erfolg ausrichten.")
            kategorie = "zusage"
        else:
            notiz = (f"«{sname}» hat fuer {medium} ABGELEHNT. "
                     "Bei kuenftigen Gesuchen Profil-Passung und Betrag kritisch pruefen.")
            kategorie = "absage"
        if apply:
            fa._dwrite("POST", "/items/agent_lessons", {
                "scope": "stiftung", "mandant": fa.MANDANT,
                "medium_id": a.get("medium_id"), "stiftung_id": a.get("stiftung_id"),
                "kategorie": kategorie, "quelle": "ausgang", "notiz": notiz[:1000], "aktiv": True})
        verarbeitet.add(aid)
        neu += 1
        print(f"[{'apply' if apply else 'dry'}] {kategorie}: {sname} / {medium}")
    if apply:
        _save_state(verarbeitet)
    print(f"Lern-Detektor: {len(apps)} abgeschlossene Verfahren, {neu} neu als Lektion erfasst "
          f"({'apply' if apply else 'dry-run'}).")


if __name__ == "__main__":
    main()
