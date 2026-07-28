#!/usr/bin/env python3
"""
Legt die Directus-Collection `medium_events` an (idempotent).

Ereignis-Protokoll je Medium: jede Station des Workflows (Aufnahme, Zugang,
Login, DNA, Freigaben, Stiftungswahl, Gesuche, Zusage/Absage) schreibt hier
eine Zeile. Produzent ist die Front-App (apps/front/src/lib/medium-events.ts,
fire-and-forget), Konsument die Slack-Roadmap (faas_roadmap_slack.py), die den
Stand im Medien-Channel nachzeichnet (Entscheid Jolanda 28.07.2026).

Aufruf auf dem Spark (Directus via Tailscale-Forwarder auf localhost:8055):
  python3 setup_medium_events.py            # Dry-run, zeigt nur was es taete
  python3 setup_medium_events.py --apply    # fuehrt aus
Token: aus ~/.hermes/.env (DIRECTUS_TOKEN).
"""
import json, os, sys, urllib.request, urllib.error

D = os.environ.get("DIRECTUS_URL_LOCAL", "http://localhost:8055")
APPLY = "--apply" in sys.argv


def _token():
    for line in open(os.path.expanduser("~/.hermes/.env")):
        if line.startswith("DIRECTUS_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("DIRECTUS_TOKEN nicht gefunden")


TOK = _token()
H = {"Authorization": "Bearer " + TOK, "Content-Type": "application/json"}


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(D + path, data=data, method=method, headers=H)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


UUID_PK = {"field": "id", "type": "uuid",
           "meta": {"hidden": True, "readonly": True, "special": ["uuid"]},
           "schema": {"is_primary_key": True}}

EVENT_FIELDS = [
    UUID_PK,
    {"field": "medium_id", "type": "string", "meta": {"interface": "input",
     "note": "Slug des Mediums (faas_medien.slug)."}, "schema": {}},
    {"field": "mandant", "type": "string", "meta": {"interface": "input"},
     "schema": {"default_value": "wepublish"}},
    {"field": "typ", "type": "string", "meta": {"interface": "input",
     "note": "medium_aufgenommen | zugang_erstellt | portal_login | dna_aktiv | "
             "dna_freigegeben | matching_freigegeben | stiftung_gewaehlt | "
             "gesuch_freigegeben | gesuch_final | gesuch_eingereicht | zusage | absage"},
     "schema": {}},
    {"field": "titel", "type": "string", "meta": {"interface": "input",
     "note": "Medien-sichtbar (landet in der Slack-Roadmap des Medien-Channels): "
             "keine Scores, keine internen Bemerkungen."}, "schema": {}},
    {"field": "detail", "type": "text", "meta": {"interface": "input-multiline"}, "schema": {}},
    {"field": "actor", "type": "string", "meta": {"interface": "input",
     "note": "E-Mail der ausloesenden Person (Portal-Zugang oder Operator)."}, "schema": {}},
    {"field": "date_created", "type": "timestamp",
     "meta": {"special": ["date-created"], "interface": "datetime", "readonly": True}, "schema": {}},
]


def collection_existiert(name):
    code, _ = req("GET", f"/collections/{name}")
    return code == 200


def main():
    modus = "APPLY" if APPLY else "DRY-RUN"
    print(f"[{modus}] Directus: {D}")

    if collection_existiert("medium_events"):
        print("Collection medium_events existiert schon — nichts zu tun (idempotent).")
        return 0

    print("Collection medium_events fehlt, wird angelegt mit Feldern:")
    for f in EVENT_FIELDS:
        print(f"  - {f['field']} ({f['type']})")

    if not APPLY:
        print("Dry-run beendet. Mit --apply ausfuehren.")
        return 0

    code, resp = req("POST", "/collections", {
        "collection": "medium_events",
        "meta": {
            "icon": "timeline",
            "note": "Ereignis-Protokoll je Medium (Workflow-Stationen); Konsument: faas_roadmap_slack.py",
            "sort_field": None,
        },
        "schema": {},
        "fields": EVENT_FIELDS,
    })
    if code not in (200, 204):
        print(f"FEHLER beim Anlegen ({code}): {resp}")
        return 1

    print("Collection medium_events angelegt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
