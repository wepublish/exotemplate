#!/usr/bin/env python3
"""
FaaS-Datenfluss-Wächter — prüft nicht ob Dienste LEBEN (das macht faas_heartbeat.py),
sondern ob die DATEN FLIESSEN. Lektion vom 2026-06-10: der Re-Match-Cron war 5 Tage
tot (chmod-Bug), alle Dienste meldeten grün, aber keine neuen Matches erreichten die
App. Dieser Wächter hätte es nach 13 Stunden gemeldet.

Drei Checks:
  1. matches_frisch  — jüngstes match_results.computed_at darf nicht älter als 13 h
                       sein (Re-Match-Cron läuft alle 6 h; eine verpasste Runde ist ok).
  2. dna_fluss       — in den letzten 4 h muss mindestens eine neue stiftungs_dna
                       entstanden sein, solange ein web_enrich_daemon-Prozess LÄUFT.
                       Läuft kein Daemon (Pool-Pause/fertig), ruht der Check (ok) —
                       kein Dauer-Alarm nach Pool-Ende (angepasst 2026-07-06).
  3. suche_gesund    — SearXNG-Probe «Fondation Louis-Jeantet»: es muss Treffer geben
                       UND mindestens einer muss «jeantet» enthalten (erkennt auch den
                       Müll-Modus, in dem Engines antworten, aber Unsinn liefern).

Alarm nach Slack #faas-admin nur beim Zustandswechsel OK->Ausfall, Erholungsmeldung
beim Wechsel zurück. Read-only ausser dem Slack-Post, keine GPU-Last.
Modi:  --dry-run (Default)  |  --apply  |  --test-slack
Cron-Empfehlung:  12 * * * *  python3 .../faas_datenfluss_waechter.py --apply
"""
from __future__ import annotations
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

CHANNEL = os.environ.get("DATENFLUSS_CHANNEL", "C0B7SD7JCEM")  # #faas-admin
STATE = Path.home() / "faas_classify" / "datenfluss.state.json"
DIRECTUS = "http://127.0.0.1:8055"
SEARX = os.environ.get("FAAS_SEARX_URL", "http://localhost:8888/search")
ENGINES = os.environ.get("FAAS_SEARX_ENGINES", "brave,startpage,yandex")
MATCH_MAX_AGE_H = float(os.environ.get("DATENFLUSS_MATCH_MAX_AGE_H", "13"))
DNA_FENSTER_H = float(os.environ.get("DATENFLUSS_DNA_FENSTER_H", "4"))


def directus_token() -> str:
    for zeile in (Path.home() / ".hermes" / ".env").read_text().splitlines():
        if zeile.startswith("DIRECTUS_TOKEN="):
            return zeile.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("Kein DIRECTUS_TOKEN in ~/.hermes/.env")


def d_get(pfad: str, params: dict) -> dict:
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{DIRECTUS}{pfad}?{q}",
        headers={"Authorization": f"Bearer {directus_token()}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def check_matches_frisch():
    try:
        d = d_get("/items/match_results", {"aggregate[max]": "computed_at"})
        roh = (d.get("data") or [{}])[0].get("max", {}).get("computed_at")
        if not roh:
            return ("matches_frisch", False, "kein computed_at gefunden")
        ts = datetime.fromisoformat(str(roh).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        alter_h = (datetime.now(timezone.utc) - ts).total_seconds() / 3600.0
        ok = alter_h <= MATCH_MAX_AGE_H
        return ("matches_frisch", ok,
                f"jüngster Match vor {alter_h:.1f} h (Limit {MATCH_MAX_AGE_H:.0f} h) — Re-Match-Cron prüfen")
    except Exception as e:
        return ("matches_frisch", False, f"Abfrage fehlgeschlagen: {e}")


def _enrich_daemon_laeuft() -> bool:
    try:
        r = subprocess.run(["pgrep", "-f", "web_enrich_daemon.py"], capture_output=True, text=True)
        return r.returncode == 0
    except Exception:
        return False


def check_dna_fluss():
    try:
        seit = (datetime.now(timezone.utc) - timedelta(hours=DNA_FENSTER_H)).strftime("%Y-%m-%dT%H:%M:%S")
        d = d_get("/items/stiftungs_dna", {
            "aggregate[count]": "id", "filter[created_at][_gte]": seit})
        n = int((d.get("data") or [{}])[0].get("count", {}).get("id") or
                (d.get("data") or [{}])[0].get("count") or 0)
        if n == 0 and not _enrich_daemon_laeuft():
            return ("dna_fluss", True,
                    "kein web_enrich_daemon aktiv — Check ruht (Pool-Pause/fertig)")
        ok = n > 0
        return ("dna_fluss", ok,
                f"{n} neue DNAs in {DNA_FENSTER_H:.0f} h — wenn 0: Daemons prüfen")
    except Exception as e:
        return ("dna_fluss", False, f"Abfrage fehlgeschlagen: {e}")


def check_suche_gesund():
    try:
        q = urllib.parse.urlencode({"q": "Fondation Louis-Jeantet", "format": "json", "engines": ENGINES})
        req = urllib.request.Request(f"{SEARX}?{q}", headers={"User-Agent": "faas-datenfluss/1.0"})
        with urllib.request.urlopen(req, timeout=25) as r:
            d = json.loads(r.read().decode())
        res = d.get("results", [])
        unresp = d.get("unresponsive_engines", [])
        treffer = any("jeantet" in str(x.get("url", "")) + str(x.get("title", "")).lower()
                      for x in res)
        ok = bool(res) and treffer
        return ("suche_gesund", ok,
                f"{len(res)} Treffer, jeantet={'ja' if treffer else 'NEIN'}, unresponsive={unresp}")
    except Exception as e:
        return ("suche_gesund", False, f"SearXNG nicht erreichbar: {e}")


CHECKS = [check_matches_frisch, check_dna_fluss, check_suche_gesund]


def slack_token():
    cfg = (Path.home() / ".hermes" / "config.yaml").read_text()
    m = re.search(r"xoxb-[A-Za-z0-9-]+", cfg)
    if not m:
        raise RuntimeError("Kein xoxb-Token in ~/.hermes/config.yaml")
    return m.group(0)


def slack(method, payload, token):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(f"https://slack.com/api/{method}", data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"})
    return json.loads(urllib.request.urlopen(req, timeout=10).read().decode())


def load_state():
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--dry-run"

    if mode == "--test-slack":
        tok = slack_token()
        r = slack("chat.postMessage", {"channel": CHANNEL,
            "text": "FaaS-Datenfluss-Wächter: Testnachricht (wird sofort gelöscht)."}, tok)
        if not r.get("ok"):
            print("post fehlgeschlagen:", r); sys.exit(1)
        d = slack("chat.delete", {"channel": CHANNEL, "ts": r["ts"]}, tok)
        print(f"Slack-Test OK: post ok={r.get('ok')}, delete ok={d.get('ok')}")
        return

    results = [c() for c in CHECKS]
    prev = load_state()
    alarms, recover = [], []
    for name, ok, detail in results:
        was = prev.get(name, "ok")
        if not ok and was == "ok":
            alarms.append(f"[ALARM] {name}: {detail}")
        elif ok and was == "fail":
            recover.append(f"[OK wieder] {name}: {detail}")
    status_line = " | ".join(f"{n}={'ok' if ok else 'FAIL'}" for n, ok, _ in results)
    print(f"{time.strftime('%F %T')} | {status_line}")
    for n, ok, detail in results:
        if not ok:
            print(f"   {n}: {detail}")

    msg_lines = alarms + recover
    if msg_lines and mode == "--apply":
        text = "FaaS-Datenfluss-Wächter (Spark):\n" + "\n".join(msg_lines)
        try:
            tok = slack_token()
            r = slack("chat.postMessage", {"channel": CHANNEL, "text": text}, tok)
            print("slack:", "ok" if r.get("ok") else r)
        except Exception as e:
            print("slack-fehler:", e)
    elif msg_lines:
        print("(dry-run, nichts gepostet)\n" + "\n".join(msg_lines))

    new_state = {n: ("ok" if ok else "fail") for n, ok, _ in results}
    if mode == "--apply":
        STATE.write_text(json.dumps(new_state, indent=2))


if __name__ == "__main__":
    main()
