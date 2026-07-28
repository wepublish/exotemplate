#!/usr/bin/env python3
"""
Ergaenzt `portal_zugaenge` um das Feld `kontakt_name` (idempotent, rein additiv).

WOZU: Die Mail-Vorlagen kennen den Platzhalter {name} fuer die Ansprechperson
beim Medium. Bisher wurde der Name pro Mail von Hand getippt und nirgends
gemerkt — auf der Onboarding-Seite gar nicht abgefragt. Am 28.07.2026 ist so
eine Einladungsmail mit wortwoertlichem «Hallo {name}» an ein Medium
rausgegangen (gemeldet von Michael Scheurer). Das Feld haelt den Namen jetzt am
Zugang fest; fehlt er, faellt die Anrede auf «Liebe Redaktion von <Medium>»
zurueck. Ein roher Platzhalter kann damit nicht mehr entstehen.

Rein additiv: ein neues, optionales Feld. Keine bestehende Spalte wird
angefasst, kein Schema-Push (siehe Regel in ENTWICKLUNG_DEPLOY.md — in
Produktion nie `directus-sync push`).

Aufruf (Directus lokal erreichbar, auf der VPS oder ueber den Spark-Forwarder):
  python3 setup_kontakt_name.py            # Dry-run, zeigt nur was es taete
  python3 setup_kontakt_name.py --apply    # fuehrt aus

Token: aus DIRECTUS_TOKEN in der Umgebung, sonst aus ~/.hermes/.env,
sonst aus /root/faas/deploy/hetzner-selfcontained/.env (VPS).
"""
import json, os, sys, urllib.request, urllib.error

D = os.environ.get("DIRECTUS_URL_LOCAL", "http://localhost:8055")
APPLY = "--apply" in sys.argv
COLLECTION = "portal_zugaenge"
FELD = "kontakt_name"


def _token():
    t = os.environ.get("DIRECTUS_TOKEN")
    if t:
        return t.strip()
    for pfad in ("~/.hermes/.env", "/root/faas/deploy/hetzner-selfcontained/.env"):
        p = os.path.expanduser(pfad)
        if not os.path.exists(p):
            continue
        for line in open(p):
            if line.startswith("DIRECTUS_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("DIRECTUS_TOKEN nicht gefunden")


H = {"Authorization": "Bearer " + _token(), "Content-Type": "application/json"}


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(D + path, data=data, method=method, headers=H)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def main():
    status, _ = req("GET", f"/fields/{COLLECTION}/{FELD}")
    if status == 200:
        print(f"ok: {COLLECTION}.{FELD} existiert bereits, nichts zu tun.")
        return 0

    feld = {
        "field": FELD,
        "type": "string",
        "meta": {
            "interface": "input",
            "width": "half",
            "note": "Ansprechperson beim Medium. Fuellt die Anrede in den Mail-Vorlagen; "
            "leer heisst «Liebe Redaktion von <Medium>».",
            "options": {"placeholder": "Vorname, z.B. Simon"},
        },
        "schema": {"is_nullable": True, "max_length": 120},
    }

    if not APPLY:
        print(f"Dry-run: wuerde {COLLECTION}.{FELD} anlegen:")
        print(json.dumps(feld, indent=2, ensure_ascii=False))
        print("Mit --apply ausfuehren.")
        return 0

    status, antwort = req("POST", f"/fields/{COLLECTION}", feld)
    if status in (200, 201):
        print(f"angelegt: {COLLECTION}.{FELD}")
        return 0
    print(f"FEHLER {status}: {antwort}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
