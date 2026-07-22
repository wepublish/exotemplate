#!/usr/bin/env python3
"""
Ergaenzt die DNA-Felder (analog kirchen/foerderer/stiftungs_dna) in den Collections
`lotteriefonds` und `sponsoren`, damit sie vom Sonder-Matcher gemessen + gematcht
werden koennen. Idempotent (vorhandene Felder werden uebersprungen).

Aufruf auf dem Spark:  python3 setup_sonder_dna_felder.py
"""
import json, os, sys, urllib.request, urllib.error

D = os.environ.get("DIRECTUS_URL_LOCAL", "http://localhost:8055")
COLLECTIONS = ["lotteriefonds", "sponsoren"]

DNA_FIELDS = [
    {"field": "tags", "type": "json", "meta": {"interface": "input-code"}, "schema": {}},
    {"field": "exclusion_tags", "type": "json", "meta": {"interface": "input-code"}, "schema": {}},
    {"field": "sound_feeling", "type": "text", "meta": {"interface": "input-multiline"}, "schema": {}},
    {"field": "foerderpraxis", "type": "json", "meta": {"interface": "input-code"}, "schema": {}},
    {"field": "schaerfe_prozent", "type": "integer", "meta": {"interface": "input"}, "schema": {}},
    {"field": "vocabulary_version_at_creation", "type": "integer", "meta": {"interface": "input"}, "schema": {}},
    {"field": "antragsteller_typ", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "web_url", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "quellen", "type": "json", "meta": {"interface": "input-code"}, "schema": {}},
    {"field": "veredelt_at", "type": "timestamp", "meta": {"interface": "datetime"}, "schema": {}},
    {"field": "veredelt_by", "type": "string", "meta": {"interface": "input"}, "schema": {}},
]


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
        return e.code, e.read().decode()[:200]


def main():
    for coll in COLLECTIONS:
        st, cur = req("GET", f"/fields/{coll}")
        have = {f["field"] for f in cur} if isinstance(cur, list) else set()
        print(f"=== {coll} (vorhandene Felder: {len(have)}) ===")
        for f in DNA_FIELDS:
            if f["field"] in have:
                print(f"  = {f['field']} (existiert)")
                continue
            s, r = req("POST", f"/fields/{coll}", f)
            print(f"  + {f['field']}: {s}" + ("" if s in (200, 201) else f"  {r}"))


if __name__ == "__main__":
    main()
