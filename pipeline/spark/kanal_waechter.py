#!/usr/bin/env python3
"""Kanal-Wächter der Rechtsabteilung: prüft jeden in kanaele.json registrierten
Automatismus auf sein Artefakt und dessen Frische-SLA. Erkennt die Fehlerklasse
«geplant, aber nie gebaut» und «still gestorben», die einzelne Log-Wächter nicht sehen.

Alarm per Slack-DM an Jolanda (Bot-Token aus ~/.hermes/.env), ein Alarm pro
Zustandswechsel plus Entwarnung — kein Spam. Cron: 2x pro Stunde.

  kanal_waechter.py            Regelbetrieb
  kanal_waechter.py --dry-run  zeigt Status, sendet nichts, ändert keinen State
"""
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.request

HOME = pathlib.Path.home()
REGISTER = HOME / "scripts" / "kanaele.json"
STATE = HOME / ".hermes" / "data" / "kanal_waechter_state.json"
ENV = HOME / ".hermes" / ".env"
JOLANDA_DM = "U01H50Y90N9"
DRY = "--dry-run" in sys.argv

# systemctl --user braucht den User-Bus auch unter Cron (vgl. hermes_core-Watcher-Fix)
os.environ.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")


def jetzt() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def slack(text: str) -> None:
    token = ""
    if ENV.exists():
        for ln in ENV.read_text(errors="replace").splitlines():
            if ln.startswith("SLACK_BOT_TOKEN="):
                token = ln.split("=", 1)[1].strip()
    if not token:
        print("WARN kein SLACK_BOT_TOKEN")
        return
    data = json.dumps({"channel": JOLANDA_DM, "text": text}).encode("utf-8")
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage", data=data,
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json; charset=utf-8"})
    try:
        urllib.request.urlopen(req, timeout=8)
    except Exception as e:  # noqa: BLE001
        print("WARN slack:", e)


def rclone_lsjson(remote: str, nur_dateien: bool = True):
    cmd = ["rclone", "lsjson", remote]
    if nur_dateien:
        cmd.append("--files-only")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "rclone-Fehler").strip()[:160])
    return json.loads(r.stdout or "[]")


def alter_h(mtime_epoch: float) -> float:
    return (time.time() - mtime_epoch) / 3600


def modtime_epoch(eintrag: dict) -> float:
    import datetime
    mt = eintrag.get("ModTime", "").replace("Z", "+00:00")
    return datetime.datetime.fromisoformat(mt).timestamp()


def pruefe(k: dict):
    """Gibt (status, detail) zurück. status: ok | kaputt."""
    typ = k["typ"]
    if typ == "datei":
        p = pathlib.Path(os.path.expanduser(k["pfad"]))
        if not p.exists():
            return "kaputt", "Artefakt fehlt: " + k["pfad"]
        a = alter_h(p.stat().st_mtime)
        if a > k["max_alter_h"]:
            return "kaputt", f"Artefakt {a:.1f}h alt (SLA {k['max_alter_h']}h): {k['pfad']}"
        return "ok", ""
    if typ == "drive_neueste":
        eintraege = [e for e in rclone_lsjson(k["remote"])
                     if e.get("Name") not in set(k.get("ausschluss") or [])
                     and not e.get("Name", "").startswith(".")]
        if not eintraege:
            return "kaputt", "kein Artefakt in " + k["remote"]
        neueste = max(modtime_epoch(e) for e in eintraege)
        a = alter_h(neueste)
        if a > k["max_alter_h"]:
            return "kaputt", f"neuestes Artefakt {a:.1f}h alt (SLA {k['max_alter_h']}h): {k['remote']}"
        return "ok", ""
    if typ == "drive_datei":
        eintraege = rclone_lsjson(k["remote"])
        if not eintraege:
            return "kaputt", "Datei fehlt: " + k["remote"]
        a = alter_h(modtime_epoch(eintraege[0]))
        if a > k["max_alter_h"]:
            return "kaputt", f"Datei {a:.1f}h alt (SLA {k['max_alter_h']}h): {k['remote']}"
        return "ok", ""
    if typ == "drive_stau":
        stau = []
        for e in rclone_lsjson(k["remote"]):
            name = e.get("Name", "")
            if name.startswith(".") or name in set(k.get("ausschluss") or []):
                continue
            a = alter_h(modtime_epoch(e))
            if a > k["max_alter_h"]:
                stau.append(f"{name} ({a:.0f}h)")
        if stau:
            return "kaputt", "unverarbeitet: " + ", ".join(stau[:5])
        return "ok", ""
    if typ in ("timer", "dienst"):
        r = subprocess.run(["systemctl", "--user", "is-active", k["unit"]],
                           capture_output=True, text=True, timeout=15)
        zustand = (r.stdout or "").strip()
        if zustand != "active":
            return "kaputt", f"{k['unit']} ist «{zustand or 'unbekannt'}»"
        return "ok", ""
    return "kaputt", "unbekannter Kanal-Typ: " + typ


def main() -> None:
    reg = json.loads(REGISTER.read_text(encoding="utf-8"))
    ergebnisse = {}
    details = {}
    for k in reg["kanaele"]:
        try:
            status, detail = pruefe(k)
        except Exception as e:  # noqa: BLE001
            status, detail = "kaputt", f"Prüfung fehlgeschlagen: {e}"
        ergebnisse[k["name"]] = status
        if detail:
            details[k["name"]] = detail

    kaputt = sorted(n for n, s in ergebnisse.items() if s != "ok")
    zeile = " | ".join(f"{n}={s}" for n, s in sorted(ergebnisse.items()))
    print(f"[{jetzt()}] {zeile}")

    alt = {}
    try:
        alt = json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        pass
    vorher_kaputt = sorted(n for n, s in alt.items() if s != "ok")

    if kaputt != vorher_kaputt:
        if kaputt:
            msg = ":warning: *Kanal-Wächter Rechtsabteilung* — " + \
                  f"{len(kaputt)} Kanal/Kanäle ohne frisches Artefakt:\n" + \
                  "\n".join(f"• *{n}*: {details.get(n, '')}" for n in kaputt)
            if vorher_kaputt:
                wieder_ok = [n for n in vorher_kaputt if n not in kaputt]
                if wieder_ok:
                    msg += "\nWieder ok: " + ", ".join(wieder_ok)
        else:
            msg = "*Kanal-Wächter Rechtsabteilung* — Entwarnung: alle " + \
                  f"{len(ergebnisse)} Kanäle liefern wieder frische Artefakte."
        if DRY:
            print("DRY-RUN, würde senden:\n" + msg)
        else:
            slack(msg)

    if not DRY:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(ergebnisse, ensure_ascii=False, indent=1),
                         encoding="utf-8")


if __name__ == "__main__":
    main()
