#!/usr/bin/env python3
"""
Legt das Directus-Schema für das Medien-Selbstbedienungsportal an (idempotent).

Neue Collections:
  portal_zugaenge  Ein-Zeile-pro-Zugang (Magic-Link-Login, Status eingeladen/aktiv/gesperrt).
  consent_log       Protokoll der Zustimmungen (Text-Version + Zeitpunkt + Kontext).

Zusätzliche Felder:
  faas_medien   dna_medium_freigabe(+_von), matching_freigeschaltet(+_von), portal_aktiv,
                logo_hochgeladen (Fix-Runde 1: Logo-Upload-Provenienz, getrennt von logo_url).
  applications  portal (json, Portal-spezifische Metadaten pro Antrag).

Strikt additiv: legt nur an, was fehlt. Bestehende Collections/Felder werden
NIE gelöscht oder verändert.

Aufruf auf dem Spark:
  DIRECTUS_TOKEN=$(cat ~/faas_classify/.dtoken) python3 setup_portal_schema.py

Env: DIRECTUS_TOKEN (Pflicht, sonst Fallback ~/.hermes/.env), DIRECTUS_URL
(Default http://localhost:8055).
"""
from __future__ import annotations
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

D = os.environ.get("DIRECTUS_URL", "http://localhost:8055").rstrip("/")


def _key_from(path: Path, name: str) -> str:
    if not path.exists():
        return ""
    for line in path.read_text().splitlines():
        if "=" in line and line.split("=", 1)[0].strip() == name:
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


TOK = os.environ.get("DIRECTUS_TOKEN") or _key_from(Path.home() / ".hermes" / ".env", "DIRECTUS_TOKEN")
if not TOK:
    sys.exit("DIRECTUS_TOKEN nicht gefunden (Env oder ~/.hermes/.env).")
H = {"Authorization": "Bearer " + TOK, "Content-Type": "application/json"}


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(D + path, data=data, method=method, headers=H)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


# UUID-Primärschlüssel (ohne Auto-Increment, Directus generiert die ID).
UUID_PK = {"field": "id", "type": "uuid",
           "meta": {"hidden": True, "readonly": True, "special": ["uuid"]},
           "schema": {"is_primary_key": True}}

# Felder von `portal_zugaenge`.
# Ein Zugang = ein Medium-Login (Magic-Link, kein Passwort). login_jti bindet
# das zuletzt ausgestellte Token, letzter_link* hält den zuletzt versendeten
# Link fest (Support/Nachvollziehbarkeit), letzter_login den letzten Erfolg.
PORTAL_ZUGAENGE_FIELDS = [
    UUID_PK,
    {"field": "email", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "medium_slug", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "mandant", "type": "string", "meta": {"interface": "input"},
     "schema": {"default_value": "wepublish"}},
    {"field": "status", "type": "string",
     "meta": {"interface": "select-dropdown",
              "options": {"choices": [{"text": "Eingeladen", "value": "eingeladen"},
                                       {"text": "Aktiv", "value": "aktiv"},
                                       {"text": "Gesperrt", "value": "gesperrt"}]}},
     "schema": {"default_value": "eingeladen"}},
    {"field": "login_jti", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "letzter_link", "type": "text", "meta": {"interface": "input-multiline"}, "schema": {}},
    {"field": "letzter_link_ts", "type": "timestamp", "meta": {"interface": "datetime"}, "schema": {}},
    {"field": "letzter_login", "type": "timestamp", "meta": {"interface": "datetime"}, "schema": {}},
    {"field": "eingeladen_am", "type": "timestamp", "meta": {"interface": "datetime"}, "schema": {}},
    {"field": "erstellt_von", "type": "string", "meta": {"interface": "input"}, "schema": {}},
]

# Felder von `consent_log`.
# Protokolliert jede bestätigte Zustimmung (z. B. Nutzungsbedingungen Portal)
# mit Text-Version, damit später belegbar ist, welchem Text zugestimmt wurde.
CONSENT_LOG_FIELDS = [
    UUID_PK,
    {"field": "medium_slug", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "email", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "mandant", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "text_version", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "bestaetigt_am", "type": "timestamp", "meta": {"interface": "datetime"}, "schema": {}},
    {"field": "kontext", "type": "string", "meta": {"interface": "input"}, "schema": {}},
]

# Zusätzliche Felder auf `faas_medien` für die Portal-Freigaben.
# dna_medium_freigabe / matching_freigeschaltet: Zeitpunkt + wer (Medium selbst
# via Portal oder Jolanda/Ramona) die DNA bzw. das Matching freigeschaltet hat.
# portal_aktiv: schaltet den Portal-Zugang für dieses Medium überhaupt frei.
FAAS_MEDIEN_PORTAL_FELDER = [
    {"field": "dna_medium_freigabe", "type": "timestamp", "meta": {"interface": "datetime",
     "note": "Zeitpunkt, an dem das Medium seine DNA im Portal freigegeben hat."}, "schema": {}},
    {"field": "dna_medium_freigabe_von", "type": "string", "meta": {"interface": "input",
     "note": "Wer die DNA freigegeben hat (E-Mail)."}, "schema": {}},
    {"field": "matching_freigeschaltet", "type": "timestamp", "meta": {"interface": "datetime",
     "note": "Zeitpunkt, an dem das Matching für dieses Medium freigeschaltet wurde."}, "schema": {}},
    {"field": "matching_freigeschaltet_von", "type": "string", "meta": {"interface": "input",
     "note": "Wer das Matching freigeschaltet hat (E-Mail)."}, "schema": {}},
    {"field": "portal_aktiv", "type": "boolean", "meta": {"interface": "boolean",
     "note": "Schaltet den Portal-Zugang für dieses Medium frei."},
     "schema": {"default_value": False}},
    {"field": "logo_hochgeladen", "type": "boolean", "meta": {"interface": "boolean",
     "note": ("true, sobald das Medium selbst ein echtes PNG/JPG-Logo über "
              "/api/portal/logo hochgeladen hat (Portal-Pflicht-Erststep). "
              "Getrennt von logo_url: das Feld logo_url kann auch ein "
              "automatisch abgerufenes Favicon sein (siehe medium-logo.ts), "
              "logo_hochgeladen bleibt dann false.")},
     "schema": {"default_value": False}},
]

# Zusätzliches Feld auf `applications` für Portal-spezifische Metadaten
# (z. B. vom Medium selbst gestellte Gesuchsanfragen über das Portal).
APPLICATIONS_PORTAL_FELD = [
    {"field": "portal", "type": "json", "meta": {"interface": "input-code",
     "note": "Portal-spezifische Metadaten (z. B. Anfrage-Herkunft, Status im Portal)."},
     "schema": {}},
]


def _existing_fields(collection):
    """Gibt die Menge der bereits vorhandenen Feldnamen zurück.
    Directus liefert /fields/{collection} als nackte Liste, nicht als {"data": [...]}.
    Beide Formate werden unterstützt (robustes Parsen wie in setup_outbox_jobs.py).
    """
    st, cur = req("GET", f"/fields/{collection}")
    if st not in (200, 404):
        print(f"  WARN: /fields/{collection} lieferte Status {st} - überspringe Feldliste.")
        return set()
    if isinstance(cur, list):
        return {f["field"] for f in cur if isinstance(f, dict)}
    if isinstance(cur, dict):
        data = cur.get("data", cur.get("fields", []))
        if isinstance(data, list):
            return {f["field"] for f in data if isinstance(f, dict)}
    return set()


def ensure_collection(name, note, fields, icon="lock_person"):
    """Legt die Collection an (falls nicht vorhanden) und ergänzt fehlende Felder.
    Bestehende Felder werden NIE verändert oder gelöscht."""
    st, _ = req("GET", f"/collections/{name}")
    if st == 200:
        print(f"Collection {name} existiert, ergänze fehlende Felder.")
        have = _existing_fields(name)
        for f in fields:
            if f["field"] in have:
                print(f"  {f['field']} existiert.")
                continue
            s, r = req("POST", f"/fields/{name}", f)
            print(f"  + Feld {f['field']} angelegt: {s}" + ("" if s in (200, 201) else f"  {r}"))
        return
    # Neue Collection anlegen: erst PK, dann die restlichen Felder einzeln.
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
        print(f"  + Feld {f['field']} angelegt: {s}" + ("" if s in (200, 201) else f"  {r}"))


def ensure_fields_on_existing(collection, fields):
    """Ergänzt Felder auf einer bereits bestehenden Collection. Legt die
    Collection selbst NICHT an (faas_medien und applications existieren)."""
    st, _ = req("GET", f"/collections/{collection}")
    if st != 200:
        print(f"WARN: Collection {collection} existiert nicht (Status {st}) - Felder werden übersprungen.")
        return
    have = _existing_fields(collection)
    for f in fields:
        if f["field"] in have:
            print(f"{collection}.{f['field']} existiert.")
            continue
        s, r = req("POST", f"/fields/{collection}", f)
        print(f"{collection} + {f['field']} angelegt: {s}" + ("" if s in (200, 201) else f"  {r}"))


def verify():
    """Verifikations-GET je Collection am Ende: Collection-Status, Feldzahl
    und expliziter Soll/Ist-Abgleich (FEHLT-Zeile bei Lücken)."""
    print("\n--- Verifikation ---")
    checks = (
        ("portal_zugaenge", {f["field"] for f in PORTAL_ZUGAENGE_FIELDS}),
        ("consent_log", {f["field"] for f in CONSENT_LOG_FIELDS}),
        ("faas_medien", {f["field"] for f in FAAS_MEDIEN_PORTAL_FELDER}),
        ("applications", {f["field"] for f in APPLICATIONS_PORTAL_FELD}),
    )
    for name, erwartete in checks:
        st, _ = req("GET", f"/collections/{name}")
        felder = _existing_fields(name)
        fehlend = erwartete - felder
        status = "OK" if not fehlend else f"FEHLT: {sorted(fehlend)}"
        print(f"{name}: Collection-GET {st}, {len(felder)} Felder, Soll/Ist {status}")


def main():
    ensure_collection(
        "portal_zugaenge",
        "Portal-Zugänge: ein Zugang pro Medium-E-Mail (Magic-Link-Login).",
        PORTAL_ZUGAENGE_FIELDS,
        icon="vpn_key",
    )
    ensure_collection(
        "consent_log",
        "Consent-Log: protokollierte Zustimmungen im Medien-Portal (Text-Version + Zeitpunkt).",
        CONSENT_LOG_FIELDS,
        icon="fact_check",
    )
    ensure_fields_on_existing("faas_medien", FAAS_MEDIEN_PORTAL_FELDER)
    ensure_fields_on_existing("applications", APPLICATIONS_PORTAL_FELD)
    verify()


if __name__ == "__main__":
    main()
