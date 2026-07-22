#!/usr/bin/env python3
"""
Ausschreibungs-Scout — Cron-Skript für den Spark.

Zweck: Entdeckt neue Förderausschreibungen auf konfigurierten Quellseiten
       sowie auf den URLs bestehender ausschreibungen aus Directus.
       Neue Kandidaten werden mit status='scout_unbestaetigt' in Directus angelegt.

Crontab-Beispiel (nicht während Wochenend-DNA-Läufen!):
  # Scout täglich um 07:00, NICHT samstags/sonntags wenn GPU-DNA-Läufe aktiv
  0 7 * * 1-5 /home/dergeraet/.venv/bin/python3 /home/dergeraet/faas-matching-wepublish/spark/scout.py >> /home/dergeraet/faas_classify/scout.log 2>&1

Env-Quelle: ~/.hermes/.env
  DIRECTUS_URL   z.B. http://localhost:8055
  DIRECTUS_TOKEN Bearer-Token mit CRUD auf ausschreibungen
  FAAS_DNA_MODEL z.B. qwen3.6:27b  (Fallback: qwen3.6:27b)

ACHTUNG: Nicht während des Wochenend-DNA-Laufs starten — Ollama (GPU) wird
         für den Extraktions-Call genutzt und konkurriert mit dem DNA-Runner.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("scout")

# ─── Env / Konfiguration ──────────────────────────────────────────────────────

DIRECTUS_URL   = os.environ.get("DIRECTUS_URL",   "http://localhost:8055")
DIRECTUS_TOKEN = os.environ.get("DIRECTUS_TOKEN",  "")
FIRECRAWL_URL  = os.environ.get("FIRECRAWL_URL",   "http://127.0.0.1:8891")
OLLAMA_URL     = os.environ.get("OLLAMA_URL",       "http://127.0.0.1:11434")
LLM_MODEL      = os.environ.get("FAAS_DNA_MODEL",   "qwen3.6:27b")

# Pfad zur Quell-Konfiguration (relativ zu dieser Datei)
QUELLEN_CONFIG = Path(__file__).parent / "scout_quellen.json"

FIRECRAWL_TIMEOUT_S = 60
OLLAMA_TIMEOUT_S    = 180   # Extraktions-Call kann etwas länger dauern
DIRECTUS_TIMEOUT_S  = 20

# ─── Extraktions-Prompt ───────────────────────────────────────────────────────

EXTRAKTIONS_PROMPT = """\
Du bist ein präziser Assistent zur Strukturierung von Förderinformationen.

Analysiere den folgenden Webseitentext und extrahiere ALLE konkreten, offenen
Förderausschreibungen bzw. Calls for Proposals/Applications, die darin erwähnt werden.

Kriterien für einen gültigen Eintrag:
- Konkrete Ausschreibung mit Titel und erkennbarem Bewerbungsbezug (Frist, Call, Förderung)
- Offene oder in nächster Zeit öffnende Ausschreibung (keine abgelaufenen)
- Aus dem Medien-, Journalismus-, NGO- oder verwandten gemeinnützigen Bereich
- KEIN generischer Stiftungszweck ohne spezifische Ausschreibung
- KEIN reiner Informationstext ohne Handlungsaufforderung

Antworte NUR mit einem JSON-Objekt in diesem exakten Format (keine Erklärungen):

{
  "ausschreibungen": [
    {
      "titel": "Vollständiger Titel der Ausschreibung",
      "kategorie": "Medienförderung|Journalismus|Digitale Medien|NGO|Wissenschaft|Kultur|Sonstiges",
      "deadline": "YYYY-MM-DD oder ''",
      "url": "Direkte URL zur Ausschreibung oder ''",
      "beschreibung": "1-2 Sätze: Was wird gefördert, wer kann sich bewerben, welcher Betrag falls bekannt"
    }
  ]
}

Wenn keine gültigen Ausschreibungen gefunden: {"ausschreibungen": []}

Webseitentext:
{SEITENTEXT}
"""

# ─── HTTP-Hilfsfunktionen ─────────────────────────────────────────────────────

def _post_json(url: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    """Sendet einen POST-Request mit JSON-Body, gibt dict zurück."""
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _directus_request(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any] | list[Any] | None:
    """Generischer Directus-API-Aufruf mit Bearer-Token."""
    url = f"{DIRECTUS_URL.rstrip('/')}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method=method,
    )
    with urllib.request.urlopen(req, timeout=DIRECTUS_TIMEOUT_S) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw.strip() else None

# ─── Directus-Operationen ─────────────────────────────────────────────────────

def lade_bestehende_ausschreibungen() -> list[dict[str, Any]]:
    """Lädt alle bestehenden ausschreibungen (id, titel, url, status)."""
    result = _directus_request(
        "GET",
        "/items/ausschreibungen?limit=-1&fields=id,titel,url,status",
    )
    if isinstance(result, dict):
        return result.get("data", [])
    return []


def erstelle_ausschreibung(eintrag: dict[str, Any]) -> str | None:
    """Legt einen neuen Eintrag mit status='scout_unbestaetigt' in Directus an."""
    payload = {
        "status": "scout_unbestaetigt",
        "titel": eintrag.get("titel", "")[:512],
        "kategorie": eintrag.get("kategorie", "")[:128],
        "deadline": eintrag.get("deadline") or None,
        "url": eintrag.get("url", "")[:1024],
    }
    # Beschreibung wird nicht direkt gespeichert (kein Schema-Feld) — nur geloggt
    result = _directus_request("POST", "/items/ausschreibungen", payload)
    if isinstance(result, dict):
        data = result.get("data", {})
        return str(data.get("id", "")) if isinstance(data, dict) else None
    return None

# ─── Dedup ────────────────────────────────────────────────────────────────────

def _normalisiere_url(url: str | None) -> str:
    """Normalisiert eine URL für Dedup-Vergleiche (lowercase, trailing slash entfernen)."""
    if not url:
        return ""
    u = url.lower().strip().rstrip("/")
    # Query-Parameter und Fragment ignorieren
    u = u.split("?")[0].split("#")[0]
    return u


def _normalisiere_titel(titel: str | None) -> str:
    """Normalisiert einen Titel für Dedup (lowercase, Leerzeichen zusammenfassen)."""
    if not titel:
        return ""
    return re.sub(r"\s+", " ", titel.lower().strip())


def baue_dedup_sets(
    bestehende: list[dict[str, Any]],
) -> tuple[set[str], set[str]]:
    """Gibt zwei Sets zurück: normalisierte URLs und normalisierte Titel."""
    urls: set[str] = set()
    titel: set[str] = set()
    for e in bestehende:
        u = _normalisiere_url(e.get("url"))
        t = _normalisiere_titel(e.get("titel"))
        if u:
            urls.add(u)
        if t:
            titel.add(t)
    return urls, titel


def ist_duplikat(
    kandidat: dict[str, Any],
    bekannte_urls: set[str],
    bekannte_titel: set[str],
) -> bool:
    """Prüft ob ein Kandidat bereits in Directus vorhanden ist."""
    u = _normalisiere_url(kandidat.get("url"))
    t = _normalisiere_titel(kandidat.get("titel"))
    if u and u in bekannte_urls:
        return True
    if t and t in bekannte_titel:
        return True
    return False

# ─── Firecrawl-Scraping ───────────────────────────────────────────────────────

def scrape_seite(url: str) -> str | None:
    """Scrapt eine URL via lokales Firecrawl, gibt Markdown zurück oder None."""
    payload = {"url": url, "formats": ["markdown"]}
    result = _post_json(
        f"{FIRECRAWL_URL.rstrip('/')}/v1/scrape",
        payload,
        FIRECRAWL_TIMEOUT_S,
    )
    # Firecrawl gibt {"success": true, "data": {"markdown": "..."}}
    data = result.get("data", {})
    if not isinstance(data, dict):
        return None
    md = data.get("markdown", "")
    return md if isinstance(md, str) and md.strip() else None

# ─── Ollama-Extraktion ────────────────────────────────────────────────────────

def extrahiere_ausschreibungen(seitentext: str) -> list[dict[str, Any]]:
    """
    Sendet den Seitentext an Ollama (qwen3.6) und parst die JSON-Antwort.
    Gibt eine Liste von Ausschreibungs-Dicts zurück (kann leer sein).
    """
    # Seitentext auf ~8000 Zeichen kürzen (Firecrawl-Markdown kann sehr lang sein)
    text_gekuerzt = seitentext[:8000]

    prompt = EXTRAKTIONS_PROMPT.replace("{SEITENTEXT}", text_gekuerzt)

    payload = {
        "model": LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "format": "json",
        "stream": False,
        "options": {
            "temperature": 0,
            "num_predict": 2000,
        },
        "think": False,
    }

    result = _post_json(
        f"{OLLAMA_URL.rstrip('/')}/api/chat",
        payload,
        OLLAMA_TIMEOUT_S,
    )

    # Antwort parsen
    content = result.get("message", {}).get("content", "")
    if not content:
        log.warning("Ollama: leere Antwort")
        return []

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        log.warning("Ollama: JSON-Parse-Fehler: %s | Rohtext: %.200s", e, content)
        return []

    ausschreibungen = parsed.get("ausschreibungen", [])
    if not isinstance(ausschreibungen, list):
        log.warning("Ollama: 'ausschreibungen' ist kein Array")
        return []

    # Grob validieren: jeder Eintrag braucht mindestens einen titel
    valide = []
    for a in ausschreibungen:
        if not isinstance(a, dict):
            continue
        titel = str(a.get("titel", "")).strip()
        if len(titel) < 5:
            continue
        valide.append(a)

    return valide


# ─── Aktive Quellensuche (SearXNG) — der eigentliche Radar ────────────────────

SEARX_URL = "http://localhost:8888/search"
# Engines wie url_discovery (Haertung 2026-06-10/07-06): bing/mojeek/duckduckgo sind
# gesperrt bzw. liefern themenfremden Muell; brave/startpage/yandex live verifiziert.
SEARX_ENGINES = os.environ.get("FAAS_SEARX_ENGINES", "brave,startpage,yandex")
ENTDECKT_STATE = Path(os.path.expanduser("~/faas_classify/scout_entdeckt.state.json"))


def _searx_suche(query: str, max_n: int = 4) -> list[str]:
    """SearXNG-Suche (selbst-gehostet, localhost:8888) -> Liste von Kandidaten-URLs.
    Relevanz-Filter (2026-07-06): mindestens ein signifikantes Query-Wort muss im
    Treffer vorkommen — sonst fressen themenfremde Engine-Treffer die Lauf-Slots."""
    q = urllib.parse.urlencode({"q": query, "format": "json", "engines": SEARX_ENGINES})
    req = urllib.request.Request(f"{SEARX_URL}?{q}", headers={"User-Agent": "faas-scout"})
    try:
        with urllib.request.urlopen(req, timeout=30) as x:
            res = json.loads(x.read().decode()).get("results", [])
    except Exception as e:
        log.warning("SearXNG-Fehler bei «%s»: %s", query, e)
        return []
    woerter = [w for w in re.findall(r"\w+", query.lower()) if len(w) >= 5]

    def _relevant(r: dict) -> bool:
        if not woerter:
            return True
        text = " ".join(str(r.get(k) or "") for k in ("url", "title", "content")).lower()
        return any(w in text for w in woerter)

    return [r.get("url") for r in res if r.get("url") and _relevant(r)][:max_n]


def _load_entdeckt() -> set:
    try:
        return set(json.loads(ENTDECKT_STATE.read_text()).get("urls", []))
    except Exception:
        return set()


def _save_entdeckt(urls: set) -> None:
    try:
        ENTDECKT_STATE.write_text(json.dumps({"urls": sorted(urls)[-2000:]}))
    except Exception:
        pass


def entdecke_neue_quellen(suchanfragen: list, treffer_pro_anfrage: int, bekannte_norm: set) -> list[str]:
    """Sucht via SearXNG nach neuen Foerder-Calls, dedupliziert gegen Bekanntes UND frueher
    Gefundenes (State), damit nicht jeden Tag dieselben Sackgassen neu gecrawlt werden."""
    entdeckt = _load_entdeckt()
    neu: list[str] = []
    neu_norm: set = set()
    for anfrage in suchanfragen:
        for url in _searx_suche(anfrage, treffer_pro_anfrage):
            norm = _normalisiere_url(url)
            if not norm or norm in bekannte_norm or norm in entdeckt or norm in neu_norm:
                continue
            neu_norm.add(norm)
            neu.append(url)
    _save_entdeckt(entdeckt | neu_norm)
    return neu


# ─── Hauptprogramm ────────────────────────────────────────────────────────────

def main() -> None:
    start = datetime.now(timezone.utc)
    log.info("=== Ausschreibungs-Scout gestartet ===")
    log.info("Directus: %s | Ollama-Modell: %s", DIRECTUS_URL, LLM_MODEL)

    # 1. Konfiguration laden
    if not QUELLEN_CONFIG.exists():
        log.error("Konfigurationsdatei nicht gefunden: %s", QUELLEN_CONFIG)
        sys.exit(1)

    with open(QUELLEN_CONFIG, encoding="utf-8") as f:
        config = json.load(f)

    max_pro_lauf: int = int(config.get("max_pro_lauf", 8))
    extra_eintraege: list[Any] = config.get("extra_quellen", [])

    # extra_quellen kann Objekte (mit url-Key) oder reine Strings enthalten
    extra_urls: list[str] = []
    for e in extra_eintraege:
        if isinstance(e, str):
            extra_urls.append(e)
        elif isinstance(e, dict) and e.get("url") and not e.get("_platzhalter"):
            extra_urls.append(e["url"])
        elif isinstance(e, dict) and e.get("_platzhalter"):
            # Platzhalter-Einträge: zur Transparenz loggen aber nicht scrapen
            log.info("Platzhalter übersprungen: %s", e.get("url", "?"))

    # 2. Bestehende ausschreibungen aus Directus laden
    log.info("Lade bestehende ausschreibungen aus Directus…")
    try:
        bestehende = lade_bestehende_ausschreibungen()
    except Exception as e:
        log.error("Directus nicht erreichbar: %s", e)
        sys.exit(1)

    log.info("Bestehende ausschreibungen: %d", len(bestehende))

    # URLs der bestehenden ausschreibungen als zusätzliche Quellen
    bestehende_urls = [
        e["url"]
        for e in bestehende
        if e.get("url") and str(e.get("url", "")).strip()
    ]

    # Quellen = extra_urls + bestehende URLs (zusammengeführt, Duplikate entfernt)
    alle_quellen_raw = extra_urls + bestehende_urls
    gesehen: set[str] = set()
    alle_quellen: list[str] = []
    for u in alle_quellen_raw:
        norm = _normalisiere_url(u)
        if norm and norm not in gesehen:
            gesehen.add(norm)
            alle_quellen.append(u)

    log.info(
        "Quellen gesamt: %d (%d extra, %d aus bestehenden ausschreibungen) — Limit: %d pro Lauf",
        len(alle_quellen),
        len(extra_urls),
        len(bestehende_urls),
        max_pro_lauf,
    )

    # 2b. Aktive Suche nach NEUEN Quellen (SearXNG) — der eigentliche Radar
    suchanfragen = config.get("suchanfragen", [])
    max_neue = int(config.get("max_neue_quellen", 5))
    treffer_pro_anfrage = int(config.get("treffer_pro_anfrage", 4))
    neue_quellen: list[str] = []
    if suchanfragen:
        log.info("Suche neue Quellen via SearXNG (%d Anfragen)…", len(suchanfragen))
        neue_quellen = entdecke_neue_quellen(suchanfragen, treffer_pro_anfrage, gesehen)[:max_neue]
        log.info("Neu entdeckte Quellen: %d", len(neue_quellen))

    # Neu Entdecktes ZUERST (der Sinn des Radars), dann bekannte Quellen auffuellen — Limit max_pro_lauf.
    # Bekannte Quellen ROTIEREND (tagesbasierter Offset, zustandslos): sonst kaemen bei
    # mehr Quellen als max_pro_lauf immer nur dieselben ersten dran und der Rest nie.
    if alle_quellen:
        offset = (datetime.now(timezone.utc).toordinal() * max_pro_lauf) % len(alle_quellen)
        rotierte_quellen = alle_quellen[offset:] + alle_quellen[:offset]
    else:
        rotierte_quellen = []
    quellen_this_run = (neue_quellen + rotierte_quellen)[:max_pro_lauf]

    # 3. Dedup-Sets aufbauen
    bekannte_urls, bekannte_titel = baue_dedup_sets(bestehende)

    # 4. Pro Quelle scrapen + extrahieren
    stats = {"geprueft": 0, "fehler": 0, "kandidaten": 0, "neu_angelegt": 0}

    for url in quellen_this_run:
        log.info("Prüfe Quelle: %s", url)
        stats["geprueft"] += 1

        # Scraping
        try:
            markdown = scrape_seite(url)
        except Exception as e:
            log.warning("Firecrawl-Fehler bei %s: %s", url, e)
            stats["fehler"] += 1
            continue

        if not markdown:
            log.info("  → Kein Inhalt (leer oder Fehler)")
            stats["fehler"] += 1
            continue

        log.info("  → Seite gescrapt (%d Zeichen)", len(markdown))

        # Extraktion via Ollama
        try:
            kandidaten = extrahiere_ausschreibungen(markdown)
        except Exception as e:
            log.warning("Ollama-Fehler bei %s: %s", url, e)
            stats["fehler"] += 1
            continue

        log.info("  → %d Kandidaten extrahiert", len(kandidaten))
        stats["kandidaten"] += len(kandidaten)

        # Dedup + Anlegen
        for kandidat in kandidaten:
            if ist_duplikat(kandidat, bekannte_urls, bekannte_titel):
                log.debug(
                    "  dup: '%s' (%s)",
                    kandidat.get("titel", "")[:60],
                    kandidat.get("url", "")[:60],
                )
                continue

            # Noch nicht vorhanden → anlegen
            try:
                neue_id = erstelle_ausschreibung(kandidat)
            except Exception as e:
                log.warning(
                    "Directus-Fehler beim Anlegen von '%s': %s",
                    kandidat.get("titel", "")[:60],
                    e,
                )
                continue

            if neue_id:
                log.info(
                    "  + Neu angelegt (id=%s): '%s'",
                    neue_id,
                    kandidat.get("titel", "")[:80],
                )
                # Dedup-Sets aktualisieren damit Folge-Kandidaten aus derselben
                # Quelle nicht doppelt angelegt werden
                u = _normalisiere_url(kandidat.get("url"))
                t = _normalisiere_titel(kandidat.get("titel"))
                if u:
                    bekannte_urls.add(u)
                if t:
                    bekannte_titel.add(t)
                stats["neu_angelegt"] += 1
            else:
                log.warning(
                    "  Anlegen scheinbar fehlgeschlagen (keine ID): '%s'",
                    kandidat.get("titel", "")[:60],
                )

        # Kurze Pause zwischen Quellen, um den Spark nicht zu überlasten
        time.sleep(1)

    # 5. Abschluss-Zusammenfassung
    dauer = (datetime.now(timezone.utc) - start).total_seconds()
    log.info("=== Lauf abgeschlossen in %.0fs ===", dauer)
    log.info(
        "Quellen geprüft: %d | Fehler: %d | Kandidaten: %d | Neu angelegt: %d",
        stats["geprueft"],
        stats["fehler"],
        stats["kandidaten"],
        stats["neu_angelegt"],
    )


if __name__ == "__main__":
    main()
