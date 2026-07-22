#!/usr/bin/env python3
"""
Loescht die alten deep-(Opus-)match_results der angegebenen Medien, nachdem der
qwen-v3-Re-Match neue Treffer geschrieben hat. Sichert die zu loeschenden Zeilen
VORHER vollstaendig in eine JSON-Backup-Datei (reversibel).

Lauf:  python3 cleanup_deep_matches.py [--apply] medium1 medium2 ...
Default = dry-run (zaehlt + backupt, loescht NICHT). --apply loescht.

Directus: localhost:8055, Token aus ~/.hermes/.env. Paginierung mit sort=id
(Lehre aus CLAUDE.md: ohne sort=id liefert Offset-Pagination Phantom-Dups).
"""
from __future__ import annotations
import json, os, sys, time, urllib.request, urllib.parse
from pathlib import Path
from datetime import datetime, timezone

BASE = "http://localhost:8055"


def token() -> str:
    for l in (Path.home() / ".hermes" / ".env").read_text().splitlines():
        if l.startswith("DIRECTUS_TOKEN"):
            return l.split("=", 1)[1].strip().strip('"')
    raise SystemExit("Kein DIRECTUS_TOKEN")


TOK = token()


def req(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {TOK}", "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=60) as x:
        raw = x.read().decode()
        return json.loads(raw) if raw else {}


def alle_deep_ids(medium: str) -> list[dict]:
    """Alle deep-match_results eines Mediums, paginiert mit sort=id."""
    rows, last = [], 0
    while True:
        q = (f"/items/match_results?filter[medium_id][_eq]={urllib.parse.quote(medium)}"
             f"&filter[dna_quality_tier][_eq]=deep&filter[id][_gt]={last}"
             f"&sort=id&limit=500&fields=*")
        batch = req("GET", q).get("data", [])
        if not batch:
            break
        rows.extend(batch)
        last = batch[-1]["id"]
        if len(batch) < 500:
            break
    return rows


def main() -> int:
    apply = "--apply" in sys.argv
    medien = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not medien:
        raise SystemExit("Medien angeben")
    backup = {"erstellt": datetime.now(timezone.utc).isoformat(), "medien": medien, "rows": {}}
    gesamt = 0
    for m in medien:
        rows = alle_deep_ids(m)
        backup["rows"][m] = rows
        gesamt += len(rows)
        print(f"  {m}: {len(rows)} deep-Zeilen")
    bpath = Path.home() / "faas_classify" / f"deep_backup_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    bpath.write_text(json.dumps(backup, ensure_ascii=False))
    print(f"Backup: {bpath} ({gesamt} Zeilen)")
    if not apply:
        print("DRY-RUN — nichts geloescht. Mit --apply loeschen.")
        return 0
    geloescht = 0
    for m in medien:
        ids = [r["id"] for r in backup["rows"][m]]
        for i in range(0, len(ids), 100):
            req("DELETE", "/items/match_results", ids[i:i + 100])
            geloescht += len(ids[i:i + 100])
        print(f"  {m}: geloescht")
    print(f"GELOESCHT: {geloescht} deep-Zeilen.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
