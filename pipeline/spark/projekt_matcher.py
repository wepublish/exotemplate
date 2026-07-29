#!/usr/bin/env python3
"""
Projekt-Matcher (Phase 2) — misst Projekt-DNA und rechnet projektspezifische Matches.

Ein Projekt (z.B. wepublish/KI-Exoskelett) bekommt eine EIGENE gemessene DNA (qwen, vocab_v3,
Antragsteller-Perspektive) und wird wie ein eigener «Client» gegen den Foerderer-Pool gematcht.
Ergebnis: match_results mit gesetztem projekt_id (Medium-Treffer = projekt_id NULL, unberuehrt).

Risikoarm:
  - Nutzt die Scoring-Funktionen der Match-Engine per IMPORT (keine Aenderung an match_engine.py).
  - Die Projekt-DNA bekommt eine EIGENE medium_dna_version_id (projekt-<slug>-v3-<run>),
    daher kein Konflikt mit der Unique-Constraint (medium_id, stiftung_id, medium_dna_version_id).
  - v1: Math-Score (Tag-/Geo-Overlap) ohne Embedding/LLM — schneller, deterministisch; LLM-Feinschliff folgt.

Modi:
  --dry-run (Default): misst DNA + zeigt Top-Funder, schreibt NICHTS.
  --apply:            misst DNA -> speichert in projekte -> schreibt Top-N match_results (projekt_id).
  --projekt <slug>:   nur ein Projekt (sonst alle aktiven).
"""
from __future__ import annotations
import argparse, json, os, sys, time
from datetime import datetime, timezone

sys.path.insert(0, os.path.expanduser("~/dna_pilot"))
sys.path.insert(0, os.path.expanduser("~/.hermes/data/faas"))
import run_pilot_nothink as rp   # VOCAB, VOCAB_BY_AREA, ollama_chat, parse_json
import match_engine as me        # compute_math_score, check_exclusion, loaders, directus helpers

# Default bewusst der vLLM-Name: der Aufrufer (run_projekt_matcher.sh, Adapter)
# setzt FAAS_DNA_MODEL explizit; erbt das Skript versehentlich einen Wert aus
# ~/.hermes/.env, der dort nicht existiert, bricht jede Messung mit 404 ab
# (Befund 29.07.2026: nemotron-3-super war eingetragen und nirgends verfuegbar).
MODEL = os.environ.get("FAAS_DNA_MODEL", "qwen3.6-27b")
TOP_N = int(os.environ.get("PROJEKT_TOP_N", "25"))
MANDANT = os.environ.get("WAECHTER_MANDANT", "wepublish")

SYSTEM_PROJEKT = """detailed thinking off

Du bist ein praeziser Analyst fuer die Foerder-DNA eines Medien-PROJEKTS (Antragsteller-Sicht, nicht Stiftung).
Du ordnest dem Projekt Themen-Tags aus einem FESTEN Vokabular zu und begruendest jede Zuordnung mit Bezug zur Projektbeschreibung.

HARTE REGELN:
- Waehle 8-14 Tags (Ziel 11) AUSSCHLIESSLICH aus der gelieferten Slug-Liste. 2-4 mit Gewicht 3 (Kern des Projekts), Rest 2/1. Erfinde NIEMALS einen Slug.
- Sicht: Was SUCHT dieses Projekt an Foerderung? Welche Stiftungs-Themen passen dazu? (z.B. KI/Innovation/Medienzukunft vs. Lokaljournalismus/Community).
- begruendung: mind. 60 Zeichen, konkreter Bezug zur Projektbeschreibung. KOPIERE NIE das Tag-Label.
- evidenz: 1-2 Belege je Tag, Format "projekt:<slug>".
- sound_feeling: 2-4 Saetze, projektspezifisch (Was ist das Projekt, welcher Foerder-Ton passt).
- exclusion_tags: Slugs, die klar NICHT passen. Leer wenn keine.
- Antworte AUSSCHLIESSLICH mit einem JSON-Objekt.

AUSGABE-SCHEMA:
{"sound_feeling": str,
 "tags": [{"tag_slug": str, "gewicht": 1|2|3, "begruendung": str, "evidenz": [str]}],
 "exclusion_tags": [{"tag_slug": str, "begruendung": str}]}"""


def build_projekt_user(p: dict, medium_dna: dict | None = None) -> str:
    """Mess-Prompt fuer die Projekt-DNA.

    Der Traeger-Kontext (Sound + Kernthemen des Mediums) steht mit im Prompt,
    ABER klar nachgeordnet: das Projekt bestimmt die Tags, das Medium hilft nur
    beim Einordnen (ein Klima-Projekt eines Basler Regionalmediums ist etwas
    anderes als dasselbe Projekt einer nationalen Wirtschaftsredaktion).
    Ohne Medien-DNA bleibt der Prompt exakt wie vorher.
    """
    parts = [
        f"PROJEKT: {p.get('name')}  (Medium: {p.get('medium_id')})",
        f"Beschreibung:\n{p.get('beschreibung') or '(leer)'}",
    ]
    if medium_dna:
        sound = (medium_dna.get("sound_feeling") or "").strip()[:800]
        kern = [t.get("tag_slug") for t in (medium_dna.get("tags") or [])
                if isinstance(t, dict) and int(t.get("gewicht") or 0) >= 3][:12]
        block = ["\nTRAEGER-MEDIUM (Kontext, NICHT der Antragsgegenstand):"]
        if sound:
            block.append(f"Selbstverstaendnis: {sound}")
        if kern:
            block.append("Kernthemen des Mediums: " + ", ".join(kern))
        block.append("Waehle die Projekt-Tags aus der Projektbeschreibung. Der Traeger-Kontext "
                     "hilft nur beim Einordnen (Region, Publikum, Haltung) und darf die "
                     "Projekt-Themen NICHT ueberschreiben.")
        parts.append("\n".join(block))
    parts.append("\nVERFUEGBARE TAG-SLUGS (nur aus dieser Liste waehlen!):")
    for area, slugs in rp.VOCAB_BY_AREA.items():
        parts.append(f"[{area}] " + ", ".join(slugs))
    return "\n".join(parts)


def mess_projekt_dna(p: dict, medium_dna: dict | None = None) -> dict | None:
    res = rp.ollama_chat(MODEL, SYSTEM_PROJEKT, build_projekt_user(p, medium_dna))
    dna = rp.parse_json(res.get("message", {}).get("content", ""))
    if not dna or not dna.get("tags"):
        return None
    # ungueltige Slugs rausfiltern
    dna["tags"] = [t for t in dna["tags"] if t.get("tag_slug") in rp.VOCAB_SET]
    dna["exclusion_tags"] = [t for t in dna.get("exclusion_tags", []) if t.get("tag_slug") in rp.VOCAB_SET]
    return dna


def _math(dna_obj, stiftung, sdna_full):
    """compute_math_score robust aufrufen (Rueckgabe kann (score, breakdown) oder score sein)."""
    r = me.compute_math_score(dna_obj, stiftung, sdna_full)
    if isinstance(r, tuple):
        return float(r[0]), (r[1] if len(r) > 1 and isinstance(r[1], dict) else {})
    if isinstance(r, dict):
        return float(r.get("score", 0)), r
    return float(r), {}


def lade_medium_dna(medium_id: str) -> dict | None:
    """Aktive Medien-DNA des Traeger-Mediums (Tags, Exclusions, Sound).

    Warum: eine Stiftung foerdert kein Projekt im Vakuum, sondern ein Vorhaben
    DIESER Organisation (Anlass Jolanda 29.07.2026: bajour fundraist regelmaessig
    fuer dorfkoenig). Region, Publikum, Haltung und Institutionalitaet des
    Mediums entscheiden mit — und ein Tabu des Mediums bleibt auch fuer sein
    Projekt ein Tabu. Fehlt die Medien-DNA, laeuft das Projekt-Matching wie
    bisher allein auf der Projekt-DNA weiter.
    """
    try:
        rows = me.directus_get("/items/medium_dna", {
            "filter[medium_id][_eq]": medium_id,
            "filter[is_active][_eq]": "true",
            "fields": "tags,exclusion_tags,sound_feeling,version_id",
            "limit": 1,
        }).get("data") or []
    except Exception as e:
        print(f"  WARN: Medien-DNA fuer {medium_id} nicht ladbar ({e}) - Projekt matcht ohne Traeger-Kontext", flush=True)
        return None
    return rows[0] if rows else None


# Wie stark Medien-Tags gegenueber Projekt-Tags zaehlen. Das Projekt fuehrt
# inhaltlich (es ist der Antragsgegenstand), das Medium liefert Kontext:
# ein Kernthema des Mediums (3) wirkt im Projekt-Match wie ein wichtiges (2),
# ein wichtiges (2) wie ein Randthema (1), ein Randthema faellt weg.
MEDIUM_TAG_ABSCHWAECHUNG = {3: 2, 2: 1, 1: 0}


def kombiniere_tags(projekt_tags: list, medium_tags: list) -> list:
    """Projekt-Tags + abgeschwaechte Medien-Tags (reine Funktion, testbar).

    Regeln:
      - Projekt-Tags bleiben unveraendert und haben Vorrang: steht ein Tag in
        beiden DNAs, gilt das Projekt-Gewicht (kein Aufaddieren — sonst
        gewaenne ein Thema, das beide teilen, unverhaeltnismaessig).
      - Medien-Tags kommen abgeschwaecht dazu (MEDIUM_TAG_ABSCHWAECHUNG);
        Randthemen des Mediums (Gewicht 1) fallen weg, sie wuerden nur Rauschen
        in die Tag-Ueberschneidung bringen.
      - Die Herkunft steht in der Begruendung, damit im score_breakdown
        ablesbar bleibt, was vom Traeger kommt.
    """
    ergebnis = [dict(t) for t in (projekt_tags or []) if t.get("tag_slug")]
    vorhanden = {t["tag_slug"] for t in ergebnis}
    for t in (medium_tags or []):
        slug = t.get("tag_slug")
        if not slug or slug in vorhanden:
            continue
        try:
            roh = int(t.get("gewicht", 1))
        except (TypeError, ValueError):
            roh = 1
        gewicht = MEDIUM_TAG_ABSCHWAECHUNG.get(roh, 0)
        if gewicht <= 0:
            continue
        vorhanden.add(slug)
        ergebnis.append({
            "tag_slug": slug,
            "gewicht": gewicht,
            "begruendung": "Traeger-Medium: " + (t.get("begruendung") or "")[:200],
            "evidenz": ["medium-dna"],
        })
    return ergebnis


def kombiniere_exclusions(projekt_excl: list, medium_excl: list) -> list:
    """Tabus beider Seiten. Ein Tabu des Mediums gilt auch fuer sein Projekt:
    was die Redaktion nicht macht, macht sie auch in einem Projekt nicht."""
    ergebnis = [dict(t) for t in (projekt_excl or []) if t.get("tag_slug")]
    vorhanden = {t["tag_slug"] for t in ergebnis}
    for t in (medium_excl or []):
        slug = t.get("tag_slug")
        if not slug or slug in vorhanden:
            continue
        vorhanden.add(slug)
        ergebnis.append({"tag_slug": slug, "begruendung": "Traeger-Medium: " + (t.get("begruendung") or "")[:200]})
    return ergebnis


def match_projekt(p: dict, dna: dict, stiftungen: list, sdna_map: dict, apply: bool, run_id: str) -> int:
    slug = p["slug"]
    version_id = f"projekt-{slug}-v3-{run_id}"
    # Traeger-Medium dazuholen: das Projekt fuehrt inhaltlich, das Medium
    # liefert Region, Publikum, Haltung und Tabus (Auftrag 29.07.2026).
    m_dna = lade_medium_dna(p["medium_id"]) or {}
    m_tags = m_dna.get("tags") or []
    m_excl = m_dna.get("exclusion_tags") or []
    # dna-Objekt im Engine-Format (flache tags -> compute_math_score liest dna['tags'] wenn sektionen leer)
    tags = kombiniere_tags(dna.get("tags", []), m_tags)
    if m_tags:
        print(f"  [{slug}] Traeger-Kontext: {len(m_tags)} Medien-Tags, "
              f"{len(tags) - len(dna.get('tags', []))} davon abgeschwaecht uebernommen", flush=True)
    # Geo-Scope des Projekts als Geo-Tags einspeisen (weiche regionale Praeferenz):
    # regionale + nationale Tags ueberschneiden sich mit den passenden Foerderern.
    geo = p.get("geo_scope") or []
    if isinstance(geo, list):
        have = {t.get("tag_slug") for t in tags}
        for g in geo:
            if g and g not in have:
                tags.append({"tag_slug": g, "gewicht": 3, "begruendung": "Projekt-Geo-Scope",
                             "evidenz": [f"projekt:{slug}"]})
    dna_obj = {
        "medium_id": p["medium_id"],        # Eltern-Medium (Parent)
        "version_id": version_id,
        "medium_name": p["name"],
        "sektionen": {},
        "tags": tags,
        "exclusion_tags": kombiniere_exclusions(dna.get("exclusion_tags", []), m_excl),
        "sound_feeling": dna.get("sound_feeling", ""),
    }
    # Foerderhistorie-Ausschluesse des Mediums gelten auch fuer seine Projekte:
    # eine Stiftung, die fuer die Redaktion nicht in Frage kommt, kommt es fuer
    # ihr Projekt auch nicht (dieselbe Quelle wie die Medium-Engine).
    try:
        ausschluesse = me.load_medium_ausschluesse().get(p["medium_id"], set())
    except Exception as e:
        print(f"  WARN: Medium-Ausschluesse nicht lesbar ({e})", flush=True)
        ausschluesse = set()
    if ausschluesse:
        print(f"  [{slug}] Medium-Ausschluesse aktiv: {len(ausschluesse)} Stiftung(en) uebersprungen", flush=True)

    scored = []
    for s in stiftungen:
        sid = s.get("id")
        try:
            if sid is not None and int(sid) in ausschluesse:
                continue
        except (TypeError, ValueError):
            pass
        sdna_full = sdna_map.get(sid)
        ex = me.check_exclusion(dna_obj, s)
        excl = ex[0] if isinstance(ex, tuple) else bool(ex)
        if excl:
            continue
        math, bd = _math(dna_obj, s, sdna_full)
        scored.append((math, s, bd))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:TOP_N]
    print(f"  [{slug}] DNA-Tags: {[t['tag_slug'] for t in dna.get('tags', [])]}")
    print(f"  [{slug}] Top-{min(8, len(top))} Funder (math):")
    for math, s, _ in top[:8]:
        print(f"     {math:5.1f}  {s.get('Stiftungsname')}")
    if not apply:
        return 0
    # Projekt-DNA in projekte speichern
    me.directus_patch(f"/items/projekte/{p['id']}", {
        "arbeits_dna": dna, "arbeits_dna_stand": datetime.now(timezone.utc).isoformat(),
        "directus_aktive_dna_version_id": version_id,
    })
    # Idempotent: bestehende Treffer dieses Projekts loeschen (kein Duplikat bei Re-Run/Rematch)
    alt = me.directus_get("/items/match_results",
        {"filter[projekt_id][_eq]": p["id"], "fields": "id", "limit": -1}).get("data") or []
    if alt:
        import requests
        requests.delete(f"{me.DIRECTUS_URL}/items/match_results",
            headers=me._headers(), json=[r["id"] for r in alt], timeout=60)
        print(f"  [{slug}] alte Treffer geloescht: {len(alt)}")
    geschrieben = 0
    for math, s, bd in top:
        if math < me.MATCH_MIN_SCORE:
            continue
        top_tags = [t["tag_slug"] for t in dna.get("tags", [])][:6]
        body = {
            "medium_id": p["medium_id"],
            "projekt_id": p["id"],
            "medium_dna_version_id": version_id,
            "stiftung_id": s.get("id"),
            "score": round(math),
            "score_math": round(math),
            "score_breakdown": bd if isinstance(bd, dict) else {},
            "begruendung": (f"Projekt-Match (math, v2): Tag-Ueberschneidung mit Projektprofil "
                            f"({', '.join(top_tags)})"
                            + (" plus Traeger-Kontext des Mediums." if m_tags else ".")),
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "compute_run_id": run_id,
            "dna_verified": False,
            "dna_quality_tier": "qwen_v3",
        }
        try:
            me.directus_post("/items/match_results", body)
            geschrieben += 1
        except Exception as e:
            print(f"     POST-Fehler stiftung {s.get('id')}: {str(e)[:120]}")
    print(f"  [{slug}] geschrieben: {geschrieben}")
    return geschrieben


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--projekt", help="nur dieser Projekt-Slug")
    ap.add_argument("--only-new", action="store_true",
                    help="nur Projekte ohne aktive DNA messen (fuer den Cron — neu angelegte Projekte)")
    ap.add_argument("--rematch", action="store_true",
                    help="NICHT neu messen — gespeicherte arbeits_dna nutzen + neu matchen (z.B. nach Geo-Aenderung)")
    args = ap.parse_args()
    run_id = "projekt-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    projekte = me.directus_get("/items/projekte",
        {"filter[mandant][_eq]": MANDANT, "filter[status][_eq]": "aktiv", "limit": -1})["data"]
    if args.projekt:
        projekte = [p for p in projekte if p["slug"] == args.projekt]
    if args.only_new:
        projekte = [p for p in projekte if not p.get("directus_aktive_dna_version_id")]
    if not projekte:
        print("Keine zu messenden Projekte." if args.only_new else "Keine aktiven Projekte."); return 0

    print(f"Projekte: {[p['slug'] for p in projekte]} | Modus: {'APPLY' if args.apply else 'DRY-RUN'} | Modell {MODEL}")
    print("Lade Foerderer-Pool …", flush=True)
    stiftungen = me.load_stiftungen()
    sdna_map = me.load_active_stiftungs_dna_full()
    print(f"  {len(stiftungen)} Stiftungen, {len(sdna_map)} mit aktiver DNA", flush=True)

    total = 0
    for p in projekte:
        if args.rematch:
            dna = p.get("arbeits_dna")
            if not dna or not dna.get("tags"):
                print(f"\n=== {p['slug']}: keine gespeicherte DNA — uebersprungen (erst messen)."); continue
            print(f"\n=== {p['slug']} ({p['name']}) — rematch mit gespeicherter DNA + Geo {p.get('geo_scope')}", flush=True)
        else:
            print(f"\n=== {p['slug']} ({p['name']}) — messe DNA …", flush=True)
            t0 = time.time()
            dna = mess_projekt_dna(p, lade_medium_dna(p["medium_id"]))
            if not dna:
                print(f"  [{p['slug']}] DNA-Messung fehlgeschlagen (kein JSON/keine Tags)."); continue
            print(f"  gemessen in {time.time()-t0:.0f}s, {len(dna.get('tags', []))} Tags", flush=True)
        total += match_projekt(p, dna, stiftungen, sdna_map, args.apply, run_id)
    print(f"\nFertig. {'Geschrieben: ' + str(total) if args.apply else 'DRY-RUN, nichts geschrieben.'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
