#!/usr/bin/env python3
"""
Idempotentes Schema-Setup für FaaS-App Phase 2.

Ergänzt die Collection `applications` um zwei Felder:
  paket         (json)      Förderpaket des Paket-Builders: score, betrag, gold,
                            gesuch_prompt, einreichungs_check, outbox_ids
  gesichtet_am  (timestamp) Wann das Paket im Sichtungs-Stapel übernommen wurde

Aufruf auf dem Spark:  python3 setup_phase2_felder.py
Token: aus ~/.hermes/.env (DIRECTUS_TOKEN), Directus auf localhost:8055.
Zweiter Lauf: «existiert bereits» für jedes Feld (Idempotenz).
"""

import json
import os
import sys
import urllib.error
import urllib.request

D = os.environ.get("DIRECTUS_URL_LOCAL", "http://localhost:8055")


def _token() -> str:
    pfad = os.path.expanduser("~/.hermes/.env")
    try:
        for zeile in open(pfad):
            if zeile.startswith("DIRECTUS_TOKEN="):
                return zeile.split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    sys.exit("DIRECTUS_TOKEN nicht in ~/.hermes/.env gefunden.")


TOK = _token()
H = {"Authorization": "Bearer " + TOK, "Content-Type": "application/json"}


def req(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(D + path, data=data, method=method, headers=H)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]


def vorhandene_felder(collection: str) -> set:
    """Gibt die Menge der bereits vorhandenen Feldnamen zurück."""
    st, cur = req("GET", f"/fields/{collection}")
    if st not in (200, 404):
        print(f"  WARN: /fields/{collection} lieferte Status {st}.")
        return set()
    if isinstance(cur, list):
        return {f["field"] for f in cur if isinstance(f, dict)}
    if isinstance(cur, dict):
        data = cur.get("data", cur.get("fields", []))
        if isinstance(data, list):
            return {f["field"] for f in data if isinstance(f, dict)}
    return set()


# Neue Felder für die Collection `applications`
APPLICATIONS_FELDER = [
    {
        "field": "paket",
        "type": "json",
        "meta": {
            "interface": "input-code",
            "note": (
                "Förderpaket des Paket-Builders: score, betrag, gold, "
                "gesuch_prompt, einreichungs_check, outbox_ids"
            ),
        },
        "schema": {},
    },
    {
        "field": "gesichtet_am",
        "type": "timestamp",
        "meta": {
            "interface": "datetime",
            "note": "Wann das Paket im Sichtungs-Stapel übernommen wurde",
        },
        "schema": {},
    },
]


def main():
    vorhanden = vorhandene_felder("applications")
    print(f"Vorhandene Felder in applications: {len(vorhanden)}")

    for f in APPLICATIONS_FELDER:
        name = f["field"]
        if name in vorhanden:
            print(f"  {name}: existiert bereits (übersprungen).")
            continue
        st, res = req("POST", "/fields/applications", f)
        if st in (200, 201):
            print(f"  {name}: angelegt (Status {st}).")
        else:
            print(f"  {name}: FEHLER Status {st}  {res}")

    print("Fertig.")


if __name__ == "__main__":
    main()
