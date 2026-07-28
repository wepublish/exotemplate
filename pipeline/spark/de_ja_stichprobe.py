#!/usr/bin/env python3
"""
DE-Ja-Qualitaets-Stichprobe (Spiegel zu reclassify_check.py).
Prueft eine gleichmaessige Stichprobe der als FOERDERSTIFTUNG markierten
DE(+LI)-Stiftungen auf FALSCH-POSITIVE, bevor Schritt D (DNA-Veredelung von ~18k)
den grossen GPU-Lauf startet. DRY: schreibt NICHTS, misst nur.

Hintergrund: DE-Klassifikation hatte ~80% Ja-Quote (ueber der 34%-Schaetzung) wegen
des "im Zweifel JA"-Bias auf teils duennen DE-Stammdaten. Diese Stichprobe schaetzt,
wie viele der "Ja" bei geschaerftem Prompt keine echten Foerderer sind.

  python3 de_ja_stichprobe.py --n 30 --laender DE
Laeuft auf dem Spark (vLLM). Env: DIRECTUS_URL, DIRECTUS_TOKEN, FAAS_VLLM_URL, FAAS_DNA_MODEL.
"""
from __future__ import annotations
import argparse, os, sys, urllib.request, json
sys.path.insert(0, os.path.expanduser("~/dna_pilot"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_pilot_nothink as K

DIRECTUS = os.environ.get("DIRECTUS_URL", "http://localhost:8055").rstrip("/")
TOKEN = os.environ.get("DIRECTUS_TOKEN", "")
MODEL = os.environ.get("FAAS_DNA_MODEL", "qwen3.6-27b")

# identischer geschaerfter Prompt wie reclassify_check.py (gleiche Ellenlänge)
SYS = ("Du entscheidest, ob eine Stiftung eine FOERDERSTIFTUNG ist. "
    "FOERDERSTIFTUNG = vergibt Geld, Beitraege, Stipendien, Preise oder Projektfoerderung an DRITTE "
    "(Personen/Organisationen ausserhalb der Stiftung). "
    "KEINE Foerderstiftung = operative/Betriebsstiftung, die ihren Zweck SELBST erbringt "
    "(betreibt Heim/Werkstatt/Museum/Institut, fuehrt eigene Forschung/Projekte durch, erbringt Dienstleistungen). "
    "Im echten Grenzfall, wenn Foerderung an Dritte plausibel ist: eher JA. "
    'Antworte AUSSCHLIESSLICH mit JSON: {"foerderer": true|false, "konfidenz": 0-100, "grund": "kurz, mit Beleg aus dem Zweck"}')


def dget(path):
    r = urllib.request.Request(f"{DIRECTUS}{path}", headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(r, timeout=60) as x:
        b = json.loads(x.read().decode())
    d = b.get("data", []) if isinstance(b, dict) else []
    return d if isinstance(d, list) else [d]


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
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--laender", default="DE")
    args = ap.parse_args()
    if not TOKEN:
        sys.exit("DIRECTUS_TOKEN fehlt")
    alle = []
    for land in args.laender.split(","):
        alle += dget(f"/items/stiftungen?filter[ist_foerderstiftung][_eq]=true&filter[land][_eq]={land}"
                     f"&sort=id&limit=-1&fields=id,Stiftungsname,zwecktext,foerderbedingungen,land")
    if not alle:
        sys.exit("keine Stiftungen gefunden")
    n = min(args.n, len(alle))
    step = max(1, len(alle) // n)
    stich = alle[::step][:n]  # gleichmaessig ueber den ganzen Bestand
    print(f"=== DE-Ja-Stichprobe: {len(stich)} von {len(alle)} Foerderern ({args.laender}) | Modell {MODEL} ===", flush=True)
    ja = nein = fehler = duenn = 0
    fp = []
    for i, s in enumerate(stich, 1):
        korpus = ((s.get("zwecktext") or "") + (s.get("foerderbedingungen") or "")).strip()
        thin = len(korpus) < 15
        if thin:
            duenn += 1
        d = klassifiziere(s)
        if d.get("_err"):
            fehler += 1
            print(f"  ERR [{s['id']}] {d['_err']}", flush=True)
            continue
        if d.get("foerderer"):
            ja += 1
        else:
            nein += 1
            fp.append((s["id"], s.get("Stiftungsname"), d.get("konfidenz")))
            mark = " [DUENN]" if thin else ""
            print(f"  FALSCH-POSITIV? [{s['id']}] {str(s.get('Stiftungsname'))[:45]}{mark} "
                  f"({d.get('konfidenz')}%) {str(d.get('grund'))[:100]}", flush=True)
        if i % 10 == 0:
            print(f"  ... {i}/{len(stich)}", flush=True)
    geprueft = ja + nein
    fp_pct = 100 * nein / max(1, geprueft)
    print(f"=== ERGEBNIS: {geprueft} geprueft | Foerderer bestaetigt {ja} | "
          f"FALSCH-POSITIV {nein} ({fp_pct:.0f}%) | duenne Stammdaten {duenn} | Fehler {fehler} ===", flush=True)
    print(f"HOCHRECHNUNG: bei {fp_pct:.0f}% FP waeren von {len(alle)} DE/LI-'Ja' rund "
          f"{int(len(alle)*fp_pct/100):,} keine echten Foerderer.".replace(",", "'"), flush=True)


if __name__ == "__main__":
    main()
