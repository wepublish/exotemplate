#!/usr/bin/env python3
"""
Legt die Directus-Collections `agent_outbox` und `faas_jobs` an (idempotent)
und ergänzt `faas_medien` um kontakt_emails (json) + slack_channel (string).

agent_outbox = jede Aussenwirkung eine Zeile (Gate: kein Versand ohne Klick).
faas_jobs    = persistente Job-Ablage (ersetzt die In-Memory-Stores der App).

Aufruf auf dem Spark:  python3 setup_outbox_jobs.py
Token: aus ~/.hermes/.env (DIRECTUS_TOKEN), Directus auf localhost:8055.
"""
import json, os, sys, urllib.request, urllib.error

D = os.environ.get("DIRECTUS_URL_LOCAL", "http://localhost:8055")


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


# UUID-Primärschlüssel (ohne Auto-Increment, Directus generiert die ID)
UUID_PK = {"field": "id", "type": "uuid",
           "meta": {"hidden": True, "readonly": True, "special": ["uuid"]},
           "schema": {"is_primary_key": True}}

# Felder der Outbox-Collection.
# Jede Aussenwirkung (Mail, Slack, Gesuch-Export) landet hier als Entwurf,
# bevor ein expliziter Freigabe-Klick den Versand auslöst.
OUTBOX_FIELDS = [
    UUID_PK,
    {"field": "ts", "type": "timestamp",
     "meta": {"special": ["date-created"], "interface": "datetime", "readonly": True}, "schema": {}},
    {"field": "mandant", "type": "string", "meta": {"interface": "input"},
     "schema": {"default_value": "wepublish"}},
    {"field": "typ", "type": "string",
     "meta": {"interface": "select-dropdown",
              "options": {"choices": [{"text": "Mail", "value": "mail"},
                                       {"text": "Slack", "value": "slack"},
                                       {"text": "Gesuch final", "value": "gesuch_final"}]}},
     "schema": {}},
    {"field": "anlass", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "status", "type": "string", "meta": {"interface": "input"},
     "schema": {"default_value": "entwurf"}},
    {"field": "medium_id", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "application_id", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "stiftung_id", "type": "integer", "meta": {"interface": "input"}, "schema": {}},  # bewusst plain integer ohne FK, wie in agent_vorschlaege
    {"field": "empfaenger", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "betreff", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "inhalt", "type": "text", "meta": {"interface": "input-multiline"}, "schema": {}},
    {"field": "anhang", "type": "json", "meta": {"interface": "input-code"}, "schema": {}},
    {"field": "erstellt_von", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "freigegeben_von", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "freigegeben_am", "type": "timestamp", "meta": {"interface": "datetime"}, "schema": {}},
    {"field": "versendet_am", "type": "timestamp", "meta": {"interface": "datetime"}, "schema": {}},
    {"field": "fehler_text", "type": "text", "meta": {"interface": "input-multiline"}, "schema": {}},
    {"field": "dedup_key", "type": "string", "meta": {"interface": "input"}, "schema": {}},
]

# Felder der Jobs-Collection.
# Ersetzt die flüchtigen In-Memory-Stores der App (dna-jobs.ts, amount-jobs.ts).
# Lädt die App neu, bleibt der Job-Status erhalten.
JOBS_FIELDS = [
    UUID_PK,
    {"field": "typ", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "key", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "status", "type": "string", "meta": {"interface": "input"},
     "schema": {"default_value": "running"}},
    {"field": "phase", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "ergebnis", "type": "json", "meta": {"interface": "input-code"}, "schema": {}},
    {"field": "fehler", "type": "text", "meta": {"interface": "input-multiline"}, "schema": {}},
    {"field": "started_at", "type": "timestamp", "meta": {"interface": "datetime"}, "schema": {}},
    {"field": "updated_at", "type": "timestamp",
     "meta": {"special": ["date-updated"], "interface": "datetime", "readonly": True}, "schema": {}},
]

# Zusätzliche Felder für faas_medien.
# kontakt_emails: Allowlist der erlaubten Empfänger (Gate gegen Versand an falsche Adressen).
# slack_channel: Medien-Slack-Kanal für Entwürfe, z. B. #p-faas-bajour.
MEDIEN_FELDER = [
    {"field": "kontakt_emails", "type": "json", "meta": {"interface": "input-code",
     "note": "Empfänger-Allowlist: nur an diese Adressen darf das System mailen."}, "schema": {}},
    {"field": "slack_channel", "type": "string", "meta": {"interface": "input",
     "note": "Medien-Kanal, z. B. #p-faas-bajour. Ziel für Slack-Entwürfe."}, "schema": {}},
]


def _existing_fields(collection):
    """Gibt die Menge der bereits vorhandenen Feldnamen zurück.
    Directus liefert /fields/{collection} als nackte Liste, nicht als {"data": [...]}.
    Beide Formate werden unterstützt (robustes Parsen wie in setup_sonder_collection.py).
    """
    st, cur = req("GET", f"/fields/{collection}")
    if st not in (200, 404):
        print(f"  WARN: /fields/{collection} lieferte Status {st} — überspringe Feldliste.")
        return set()
    if isinstance(cur, list):
        return {f["field"] for f in cur if isinstance(f, dict)}
    if isinstance(cur, dict):
        data = cur.get("data", cur.get("fields", []))
        if isinstance(data, list):
            return {f["field"] for f in data if isinstance(f, dict)}
    return set()


def ensure_collection(name, note, fields, icon="outbox"):
    """Legt die Collection an (falls nicht vorhanden) und ergänzt fehlende Felder."""
    st, _ = req("GET", f"/collections/{name}")
    if st == 200:
        print(f"Collection {name} existiert, ergänze fehlende Felder.")
        have = _existing_fields(name)
        for f in fields:
            if f["field"] in have:
                print(f"  {f['field']} bereits vorhanden.")
                continue
            s, r = req("POST", f"/fields/{name}", f)
            print(f"  + Feld {f['field']}: {s}" + ("" if s in (200, 201) else f"  {r}"))
        return
    # Neue Collection anlegen: erst PK, dann die restlichen Felder einzeln
    body = {"collection": name,
            "meta": {"icon": icon, "note": note},
            "schema": {},
            "fields": [fields[0]]}
    s, r = req("POST", "/collections", body)
    print(f"Collection {name} angelegt: {s}")
    if s not in (200, 201):
        print(r)
        sys.exit(1)
    for f in fields[1:]:
        s, r = req("POST", f"/fields/{name}", f)
        print(f"  + Feld {f['field']}: {s}" + ("" if s in (200, 201) else f"  {r}"))


def main():
    ensure_collection(
        "agent_outbox",
        "Outbox: jede Aussenwirkung eine Zeile. Kein Versand ohne Freigabe-Klick.",
        OUTBOX_FIELDS,
        icon="outbox",
    )
    ensure_collection(
        "faas_jobs",
        "Persistente App-Jobs (Betrag, DNA). Ersetzt In-Memory-Stores.",
        JOBS_FIELDS,
        icon="sync",
    )
    # faas_medien-Felder ergänzen
    have = _existing_fields("faas_medien")
    for f in MEDIEN_FELDER:
        if f["field"] in have:
            print(f"faas_medien.{f['field']} existiert bereits.")
            continue
        s, r = req("POST", "/fields/faas_medien", f)
        print(f"faas_medien + {f['field']}: {s}" + ("" if s in (200, 201) else f"  {r}"))


if __name__ == "__main__":
    main()
