#!/usr/bin/env python3
"""
Sonder-Matcher — Medium-DNA gegen die Sonderfall-Collections `kirchen` und `foerderer`.

Gegenstueck zur Haupt-Match-Engine (die hart auf `stiftungen`/`stiftung_id` laeuft) und
zu projekt_matcher.py (Projekt-DNA -> Stiftungen). Hier: aktive Medium-DNA wird gegen die
kirchen-/foerderer-Pools math-gematcht und nach `sonder_match_results` geschrieben
(eigene Collection, damit die Haupt-Engine/App-Joins unberuehrt bleiben).

Risikoarm:
  - Wiederverwendung von match_engine.compute_math_score per IMPORT (keine Aenderung an der Engine).
  - kirchen/foerderer tragen `tags` im stiftungs_dna-Format -> direkt als sdna_full nutzbar
    => identische Score-Skala wie die Stiftungs-Matches (dna_vs_dna).
  - Idempotent: vor dem Schreiben werden alte Treffer des Mediums geloescht.

Math-only (v1), wie projekt_matcher: Tag-/Gewicht-Ueberschneidung, deterministisch, kein LLM.

Modi:
  --dry-run (Default): rechnet + zeigt Top-Treffer, schreibt NICHTS.
  --apply:             schreibt sonder_match_results (idempotent pro Medium).
  --medium <slug>:     nur dieses Medium (sonst alle aktiven medium_dna).
"""
from __future__ import annotations
import argparse, json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.expanduser("~/dna_pilot"))
sys.path.insert(0, os.path.expanduser("~/.hermes/data/faas"))
import match_engine as me  # compute_math_score, directus_get/post, _headers, DIRECTUS_URL

MIN_SCORE = int(os.environ.get("SONDER_MIN_SCORE", "10"))
MANDANT = os.environ.get("WAECHTER_MANDANT", "wepublish")
TOP_N = int(os.environ.get("SONDER_TOP_N", "0"))  # 0 = unbegrenzt (Pool ist klein)
ZIELE = ["kirchen", "foerderer", "lotteriefonds", "sponsoren"]
# Name-Feld je Collection (kirchen/foerderer: name; lotteriefonds/sponsoren abweichend).
NAME_FIELD = {"kirchen": "name", "foerderer": "name",
              "lotteriefonds": "stiftungsname", "sponsoren": "firmenname"}


def load_medien(slug=None):
    p = {"filter[is_active][_eq]": "true",
         "fields": "medium_id,medium_name,version_id,sektionen,tags,exclusion_tags,sound_feeling",
         "limit": -1}
    rows = me.directus_get("/items/medium_dna", p).get("data") or []
    out = []
    for m in rows:
        if slug and m.get("medium_id") != slug:
            continue
        has_tags = bool(m.get("tags")) or bool(m.get("sektionen"))
        if not has_tags:
            continue
        out.append(m)
    return out


def load_ziel(coll):
    nf = NAME_FIELD.get(coll, "name")
    p = {"fields": f"id,{nf},tags,exclusion_tags,schaerfe_prozent", "limit": -1}
    rows = me.directus_get(f"/items/{coll}", p).get("data") or []
    # nur bereits gemessene (mit Tags); Name auf _ziel_name normalisieren
    out = []
    for r in rows:
        if isinstance(r.get("tags"), list) and r["tags"]:
            r["_ziel_name"] = r.get(nf)
            out.append(r)
    return out


def ziel_tag_slugs(ziel):
    out = set()
    for t in ziel.get("tags") or []:
        if isinstance(t, dict):
            s = t.get("tag_slug") or t.get("tag")
            if s:
                out.add(s)
    return out


def medium_exclusion_slugs(dna):
    """Medium-Exclusions (ausser geo_ — vgl. Haupt-Engine: Geo schliesst nicht hart aus)."""
    out = set()
    for e in dna.get("exclusion_tags") or []:
        if isinstance(e, dict):
            t = e.get("tag") or e.get("tag_slug") or ""
            if t and not t.startswith("geo_"):
                out.add(t)
    return out


def delete_alte(medium_id):
    alt = me.directus_get("/items/sonder_match_results",
                          {"filter[medium_id][_eq]": medium_id, "fields": "id", "limit": -1}).get("data") or []
    if not alt:
        return 0
    import requests
    requests.delete(f"{me.DIRECTUS_URL}/items/sonder_match_results",
                    headers=me._headers(), json=[r["id"] for r in alt], timeout=60)
    return len(alt)


def match_medium(m, ziele_data, apply, run_id):
    medium_id = m.get("medium_id")
    version_id = m.get("version_id") or ""
    dna_obj = {
        "sektionen": m.get("sektionen") or {},
        "tags": m.get("tags") or [],
        "exclusion_tags": m.get("exclusion_tags") or [],
    }
    excl = medium_exclusion_slugs(dna_obj)
    scored = []
    for coll, rows in ziele_data.items():
        for z in rows:
            zslugs = ziel_tag_slugs(z)
            if excl & zslugs:  # harte Exclusion nur bei echtem (nicht-geo) Tag-Treffer
                continue
            score, bd = me.compute_math_score(dna_obj, {}, z)
            if score < MIN_SCORE:
                continue
            matched = [x.get("tag") for x in (bd.get("matched") or []) if x.get("tag")]
            scored.append({
                "ziel_collection": coll, "ziel": z, "score": score,
                "breakdown": bd, "matched": matched,
            })
    scored.sort(key=lambda x: x["score"], reverse=True)
    if TOP_N > 0:
        scored = scored[:TOP_N]

    print(f"\n=== {medium_id}  ({len(scored)} Treffer >= {MIN_SCORE}) ===")
    for r in scored[:10]:
        z = r["ziel"]
        print(f"  {r['score']:3d}  [{r['ziel_collection'][:4]}] {str(z.get('_ziel_name'))[:46]:46}  "
              f"tags: {', '.join(r['matched'][:5])}")
    if not apply:
        return 0

    geloescht = delete_alte(medium_id)
    if geloescht:
        print(f"  alte Treffer geloescht: {geloescht}")
    geschrieben = 0
    now = datetime.now(timezone.utc).isoformat()
    for r in scored:
        z = r["ziel"]
        matched = r["matched"]
        body = {
            "medium_id": medium_id,
            "mandant": MANDANT,
            "ziel_collection": r["ziel_collection"],
            "ziel_id": z.get("id"),
            "ziel_name": z.get("_ziel_name"),
            "score": r["score"],
            "score_math": r["score"],
            "score_breakdown": r["breakdown"] if isinstance(r["breakdown"], dict) else {},
            "begruendung": (f"Sonder-Match (math, v1): {len(matched)} gemeinsame Themen mit "
                            f"{z.get('_ziel_name')}" + (f" — {', '.join(matched[:6])}." if matched else ".")),
            "top_tags": matched[:8],
            "schaerfe_ziel": z.get("schaerfe_prozent"),
            "medium_dna_version_id": version_id,
            "computed_at": now,
            "compute_run_id": run_id,
        }
        try:
            me.directus_post("/items/sonder_match_results", body)
            geschrieben += 1
        except Exception as e:
            print(f"     POST-Fehler {r['ziel_collection']}/{z.get('id')}: {str(e)[:120]}")
    print(f"  geschrieben: {geschrieben}")
    return geschrieben


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--medium", help="nur dieses Medium (medium_id/slug)")
    args = ap.parse_args()
    run_id = "sonder-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    medien = load_medien(args.medium)
    if not medien:
        print("Keine aktiven Medien mit DNA gefunden" + (f" fuer '{args.medium}'." if args.medium else "."))
        return 0
    ziele_data = {c: load_ziel(c) for c in ZIELE}
    print(f"Medien: {[m.get('medium_id') for m in medien]} | Modus: {'APPLY' if args.apply else 'DRY-RUN'} | "
          f"MIN_SCORE={MIN_SCORE}")
    print("Sonder-Pools: " + ", ".join(f"{c}={len(ziele_data[c])} gemessen" for c in ZIELE))

    total = 0
    for m in medien:
        total += match_medium(m, ziele_data, args.apply, run_id)
    print(f"\nFertig. {'Geschrieben: ' + str(total) if args.apply else 'DRY-RUN, nichts geschrieben.'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
