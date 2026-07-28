#!/usr/bin/env python3
"""FaaS Dead-Man-Switch (NAS-seitig).
Prueft die Frische des Spark-Lebenszeichens (vom Spark alle 5 Min geschrieben).
Wird es zu alt, ist der Spark down/haengt -> Slack-Alarm #faas-admin (Dedup).
Laeuft auf dem NAS, unabhaengig vom Spark. Token aus ~/.faas_slack_token.
Modi: --dry-run (Default) | --apply | --test-slack
"""
import json, os, sys, time, urllib.request
from pathlib import Path

ALIVE = "/volume2/ki_work/backups/spark/heartbeat/spark_alive"
STATE = os.path.expanduser("~/.faas_deadman.state.json")
TOKEN_FILE = os.path.expanduser("~/.faas_slack_token")
CHANNEL = os.environ.get("DEADMAN_CHANNEL", "C0B7SD7JCEM")
MAX_AGE_MIN = int(os.environ.get("DEADMAN_MAX_AGE_MIN", "15"))

def token():
    return Path(TOKEN_FILE).read_text().strip()

def slack(method, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request("https://slack.com/api/" + method, data=data,
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json; charset=utf-8"})
    return json.loads(urllib.request.urlopen(req, timeout=10).read().decode())

def age_min():
    try:
        return (time.time() - os.path.getmtime(ALIVE)) / 60.0
    except FileNotFoundError:
        return None

def load():
    try:
        return json.loads(Path(STATE).read_text())
    except Exception:
        return {}

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--dry-run"
    if mode == "--test-slack":
        r = slack("chat.postMessage", {"channel": CHANNEL, "text": "FaaS Dead-Man-Switch (NAS): Testnachricht (wird geloescht)."})
        if not r.get("ok"):
            print("post fail", r); sys.exit(1)
        d = slack("chat.delete", {"channel": CHANNEL, "ts": r["ts"]})
        print("Slack-Test ok: post=%s delete=%s" % (r.get("ok"), d.get("ok"))); return
    a = age_min()
    down = (a is None) or (a > MAX_AGE_MIN)
    detail = "kein Lebenszeichen-File" if a is None else ("letztes Lebenszeichen vor %.0f min" % a)
    prev = load().get("spark", "ok")
    now = "fail" if down else "ok"
    print("%s | spark=%s | %s" % (time.strftime("%F %T"), now.upper(), detail))
    msg = None
    if down and prev == "ok":
        msg = "[ALARM] Spark nicht erreichbar — %s. Adapter/Waechter/Matching liegen vermutlich still." % detail
    elif (not down) and prev == "fail":
        msg = "[OK wieder] Spark sendet wieder Lebenszeichen — %s." % detail
    if msg and mode == "--apply":
        try:
            r = slack("chat.postMessage", {"channel": CHANNEL, "text": "FaaS Dead-Man-Switch (NAS):\n" + msg})
            print("slack:", "ok" if r.get("ok") else r)
        except Exception as e:
            print("slack-fehler:", e)
    elif msg:
        print("(dry-run) " + msg)
    if mode == "--apply":
        Path(STATE).write_text(json.dumps({"spark": now}))

if __name__ == "__main__":
    main()
