#!/usr/bin/env python3
"""
FaaS-Heartbeat — prueft die kritischen FaaS-Dienste auf dem Spark und alarmiert
bei Ausfall nach Slack (#faas-admin). Dedup ueber State: alarmiert nur beim
Wechsel OK->Ausfall, meldet Erholung beim Wechsel Ausfall->OK. Kein Spam.

Read-only ausser dem Slack-Post. Keine GPU-Last.
Modi:  --dry-run (Default, nur anzeigen)  |  --apply (postet nach Slack)
       --test-slack (postet eine Testnachricht und loescht sie sofort wieder)

Cron-Empfehlung:  */5 * * * *  ... faas_heartbeat.py --apply
"""
from __future__ import annotations
import json, os, re, sys, time, urllib.request, urllib.error
from pathlib import Path

CHANNEL = os.environ.get("HEARTBEAT_CHANNEL", "C0B7SD7JCEM")  # #faas-admin
STATE = Path.home() / "faas_classify" / "heartbeat.state.json"
WAECHTER_LOG = Path.home() / "faas_classify" / "waechter.log"
WAECHTER_MAX_AGE_MIN = int(os.environ.get("HEARTBEAT_WAECHTER_MAX_AGE_MIN", "30"))

def _http(url, timeout=6):
    r = urllib.request.urlopen(url, timeout=timeout)
    return r.getcode(), r.read().decode("utf-8", "replace")

def check_adapter():
    try:
        code, body = _http("http://127.0.0.1:9200/")
        d = json.loads(body)
        return ("adapter", bool(d.get("ok")), f"http {code}, model {d.get('model')}")
    except Exception as e:
        return ("adapter", False, f"nicht erreichbar: {e}")

def check_vllm():
    try:
        code, body = _http("http://127.0.0.1:8001/v1/models")
        ok = code == 200 and '"data"' in body
        return ("vllm", ok, f"http {code}")
    except Exception as e:
        return ("vllm", False, f"nicht erreichbar: {e}")

def check_directus():
    try:
        code, _ = _http("http://127.0.0.1:8055/server/health")
        return ("directus", code == 200, f"http {code}")
    except Exception as e:
        return ("directus", False, f"nicht erreichbar: {e}")

def check_waechter():
    try:
        age_min = (time.time() - WAECHTER_LOG.stat().st_mtime) / 60.0
        ok = age_min <= WAECHTER_MAX_AGE_MIN
        return ("waechter", ok, f"letzter Lauf vor {age_min:.0f} min")
    except Exception as e:
        return ("waechter", False, f"kein Log: {e}")

CHECKS = [check_adapter, check_vllm, check_directus, check_waechter]

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
    try: return json.loads(STATE.read_text())
    except Exception: return {}

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--dry-run"

    if mode == "--test-slack":
        tok = slack_token()
        r = slack("chat.postMessage", {"channel": CHANNEL,
            "text": "FaaS-Heartbeat: Testnachricht (wird sofort geloescht)."}, tok)
        if not r.get("ok"):
            print("post fehlgeschlagen:", r); sys.exit(1)
        ts = r["ts"]
        d = slack("chat.delete", {"channel": CHANNEL, "ts": ts}, tok)
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

    msg_lines = alarms + recover
    if msg_lines and mode == "--apply":
        text = "FaaS-Heartbeat (Spark):\n" + "\n".join(msg_lines)
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
