#!/usr/bin/env python3
"""match_engine.py – Match-Engine v0.5 (Math + Embedding + LLM)

v0.5 (2026-05-18): Math-Score nutzt jetzt die veredelte Stiftungs-DNA, sofern
vorhanden — gewichtetes Tag-Produkt (gewicht_medium * gewicht_stiftung) statt
Match gegen die alten Llama-Boolean-Felder. Fallback auf Booleans nur fuer
Stiftungen ohne aktive Stiftungs-DNA. Damit ist die Top-N-Vorauswahl ebenfalls
DNA-basiert.

Liest aktive medium_dna-Eintraege und alle stiftungen aus Directus.
Berechnet pro (medium, stiftung)-Paar drei Komponenten und einen Combined-Score:

- Math-Komponente (v0.5): gewichtetes DNA-vs-DNA-Matching. Pro gemeinsamem Tag
  matched += gewicht_medium * gewicht_stiftung. Theoretisches Maximum:
  sum(gewicht_medium * 3). Fallback fuer Stiftungen ohne DNA: Anwesenheits-Match
  gegen Boolean-Felder (wie v0.4c).
- Embedding-Komponente: Cosine-Similarity ueber Qdrant (768-dim nomic-embed-text)
- LLM-Komponente: qwen3.6-27b via vLLM (OpenAI-Chat, :8001), JSON-Output (score, begruendung)
  Backend per FAAS_LLM_BACKEND umschaltbar: vllm (default) | ollama
  Gecached pro (medium_dna_version_id, stiftung_id, stiftung_dna_version_id, model)
- Exclusion-Check: wenn Stiftung einen Exclusion-Tag traegt -> Score 0

Combined-Score: gewichtete Summe der drei Komponenten. Fehlt eine Komponente
(z. B. kein Embedding fuer das Medium), wird ihr Gewicht proportional auf die
anderen umverteilt. Defaults: math 0.30, embedding 0.20, llm 0.50.

Schreibt Top-N pro Medium nach Directus match_results.

Usage:
    python3 match_engine.py --dry-run
    python3 match_engine.py --medium wepublish
    python3 match_engine.py                       # full run, alle aktiven Medien
    python3 match_engine.py --medium wepublish --no-llm        # nur Math+Embedding (Diagnose)
    python3 match_engine.py --medium wepublish --no-embedding  # nur Math+LLM (Diagnose)

ENV-Variablen:
    DIRECTUS_URL          (default: https://stiftungen.winkelriedtoechter.ch)
    DIRECTUS_TOKEN        (default: aus ~/.hermes/.env)
    TOP_N_PER_MEDIUM      (default: 200)
    FAAS_LLM_BACKEND      (default: vllm; alternativ: ollama)
    VLLM_URL              (default: http://127.0.0.1:8001)
    FAAS_VLLM_MODEL       (default: qwen3.6-27b)
    OLLAMA_URL            (default: http://127.0.0.1:11434)        [nur bei backend=ollama]
    FAAS_LLM_MODEL        (default: nemotron-3-super:120b-a12b)    [nur bei backend=ollama]
    QDRANT_URL            (default: http://127.0.0.1:6333)
    QDRANT_STIFTUNGS_COLL (default: faas_stiftungen_dna)
    QDRANT_MEDIEN_COLL    (default: faas_medien_dna)
    MATH_WEIGHT           (default: 0.30)
    EMBEDDING_WEIGHT      (default: 0.20)
    LLM_WEIGHT            (default: 0.50)

Autor: Jolanda Spiess + Claude (Anthropic), 2026-04-30 / 2026-05-07
"""

import os
import re
import sys
import hashlib
import json
import uuid
import argparse
import subprocess
from datetime import datetime, timezone

import requests

DIRECTUS_URL = os.environ.get("DIRECTUS_URL", "https://stiftungen.winkelriedtoechter.ch")
DIRECTUS_TOKEN = os.environ.get("DIRECTUS_TOKEN", "")
TOP_N_PER_MEDIUM = int(os.environ.get("TOP_N_PER_MEDIUM", "200"))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("FAAS_LLM_MODEL", "nemotron-3-super:120b-a12b")
# vLLM-Backend (OpenAI-kompatibel, qwen3.6-27b auf :8001). Default seit 2026-06-01,
# loest Ollama/Nemotron ab: vLLM teilt sich die GPU sauber mit dem DNA-Pool-Lauf
# (Ollama + vLLM gleichzeitig qwen laden = OOM). Reversibel via FAAS_LLM_BACKEND=ollama.
LLM_BACKEND = (os.environ.get("FAAS_LLM_BACKEND", "vllm") or "").strip().lower()
VLLM_URL = os.environ.get("VLLM_URL", "http://127.0.0.1:8001")
VLLM_MODEL = os.environ.get("FAAS_VLLM_MODEL", "qwen3.6-27b")
# Aktives Modell fuer Cache-Key (match_llm_cache.model) + Logging. Modellwechsel
# invalidiert den Cache automatisch (anderer Key) -> sauberer Re-Score.
ACTIVE_MODEL = VLLM_MODEL if LLM_BACKEND == "vllm" else OLLAMA_MODEL
# Prompt-Version im Cache-Key: eine inhaltliche Aenderung am Bewertungs-Prompt MUSS
# den Score-Cache invalidieren (Key = medium_dna_version x stiftung x model), sonst
# ueberleben alte Scores jede Prompt-Aenderung. Bump bei jeder Prompt-Aenderung.
# p2 = Praezisions-Welle 2026-07-24 (Preis-/Einzelpersonen-Malus, Institutionalitaets-Check).
# Nur Cache-Key/Logging: der vLLM-API-Call nutzt weiterhin das rohe VLLM_MODEL.
PROMPT_VERSION = os.environ.get("MATCH_PROMPT_VERSION", "2")
ACTIVE_MODEL = f"{ACTIVE_MODEL}+p{PROMPT_VERSION}"
QDRANT_URL = os.environ.get("QDRANT_URL", "http://127.0.0.1:6333")
QDRANT_STIFTUNGS_COLL = os.environ.get("QDRANT_STIFTUNGS_COLL", "faas_stiftungen_dna")
QDRANT_MEDIEN_COLL = os.environ.get("QDRANT_MEDIEN_COLL", "faas_medien_dna")
MATCH_MIN_SCORE = int(os.environ.get("MATCH_MIN_SCORE", "30"))  # Score-Threshold: Matches darunter werden nicht in Directus geschrieben (verhindert Tinder-Muell / schwache Treffer wie Score 16). Default 30 (Jolanda 2026-06-02; war vorher faelschlich 0).
MATCH_MIN_TIER = (os.environ.get("MATCH_MIN_TIER", "qwen_v3") or "").strip().lower() or None  # Tier-Filter: nur Records mit diesem dna_quality_tier werden geschrieben. Default "qwen_v3" (finale Matching-Methode, Jolanda 2026-06-02 — nur noch qwen-v3-Treffer; Opus-"deep" war nur die Eich-Latte). Leer = aus.

# Drei-Komponenten-Gewichte (Summe = 1.0). Fallback-Logik in combine_scores:
# fehlt eine Komponente, wird ihr Gewicht proportional auf die anderen umverteilt.
MATH_WEIGHT = float(os.environ.get("MATH_WEIGHT", "0.10"))
EMBEDDING_WEIGHT = float(os.environ.get("EMBEDDING_WEIGHT", "0.10"))
LLM_WEIGHT = float(os.environ.get("LLM_WEIGHT", "0.80"))
LLM_TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "180"))


# ============================================================
# Directus REST-Client (minimal)
# ============================================================


def _classify_dna_tier(klassifiziert_by: str | None) -> tuple[bool, str]:
    """Aus klassifiziert_by die DNA-Qualitaets-Klasse ableiten.

    Returns:
        (dna_verified: bool, dna_quality_tier: str)
        Tier-Werte: "deep" | "boolean_v2" | "hermes_v1" | "unknown"
    """
    if not klassifiziert_by:
        return (False, "unknown")
    k = klassifiziert_by.lower()
    # qwen-v3-Pool: das neue, poolweite Produktionsmass — symmetrisch zu den
    # Medien-v3-DNAs (gleiches Vokabular, gleiche Ellenlaenge). DIE finale
    # Matching-Methode (Entscheidung Jolanda, 2026-06-02): nur noch qwen-Treffer.
    # Opus-"deep" war nur die Eich-Latte, nicht das Endprodukt.
    if "qwen" in k and "v3" in k:
        return (True, "qwen_v3")
    # Deep-Klasse: alte Opus-Tiefen-Veredelung (Eich-Latte, nicht mehr Match-Basis)
    if "cron-deep" in k or "cron-poolb-deep" in k:
        return (True, "deep")
    # Skill v0.3.1+: aeltere Skill-Veredelung mit echter Begruendung, qualitaetsgleich
    if "skill v0.3" in k or "skill v0.4" in k or "skill v0.5" in k:
        return (True, "deep")
    # Boolean-Stamping (alte Cron-Wellen)
    if "cron-night" in k or "cowork-welle" in k:
        return (False, "boolean_v2")
    # Hermes-Llama-Baseline (v1)
    if "hermes" in k or "spark-agent" in k or "llama" in k:
        return (False, "hermes_v1")
    # Skill v0.1/v0.2 alt — Mittellage, eher Boolean
    if "skill v0.1" in k or "skill v0.2" in k:
        return (False, "boolean_v2")
    return (False, "unknown")


def _headers():
    if not DIRECTUS_TOKEN:
        raise RuntimeError("DIRECTUS_TOKEN ist nicht gesetzt (env oder ~/.hermes/.env)")
    return {"Authorization": f"Bearer {DIRECTUS_TOKEN}"}


def directus_get(endpoint, params=None):
    resp = requests.get(f"{DIRECTUS_URL}{endpoint}", headers=_headers(), params=params or {}, timeout=60)
    resp.raise_for_status()
    return resp.json()


def directus_post(endpoint, body, max_retries=4):
    """Directus POST mit Retry bei transienten 5xx-Fehlern und Connection-Aussetzern.

    Beim Cueltuer-Lauf am 2026-05-07 schlug 1 Push mit 502 Bad Gateway fehl, weil
    Directus kurz ueberlastet war. Fuer den taeglichen 04:00-Cron-Lauf mit ~600
    Pushs muss das robust laufen, sonst sammeln sich Fehler.
    """
    import time
    headers = {**_headers(), "Content-Type": "application/json"}
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(f"{DIRECTUS_URL}{endpoint}", headers=headers, json=body, timeout=60)
            if resp.status_code in (502, 503, 504, 429):
                last_err = f"HTTP {resp.status_code}"
                if attempt < max_retries:
                    time.sleep(2 * attempt)
                    continue
            resp.raise_for_status()
            return resp.json()
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            last_err = f"{type(e).__name__}: {str(e)[:150]}"
            if attempt < max_retries:
                time.sleep(2 * attempt)
                continue
            raise
    raise RuntimeError(f"directus_post {endpoint} nach {max_retries} Versuchen fehlgeschlagen: {last_err}")


# ============================================================
# Postgres-Direktzugriff fuer match_llm_cache
# (gleiche Methode wie premium_enricher.py / parse_stiftungsraete.py)
# ============================================================
PG_DOCKER_CONTAINER = os.environ.get("PG_DOCKER_CONTAINER", "directus-postgres-spark")
PG_DB_USER = os.environ.get("PG_DB_USER", "directus")
PG_DB_NAME = os.environ.get("PG_DB_NAME", "directus_db")
# ssh-Alias fuer Daten-Reads gegen die VPS-Postgres (forced command, nur psql).
# Gesetzt in ~/.hermes/.env. Leer = Fallback auf den lokalen Container (Alt-DB!).
PG_REMOTE_SSH = os.environ.get("PG_REMOTE_SSH", "")

# Sentinel fuer Stiftungen ohne aktive stiftungs_dna - macht sie cachebar.
# Cache-Auto-Invalidierung greift weiter: bekommt eine Stiftung spaeter eine DNA,
# ist die `current_stiftung_dna_version_id` != Sentinel und der Cache-Eintrag wird
# als invalid behandelt (Cache-Miss -> neuer LLM-Call).
NO_DNA_SENTINEL = "_no_active_dna_v0"


def _norm_sdna(stiftung_dna_version_id):
    """Leerstring/None -> Sentinel, sonst durchreichen."""
    return stiftung_dna_version_id if stiftung_dna_version_id else NO_DNA_SENTINEL


def _quote_pg(value):
    """SQL-Literal-Escape fuer Postgres. None -> NULL."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value).replace("'", "''")
    return f"'{s}'"


def _psql_run(sql, timeout=30, remote=False):
    """SQL ausfuehren; liefert stdout (TSV bei SELECT).

    remote=True: produktive Daten-Reads gegen die VPS-Postgres, via ssh-Alias
    PG_REMOTE_SSH mit forced command (kann ausschliesslich psql in der VPS-DB,
    kein Shell-Zugang). Seit dem Hetzner-Cutover (2026-07-24) ist die VPS die
    Wahrheit; der lokale Container directus-postgres-spark traegt nur noch die
    eingefrorene Alt-DB plus den pipeline-lokalen LLM-Cache (match_llm_cache).
    remote=False: lokaler Container - NUR noch fuer den LLM-Cache verwenden.
    """
    if remote and PG_REMOTE_SSH:
        cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", PG_REMOTE_SSH]
    else:
        cmd = ["docker", "exec", "-i", PG_DOCKER_CONTAINER,
               "psql", "-U", PG_DB_USER, "-d", PG_DB_NAME,
               "-t", "-A", "-F", "\t"]
    proc = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"psql fehlgeschlagen: {proc.stderr.strip()[:300]}")
    return proc.stdout


def cache_lookup(medium_dna_version_id, stiftung_id, current_stiftung_dna_version_id, model=None):
    """Cache-Lookup. Nur Hit, wenn cached_dna_v == current_dna_v (Auto-Invalidierung).

    Stiftungen ohne aktive DNA werden ueber NO_DNA_SENTINEL gematcht.
    """
    current_norm = _norm_sdna(current_stiftung_dna_version_id)
    sql = (f"SELECT score, COALESCE(begruendung, ''), "
           f"COALESCE(stiftung_dna_version_id, '{NO_DNA_SENTINEL}') "
           f"FROM match_llm_cache "
           f"WHERE medium_dna_version_id = {_quote_pg(medium_dna_version_id)} "
           f"AND stiftung_id = {int(stiftung_id)} "
           f"AND model = {_quote_pg(model or ACTIVE_MODEL)} LIMIT 1;")
    try:
        out = _psql_run(sql).strip()
    except Exception:
        return None
    if not out:
        return None
    parts = out.split("\t")
    if len(parts) < 3:
        return None
    try:
        score = int(parts[0])
    except ValueError:
        return None
    cached_dna_v = parts[2] or NO_DNA_SENTINEL
    if cached_dna_v != current_norm:
        return None
    return score, parts[1]


def cache_write(medium_dna_version_id, stiftung_id, stiftung_dna_version_id,
                score, begruendung, model, max_retries=3):
    """UPSERT in match_llm_cache. RETURNING bestaetigt das INSERT/UPDATE.

    Retry-Loop gegen transiente docker-exec/Postgres-Stoerungen unter
    Parallel-Last (z.B. Embedding-Pass). Liefert nur True, wenn die
    RETURNING-Zeile zurueckkommt - schuetzt vor dem Bug aus 2026-05-07,
    bei dem einzelne docker-exec-Calls returncode 0 zurueckgaben, ohne
    dass die Zeile tatsaechlich geschrieben wurde.
    """
    import time
    sql = (
        f"INSERT INTO match_llm_cache "
        f"(medium_dna_version_id, stiftung_id, stiftung_dna_version_id, score, begruendung, model, computed_at) "
        f"VALUES ({_quote_pg(medium_dna_version_id)}, {int(stiftung_id)}, "
        f"{_quote_pg(stiftung_dna_version_id)}, {int(score)}, "
        f"{_quote_pg((begruendung or '')[:500])}, {_quote_pg(model)}, NOW()) "
        f"ON CONFLICT (medium_dna_version_id, stiftung_id) DO UPDATE SET "
        f"stiftung_dna_version_id = EXCLUDED.stiftung_dna_version_id, "
        f"score = EXCLUDED.score, "
        f"begruendung = EXCLUDED.begruendung, "
        f"model = EXCLUDED.model, "
        f"computed_at = NOW() "
        f"RETURNING stiftung_id;"
    )
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            out = _psql_run(sql).strip()
            if out and str(stiftung_id) in out.split("\n")[0]:
                return True
            last_err = f"RETURNING leer (out={out!r})"
        except Exception as e:
            last_err = str(e)[:200]
        if attempt < max_retries:
            time.sleep(0.5 * attempt)
    print(f"    cache_write FAIL stiftung_id={stiftung_id} nach {max_retries} Versuchen: {last_err}", flush=True)
    return False


def load_active_stiftungs_dna_map():
    """Liefert dict: stiftung_id (int) -> {version_id, klassifiziert_by}.
    Erweitert 2026-05-13: zusaetzlich klassifiziert_by fuer DNA-Quality-Tier-Bestimmung."""
    sql = "SELECT stiftung_id, version_id, COALESCE(klassifiziert_by,'') FROM stiftungs_dna WHERE is_active = TRUE;"
    out = _psql_run(sql, timeout=60, remote=True).strip()
    result = {}
    for line in out.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        try:
            result[int(parts[0])] = {"version_id": parts[1], "klassifiziert_by": parts[2] if len(parts) >= 3 else ""}
        except ValueError:
            continue
    return result



def load_active_stiftungs_dna_full():
    """Volle aktive Stiftungs-DNA pro Stiftung (stiftung_id -> dict).

    Implementiert direkt via psql + json_agg, weil Directus REST mit JSON-Feldern
    in den fields (tags, exclusion_tags, foerderpraxis) und limit=-1 zu langsam ist.
    Liefert in unter einer Sekunde."""
    # Zeilenweise statt json_agg (Riesenwert kippte den VPS-Postgres, s. load_stiftungen).
    sql = (
        "SELECT json_build_object("
        "'stiftung_id', stiftung_id,"
        "'stiftung_name', stiftung_name,"
        "'version_id', version_id,"
        "'version_number', version_number,"
        "'klassifiziert_by', klassifiziert_by,"
        "'schaerfe_prozent', schaerfe_prozent,"
        "'sound_feeling', sound_feeling,"
        "'tags', tags,"
        "'exclusion_tags', exclusion_tags,"
        "'foerderpraxis', foerderpraxis)::text "
        "FROM stiftungs_dna WHERE is_active = TRUE;"
    )
    raw = _psql_run(sql, timeout=180, remote=True)
    data = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            data.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    out = {}
    for d in data:
        sid = d.get("stiftung_id")
        if sid is None:
            continue
        try:
            sid_int = int(sid)
        except (TypeError, ValueError):
            continue
        out[sid_int] = d
    return out


# ============================================================
# Daten-Loader (Directus REST)
# ============================================================
def load_active_dna(medium_filter=None):
    params = {"filter[is_active][_eq]": "true", "limit": -1}
    if medium_filter:
        params["filter[medium_id][_eq]"] = medium_filter
    return directus_get("/items/medium_dna", params)["data"]


def load_stiftungen():
    """Alle Stiftungen direkt aus Postgres via psql laden.

    Schneller als Directus REST (5s statt 15+min fuer 40k Stiftungen).
    Das embedding-Feld wird per Default ausgeschlossen (gross + unnoetig
    fuer die Match-Engine, die das Embedding ueber Qdrant holt).
    """
    # Zeilenweise (EIN JSON-Objekt pro Zeile): json_agg baute EINEN Riesenwert
    # (40k x ~190 Spalten) und kippte den VPS-Postgres (Befund 2026-07-24).
    # jsonb::text ist einzeilig (Newlines in Strings sind als \n escaped).
    # duplicate_of: als Duplikat verlinkte Eintraege sind nie Kandidaten -
    # sonst erscheint dieselbe Foerderung doppelt in den Treffern (MFF-Fall).
    # ist_foerderstiftung IS NOT FALSE (W1.6): explizite Nicht-Foerderer (operative
    # Stiftungen, Verbaende ohne Vergabe) raus; TRUE und NULL (ungeprueft) bleiben.
    # IS NOT FALSE nur, wenn die Spalte existiert (dynamischer Schutz).
    spalten_check = "SELECT 1 FROM information_schema.columns WHERE table_name='stiftungen' AND column_name='ist_foerderstiftung' LIMIT 1;"
    hat_foerder_spalte = bool(_psql_run(spalten_check, timeout=30, remote=True).strip())
    where = "s.duplicate_of IS NULL"
    if hat_foerder_spalte:
        where += " AND s.ist_foerderstiftung IS NOT FALSE"
    sql = f"SELECT (to_jsonb(s) - 'embedding')::text FROM stiftungen s WHERE {where};"
    raw = _psql_run(sql, timeout=180, remote=True)
    rows = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


# ============================================================
# Tag-Extraktion
# ============================================================
TAG_PREFIXES = (
    "matching_targets_",
    "geo_",
    "medien_journalismus_",
    "gesellschaft_demokratie_",
    "soziales_inklusion_",
    "kultur_kunst_lifestyle_",
    "sport_freizeit_",
    "bildung_wissenschaft_ethik_",
    "umwelt_tech_stadt_",
)


# DACH-Geo-Tags die fuer DACH-Stiftungen automatisch matchen sollen.
_DACH_GEO_BYPASS = (
    "geo_basel", "geo_bern", "geo_zuerich", "geo_winterthur",
    "geo_st_gallen", "geo_luzern", "geo_genf_romandie",
    "geo_graubuenden", "geo_tessin", "geo_schweiz_weit",
    "geo_oesterreich", "geo_dach_region", "geo_international",
)


def extract_stiftung_tags(stiftung):
    """Liefert ein set aller Tag-Felder der Stiftung mit Wert TRUE.

    Sonderfall DACH: Wenn `geo_dach_region` aktiv ist, werden alle
    DACH-Geo-Tags virtuell mitgesetzt.
    """
    tags = set()
    for key, value in stiftung.items():
        if value is True and key.startswith(TAG_PREFIXES):
            tags.add(key)
    if "geo_dach_region" in tags:
        tags.update(_DACH_GEO_BYPASS)
    return tags


# ============================================================
# Math-Komponente
# ============================================================
def _stiftung_dna_tag_weights(sdna_full):
    """Aus voller Stiftungs-DNA dict {tag_slug: gewicht} bauen."""
    out = {}
    if not isinstance(sdna_full, dict):
        return out
    for tag_obj in sdna_full.get("tags") or []:
        if not isinstance(tag_obj, dict):
            continue
        slug = tag_obj.get("tag_slug") or tag_obj.get("tag") or ""
        gew = int(tag_obj.get("gewicht", 0) or 0)
        if slug and gew > 0:
            # Falls Duplikat im Array: hoechstes Gewicht behalten.
            out[slug] = max(out.get(slug, 0), gew)
    return out


def compute_math_score(dna, stiftung, sdna_full=None):
    """Math-Score 0-100 plus Breakdown.

    v0.5 (2026-05-18): gewichtetes DNA-vs-DNA-Matching, wenn Stiftungs-DNA
    vorhanden ist. Beide Seiten verwenden dasselbe Tag-Vokabular (v2, 171 Tags).
    Pro gemeinsamem Tag: matched += gewicht_medium * gewicht_stiftung.
    Theoretisches Maximum: sum(gewicht_medium * 3) — wenn die Stiftung jeden
    Medium-Tag mit Maximalgewicht 3 spiegelt.

    Fallback fuer Stiftungen ohne veredelte DNA: alte Boolean-Felder-Logik
    (extract_stiftung_tags), aber als reine Anwesenheits-Pruefung — der Math-
    Score ist dann strukturell niedriger als bei DNA-vs-DNA. Dieser Bias ist
    gewollt: er gewichtet veredelte Stiftungen in der Top-N-Vorauswahl hoeher.
    """
    sdna_tag_weights = _stiftung_dna_tag_weights(sdna_full)
    use_dna = bool(sdna_tag_weights)

    matched_score = 0
    max_score = 0
    matched_breakdown = []
    mode = "dna_vs_dna" if use_dna else "boolean_fallback"

    if not use_dna:
        # Fallback: Anwesenheits-Match gegen Boolean-Felder der stiftungen-Tabelle.
        boolean_tags = extract_stiftung_tags(stiftung)

    # Medium-Tags extrahieren — ZWEI Schemata:
    #  - altes Medium-Schema (wepublish, cueltuer, neue_wege): sektionen-Dict mit Tag-Listen.
    #  - neues v3-Schema (app-gemessen via measure-medium-dna, symmetrisch zu stiftungs_dna):
    #    flache tags-Liste. Ohne diesen Fallback bekaeme JEDES app-gemessene Medium math=0.
    sektionen = dna.get("sektionen") or {}
    if sektionen:
        medium_tag_objs = [(sn, t) for sn, tl in sektionen.items()
                           if isinstance(tl, list) for t in tl if isinstance(t, dict)]
    else:
        medium_tag_objs = [("tags", t) for t in (dna.get("tags") or []) if isinstance(t, dict)]
    for sektion_name, tag_obj in medium_tag_objs:
        # DNA-Studio-Schema-Drift: einige Medien nutzen tag_slug, andere tag.
        tag = tag_obj.get("tag") or tag_obj.get("tag_slug") or ""
        gewicht_m = int(tag_obj.get("gewicht", 0) or 0)
        if gewicht_m <= 0 or not tag:
            continue
        if use_dna:
            # Theoretisches Max: Stiftung spiegelt mit Maximalgewicht 3.
            max_score += gewicht_m * 3
            gewicht_s = sdna_tag_weights.get(tag, 0)
            if gewicht_s > 0:
                matched_score += gewicht_m * gewicht_s
                matched_breakdown.append({
                    "tag": tag,
                    "gewicht": gewicht_m,
                    "gewicht_stiftung": gewicht_s,
                    "sektion": sektion_name,
                })
        else:
            # Fallback-Logik wie v0.4c: reines Anwesenheits-Match, gewicht_medium gilt.
            max_score += gewicht_m
            if tag in boolean_tags:
                matched_score += gewicht_m
                matched_breakdown.append({
                    "tag": tag,
                    "gewicht": gewicht_m,
                    "sektion": sektion_name,
                })

    score = int(round((matched_score / max_score) * 100)) if max_score > 0 else 0
    breakdown = {
        "matched": matched_breakdown,
        "matched_score": matched_score,
        "max_score": max_score,
        "mode": mode,
    }
    return score, breakdown


# ============================================================
# Exclusion-Check
# ============================================================
def check_exclusion(dna, stiftung):
    stiftung_tags = extract_stiftung_tags(stiftung)
    exclusion_list = dna.get("exclusion_tags") or []
    if not isinstance(exclusion_list, list):
        return False, None
    for ex in exclusion_list:
        if isinstance(ex, dict):
            tag = ex.get("tag") or ex.get("tag_slug") or ""
            # Geo-Exclusions eines MEDIUMS schliessen Foerderer NICHT hart aus:
            # der redaktionelle Geo-Fokus (z.B. bajour = Basel) ist keine Foerder-
            # Eligibilitaet — eine Basler Redaktion kann von einer Zuercher National-
            # Stiftung gefoerdert werden. Geografische Naehe wirkt im math-Score.
            # Foerderer-eigene Geo-Restriktionen bleiben davon unberuehrt.
            if tag.startswith("geo_"):
                continue
            if tag and tag in stiftung_tags:
                return True, ex
    return False, None


# ============================================================
# LLM-Komponente (Hermes via Ollama, JSON-Mode)
# ============================================================
def _top_dna_tags(dna, limit=15):
    """Top-Tags der Medium-DNA (gewicht >= 2), als flache Liste.
    Beide Schemata: sektionen-Dict (alt) oder flache tags-Liste (neu, app-gemessen)."""
    out = []
    sektionen = dna.get("sektionen") or {}
    if sektionen:
        tag_objs = [t for s in sektionen.values() if isinstance(s, list) for t in s]
    else:
        tag_objs = dna.get("tags") or []
    for tag_obj in tag_objs:
        if not isinstance(tag_obj, dict):
            continue
        if int(tag_obj.get("gewicht", 0) or 0) >= 2:
            out.append(tag_obj.get("tag") or tag_obj.get("tag_slug") or "")
    return [t for t in out if t][:limit]


def _extract_json_obj(text):
    """Erstes balanciertes {...}-JSON-Objekt aus einem Text robust extrahieren.
    vLLM liefert (ohne response_format) den JSON-Body als reinen Text in content."""
    text = (text or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except Exception:
                    return None
    return None


def _llm_call_vllm(prompt):
    """vLLM OpenAI-Chat-Call (qwen3.6-27b). KEIN response_format (haengt qwen3.6 bei
    laengerem JSON), enable_thinking:false, content per loser JSON-Extraktion.
    Rueckgabe: dict oder None bei Fehler."""
    payload = {
        "model": VLLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": 256,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    try:
        r = requests.post(f"{VLLM_URL}/v1/chat/completions", json=payload, timeout=LLM_TIMEOUT)
        r.raise_for_status()
        choices = r.json().get("choices") or []
        content = (choices[0].get("message", {}).get("content", "") if choices else "") or ""
        return _extract_json_obj(content)
    except Exception:
        return None


def _llm_call_ollama(prompt):
    """LLM-JSON-Call. Dispatcht je nach FAAS_LLM_BACKEND auf vLLM (default) oder
    Ollama-Generate. Rueckgabe: dict oder None bei Fehler. (Funktionsname historisch
    beibehalten; einzige Aufrufstelle in compute_llm_score.)"""
    if LLM_BACKEND == "vllm":
        return _llm_call_vllm(prompt)
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "keep_alive": "1h",
        "options": {"temperature": 0.2, "num_predict": 250},
    }
    try:
        r = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=LLM_TIMEOUT)
        r.raise_for_status()
        raw = r.json().get("response", "").strip()
        return json.loads(raw)
    except Exception:
        return None


def _fmt_rueckmeldungen(rueckmeldungen, max_items=5):
    """Rueckmeldungs-Block fuer den Prompt. Leer -> leerer String (kein Block)."""
    texte = [str(r).strip().replace("\n", " ")[:500] for r in (rueckmeldungen or []) if str(r).strip()]
    if not texte:
        return ""
    zeilen = "\n".join(f"  - {t}" for t in texte[:max_items])
    return ("RUECKMELDUNG ZU GENAU DIESEM PAAR (von We.Publish bzw. dem Medium selbst, "
            "verbindlich - schlaegt jede DNA-Heuristik):\n"
            f"{zeilen}\n\n")


_RUECKMELDUNGEN_CACHE = None


def load_match_rueckmeldungen():
    """{(medium_id, stiftung_id:int): [notiz, ...]} aller AKTIVEN Treffer-
    Rueckmeldungen aus `agent_lessons` (kategorie 'match_rueckmeldung').

    Operator-Rueckmeldungen sind ab dem Schreiben aktiv; Rueckmeldungen aus dem
    Medien-Portal erst nach der Freigabe durch We.Publish (Entscheid der
    Nutzerin 29.07.2026) - `aktiv = false` bleibt hier folgenlos. Einmal pro
    Lauf gelesen. Fehlt die Collection oder das Feld, laeuft der Lauf ohne
    Rueckmeldungen weiter.
    """
    global _RUECKMELDUNGEN_CACHE
    if _RUECKMELDUNGEN_CACHE is not None:
        return _RUECKMELDUNGEN_CACHE
    mapping = {}
    try:
        res = directus_get("/items/agent_lessons", {
            "filter[kategorie][_eq]": "match_rueckmeldung",
            "filter[aktiv][_eq]": "true",
            "fields": "medium_id,stiftung_id,notiz,ts",
            "sort": "-ts",
            "limit": -1,
        })
        for row in (res.get("data") or []):
            medium_id = row.get("medium_id")
            notiz = (row.get("notiz") or "").strip()
            if not medium_id or not notiz:
                continue
            try:
                sid = int(row.get("stiftung_id"))
            except (TypeError, ValueError):
                continue
            mapping.setdefault((medium_id, sid), []).append(notiz)
    except Exception as e:
        print(f"  WARN: Treffer-Rueckmeldungen nicht lesbar ({e}) - Lauf ohne Rueckmeldungen", flush=True)
    _RUECKMELDUNGEN_CACHE = mapping
    return mapping


def build_match_prompt(dna, stiftung, math_score, sdna_full=None, rueckmeldungen=None):
    """Bewertungs-Prompt Medium-DNA vs. Stiftungs-DNA bauen (reine Funktion, testbar).

    Prompt-Version: siehe PROMPT_VERSION (Cache-Key). Bei jeder inhaltlichen
    Aenderung hier PROMPT_VERSION bumpen, sonst liefert der Cache alte Scores.
    p2 (2026-07-24): Preis-/Einzelpersonen-Malus + Institutionalitaets-Check.
    Ausloeser: Ramonas Praezisions-Feedback - kleine Kunstpreis-Stiftungen rankten
    vor institutionellen Geldgebern (Migros-Kulturprozent Platz 33 bei cueltuer).

    `rueckmeldungen` (Liste Strings, 2026-07-29): freigegebene Rueckmeldungen zu
    GENAU diesem Medium-Stiftung-Paar aus agent_lessons (Operator sofort, Medium
    nach Freigabe). Sie stehen als eigener, verbindlicher Block im Prompt - ein
    Mensch, der das Paar kennt, schlaegt jede DNA-Heuristik. Der Cache-Key traegt
    ihren Fingerabdruck (compute_llm_score), damit eine neue Rueckmeldung den
    alten Score sofort invalidiert.
    """
    def _fmt_tag_list(tag_list, max_items=30):
        lines = []
        for t in (tag_list or [])[:max_items]:
            if not isinstance(t, dict):
                continue
            slug = t.get("tag_slug") or t.get("tag") or "?"
            gew = t.get("gewicht", "?")
            beg = (t.get("begruendung") or "").strip().replace("\n", " ")[:280]
            lines.append(f"    - {slug} [Gewicht {gew}]: {beg}")
        return "\n".join(lines) if lines else "    (keine)"

    def _fmt_excl(ex_list, max_items=20):
        lines = []
        for e in (ex_list or [])[:max_items]:
            if not isinstance(e, dict):
                continue
            slug = e.get("tag_slug") or e.get("tag") or "?"
            beg = (e.get("begruendung") or "").strip().replace("\n", " ")[:200]
            lines.append(f"    - {slug}: {beg}")
        return "\n".join(lines) if lines else "    (keine)"

    # Medium-DNA-Block
    m_name = dna.get("medium_name") or dna.get("medium_id") or ""
    m_sound = (dna.get("sound_feeling") or "")[:1200]
    m_schaerfe = dna.get("schaerfe_prozent")
    m_tags_raw = dna.get("tags") or (dna.get("sektionen") or {}).get("tags") or []
    m_excl = dna.get("exclusion_tags") or []
    m_foerder = dna.get("foerderpraxis") or {}

    medium_block = (
        f"  Name: {m_name}\n"
        f"  Schaerfe-Prozent (Strikte des Profils): {m_schaerfe}\n"
        f"  Sound/Selbstverstaendnis:\n    {m_sound}\n"
        f"  Tags (mit Gewicht und Begruendung):\n{_fmt_tag_list(m_tags_raw)}\n"
        f"  Tabu-Themen / Exclusion-Tags:\n{_fmt_excl(m_excl)}\n"
        f"  Foerderpraxis (Medium-Sicht): {json.dumps(m_foerder, ensure_ascii=False)[:600]}\n"
    )

    # Stiftungs-DNA-Block
    if sdna_full and isinstance(sdna_full, dict) and sdna_full.get("stiftung_id") is not None:
        s_name = sdna_full.get("stiftung_name") or stiftung.get("Stiftungsname") or ""
        s_sound = (sdna_full.get("sound_feeling") or "")[:1500]
        s_schaerfe = sdna_full.get("schaerfe_prozent")
        s_tags_raw = sdna_full.get("tags") or []
        s_excl = sdna_full.get("exclusion_tags") or []
        s_foerder = sdna_full.get("foerderpraxis") or {}
        stiftung_block = (
            f"  Name: {s_name}\n"
            f"  Sitz: {stiftung.get('sitz') or ''} ({stiftung.get('land') or ''})\n"
            f"  Schaerfe-Prozent (Strikte des DNA-Profils): {s_schaerfe}\n"
            f"  Sound/Selbstverstaendnis:\n    {s_sound}\n"
            f"  Tags (mit Gewicht und Begruendung):\n{_fmt_tag_list(s_tags_raw)}\n"
            f"  Tabu-Themen / Exclusion-Tags:\n{_fmt_excl(s_excl)}\n"
            f"  Foerderpraxis: {json.dumps(s_foerder, ensure_ascii=False)[:800]}\n"
        )
    else:
        stiftung_block = (
            f"  Name: {stiftung.get('Stiftungsname') or ''}\n"
            f"  Sitz: {stiftung.get('sitz') or ''} ({stiftung.get('land') or ''})\n"
            f"  Zwecktext (Roh): {(stiftung.get('zwecktext') or '')[:800]}\n"
            f"  Foerderbedingungen (Roh): {(stiftung.get('foerderbedingungen') or '')[:500]}\n"
            "  HINWEIS: Diese Stiftung hat noch keine veredelte DNA. Bewerte konservativ.\n"
        )

    prompt = (
        "Du bewertest die Passgenauigkeit zwischen einem Medium und einer Foerderstiftung "
        "auf Basis ihrer veredelten DNA-Profile. Beide Profile sind sorgfaeltig recherchierte "
        "Selbst- bzw. Fremdbeschreibungen mit Tags, Begruendungen, Tabu-Themen, Sound und Foerderpraxis. "
        "Nutze diese Informationen voll aus.\n\n"
        "MEDIUM-DNA:\n"
        f"{medium_block}\n"
        "STIFTUNGS-DNA:\n"
        f"{stiftung_block}\n"
        "KONTEXT (technische Hilfsgroessen):\n"
        f"  Math-Score (Tag-Overlap): {math_score}/100\n\n"
        f"{_fmt_rueckmeldungen(rueckmeldungen)}"
        "Bewertungsaufgabe:\n"
        "Bewerte die Passgenauigkeit auf einer Skala 0-100. Der Antragsteller ist immer eine "
        "ORGANISATION (ein Medium bzw. dessen Traegerschaft), nie eine Einzelperson. Pruefkaskade:\n"
        "  0. Rueckmeldungs-Check: Liegt oben eine RUECKMELDUNG zu diesem Paar vor, ist sie "
        "verbindlich und schlaegt jede andere Einschaetzung. Sagt sie, die Stiftung passe nicht "
        "(falsche Foerderpraxis, kein Medienbezug, Absage erhalten, Region falsch): Score <= 15 und "
        "nenne die Rueckmeldung als Grund. Nennt sie eine Einschraenkung, senke entsprechend.\n"
        "  1. Tabu-Check: Wenn ein Tabu-Thema der Stiftung das Kerngeschaeft des Mediums trifft, "
        "oder umgekehrt das Medium ein Tabu der Stiftung im Kern hat: Score <= 20.\n"
        "  2. Antragstyp-Check: Kann eine Organisation (Medium, Verlag, Redaktion) bei diesem "
        "Foerderer ueberhaupt Foerdergeld beantragen? Vergibt der Foerderer primaer Preise, "
        "Auszeichnungen, Stipendien oder Werkbeitraege an Einzelpersonen (Kuenstlerinnen, Autoren, "
        "Forschende) und bietet KEINE offene Projekt- oder Organisationsfoerderung: Score <= 25, "
        "auch bei grosser thematischer Naehe. Falls Foerderpraxis explizit Forschung/Einzelpersonen/"
        "Technologie ohne Medienbezug: Score <= 30.\n"
        "  3. Institutionalitaets-Check: Ein institutioneller Geldgeber (wiederkehrende "
        "Foerderprogramme, professionelle Antragswege, foerdert Organisationen und Projekte, "
        "relevante Foerdersummen) ist fuer ein Medium deutlich wertvoller als eine kleine Preis-, "
        "Gedenk- oder Familienstiftung mit gleicher thematischer Naehe. Bewerte institutionelle "
        "Geldgeber bei vergleichbarer Themen-Naehe 10-20 Punkte hoeher als solche Kleinstiftungen.\n"
        "  4. Geo-Check: Foerdert die Stiftung im Geo-Scope des Mediums? Mismatch verringert Score.\n"
        "  5. Themen-Match: Wie stark deckt sich die Themen-DNA? Hoch-gewichtete Tags (Gewicht 3) auf beiden "
        "Seiten im selben Themenbereich = starkes Plus.\n"
        "  6. Sound/Selbstverstaendnis: Passt die Welt-Sicht? (Z.B. kapitalismuskritisches Medium vs. "
        "wirtschaftsnahe Foerderstiftung = Mismatch.)\n\n"
        "Begruendungs-Regeln:\n"
        "  - 1-3 Saetze auf Deutsch, klar und faktisch.\n"
        "  - Keine Konjunktive, kein 'koennte', kein 'eventuell'.\n"
        "  - Bei Mismatch: benenne PRAEZISE den Grund (welcher Tabu, welche Foerderpraxis, welche Geo-Differenz).\n"
        "  - Bei Match: benenne die zwei staerksten Resonanz-Achsen.\n"
        "  - Kein scharfes ss (immer ss schreiben).\n\n"
        "Output ausschliesslich als JSON-Objekt mit zwei Feldern:\n"
        '  {"score": <0-100>, "begruendung": "<deutscher Text>"}'
    )
    return prompt


def compute_llm_score(dna, stiftung, math_score, stiftung_dna_version_id,
                      sdna_full=None, use_cache=True, rueckmeldungen=None):
    """LLM-Score 0-100 + Begruendung. DNA-vs-DNA-Bewertung.

    Wenn sdna_full uebergeben wird, fliesst die volle veredelte Stiftungs-DNA in den
    Prompt ein (Tags+Begruendungen, Exclusion-Tags, Foerderpraxis, Sound, Schaerfe).
    Sonst Fallback auf Stammdaten. Prompt-Bau: build_match_prompt (testbar).

    Cached pro (medium_dna_version_id, stiftung_id, stiftung_dna_version_id)
    unter ACTIVE_MODEL (traegt die PROMPT_VERSION).
    """
    medium_dna_version_id = dna.get("version_id")
    stiftung_id = stiftung.get("id")

    # Rueckmeldungen wandern in den Cache-Key (wie die PROMPT_VERSION): eine
    # neue oder geaenderte Rueckmeldung invalidiert den alten Score sofort,
    # statt ihn bis zur naechsten DNA-Version weiterzuschleppen.
    modell = ACTIVE_MODEL
    if rueckmeldungen:
        fp = hashlib.sha256("\u0000".join(str(r) for r in rueckmeldungen).encode("utf-8")).hexdigest()[:8]
        modell = f"{ACTIVE_MODEL}+fb{fp}"

    if use_cache and medium_dna_version_id and stiftung_id is not None:
        hit = cache_lookup(medium_dna_version_id, stiftung_id, stiftung_dna_version_id, model=modell)
        if hit is not None:
            return hit[0], hit[1], "cache"

    prompt = build_match_prompt(dna, stiftung, math_score, sdna_full=sdna_full,
                               rueckmeldungen=rueckmeldungen)

    obj = _llm_call_ollama(prompt)
    if not isinstance(obj, dict):
        return None, None, "fail"
    try:
        score = int(obj.get("score") or 0)
    except (TypeError, ValueError):
        return None, None, "fail"
    score = max(0, min(100, score))
    begruendung = (obj.get("begruendung") or "").strip()[:600]

    if use_cache and medium_dna_version_id and stiftung_id is not None:
        cache_write(medium_dna_version_id, stiftung_id, _norm_sdna(stiftung_dna_version_id),
                    score, begruendung, modell)

    return score, begruendung, "llm"


# ============================================================
# Embedding-Score (Cosine Similarity ueber Qdrant)
# ============================================================
def query_stiftung_similarities(medium_dna_id, top_k=5000):
    """Holt Qdrant-Similarity-Scores aller Stiftungen zum Medium-Vektor.
    Rueckgabe: dict {stiftung_id (int): cosine_similarity_score 0-100}.
    Bei Fehler oder fehlendem Medium-Vektor: leeres dict.
    """
    try:
        # 1. Medium-Vektor aus Qdrant holen
        r = requests.post(
            f"{QDRANT_URL}/collections/{QDRANT_MEDIEN_COLL}/points",
            json={"ids": [str(medium_dna_id)], "with_vector": True},
            timeout=10,
        )
        if r.status_code != 200:
            # Falls Qdrant Hash-IDs nutzt (siehe embedding_pass.py): UUID aus md5 nachbauen
            import hashlib, uuid
            qid = str(uuid.UUID(hashlib.md5(str(medium_dna_id).encode()).hexdigest()))
            r = requests.post(
                f"{QDRANT_URL}/collections/{QDRANT_MEDIEN_COLL}/points",
                json={"ids": [qid], "with_vector": True},
                timeout=10,
            )
            r.raise_for_status()
        points = r.json().get("result", [])
        if not points or not points[0].get("vector"):
            return {}
        medium_vec = points[0]["vector"]

        # 2. Qdrant-Suche: Top-K Stiftungen nach cosine
        r = requests.post(
            f"{QDRANT_URL}/collections/{QDRANT_STIFTUNGS_COLL}/points/search",
            json={"vector": medium_vec, "limit": top_k, "with_payload": True},
            timeout=30,
        )
        r.raise_for_status()
        results = r.json().get("result", [])

        # 3. Mapping {stiftung_id (int): score 0-100}
        sim_map = {}
        for p in results:
            payload = p.get("payload", {})
            sid = payload.get("stiftung_id")
            if sid is None:
                continue
            try:
                sid_int = int(sid)
            except (TypeError, ValueError):
                continue
            # Qdrant Cosine-Score ist 0-1; auf 0-100 skalieren
            sim_map[sid_int] = int(round(float(p.get("score", 0.0)) * 100))
        return sim_map
    except Exception as e:
        print(f"    WARN: Qdrant-Similarity-Query fehlgeschlagen: {e}", flush=True)
        return {}


# ============================================================
# Score-Kombination (drei-Komponenten)
# ============================================================
def combine_scores(math_score, embedding_score, llm_score):
    """Drei-Komponenten-Combined-Score mit fehlertoleranter Umverteilung.

    Gewichte: MATH_WEIGHT, EMBEDDING_WEIGHT, LLM_WEIGHT (Summe = 1.0 wenn alle da).
    Wenn eine Komponente None ist: ihr Gewicht wird proportional auf die anderen umverteilt.
    """
    components = []  # list of (score, weight)
    if math_score is not None:
        components.append((math_score, MATH_WEIGHT))
    if embedding_score is not None:
        components.append((embedding_score, EMBEDDING_WEIGHT))
    if llm_score is not None:
        components.append((llm_score, LLM_WEIGHT))
    if not components:
        return 0
    total_weight = sum(w for _, w in components)
    if total_weight == 0:
        return 0
    weighted_sum = sum(s * (w / total_weight) for s, w in components)
    return int(round(weighted_sum))


# ============================================================
# Main loop
# ============================================================

GEO_FIELDS_FOR_MODIFIKATOREN = [
    'geo_schweiz_weit','geo_zuerich','geo_basel','geo_bern',
    'geo_st_gallen','geo_luzern','geo_tessin','geo_genf_romandie',
    'geo_graubuenden','geo_winterthur',
    'geo_oesterreich','geo_dach_region','geo_international',
]

def _stiftungs_geo_modifikator(stiftung, sdna_full=None):
    scope=set(); flags=[]
    land=stiftung.get('land')
    name=stiftung.get('Stiftungsname') or (sdna_full or {}).get('stiftung_name')
    sitz=stiftung.get('sitz')
    if land in ('CH','DE','AT'): scope.add(land)
    for f in GEO_FIELDS_FOR_MODIFIKATOREN:
        if stiftung.get(f) is True:
            flags.append(f)
            if f=='geo_oesterreich': scope.add('AT')
            elif f=='geo_dach_region': scope.update(['CH','DE','AT'])
            elif f=='geo_international': scope.add('INTL')
            else: scope.add('CH')
    if not scope: scope.add('CH')
    _foerder=(sdna_full or {}).get('foerderpraxis') or {}
    _schaerfe=(sdna_full or {}).get('schaerfe_prozent')
    _excl=(sdna_full or {}).get('exclusion_tags') or []
    _sound=((sdna_full or {}).get('sound_feeling') or '')[:400]
    return {'type':'stiftungs_geo_scope','stiftung_id':stiftung.get('id'),
            'name':name,'sitz':sitz,
            'land':stiftung.get('land'),'geo_scope':sorted(scope),'geo_flags':flags,
            'foerderpraxis':_foerder,
            'schaerfe_prozent':_schaerfe,
            'exclusion_tags_summary':[(e.get('tag_slug') or e.get('tag')) for e in _excl if isinstance(e,dict)],
            'sound_feeling':_sound}


_PREIS_RE = re.compile(r'preis|kulturpreis|stipend|werkbeitrag|auszeichnung', re.I)


def _parse_betrag_grenzen(foerdersummen_range):
    """(min, max) CHF-Betrag aus einem Freitext-Range wie "CHF 2'000-165'000"
    oder "CHF 10.000". (None, None) wenn nicht parsebar."""
    if not foerdersummen_range or not isinstance(foerdersummen_range, str):
        return None, None
    werte = []
    for n in re.findall(r"\d[\d'.,’\s]*\d|\d", foerdersummen_range):
        n2 = re.sub(r"[^\d]", "", n)
        if n2:
            werte.append(int(n2))
    if not werte:
        return None, None
    return min(werte), max(werte)


def waehle_zu_bewertende(candidates, existing_match_ids, top_n):
    """Welche Kandidaten in diesem Lauf bewertet werden.

    Top-N nach Math-Score PLUS jede Stiftung, die fuer dieses Medium schon eine
    match_results-Zeile hat. Ohne den zweiten Teil altern Zeilen unbegrenzt: sie
    stehen in der UPSERT-Map, werden aber nie angefasst, weil die Stiftung nicht
    mehr unter die Top-N kommt. Genau so trug Migros-Kulturprozent bei cueltuer
    am 27.07.2026 noch einen Rechenstand vom 8. Juli und rankte damit auf Platz 8
    (Befund 2026-07-27: 1038 von 3145 Zeilen aelter als der jeweils letzte Lauf).

    `candidates` muss bereits nach math_score absteigend sortiert sein.
    Rueckgabe: (zu_bewerten, nachzuegler) - nachzuegler nur fuer die Protokollzeile.
    """
    top = candidates[:top_n]
    top_ids = {c["stiftung"].get("id") for c in top}
    nachzuegler = [c for c in candidates[top_n:]
                   if c["stiftung"].get("id") in existing_match_ids
                   and c["stiftung"].get("id") not in top_ids]
    return top + nachzuegler, nachzuegler


def _institutionalitaets_modifikator(stiftung, sdna_full=None):
    """Deterministisches Score-Delta aus HARTEN Feldern (nicht aus LLM-Prosa):
    schuetzt belegbare institutionelle Geldgeber vor halluzinierten Namensprofilen
    (Kalibrierung 2026-07-24 — Ursache: kleine Preis-/Namensstiftungen mit erfundener
    'institutioneller' DNA rankten vor echten Grossfoerderern wie Migros-Kulturprozent).
    Rueckgabe: (delta:int in [-25,+10], info:dict). Bewusst konservativ."""
    delta = 0
    gruende = []
    ist_foerder = stiftung.get('ist_foerderstiftung')
    fs = stiftung.get('foerdersummen_range')
    kat = stiftung.get('kategorie') or ''
    name = stiftung.get('Stiftungsname') or ''
    lo, hi = _parse_betrag_grenzen(fs)

    if ist_foerder is False:  # Nicht-Foerderer (Sicherheitsnetz; W1.6 filtert i.d.R. schon)
        delta -= 20
        gruende.append('kein_foerderer')

    if _PREIS_RE.search(name) or _PREIS_RE.search(kat):  # Preis/Stipendium = Einzelpersonen, keine Org-Foerderung
        delta -= 12
        gruende.append('preis_stipendium')
    elif lo is not None and hi is not None and lo == hi and hi > 0:  # fixe Dotation = Preis, keine Projektspanne
        delta -= 10
        gruende.append('fixe_dotation')

    if not fs:  # kein Betrags-Beleg -> evidenzarmes Profil (faengt halluzinierte stammdaten-DNA)
        delta -= 8
        gruende.append('kein_betrag_beleg')
    elif hi is not None and hi >= 30000 and ist_foerder is not False:  # belegter, relevanter Spielraum -> echter Grossfoerderer
        delta += 8
        gruende.append('belegter_grossfoerderer')

    delta = max(-25, min(10, delta))
    return delta, {'type': 'institutionalitaet', 'delta': delta, 'gruende': gruende,
                   'foerdersummen_range': fs, 'ist_foerderstiftung': ist_foerder,
                   'betrag_min': lo, 'betrag_max': hi}


def directus_patch(endpoint, body, max_retries=4):
    """Directus PATCH mit gleicher Retry-Logik wie directus_post."""
    import time
    headers = {**_headers(), "Content-Type": "application/json"}
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.patch(f"{DIRECTUS_URL}{endpoint}", headers=headers, json=body, timeout=60)
            if resp.status_code in (502, 503, 504, 429):
                last_err = f"HTTP {resp.status_code}"
                if attempt < max_retries:
                    time.sleep(2 * attempt)
                    continue
            resp.raise_for_status()
            return resp.json()
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            last_err = f"{type(e).__name__}: {str(e)[:150]}"
            if attempt < max_retries:
                time.sleep(2 * attempt)
                continue
            raise
    raise RuntimeError(f"directus_patch {endpoint} nach {max_retries} Versuchen fehlgeschlagen: {last_err}")


def directus_delete_match_results(ids):
    """Batch-DELETE von match_results-Zeilen (Body = Liste der Keys)."""
    if not ids:
        return True
    r = requests.delete(f"{DIRECTUS_URL}/items/match_results",
                        json=list(ids), headers=_headers(), timeout=60)
    if r.status_code not in (200, 204):
        raise RuntimeError(f"DELETE match_results HTTP {r.status_code}: {r.text[:200]}")
    return True


def cleanup_stale_match_results(medium_id, active_version_id, batch=100):
    """Versions-Hygiene: projektfreie match_results des Mediums loeschen, deren
    medium_dna_version_id NICHT der aktiven Version entspricht.

    Ursache der Duplikate (Befund 2026-07-24): der UPSERT in push_match_result ist
    pro (medium, stiftung, dna_version) - Zeilen aelterer Medium-DNA-Versionen
    blieben liegen und erschienen in der App doppelt. Projekt-Zeilen
    (projekt_id gesetzt) sind bewusst ausgenommen.
    """
    res = directus_get("/items/match_results", {
        "filter[medium_id][_eq]": medium_id,
        "filter[medium_dna_version_id][_neq]": active_version_id,
        "filter[projekt_id][_null]": "true",
        "fields": "id",
        "limit": -1,
    })
    ids = [row["id"] for row in (res.get("data") or [])]
    for i in range(0, len(ids), batch):
        directus_delete_match_results(ids[i:i + batch])
    return len(ids)


_DUPLIKAT_IDS_CACHE = None


def load_duplikat_stiftung_ids():
    """IDs aller als Duplikat markierten Stiftungen (`duplicate_of` gesetzt).
    Einmal pro Lauf gelesen und zwischengespeichert."""
    global _DUPLIKAT_IDS_CACHE
    if _DUPLIKAT_IDS_CACHE is None:
        out = _psql_run("SELECT id FROM stiftungen WHERE duplicate_of IS NOT NULL;",
                        timeout=60, remote=True)
        _DUPLIKAT_IDS_CACHE = {int(z.strip()) for z in out.split("\n") if z.strip().isdigit()}
    return _DUPLIKAT_IDS_CACHE


def cleanup_duplikat_match_results(existing_match_ids, duplikat_ids, batch=100):
    """Treffer-Zeilen von als Duplikat markierten Stiftungen entfernen.

    `load_stiftungen` filtert Duplikate (`duplicate_of IS NULL`), damit dieselbe
    Foerderung nicht zweimal als Kandidat auftritt. Bestehende Zeilen solcher
    Stiftungen waren dadurch aber unerreichbar: kein Lauf konnte sie mehr
    anfassen, sie froren mit ihrem alten Score ein. Befund 2026-07-27: der Media
    Forward Fund stand unter der Zweit-ID 46988 in ALLEN fuenf Medien doppelt und
    rankte dort mit eingefrorenen 79 bis 86 jeweils UEBER dem kanonischen
    Eintrag 11991. Dazu zwei Migros-Duplikate.

    Entfernt die Zeilen und nimmt sie aus der UPSERT-Map, damit der Push-Loop
    danach nicht auf eine geloeschte Zeile patcht.
    Rueckgabe: Anzahl entfernter Zeilen.
    """
    treffer = [(sid, rid) for sid, rid in existing_match_ids.items() if sid in duplikat_ids]
    if not treffer:
        return 0
    ids = [rid for _sid, rid in treffer]
    for i in range(0, len(ids), batch):
        directus_delete_match_results(ids[i:i + batch])
    for sid, _rid in treffer:
        existing_match_ids.pop(sid, None)
    return len(ids)


def load_medium_ausschluesse():
    """{medium_id: set(stiftung_ids)} aller aktiven Medium-Ausschluesse aus
    `medium_foerderhistorie` (Design 2026-07-29: das Medium erfasst im Portal,
    welche Stiftungen fuer kuenftige Gesuche nicht mehr in Frage kommen —
    typ 'ausgeschlossen' oder Flag `ausgeschlossen` auf erhalten/abgelehnt).

    Nur Zeilen mit verknuepfter stiftung_id koennen wirken; reiner Freitext-
    Name reicht nicht (Namens-Matching waere zu unscharf). Fehlt die
    Collection (aeltere Umgebung), laeuft der Lauf ohne Ausschluesse weiter.
    """
    try:
        res = directus_get("/items/medium_foerderhistorie", {
            "filter[aktiv][_eq]": "true",
            "filter[stiftung_id][_nnull]": "true",
            "fields": "medium_id,stiftung_id,typ,ausgeschlossen",
            "limit": -1,
        })
    except Exception as e:
        print(f"  WARN: medium_foerderhistorie nicht lesbar ({e}) - Lauf ohne Medium-Ausschluesse", flush=True)
        return {}
    mapping = {}
    for row in (res.get("data") or []):
        if row.get("typ") != "ausgeschlossen" and not row.get("ausgeschlossen"):
            continue
        medium_id = row.get("medium_id")
        sid = row.get("stiftung_id")
        if not medium_id or sid is None:
            continue
        try:
            mapping.setdefault(medium_id, set()).add(int(sid))
        except (TypeError, ValueError):
            continue
    return mapping


def cleanup_ausschluss_match_results(medium_id, ausschluss_ids, existing_match_ids, batch=100):
    """Bestehende match_results des Mediums fuer ausgeschlossene Stiftungen
    loeschen (alle DNA-Versionen, projektfreie Zeilen).

    Ohne diesen Schritt wuerden Alt-Zeilen ausgeschlossener Stiftungen
    einfrieren: der Kandidaten-Skip macht sie fuer den Lauf unerreichbar,
    genau der Mechanismus, der am 27.07.2026 Duplikat-Zeilen mit altem Score
    liegen liess. Entfernte Stiftungen fliegen auch aus der UPSERT-Map, damit
    der Push-Loop nicht auf eine geloeschte Zeile patcht.
    Rueckgabe: Anzahl entfernter Zeilen.
    """
    if not ausschluss_ids:
        return 0
    res = directus_get("/items/match_results", {
        "filter[medium_id][_eq]": medium_id,
        "filter[stiftung_id][_in]": ",".join(str(i) for i in sorted(ausschluss_ids)),
        "filter[projekt_id][_null]": "true",
        "fields": "id",
        "limit": -1,
    })
    ids = [row["id"] for row in (res.get("data") or [])]
    for i in range(0, len(ids), batch):
        directus_delete_match_results(ids[i:i + batch])
    for sid in list(existing_match_ids.keys()):
        try:
            if int(sid) in ausschluss_ids:
                existing_match_ids.pop(sid, None)
        except (TypeError, ValueError):
            continue
    return len(ids)


def load_existing_match_result_ids(medium_id, medium_dna_version_id):
    """Lade Mapping {stiftung_id: row_id} aller existierenden match_results
    fuer (medium_id, medium_dna_version_id). Wird vor dem Push-Loop verwendet,
    um INSERT vs PATCH zu entscheiden (UPSERT statt INSERT-Spam).
    Bei Konflikt (mehrere Rows pro stiftung_id) wird die juengste behalten;
    aeltere bleiben verwaist und werden vom Cleanup-Job entsorgt.
    """
    params = {
        "filter[medium_id][_eq]": medium_id,
        "filter[medium_dna_version_id][_eq]": medium_dna_version_id,
        "fields": "id,stiftung_id,date_created",
        "sort": "-date_created",
        "limit": -1,
    }
    rows = directus_get("/items/match_results", params).get("data", [])
    mapping = {}
    for r in rows:
        sid = r.get("stiftung_id")
        if sid is None or sid in mapping:
            continue
        mapping[sid] = r["id"]
    return mapping



def push_match_result(dna, stiftung, math_score, math_breakdown, embedding_score,
                      llm_score, begruendung,
                      exclusion_triggered, exclusion_info, run_id,
                      dna_verified=False, dna_quality_tier="unknown",
                      sdna_full=None,
                      dry_run=False,
                      existing_match_ids=None):
    combined = combine_scores(math_score, embedding_score, llm_score)
    if exclusion_triggered:
        combined = 0
    # Deterministischer Institutionalitaets-Modifikator (Kalibrierung 2026-07-24):
    # hebt belegte Geldgeber, senkt Preis-/evidenzlose Namensprofile. Nur wenn nicht
    # ohnehin ausgeschlossen und ein positiver Score vorliegt.
    inst_delta, inst_info = _institutionalitaets_modifikator(stiftung, sdna_full)
    if not exclusion_triggered and combined > 0 and inst_delta:
        combined = max(0, min(100, combined + inst_delta))

    breakdown = dict(math_breakdown) if isinstance(math_breakdown, dict) else {}
    breakdown["weights"] = {
        "math": MATH_WEIGHT, "embedding": EMBEDDING_WEIGHT, "llm": LLM_WEIGHT,
    }
    breakdown["components"] = {
        "math": math_score, "embedding": embedding_score, "llm": llm_score,
    }
    if exclusion_triggered:
        breakdown["exclusion_tag"] = exclusion_info

    body = {
        "medium_id": dna["medium_id"],
        "medium_dna_version_id": dna["version_id"],
        "stiftung_id": stiftung.get("id"),
        "score": combined,
        "score_math": math_score,
        "embedding_score": embedding_score,
        "score_llm": llm_score,
        "score_breakdown": breakdown,
        "begruendung": begruendung,
        "modifikatoren": [_stiftungs_geo_modifikator(stiftung, sdna_full), inst_info],
        "exclusion_triggered": exclusion_triggered,
        "funder_updated_at_snapshot": stiftung.get("date_updated"),
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "compute_run_id": run_id,
        "dna_verified": dna_verified,
        "dna_quality_tier": dna_quality_tier,
    }
    if dry_run:
        return body
    sid = stiftung.get("id")
    existing_id = (existing_match_ids or {}).get(sid) if sid is not None else None
    # Score-Threshold: niedrigwertige Matches gar nicht erst in Directus speichern.
    # Exclusion-Triggered (score=0) ebenfalls ueberspringen.
    #
    # ABER: existiert fuer die Stiftung schon eine Zeile, wird sie fortgeschrieben
    # statt uebersprungen. Sonst behaelt sie ihren alten, hoeheren Score fuer immer
    # (Befund 2026-07-27: 1047 solche Zeilen, 73 davon oberhalb der Anzeigeschwelle
    # von 20 und damit im Portal sichtbar - u.a. der Media Forward Fund auf Rang 1
    # bei cueltuer). Ein einmal geschriebener Treffer muss der Wahrheit folgen,
    # auch wenn sie unter die Schwelle faellt. Neue Zeilen entstehen unveraendert
    # erst ab MATCH_MIN_SCORE.
    if combined < MATCH_MIN_SCORE:
        if existing_id is None:
            return {"skipped": True, "reason": f"score {combined} < threshold {MATCH_MIN_SCORE}"}
        return directus_patch(f"/items/match_results/{existing_id}", body)
    if MATCH_MIN_TIER and (dna_quality_tier or "unknown").lower() != MATCH_MIN_TIER:
        if existing_id is None:
            return {"skipped": True, "reason": f"tier {dna_quality_tier} != min_tier {MATCH_MIN_TIER}"}
        return directus_patch(f"/items/match_results/{existing_id}", body)
    # UPSERT: wenn bestehender Eintrag fuer (medium_id, stiftung_id, dna_version) existiert,
    # PATCHEN statt neu INSERTen. Verhindert Duplikat-Spam pro Match-Engine-Lauf.
    if existing_id is not None:
        return directus_patch(f"/items/match_results/{existing_id}", body)
    # v0.5.2 (2026-05-19): UNIQUE-Constraint match_results_unique_per_dna_version greift
    # in der DB. Bei Race-Condition (Map veraltet) wuerde POST mit 400/409/422 abbrechen.
    # Fallback: existierende ID per GET nachladen und PATCHen statt zu crashen.
    try:
        return directus_post("/items/match_results", body)
    except Exception as e:
        emsg = str(e).lower()
        if any(x in emsg for x in ("400", "409", "422", "duplicate key", "unique", "violates unique")):
            try:
                lookup = directus_get("/items/match_results", {
                    "filter[medium_id][_eq]": body["medium_id"],
                    "filter[stiftung_id][_eq]": body["stiftung_id"],
                    "filter[medium_dna_version_id][_eq]": body["medium_dna_version_id"],
                    "fields": "id",
                    "limit": 1,
                })
                rows = lookup.get("data") or []
                if rows:
                    return directus_patch(f"/items/match_results/{rows[0]['id']}", body)
            except Exception as e2:
                raise RuntimeError(
                    f"UPSERT-Fallback fehlgeschlagen fuer stiftung_id={body.get('stiftung_id')} "
                    f"(medium={body.get('medium_id')}, dna={body.get('medium_dna_version_id')}): {e2}"
                )
        raise


def run_match(args):
    print(f"[{datetime.now().isoformat()}] match-engine v0.5.3 (MIN_TIER) startet", flush=True)
    print(f"  LLM-Backend: {LLM_BACKEND} | Modell: {ACTIVE_MODEL}", flush=True)
    print(f"  Gewichte: math={MATH_WEIGHT} embedding={EMBEDDING_WEIGHT} llm={LLM_WEIGHT}", flush=True)
    print(f"  Score-Threshold: MATCH_MIN_SCORE={MATCH_MIN_SCORE} (Matches darunter werden nicht in Directus geschrieben)", flush=True)
    print(f"  Tier-Filter: MATCH_MIN_TIER={MATCH_MIN_TIER!r} (Records mit anderem dna_quality_tier werden nicht geschrieben)", flush=True)
    print(f"  Aktive Komponenten: math=Y embedding={'N' if args.no_embedding else 'Y'} llm={'N' if args.no_llm else 'Y'} | dry_run: {args.dry_run}", flush=True)
    run_id = str(uuid.uuid4())
    print(f"  Run-ID: {run_id}", flush=True)

    dnas = load_active_dna(args.medium)
    print(f"  Aktive DNAs: {len(dnas)}", flush=True)
    if not dnas:
        print("  Keine aktiven DNAs gefunden, Abbruch.", flush=True)
        return 1

    stiftungen = load_stiftungen()
    print(f"  Stiftungen: {len(stiftungen)}", flush=True)

    # Medium-Ausschluesse (Foerderhistorie, Design 2026-07-29): einmal pro Lauf.
    ausschluss_map = load_medium_ausschluesse()
    # Treffer-Rueckmeldungen (aktiv = freigegeben), einmal pro Lauf.
    rueckmeldungs_map = load_match_rueckmeldungen()
    if rueckmeldungs_map:
        print(f"  Treffer-Rueckmeldungen (aktiv): {len(rueckmeldungs_map)} Paar(e)", flush=True)
    if ausschluss_map:
        print(f"  Medium-Ausschluesse: " +
              ", ".join(f"{m}={len(s)}" for m, s in sorted(ausschluss_map.items())), flush=True)

    # v0.5.1 (2026-05-19): Stiftungs-DNA-Map IMMER laden, weil compute_math_score
    # sie auch ohne LLM braucht (DNA-vs-DNA-Math). Vorher war der Load an
    # `not args.no_llm` gekoppelt, was bei `--no-llm`-Laeufen den DNA-Math
    # umging und alle Stiftungen in den Boolean-Fallback zwang.
    try:
        sdna_map = load_active_stiftungs_dna_map()
        sdna_full_map = load_active_stiftungs_dna_full()
        print(f"  Aktive stiftungs_dna-Versionen: {len(sdna_map)} (full: {len(sdna_full_map)})", flush=True)
    except Exception as e:
        print(f"  WARN: stiftungs_dna-Map-Load fehlgeschlagen: {e} - DNA-Math + LLM-Cache deaktiviert", flush=True)
        sdna_map = {}
        sdna_full_map = {}

    total_pushed = 0
    consecutive_fails = 0
    for dna in dnas:
        medium = dna["medium_id"]
        print(f"\n  Medium: {medium} (DNA v{dna.get('version')}, version_id {dna.get('version_id')})", flush=True)

        # Embedding-Similarity-Map fuer dieses Medium aus Qdrant holen
        embedding_sim_map = {}
        if not args.no_embedding:
            embedding_sim_map = query_stiftung_similarities(dna.get("id"), top_k=5000)
            if embedding_sim_map:
                print(f"    Embedding-Similarities geladen: {len(embedding_sim_map)} Stiftungen", flush=True)
            else:
                print(f"    Embedding-Similarities: leer (Medium-Vektor fehlt oder Qdrant down)", flush=True)

        # UPSERT-Map ZUERST laden (vor dem Kandidatenaufbau): sie sagt, welche
        # Stiftungen fuer dieses Medium bereits eine Zeile haben. Diese Zeilen werden
        # in JEDEM Lauf mitbewertet, auch wenn die Stiftung nicht mehr unter die
        # Top-N kommt oder ihr Math-Score auf 0 gefallen ist. Sonst altern sie
        # unbegrenzt: Migros-Kulturprozent trug bei cueltuer am 27.07. noch einen
        # Stand vom 8. Juli und rankte damit auf Platz 8 mit einem Wert, den die
        # heutige Engine nie berechnet hat (Befund 2026-07-27).
        try:
            existing_match_ids = load_existing_match_result_ids(dna["medium_id"], dna["version_id"])
            print(f"    UPSERT-Map: {len(existing_match_ids)} bestehende match_results fuer Update vorgesehen", flush=True)
        except Exception as e:
            print(f"    WARN: existing match_results konnten nicht geladen werden ({e}); falle auf INSERT-only zurueck", flush=True)
            existing_match_ids = {}

        # Duplikat-Hygiene: Zeilen als Duplikat markierter Stiftungen entfernen.
        # Sie sind nie Kandidaten und wuerden sonst mit altem Score einfrieren.
        try:
            n_dup = cleanup_duplikat_match_results(existing_match_ids, load_duplikat_stiftung_ids())
            if n_dup:
                print(f"    Duplikat-Hygiene: {n_dup} Treffer-Zeile(n) als Duplikat markierter Stiftungen entfernt", flush=True)
        except Exception as e:
            print(f"    WARN: Duplikat-Hygiene uebersprungen ({e})", flush=True)

        # Ausschluss-Hygiene: das Medium hat diese Stiftungen im Portal
        # ausgeschlossen — bestehende Zeilen weg, damit nichts einfriert.
        medium_ausschluesse = ausschluss_map.get(medium, set())
        if medium_ausschluesse:
            try:
                n_aus = cleanup_ausschluss_match_results(medium, medium_ausschluesse, existing_match_ids)
                print(f"    Medium-Ausschluesse: {len(medium_ausschluesse)} Stiftung(en) uebersprungen, "
                      f"{n_aus} bestehende Treffer-Zeile(n) entfernt", flush=True)
            except Exception as e:
                print(f"    WARN: Ausschluss-Hygiene uebersprungen ({e})", flush=True)

        candidates = []
        for stiftung in stiftungen:
            # Vom Medium ausgeschlossene Stiftung: nie Kandidat, keine Zeile,
            # kein LLM-Budget (Design 2026-07-29).
            try:
                if stiftung.get("id") is not None and int(stiftung.get("id")) in medium_ausschluesse:
                    continue
            except (TypeError, ValueError):
                pass

            excluded, ex_info = check_exclusion(dna, stiftung)
            if excluded:
                candidates.append({
                    "stiftung": stiftung,
                    "math_score": 0,
                    "math_breakdown": {},
                    "exclusion_triggered": True,
                    "exclusion_info": ex_info,
                })
                continue

            _sid_pre = stiftung.get("id")
            math_score, math_breakdown = compute_math_score(
                dna, stiftung,
                sdna_full=sdna_full_map.get(_sid_pre) if isinstance(sdna_full_map, dict) else None,
            )
            # Math-Score 0 = normalerweise kein Kandidat. Existiert fuer die Stiftung
            # aber schon eine Zeile, wird sie trotzdem bewertet und ehrlich
            # fortgeschrieben, statt mit einem alten Wert liegenzubleiben.
            if math_score <= 0 and _sid_pre not in existing_match_ids:
                continue

            # DNA-Klassifikator aus sdna_map fuer DNA-Quality-Tier in match_results
            _sid = stiftung.get("id")
            _entry = sdna_map.get(_sid) if isinstance(sdna_map, dict) else None
            _sdna_klass_for_c = _entry["klassifiziert_by"] if _entry else ""
            candidates.append({
                "stiftung": stiftung,
                "math_score": math_score,
                "math_breakdown": math_breakdown,
                "exclusion_triggered": False,
                "exclusion_info": None,
                "stiftung_dna_klassifiziert_by": _sdna_klass_for_c,
            })

        candidates.sort(key=lambda c: c["math_score"], reverse=True)
        top, nachzuegler = waehle_zu_bewertende(candidates, existing_match_ids, TOP_N_PER_MEDIUM)
        non_exclusions = [c for c in top if not c["exclusion_triggered"]]
        print(f"    Kandidaten gesamt: {len(candidates)}, Top-{TOP_N_PER_MEDIUM}: {len(top) - len(nachzuegler)} "
              f"+ {len(nachzuegler)} bestehende Zeilen ausserhalb der Top-N = {len(top)} zu bewerten "
              f"(non-excluded: {len(non_exclusions)})", flush=True)

        # (Die UPSERT-Map wurde oben, vor dem Kandidatenaufbau, geladen: pro Push wird
        # per stiftung_id geprueft -> bestehender Eintrag wird via PATCH aktualisiert
        # statt ein zweiter INSERT zu erzeugen. Verhindert Duplikate.)

        cache_hits = 0
        llm_calls = 0
        llm_fails = 0
        for idx, c in enumerate(top, 1):
            if c["exclusion_triggered"]:
                llm_score, begruendung = None, None
            elif args.no_llm:
                llm_score, begruendung = None, None
            else:
                sid = c["stiftung"].get("id")
                _entry = sdna_map.get(sid)
                sdna_v = _entry["version_id"] if _entry else None
                _sdna_klass = _entry["klassifiziert_by"] if _entry else ""
                _rm = rueckmeldungs_map.get((medium, int(sid))) if sid is not None else None
                llm_score, begruendung, source = compute_llm_score(
                    dna, c["stiftung"], c["math_score"], sdna_v,
                    sdna_full=sdna_full_map.get(sid),
                    use_cache=not args.no_cache,
                    rueckmeldungen=_rm,
                )
                if source == "cache":
                    cache_hits += 1
                    consecutive_fails = 0
                elif source == "llm":
                    llm_calls += 1
                    consecutive_fails = 0
                else:
                    llm_fails += 1
                    consecutive_fails += 1
                    if consecutive_fails >= 100:
                        print(f"    ABBRUCH: 100x in Folge LLM-Fail. Pruefe Ollama.", flush=True)
                        return 2
                if idx % 25 == 0:
                    print(f"    [{idx}/{len(top)}] cache_hits={cache_hits} llm_calls={llm_calls} llm_fails={llm_fails}",
                          flush=True)

            sid = c["stiftung"].get("id")
            embedding_score = embedding_sim_map.get(int(sid)) if sid is not None else None
            try:
                # DNA-Qualitaets-Tier aus aktiver Stiftungs-DNA ableiten
                _stiftung_dna_klass = c.get("stiftung_dna_klassifiziert_by") or c["stiftung"].get("_stiftung_dna_klassifiziert_by")
                _dna_verified, _dna_quality_tier = _classify_dna_tier(_stiftung_dna_klass)
                push_match_result(
                    dna, c["stiftung"], c["math_score"], c["math_breakdown"],
                    embedding_score, llm_score, begruendung,
                    c["exclusion_triggered"], c["exclusion_info"],
                    run_id,
                    dna_verified=_dna_verified,
                    dna_quality_tier=_dna_quality_tier,
                    sdna_full=sdna_full_map.get(sid),
                    dry_run=args.dry_run,
                    existing_match_ids=existing_match_ids,
                )
                total_pushed += 1
            except Exception as e:
                sid = c["stiftung"].get("id")
                print(f"    Push-Fehler fuer stiftung_id={sid}: {e}", flush=True)

        print(f"    Medium {medium} fertig: cache_hits={cache_hits} llm_calls={llm_calls} llm_fails={llm_fails}",
              flush=True)

        # Versions-Hygiene: Zeilen alter Medium-DNA-Versionen raeumen (Duplikat-Ursache).
        if not args.dry_run:
            try:
                n_stale = cleanup_stale_match_results(medium, dna["version_id"])
                if n_stale:
                    print(f"    Versions-Hygiene: {n_stale} stale match_results geloescht "
                          f"(nicht Version {dna['version_id']})", flush=True)
            except Exception as e:
                print(f"    WARN Versions-Hygiene fehlgeschlagen: {e}", flush=True)

    print(f"\n[{datetime.now().isoformat()}] Lauf abgeschlossen. Run-ID: {run_id} | "
          f"Pushed: {total_pushed}{' (DRY-RUN)' if args.dry_run else ''}", flush=True)
    return 0


def main():
    parser = argparse.ArgumentParser(description="Match-Engine v0.3 (Math + Embedding + LLM)")
    parser.add_argument("--medium", help="Nur ein bestimmtes Medium (z.B. wepublish)")
    parser.add_argument("--dry-run", action="store_true", help="Keine Push-Operationen, nur Logs")
    parser.add_argument("--no-llm", action="store_true",
                        help="LLM-Score skippen (nur Math+Embedding) - fuer Diagnose")
    parser.add_argument("--no-embedding", action="store_true",
                        help="Embedding-Score skippen (nur Math+LLM) - fuer Diagnose")
    parser.add_argument("--no-cache", action="store_true",
                        help="Cache umgehen (immer frisch rechnen) - fuer Re-Eval")
    args = parser.parse_args()
    sys.exit(run_match(args))


if __name__ == "__main__":
    main()
