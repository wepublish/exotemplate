#!/usr/bin/env python3
"""
Legt die Directus-Collection `sonder_match_results` an (idempotent).

Sonder-Matches = Medium x kirchen/foerderer (separater Sonder-Matcher, NICHT die
Haupt-Match-Engine). Bewusst eigene Collection, weil match_results hart auf
stiftung_id (integer, gejoint gegen `stiftungen`) verdrahtet ist und die
kirchen/foerderer-IDs (1..46) damit kollidieren wuerden.

Aufruf auf dem Spark:  python3 setup_sonder_collection.py
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


COLLECTION = "sonder_match_results"

FIELDS = [
    {"field": "id", "type": "integer",
     "meta": {"hidden": True, "interface": "input", "readonly": True},
     "schema": {"is_primary_key": True, "has_auto_increment": True}},
    {"field": "medium_id", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "mandant", "type": "string",
     "meta": {"interface": "input"}, "schema": {"default_value": "wepublish"}},
    {"field": "ziel_collection", "type": "string",
     "meta": {"interface": "select-dropdown",
              "options": {"choices": [{"text": "Kirchen", "value": "kirchen"},
                                       {"text": "Foerderer", "value": "foerderer"}]}},
     "schema": {}},
    {"field": "ziel_id", "type": "integer", "meta": {"interface": "input"}, "schema": {}},
    {"field": "ziel_name", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "score", "type": "integer", "meta": {"interface": "input"}, "schema": {}},
    {"field": "score_math", "type": "integer", "meta": {"interface": "input"}, "schema": {}},
    {"field": "score_breakdown", "type": "json", "meta": {"interface": "input-code"}, "schema": {}},
    {"field": "begruendung", "type": "text", "meta": {"interface": "input-multiline"}, "schema": {}},
    {"field": "top_tags", "type": "json", "meta": {"interface": "input-code"}, "schema": {}},
    {"field": "schaerfe_ziel", "type": "integer", "meta": {"interface": "input"}, "schema": {}},
    {"field": "medium_dna_version_id", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "computed_at", "type": "timestamp", "meta": {"interface": "datetime"}, "schema": {}},
    {"field": "compute_run_id", "type": "string", "meta": {"interface": "input"}, "schema": {}},
]


def main():
    st, _ = req("GET", f"/collections/{COLLECTION}")
    if st == 200:
        print(f"Collection {COLLECTION} existiert bereits — ergaenze fehlende Felder.")
        st_f, cur = req("GET", f"/fields/{COLLECTION}")
        have = {f["field"] for f in cur} if isinstance(cur, list) else set()
        for f in FIELDS:
            if f["field"] in have:
                continue
            s, r = req("POST", f"/fields/{COLLECTION}", f)
            print(f"  + Feld {f['field']}: {s}")
        return
    # Collection neu anlegen, inkl. PK-Feld
    body = {
        "collection": COLLECTION,
        "meta": {"icon": "join_inner", "note": "Sonder-Matches: Medium x kirchen/foerderer "
                 "(separater Matcher, NICHT Haupt-Engine).", "sort_field": "score"},
        "schema": {},
        "fields": [FIELDS[0]],
    }
    s, r = req("POST", "/collections", body)
    print(f"Collection angelegt: {s}")
    if s not in (200, 201):
        print(r); sys.exit(1)
    for f in FIELDS[1:]:
        s, r = req("POST", f"/fields/{COLLECTION}", f)
        print(f"  + Feld {f['field']}: {s}" + ("" if s in (200, 201) else f"  {r}"))


if __name__ == "__main__":
    main()
