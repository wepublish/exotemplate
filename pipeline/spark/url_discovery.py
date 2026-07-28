#!/usr/bin/env python3
"""
URL-Discovery für den Web-Enricher: findet die echte Website einer Stiftung.
Nutzt die selbst-gehostete SearXNG-Meta-Suche (Spark :8888, JSON-API) — sauberes
strukturiertes Ergebnis, key-frei, souverän. Der faas-crawler hat keinen Such-Endpoint.

Gehärtet 2026-06-10 (mojeek/duckduckgo IP-gesperrt, bing lieferte themenfremden Müll):
  1. Engines auf brave,startpage,yandex (live verifiziert, liefern Eigenseiten sauber);
     übersteuerbar per Env FAAS_SEARX_ENGINES.
  2. Drosselung zwischen Suchanfragen (FAAS_SEARX_MIN_INTERVAL, Default 5 s) — beide
     Daemons (Spark + Studio) teilen dieselbe SearXNG-Instanz, die Doppellast hat
     vermutlich die mojeek-/duckduckgo-Sperren ausgelöst.
  3. Relevanz-Filter: ein signifikantes Wort des Stiftungsnamens muss im Treffer
     (URL/Titel/Snippet) vorkommen. Themenfremder Engine-Müll (Casino-Reviews,
     Jobbörsen) fällt damit raus, bevor der teure qwen-Sanity-Check läuft.

Strategie: SearXNG-Suche nach Stiftungsname -> Kandidaten-URLs in Treffer-Reihenfolge,
relevanz-geprüft, auf Host-Wurzel normalisiert, Verzeichnis-/Social-/Register-Domains
gefiltert. Der eigentliche Eignungs-Entscheid fällt danach im qwen-Sanity-Check.

CLI:  python3 url_discovery.py "Stiftungsname" [...]
Modul: finde_kandidaten(name) -> list[str]
"""
from __future__ import annotations
import json, os, re, sys, time, urllib.parse, urllib.request

SEARX = os.environ.get("FAAS_SEARX_URL", "http://localhost:8888/search")
ENGINES = os.environ.get("FAAS_SEARX_ENGINES", "brave,startpage,yandex")
MIN_INTERVAL = float(os.environ.get("FAAS_SEARX_MIN_INTERVAL", "5"))

# Domains, die nie die Eigensite einer Stiftung sind (Verzeichnisse/Register/Social).
BLOCK = (
    "spheriq", "linkedin", "facebook", "instagram", "twitter", "x.com", "youtube",
    "wikipedia", "wikidata", "wikimedia", "moneyhouse", "zefix", "northdata", "kompass",
    "dnb.com", "firmenabc", "companyhouse", "xing", "crunchbase", "glassdoor", "indeed",
    "yelp", "tripadvisor", "amazon.", "pinterest", "tiktok", "fundraiso", "business-monitor",
    "lixt.ch", "b2bhint", "wirtschaftsregister", "online-handelsregister", "graph.swiss",
    "theorg.com", "stiftungen.social", "die-stiftung.de", "deutscher-engagementpreis",
    "handelsregister", "monetas", "easymonitoring", "guidestar", "candid.org",
    "greenhouse.io", "lever.co", "ngo.ch", "vereine.ch",
    "swissfoundations", "stiftungschweiz",
)

# Füllwörter, die in fast jedem Stiftungsnamen stehen — tragen keine Relevanz-Information.
_STOPP = {
    "fondation", "stiftung", "foundation", "fondazione", "fundaziun", "fundacion",
    "fonds", "fund", "trust", "verein", "gemeinnuetzige", "gemeinnützige", "charitable",
    "pour", "la", "le", "les", "der", "die", "das", "des", "den", "dem", "und", "et",
    "ed", "fuer", "für", "von", "van", "zur", "zum", "of", "the", "for", "and",
    "di", "del", "della", "dello", "in", "im", "am", "an", "de", "du", "el", "il", "lo",
}

_letzte_suche = [0.0]


def _signifikante_woerter(name: str) -> list[str]:
    """Namens-Wörter, die einen Treffer als relevant ausweisen (ohne Füllwörter)."""
    woerter = re.findall(r"\w+", name.lower(), flags=re.UNICODE)
    return [w for w in woerter if len(w) >= 3 and w not in _STOPP]


def _relevant(r: dict, woerter: list[str]) -> bool:
    """Mindestens ein signifikantes Namens-Wort muss im Treffer vorkommen."""
    if not woerter:
        return True
    text = " ".join(str(r.get(k) or "") for k in ("url", "title", "content")).lower()
    return any(w in text for w in woerter)


def _searx(query: str, timeout: int = 30) -> list[dict]:
    # Drosselung: beide Daemons teilen die SearXNG-Instanz — Anfragen zeitlich strecken.
    warte = MIN_INTERVAL - (time.time() - _letzte_suche[0])
    if warte > 0:
        time.sleep(warte)
    q = urllib.parse.urlencode({"q": query, "format": "json", "engines": ENGINES})
    r = urllib.request.Request(f"{SEARX}?{q}", headers={"User-Agent": "faas-enricher/1.0"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as x:
            return json.loads(x.read().decode()).get("results", [])
    finally:
        _letzte_suche[0] = time.time()


def finde_kandidaten(name: str, max_n: int = 5) -> list[str]:
    """Kandidaten-URLs (Host-Wurzel) für eine Stiftung, beste zuerst. Leer wenn nichts."""
    name = re.sub(r"\s+", " ", name).strip()
    if not name:
        return []
    try:
        res = _searx(name)
    except Exception:
        try:
            time.sleep(5)
            res = _searx(name)
        except Exception:
            return []
    woerter = _signifikante_woerter(name)
    out, seen = [], set()
    for r in res:
        u = r.get("url") or ""
        if not u.startswith("http"):
            continue
        if not _relevant(r, woerter):
            continue
        p = urllib.parse.urlparse(u)
        host = p.netloc.lower()
        if not host or any(b in host for b in BLOCK):
            continue
        wurzel = f"{p.scheme}://{host}"
        if wurzel in seen:
            continue
        seen.add(wurzel)
        out.append(wurzel)
        if len(out) >= max_n:
            break
    return out


if __name__ == "__main__":
    for name in sys.argv[1:]:
        print(f"\n{name!r}:")
        for u in finde_kandidaten(name):
            print("  ", u)
