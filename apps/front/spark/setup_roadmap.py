#!/usr/bin/env python3
"""
Legt die Directus-Collection `faas_roadmap` an (idempotent) und seedet pro
aktivem wepublish-Medium eine Zeile mit der 8-Stationen-Roadmap.

Eine Zeile pro Medium. `stationen` speichert NUR die menschlich gepflegten
Anteile je Station (freigegeben, dokument_link, notiz); Titel/Rolle/Status
leiten sich in der App (src/lib/roadmap.ts) bzw. aus Live-Daten ab.

WICHTIG (Entkopplung): die Slack-Referenzen der Roadmap (slack_channel,
canvas_id, action_ts) leben HIER auf der faas_roadmap-Zeile, NICHT auf
faas_medien.slack_channel. faas_medien.slack_channel wird bewusst NICHT
angefasst, weil dessen Befuellung den Outbox-/Waechter-/Paket-Builder-
Slack-Versand scharf schaltet (heute dormant, gewollt).

Aufruf auf dem Spark:
  python3 setup_roadmap.py            # Dry-run, zeigt nur was es taete
  python3 setup_roadmap.py --apply    # fuehrt aus
Token: aus ~/.hermes/.env (DIRECTUS_TOKEN), Directus auf localhost:8055.
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

ROADMAP_FIELDS = [
    UUID_PK,
    {"field": "medium_id", "type": "string", "meta": {"interface": "input"}, "schema": {}},
    {"field": "mandant", "type": "string", "meta": {"interface": "input"},
     "schema": {"default_value": "wepublish"}},
    {"field": "stationen", "type": "json", "meta": {"interface": "input-code",
     "note": "8 Eintraege: {nr, freigegeben, dokument_link, notiz}. Titel/Rolle/Status leiten sich in der App ab."}, "schema": {}},
    {"field": "slack_channel", "type": "string", "meta": {"interface": "input",
     "note": "Channel-ID des Roadmap-Pults (z. B. C0ANUQUR9ND). Entkoppelt von faas_medien.slack_channel."}, "schema": {}},
    {"field": "canvas_id", "type": "string", "meta": {"interface": "input",
     "note": "Canvas-ID des Roadmap-Canvas im Medien-Kanal."}, "schema": {}},
    {"field": "action_ts", "type": "string", "meta": {"interface": "input",
     "note": "ts der interaktiven Aktions-Nachricht (fuer chat.update)."}, "schema": {}},
    {"field": "aktualisiert_am", "type": "timestamp",
     "meta": {"special": ["date-updated"], "interface": "datetime", "readonly": True}, "schema": {}},
    {"field": "aktualisiert_quelle", "type": "string", "meta": {"interface": "input"}, "schema": {}},
]

# Bekannte Slack-Referenzen aus SKILL_PATCH_slack_workflow.md (existierende Kanaele/Canvases).
# eecomm-Kanal = ee-news (Slug-Migration).
SLACK_REFS = {
    "cueltuer": {"slack_channel": "C0ANUQUR9ND", "canvas_id": "F0ANG7ADHL2"},
    "wepublish": {"slack_channel": "C0AN9GC0SJF", "canvas_id": "F0AN9RM8C6P"},
    "ee-news": {"slack_channel": "C0ANL56510C", "canvas_id": "F0APAR77D5W"},
}


def _seed_stationen():
    return [{"nr": n, "freigegeben": None, "dokument_link": None, "notiz": None} for n in range(1, 9)]


def _existing_fields(collection):
    st, cur = req("GET", f"/fields/{collection}")
    if st not in (200, 404):
        print(f"  WARN: /fields/{collection} Status {st}")
        return set()
    if isinstance(cur, list):
        return {f["field"] for f in cur if isinstance(f, dict)}
    if isinstance(cur, dict):
        data = cur.get("data", cur.get("fields", []))
        if isinstance(data, list):
            return {f["field"] for f in data if isinstance(f, dict)}
    return set()


def ensure_collection():
    st, _ = req("GET", "/collections/faas_roadmap")
    if st == 200:
        print("Collection faas_roadmap existiert, ergaenze fehlende Felder.")
        if not APPLY:
            print("  [dry-run] wuerde fehlende Felder ergaenzen")
            return
        have = _existing_fields("faas_roadmap")
        for f in ROADMAP_FIELDS:
            if f["field"] in have:
                continue
            s, r = req("POST", "/fields/faas_roadmap", f)
            print(f"  + Feld {f['field']}: {s}" + ("" if s in (200, 201) else f"  {r}"))
        return
    print("Collection faas_roadmap fehlt.")
    if not APPLY:
        print("  [dry-run] wuerde Collection + 9 Felder anlegen")
        return
    body = {"collection": "faas_roadmap",
            "meta": {"icon": "checklist", "note": "8-Stationen-Roadmap pro Medium (Slack-Spiegel + App)."},
            "schema": {}, "fields": [ROADMAP_FIELDS[0]]}
    s, r = req("POST", "/collections", body)
    print(f"Collection faas_roadmap angelegt: {s}")
    if s not in (200, 201):
        print(r)
        sys.exit(1)
    for f in ROADMAP_FIELDS[1:]:
        s, r = req("POST", "/fields/faas_roadmap", f)
        print(f"  + Feld {f['field']}: {s}" + ("" if s in (200, 201) else f"  {r}"))


def aktive_medien():
    st, r = req("GET", "/items/faas_medien?filter[is_active][_eq]=true&filter[mandant][_eq]=wepublish&fields=slug&limit=100")
    if st != 200 or not isinstance(r, dict):
        sys.exit(f"faas_medien lesen fehlgeschlagen: {st} {r}")
    return [m["slug"] for m in r.get("data", []) if m.get("slug")]


def seed_medien():
    slugs = aktive_medien()
    print(f"Aktive wepublish-Medien: {', '.join(slugs)}")
    for slug in slugs:
        st, r = req("GET", f"/items/faas_roadmap?filter[medium_id][_eq]={slug}&filter[mandant][_eq]=wepublish&fields=id,slack_channel&limit=1")
        existing = r.get("data", []) if isinstance(r, dict) else []
        refs = SLACK_REFS.get(slug, {})
        if existing:
            row = existing[0]
            # Slack-Referenzen nachtragen, falls leer und bekannt
            patch = {k: v for k, v in refs.items() if not row.get(k)}
            if patch:
                if not APPLY:
                    print(f"  [dry-run] {slug}: Zeile vorhanden, wuerde {list(patch)} setzen")
                else:
                    s, rr = req("PATCH", f"/items/faas_roadmap/{row['id']}", patch)
                    print(f"  {slug}: Slack-Refs ergaenzt {list(patch)}: {s}")
            else:
                print(f"  {slug}: Zeile vorhanden, nichts zu tun")
            continue
        body = {"medium_id": slug, "mandant": "wepublish",
                "stationen": _seed_stationen(), "aktualisiert_quelle": "setup", **refs}
        if not APPLY:
            print(f"  [dry-run] {slug}: wuerde Zeile anlegen (8 Stationen{', + Slack-Refs' if refs else ''})")
            continue
        s, rr = req("POST", "/items/faas_roadmap", body)
        print(f"  {slug}: Zeile angelegt: {s}" + ("" if s in (200, 201) else f"  {rr}"))


def main():
    print(f"{'APPLY' if APPLY else 'DRY-RUN'} gegen {D}\n")
    ensure_collection()
    print()
    seed_medien()


if __name__ == "__main__":
    main()
