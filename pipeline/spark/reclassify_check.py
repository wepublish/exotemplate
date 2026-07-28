#!/usr/bin/env python3
"""
Re-Klassifikations-QA: prueft die als NICHT-Foerderstiftung markierten CH+AT-Stiftungen
auf Falsch-Negative (echte Foerderer, die faelschlich ausgeschlossen wurden). Geschaerfter
Prompt: Foerderstiftung = vergibt Geld/Beitraege/Stipendien/Preise an DRITTE; Betriebs-/
operative Stiftung (erbringt Zweck selbst) = KEIN Foerderer.

DRY (default): misst + zeigt, schreibt NICHTS. --apply: flippt klare Foerderer
(ist_foerderstiftung=true) -> sie landen im naechsten Enricher-Pass.
Laeuft auf dem Spark (vLLM). GPU-poelt optional via --yield (pausiert bei match_engine).

  python3 reclassify_check.py --limit 40            # DRY-Stichprobe
  python3 reclassify_check.py --apply               # voller Lauf, flippt Foerderer
"""
from __future__ import annotations
import argparse, json, os, subprocess, sys, time, urllib.request
sys.path.insert(0, os.path.expanduser("~/dna_pilot"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_pilot_nothink as K

DIRECTUS = os.environ.get("DIRECTUS_URL", "http://localhost:8055").rstrip("/")
TOKEN = os.environ.get("DIRECTUS_TOKEN", "")
MODEL = os.environ.get("FAAS_DNA_MODEL", "qwen3.6-27b")
LOG = os.path.expanduser("~/faas_classify/reclassify.log")

SYS = ("Du entscheidest, ob eine Schweizer/oesterreichische Stiftung eine FOERDERSTIFTUNG ist. "
    "FOERDERSTIFTUNG = vergibt Geld, Beitraege, Stipendien, Preise oder Projektfoerderung an DRITTE "
    "(Personen/Organisationen ausserhalb der Stiftung). "
    "KEINE Foerderstiftung = operative/Betriebsstiftung, die ihren Zweck SELBST erbringt "
    "(betreibt Heim/Werkstatt/Museum/Institut, fuehrt eigene Forschung/Projekte durch, erbringt Dienstleistungen). "
    "Im echten Grenzfall, wenn Foerderung an Dritte plausibel ist: eher JA. "
    'Antworte AUSSCHLIESSLICH mit JSON: {"foerderer": true|false, "konfidenz": 0-100, "grund": "kurz, mit Beleg aus dem Zweck"}')


def http(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{DIRECTUS}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=40) as x:
        raw = x.read().decode()
        return x.status, (json.loads(raw) if raw else {})


def dget(path):
    _, b = http("GET", path)
    d = b.get("data", []) if isinstance(b, dict) else []
    return d if isinstance(d, list) else [d]


def log(m):
    print(m, flush=True)
    try:
        open(LOG, "a").write(m + "\n")
    except Exception:
        pass


def klassifiziere(s):
    user = (f"Stiftung: {s.get('Stiftungsname')}\n"
            f"Zweck: {(s.get('zwecktext') or '')[:1200]}\n"
            f"Foerderbedingungen: {(s.get('foerderbedingungen') or '')[:400]}")
    try:
        resp = K.ollama_chat(MODEL, SYS, user, timeout=120)
        return K.parse_json(resp.get("message", {}).get("content", "")) or {}
    except Exception as e:
        return {"_err": str(e)[:80]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--apply", action="store_true", help="klare Foerderer auf ist_foerderstiftung=true flippen")
    ap.add_argument("--min-konfidenz", type=int, default=75)
    args = ap.parse_args()
    if not TOKEN:
        sys.exit("DIRECTUS_TOKEN fehlt")
    stiftungen = []
    for land in ("CH", "AT"):
        stiftungen += dget(f"/items/stiftungen?filter[ist_foerderstiftung][_eq]=false&filter[land][_eq]={land}"
                           f"&sort=id&limit=-1&fields=id,Stiftungsname,zwecktext,foerderbedingungen")
    if args.limit:
        stiftungen = stiftungen[:args.limit]
    log(f"=== Re-Klassifikation {'APPLY' if args.apply else 'DRY'} | {len(stiftungen)} Nicht-Foerder | Modell {MODEL} ===")
    flips, fehler, geprueft = [], 0, 0
    for i, s in enumerate(stiftungen, 1):
        d = klassifiziere(s)
        geprueft += 1
        if d.get("_err"):
            fehler += 1; continue
        if d.get("foerderer") and int(d.get("konfidenz", 0)) >= args.min_konfidenz:
            flips.append((s["id"], s.get("Stiftungsname"), d.get("konfidenz"), d.get("grund")))
            log(f"  FLIP? [{s['id']}] {s.get('Stiftungsname')[:45]} ({d.get('konfidenz')}%) {str(d.get('grund'))[:110]}")
            if args.apply:
                http("PATCH", f"/items/stiftungen/{s['id']}", {"ist_foerderstiftung": True})
        if i % 50 == 0:
            log(f"  ... {i}/{len(stiftungen)} geprueft, {len(flips)} Foerderer-Verdacht")
    log(f"=== Fertig: {geprueft} geprueft, {len(flips)} als Foerderer erkannt ({100*len(flips)/max(1,geprueft):.0f}%), {fehler} Fehler ===")
    if not args.apply and flips:
        log("   (DRY — nichts geaendert. Mit --apply flippen.)")


if __name__ == "__main__":
    main()
