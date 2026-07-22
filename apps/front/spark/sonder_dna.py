#!/usr/bin/env python3
"""
DNA-Messung fuer die Sonder-Collections `lotteriefonds` und `sponsoren`
(generalisiert aus foerderer_dna.py mit Feld-Mapping — diese Collections haben
andere Stammdaten-Felder als kirchen/foerderer).

Gleiche Ellenlaenge wie der Stiftungspool (run_pilot_nothink: vocab_v3, temp 0,
thinking off) -> pool-konsistente Tags fuer den Sonder-Matcher. Resumierbar
(misst nur Eintraege ohne schaerfe_prozent; --remeasure misst alle).

Aufruf:  python3 sonder_dna.py --collection lotteriefonds|sponsoren  [--limit N] [--remeasure]
Env:     FAAS_VLLM_URL (Studio-MLX bf16, Default gesetzt), FIRECRAWL_URL.
"""
import os, sys, json, time, argparse, urllib.request, urllib.error, subprocess

os.environ.setdefault("FAAS_VLLM_URL", "http://100.91.228.59:8002/v1")
MODEL = os.environ.get("KIRCHEN_MODEL", "/Users/jolandaspiess/models/Qwen3.6-27B-MLX-bf16")
sys.path.insert(0, os.path.expanduser("~/dna_pilot")); os.chdir(os.path.expanduser("~/dna_pilot"))
from run_pilot_nothink import SYSTEM, VOCAB_SET, VOCAB_BY_AREA, ollama_chat, parse_json, calc_schaerfe

BASE = "http://127.0.0.1:8055"
TOKEN = subprocess.check_output(
    "docker inspect faas-matching --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^DIRECTUS_TOKEN=' | cut -d= -f2",
    shell=True).decode().strip()
CRAWLER = os.environ.get("FIRECRAWL_URL", "http://127.0.0.1:8891")

MAPPING = {
    "lotteriefonds": {
        "name": "stiftungsname",
        "art": "Kantonaler Lotterie-/Swisslos-Fonds (oeffentlicher Foerderer)",
        "korpus": [("Kanton", "kanton"), ("Foerderbedingungen", "foerderbedingungen"),
                   ("Medien-Bezug", "medientrigger")],
        "url": ["url_lotteriefonds", "url"],
        "antragsteller_typ": "foerderer",
        "fields": "id,stiftungsname,kanton,foerderbedingungen,medientrigger,url_lotteriefonds,url,schaerfe_prozent",
    },
    "sponsoren": {
        "name": "firmenname",
        "art": "Sponsor / B2B-Foerderer (Medien-Sponsoring)",
        "korpus": [("Fokus-Medium", "fokus_medium"), ("Sponsoring-Paket", "sponsoring_paket"),
                   ("B2B-Argumente", "b2b_argumente")],
        "url": [],
        "antragsteller_typ": "sponsor",
        "fields": "id,firmenname,fokus_medium,sponsoring_paket,b2b_argumente,schaerfe_prozent",
    },
}


def dreq(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=30) as resp:
        return json.loads(resp.read().decode() or "{}")


def crawl(url):
    if not url:
        return ""
    u = url.strip().split()[0]
    if not u.startswith("http"):
        u = "https://" + u
    try:
        body = json.dumps({"url": u, "formats": ["markdown"]}).encode()
        req = urllib.request.Request(f"{CRAWLER}/v1/scrape", data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read().decode())
        md = (d.get("data") or {}).get("markdown") or d.get("markdown") or ""
        return md if isinstance(md, str) else ""
    except Exception:
        return ""


def first_url(row, url_fields):
    for f in url_fields:
        v = (row.get(f) or "").strip()
        if v:
            return v
    return ""


def build_user(row, korpus, m):
    parts = [f"{m['art'].upper()}: {row.get(m['name'])}"]
    for label, field in m["korpus"]:
        val = (row.get(field) or "").strip()
        if val:
            parts.append(f"{label}: {val}")
    if korpus and len(korpus) > 400:
        parts.append(f"\nWEB-KORPUS (gecrawlt):\n{korpus[:14000]}")
    parts.append("\nVERFUEGBARE TAG-SLUGS (nur aus dieser Liste waehlen!):")
    for area, slugs in VOCAB_BY_AREA.items():
        parts.append(f"[{area}] " + ", ".join(slugs))
    return "\n".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", required=True, choices=list(MAPPING.keys()))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--remeasure", action="store_true")
    args = ap.parse_args()
    COLL = args.collection
    m = MAPPING[COLL]

    rows = dreq("GET", f"/items/{COLL}?limit=-1&fields={m['fields']}")["data"]
    if not args.remeasure:
        rows = [r for r in rows if r.get("schaerfe_prozent") is None]
    if args.limit:
        rows = rows[:args.limit]
    print(f"[{COLL}] zu messen: {len(rows)} | {os.environ['FAAS_VLLM_URL']}", flush=True)

    for i, row in enumerate(rows, 1):
        t0 = time.time()
        url = first_url(row, m["url"])
        korpus = crawl(url)
        has_web = len(korpus) > 400
        dna, err, raw = None, None, None
        for _ in range(2):
            try:
                raw = ollama_chat(MODEL, SYSTEM, build_user(row, korpus, m)).get("message", {}).get("content", "")
                dna = parse_json(raw)
                if dna and dna.get("tags"):
                    break
            except Exception as e:
                err = f"{type(e).__name__}: {e}"; time.sleep(2)
        dt = time.time() - t0
        name = row.get(m["name"]) or ""
        if not dna or not dna.get("tags"):
            print(f"[{i}/{len(rows)}] id={row['id']} FAIL ({err or 'kein_json'}) {dt:.0f}s  {name[:34]}", flush=True)
            continue
        tags = [t for t in dna.get("tags", []) if t.get("tag_slug") in VOCAB_SET]
        excl = [t for t in dna.get("exclusion_tags", []) if t.get("tag_slug") in VOCAB_SET]
        pruef = " ".join((row.get(f) or "") for _, f in m["korpus"])
        sch = calc_schaerfe({**dna, "tags": tags, "exclusion_tags": excl}, has_web, pruef)
        dreq("PATCH", f"/items/{COLL}/{row['id']}", {
            "sound_feeling": (dna.get("sound_feeling") or "").strip(),
            "tags": tags, "exclusion_tags": excl, "foerderpraxis": dna.get("foerderpraxis") or {},
            "schaerfe_prozent": sch, "vocabulary_version_at_creation": 3,
            "antragsteller_typ": m["antragsteller_typ"], "web_url": (url or None),
            "quellen": {"datenbasis": ("stammdaten+web" if has_web else "stammdaten"),
                        "gemessen_am": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "gemessen_durch": f"{COLL}-dna-v3-mlx-bf16"},
            "veredelt_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "veredelt_by": f"{COLL}-dna-v3"})
        print(f"[{i}/{len(rows)}] id={row['id']} ok tags={len(tags)} sch={sch} web={has_web} {dt:.0f}s  {name[:34]}", flush=True)


if __name__ == "__main__":
    main()
