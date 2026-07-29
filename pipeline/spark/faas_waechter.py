#!/usr/bin/env python3
"""
FaaS-Wächter — proaktiver Puls für den FaaS-Assistenten.

Zweck: Liest den Gesamtzustand aus Directus, difft gegen die bereits erzeugten
       Vorschläge, wendet ein Relevanz-Gate an und legt NEUE Befunde als
       agent_vorschlaege an. Vier Felder: Fristen, Match-Vorschläge,
       Entwurfs-Anstoss, Pipeline-Hygiene. Die App rendert die Vorschläge als
       Aktions-Inbox; Jolanda/Ramona geben frei, passen an oder verneinen.

Prinzip: deterministische Erkennung, KEIN LLM (souverän, robust, null GPU).
         Die Begründung der Match-Vorschläge stammt aus match_results.begruendung,
         die der Match-Engine-Lauf (qwen, lokal) bereits erzeugt hat.

Haltung: proaktiv-vorschlagend. Schreibt NUR nach agent_vorschlaege. Keine
         Aussenwirkung (kein Versand/Geld/Öffentlich), kein Eingriff in
         DNA-/Pool-Läufe, keine GPU.

Modi:
  --dry-run  (Default) liest + rechnet + zeigt, schreibt NICHTS.
  --apply    legt neue Vorschläge in Directus an.

Crontab-Beispiel (Puls 10-15 Min; NICHT während GPU-DNA-Läufen nötig, da kein LLM):
  */12 * * * * /home/dergeraet/.venv/bin/python3 /home/dergeraet/faas-matching-wepublish/spark/faas_waechter.py --apply >> /home/dergeraet/faas_classify/waechter.log 2>&1

Env-Quelle: ~/.hermes/.env  (DIRECTUS_URL, DIRECTUS_TOKEN)
Relevanz-Schwellen (per Env überschreibbar):
  WAECHTER_STRONG_SCORE   (60)   ab welchem Score ein Match "stark" ist
  WAECHTER_MATCH_TOP_N    (5)    max. neue Match-Vorschläge pro Medium pro Lauf
  WAECHTER_STALE_TAGE     (10)   Antrag-Stillstand für Entwurfs-Anstoss
  WAECHTER_DNA_ALT_TAGE   (30)   DNA-Alter für Hygiene-Hinweis
  Fristfenster fest: 14 / 7 / 2 Tage.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("waechter")


# ─── Env ────────────────────────────────────────────────────────────────────

def _lade_env() -> None:
    """Lädt ~/.hermes/.env in os.environ. Die Datei ist autoritativ (override),
    sonst gewinnt eine evtl. eingeschränkte DIRECTUS_TOKEN-Variable der Shell."""
    pfad = Path.home() / ".hermes" / ".env"
    if not pfad.exists():
        return
    for zeile in pfad.read_text().splitlines():
        zeile = zeile.strip()
        if not zeile or zeile.startswith("#") or "=" not in zeile:
            continue
        k, v = zeile.split("=", 1)
        k = k.strip()
        # DIRECTUS_URL aus .env zeigt auf die öffentliche Cloudflare-URL (Access
        # davor -> 403). Der Wächter läuft Spark-lokal und nutzt localhost.
        if k == "DIRECTUS_URL":
            continue
        os.environ[k] = v.strip().strip('"')


_lade_env()

DIRECTUS_URL = os.environ.get("WAECHTER_DIRECTUS_URL", "http://localhost:8055").rstrip("/")
DIRECTUS_TOKEN = os.environ.get("DIRECTUS_TOKEN", "")
TIMEOUT = 30

STRONG_SCORE = int(os.environ.get("WAECHTER_STRONG_SCORE", "60"))
MATCH_TOP_N = int(os.environ.get("WAECHTER_MATCH_TOP_N", "5"))
STALE_TAGE = int(os.environ.get("WAECHTER_STALE_TAGE", "10"))
DNA_ALT_TAGE = int(os.environ.get("WAECHTER_DNA_ALT_TAGE", "30"))
STAU_SCHWELLE = int(os.environ.get("WAECHTER_STAU_SCHWELLE", "20"))
GOLD_ENTWURF_TAGE = int(os.environ.get("WAECHTER_GOLD_ENTWURF_TAGE", "3"))
GOLD_ENTWURF_MIN = int(os.environ.get("WAECHTER_GOLD_ENTWURF_MIN", "3"))
FRIST_FENSTER = [14, 7, 2]
# Mandant: dieser Wächter verarbeitet NUR Clients dieses Mandanten (Trennung
# wepublish | winkelried). Default wepublish; der Winkelried-Lauf setzt WAECHTER_MANDANT=winkelried.
MANDANT = os.environ.get("WAECHTER_MANDANT", "wepublish")


# ─── Directus ───────────────────────────────────────────────────────────────

def _req(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    url = f"{DIRECTUS_URL}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method=method,
    )
    with urllib.request.urlopen(r, timeout=TIMEOUT) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw.strip() else None


def _get(path: str) -> list[dict[str, Any]]:
    res = _req("GET", path)
    if isinstance(res, dict):
        d = res.get("data", [])
        return d if isinstance(d, list) else [d]
    return []


# ─── Datumshilfen ───────────────────────────────────────────────────────────

def _heute() -> date:
    return datetime.now(timezone.utc).date()


def _als_date(wert: str | None) -> date | None:
    if not wert:
        return None
    try:
        return datetime.fromisoformat(wert.replace("Z", "+00:00")).date()
    except (ValueError, AttributeError):
        try:
            return datetime.strptime(wert[:10], "%Y-%m-%d").date()
        except ValueError:
            return None


def _tage_bis(wert: str | None) -> int | None:
    d = _als_date(wert)
    return (d - _heute()).days if d else None


def _tage_seit(wert: str | None) -> int | None:
    d = _als_date(wert)
    return (_heute() - d).days if d else None


def _fenster_fuer(tage: int) -> int | None:
    """Engstes Fristfenster, in dem die Tage liegen (14/7/2), sonst None."""
    for f in sorted(FRIST_FENSTER):  # 2, 7, 14
        if tage <= f:
            return f
    return None


def _prio_aus_tagen(tage: int) -> str:
    if tage <= 2:
        return "hoch"
    if tage <= 7:
        return "mittel"
    return "tief"


# ─── Dedup ──────────────────────────────────────────────────────────────────

def lade_dedup_keys() -> set[str]:
    """Dedup-Keys aller bestehenden Vorschläge (jeder Status), aus dem
    gespeicherten Feld dedup_key.

    Einmal verneinte/erledigte Vorschläge bleiben unterdrückt (Lern-Loop-Saat).
    Fristen tragen das Fenster im Key -> ein engeres Fenster (14->7->2) pingt neu.
    """
    keys: set[str] = set()
    for v in _get("/items/agent_vorschlaege?limit=-1&fields=dedup_key"):
        k = v.get("dedup_key")
        if k:
            keys.add(k)
    return keys


def lade_outbox_dedup_keys() -> set[str]:
    """Dedup-Keys aller bestehenden Outbox-Zeilen (jeder Status). Einmal
    verworfen bleibt verworfen, einmal versendet wird nicht neu entworfen."""
    keys: set[str] = set()
    for v in _get("/items/agent_outbox?limit=-1&fields=dedup_key"):
        k = v.get("dedup_key")
        if k:
            keys.add(k)
    return keys


def sammle_outbox_entwuerfe(aktive_media: list[dict], applications: list[dict],
                            dedup: set[str]) -> list[dict]:
    """Deterministische Slack-Entwürfe (Phase 1, Haiku-Feinschliff folgt in Phase 4):
    Nachfassen bei eingereichten, stillen Anträgen plus Datensuppe-Erinnerung,
    wenn einem Medium die aktive DNA fehlt. Nur für Medien MIT slack_channel."""
    entwuerfe: list[dict] = []
    medien = {m.get("slug"): m for m in aktive_media}

    for a in applications:
        if (a.get("status") or "") != "eingereicht":
            continue
        tage = _tage_seit(a.get("date_updated"))
        if tage is None or tage < STALE_TAGE:
            continue
        kanal = (medien.get(a.get("medium_id") or "") or {}).get("slack_channel")
        if not kanal:
            continue
        key = f"outbox|nachfass|{a.get('id')}"
        if key in dedup:
            continue
        dedup.add(key)
        name = a.get("stiftung_name") or f"Stiftung {a.get('stiftung_id')}"
        entwuerfe.append({
            "typ": "slack", "anlass": "nachfassen", "status": "entwurf",
            "medium_id": a.get("medium_id"), "application_id": str(a.get("id")),
            "stiftung_id": a.get("stiftung_id"), "empfaenger": kanal,
            "inhalt": (f"Kurzes Nachfassen zu eurem Gesuch bei {name}: eingereicht, "
                       f"seit {tage} Tagen ohne neuen Stand. Habt ihr etwas von der "
                       f"Stiftung gehört? Wenn ihr von uns etwas braucht (Zahlen, "
                       f"Textbausteine, Beilagen), meldet euch kurz. Der Gerät, FaaS"),
            "erstellt_von": "waechter", "dedup_key": key, "mandant": MANDANT,
        })

    for m in aktive_media:
        slug, kanal = m.get("slug"), m.get("slack_channel")
        if not slug or not kanal or m.get("directus_aktive_dna_version_id"):
            continue
        key = f"outbox|datensuppe|{slug}"
        if key in dedup:
            continue
        dedup.add(key)
        entwuerfe.append({
            "typ": "slack", "anlass": "datensuppe_erinnerung", "status": "entwurf",
            "medium_id": slug, "application_id": None, "stiftung_id": None,
            "empfaenger": kanal,
            # Text am 29.07.2026 umgestellt: der Drive-Ordner 01_datensuppe ist
            # keine Quelle mehr, die Medien liefern ihre Unterlagen im Portal
            # ein. Der anlass-Schlüssel bleibt "datensuppe_erinnerung", damit
            # bestehende dedup_keys und Outbox-Zeilen weiter greifen.
            "inhalt": ("Erinnerung aus dem FaaS: eure DNA ist noch nicht aktiv. "
                       "Im Portal unter «Unterlagen» könnt ihr Dokumente und Links "
                       "hochladen (Leitbild, Jahresbericht, frühere Gesuche, "
                       "Beispielartikel) und die drei Fragen beantworten. Je mehr "
                       "dort liegt, desto schärfer wird eure DNA und desto besser "
                       "die Stiftungs-Treffer. Der Gerät, FaaS"),
            "erstellt_von": "waechter", "dedup_key": key, "mandant": MANDANT,
        })
    return entwuerfe


# ─── Befund-Sammler (je Feld) ─────────────────────────────────────────────────

def _stiftung_namen(ids: list) -> dict[str, str]:
    """Stiftungsnamen für eine Liste von IDs (ein Batch-Query)."""
    ids = [str(i) for i in ids if i is not None]
    if not ids:
        return {}
    csv = ",".join(ids)
    rows = _get(f"/items/stiftungen?limit=-1&filter[id][_in]={csv}&fields=id,Stiftungsname")
    return {str(r.get("id")): r.get("Stiftungsname") for r in rows if r.get("Stiftungsname")}


def _offene_match_zahl(slug: str) -> int:
    """Anzahl bereits OFFENER Match-Vorschläge für ein Medium."""
    res = _req(
        "GET",
        f"/items/agent_vorschlaege?aggregate[count]=*"
        f"&filter[typ][_eq]=match&filter[status][_eq]=offen&filter[medium_id][_eq]={slug}",
    )
    try:
        return int(res["data"][0]["count"])
    except (KeyError, IndexError, TypeError, ValueError):
        return 0


def sammle_match_vorschlaege(aktive_media: list[dict], dedup: set[str]) -> list[dict]:
    befunde: list[dict] = []
    for m in aktive_media:
        slug = m.get("slug")
        if not slug:
            continue
        # Inbox-Budget: höchstens MATCH_TOP_N OFFENE Match-Vorschläge pro Medium.
        # Refill erst, wenn Jolanda/Ramona welche entscheidet (offen sinkt).
        budget = MATCH_TOP_N - _offene_match_zahl(slug)
        if budget <= 0:
            continue
        rows = _get(
            f"/items/match_results?limit={MATCH_TOP_N * 6}"
            f"&filter[medium_id][_eq]={slug}&filter[score][_gte]={STRONG_SCORE}"
            f"&sort=-score&fields=id,medium_id,stiftung_id,score,begruendung"
        )
        genommen = 0
        for r in rows:
            if genommen >= budget:
                break
            key = f"match|{slug}|{r.get('stiftung_id')}"
            if key in dedup:
                continue
            dedup.add(key)
            score = r.get("score")
            befunde.append({
                "typ": "match",
                "status": "offen",
                "prioritaet": "mittel" if (score or 0) < 75 else "hoch",
                "medium_id": slug,
                "stiftung_id": str(r.get("stiftung_id")),
                "stiftung_name": None,
                "titel": "",  # im Enrich-Pass gesetzt (braucht den Namen)
                "beschreibung": "Shortlist-Kandidat aus der Match-Engine. Bei Freigabe als Antrag übernehmen.",
                "begruendung": (r.get("begruendung") or "")[:1500],
                "quelle_modell": "match-engine",
                "dedup_key": key,
                "_score": score,
            })
            genommen += 1
    # Namen in einem Batch nachtragen (für den Antrag bei Freigabe) + Titel bauen.
    namen = _stiftung_namen([b["stiftung_id"] for b in befunde])
    for b in befunde:
        name = namen.get(str(b["stiftung_id"]))
        b["stiftung_name"] = name
        score = b.pop("_score", None)
        ziel = name or f"Stiftung {b['stiftung_id']}"
        b["titel"] = f"Starker Match (Score {score}): {ziel} für {b['medium_id']}"
    return befunde


def sammle_fristen_ausschreibungen(dedup: set[str]) -> list[dict]:
    befunde: list[dict] = []
    rows = _get("/items/ausschreibungen?limit=-1&fields=id,titel,deadline,status,url")
    for r in rows:
        if (r.get("status") or "") in ("archiviert", "abgelaufen", "verworfen", "scout_unbestaetigt"):
            continue
        tage = _tage_bis(r.get("deadline"))
        if tage is None or tage < 0:
            continue
        fenster = _fenster_fuer(tage)
        if fenster is None:
            continue
        key = f"frist|{MANDANT}|aussch|{r.get('id')}|{fenster}"
        if key in dedup:
            continue
        dedup.add(key)
        befunde.append({
            "typ": "frist",
            "status": "offen",
            "prioritaet": _prio_aus_tagen(tage),
            "medium_id": "",
            "stiftung_id": None,
            "titel": f"Ausschreibungs-Frist in {tage} Tagen: {(r.get('titel') or '')[:80]}",
            "beschreibung": f"Deadline {(_als_date(r.get('deadline')) or '')}. Prüfen, ob ein Medium passt und einreichen will.",
            "begruendung": f"Frist im {fenster}-Tage-Fenster (ausschreibungen.deadline).",
            "artefakt_link": r.get("url") or None,
            "quelle_modell": "waechter",
            "dedup_key": key,
        })
    return befunde


def sammle_fristen_applications(applications: list[dict], dedup: set[str]) -> list[dict]:
    befunde: list[dict] = []
    for a in applications:
        if (a.get("status") or "") in ("zugesagt", "abgelehnt", "archiviert", "ausgeblendet"):
            continue
        tage = _tage_bis(a.get("frist"))
        if tage is None or tage < 0:
            continue
        fenster = _fenster_fuer(tage)
        if fenster is None:
            continue
        key = f"frist|app|{a.get('id')}|{fenster}"
        if key in dedup:
            continue
        dedup.add(key)
        name = a.get("stiftung_name") or a.get("stiftung_id")
        befunde.append({
            "typ": "frist",
            "status": "offen",
            "prioritaet": _prio_aus_tagen(tage),
            "medium_id": a.get("medium_id") or "",
            "stiftung_id": str(a.get("stiftung_id")) if a.get("stiftung_id") is not None else None,
            "stiftung_name": a.get("stiftung_name"),
            "titel": f"Eingabefrist in {tage} Tagen: {name} ({a.get('medium_id')})",
            "beschreibung": "Antrag läuft, Frist naht. Entwurf finalisieren und einreichen.",
            "begruendung": f"Frist im {fenster}-Tage-Fenster (applications.frist).",
            "artefakt_link": a.get("drive_link") or None,
            "quelle_modell": "waechter",
            "dedup_key": key,
        })
    return befunde


def sammle_entwurfs_anstoss(applications: list[dict], dedup: set[str]) -> list[dict]:
    befunde: list[dict] = []
    for a in applications:
        if (a.get("status") or "") not in ("identifiziert", "in_arbeit"):
            continue
        tage = _tage_seit(a.get("date_updated"))
        if tage is None or tage < STALE_TAGE:
            continue
        key = f"entwurf|{a.get('id')}"
        if key in dedup:
            continue
        dedup.add(key)
        name = a.get("stiftung_name") or a.get("stiftung_id")
        befunde.append({
            "typ": "entwurf",
            "status": "offen",
            "prioritaet": "mittel",
            "medium_id": a.get("medium_id") or "",
            "stiftung_id": str(a.get("stiftung_id")) if a.get("stiftung_id") is not None else None,
            "stiftung_name": a.get("stiftung_name"),
            "titel": f"Entwurf fällig: {name} ({a.get('medium_id')}) liegt seit {tage} Tagen",
            "beschreibung": "Antrag steht seit Längerem still. Gesuch-Entwurf vorbereiten und prüfen.",
            "begruendung": f"Stillstand > {STALE_TAGE} Tage (applications.date_updated, Status {a.get('status')}).",
            "artefakt_link": a.get("drive_link") or None,
            "quelle_modell": "waechter",
            "dedup_key": key,
        })
    return befunde


def _paket_tage(a: dict) -> int | None:
    """Alter des Pakets in Tagen (aus paket.gebaut_am), None wenn kein Stempel."""
    paket = a.get("paket")
    if not isinstance(paket, dict):
        return None
    return _tage_seit(paket.get("gebaut_am"))


def sammle_sichtungs_stau(applications: list[dict], dedup: set[str]) -> list[dict]:
    """EIN Vorschlag pro Woche, wenn zu viele Pakete ungesichtet liegen. Der Stau
    legt sonst still den Builder UND den Digest lahm (Befund 08.07.2026)."""
    ungesichtet = [
        a for a in applications
        if a.get("status") == "identifiziert"
        and a.get("zuletzt_geaendert_quelle") == "paket-builder"
        and not a.get("gesichtet_am")
    ]
    if len(ungesichtet) < STAU_SCHWELLE:
        return []
    woche = _heute().strftime("%G-W%V")
    key = f"stau|{woche}"
    if key in dedup:
        return []
    dedup.add(key)
    return [{
        "typ": "hygiene", "status": "offen", "prioritaet": "hoch",
        "medium_id": "", "stiftung_id": None,
        "titel": f"Sichtungs-Stau: {len(ungesichtet)} Förderpakete ungesichtet",
        "beschreibung": "Der Sichtungs-Stapel läuft über. Solange die Pakete liegen, "
                        "baut der Builder weniger Neues. In der App unter «Sichten» "
                        "im Listenmodus stapelweise übernehmen oder verwerfen.",
        "begruendung": f"{len(ungesichtet)} ungesichtete Paket-Anträge >= Schwelle {STAU_SCHWELLE}.",
        "quelle_modell": "waechter",
        "dedup_key": key,
    }]


def sammle_gold_ohne_entwurf(applications: list[dict], dedup: set[str]) -> list[dict]:
    """EIN Wochen-Vorschlag, wenn mehrere Gold-Pakete seit Tagen ohne Gesuch-Entwurf
    liegen — das Signal, dass der nächtliche Studio-Gesuch-Loop nicht läuft."""
    faellig = []
    for a in applications:
        if a.get("status") != "identifiziert":
            continue
        paket = a.get("paket")
        if not isinstance(paket, dict) or not paket.get("gold"):
            continue
        if paket.get("gesuch_entwurf") or a.get("drive_link"):
            continue
        tage = _paket_tage(a)
        if tage is None or tage < GOLD_ENTWURF_TAGE:
            continue
        faellig.append(a)
    if len(faellig) < GOLD_ENTWURF_MIN:
        return []
    woche = _heute().strftime("%G-W%V")
    key = f"goldentwurf|{woche}"
    if key in dedup:
        return []
    dedup.add(key)
    beispiele = ", ".join(
        str(a.get("stiftung_name") or a.get("stiftung_id")) for a in faellig[:3]
    )
    return [{
        "typ": "hygiene", "status": "offen", "prioritaet": "mittel",
        "medium_id": "", "stiftung_id": None,
        "titel": f"{len(faellig)} Gold-Pakete ohne Gesuch-Entwurf (älter {GOLD_ENTWURF_TAGE} Tage)",
        "beschreibung": "Der nächtliche Gesuch-Loop hat keine Entwürfe geliefert. "
                        "Prüfen, ob der Cowork-Task «faas-gesuch-loop» auf dem Studio "
                        "noch läuft — oder in der App «Entwurf jetzt» drücken. "
                        f"Beispiele: {beispiele}.",
        "begruendung": f"{len(faellig)} identifizierte Gold-Pakete ohne paket.gesuch_entwurf "
                       f"und ohne drive_link, gebaut vor >= {GOLD_ENTWURF_TAGE} Tagen.",
        "quelle_modell": "waechter",
        "dedup_key": key,
    }]


def _hat_matches(slug: str) -> bool:
    rows = _get(f"/items/match_results?limit=1&filter[medium_id][_eq]={slug}&fields=id")
    return len(rows) > 0


def sammle_hygiene(aktive_media: list[dict], dedup: set[str]) -> list[dict]:
    befunde: list[dict] = []
    for m in aktive_media:
        slug = m.get("slug")
        if not slug:
            continue
        # DNA fehlt ganz? (Nur melden, wenn das Medium auch wirklich nicht
        # matcht — ein gesetzter Match beweist eine funktionierende DNA, dann
        # ist nur der Zeiger leer = kein Inbox-würdiger Befund.)
        if not m.get("directus_aktive_dna_version_id"):
            if _hat_matches(slug):
                continue
            key = f"hygiene|{slug}|DNA fehlt"
            if key not in dedup:
                dedup.add(key)
                befunde.append({
                    "typ": "hygiene", "status": "offen", "prioritaet": "mittel",
                    "medium_id": slug, "stiftung_id": None,
                    "titel": f"Medium {slug} hat keine aktive DNA",
                    "beschreibung": "Ohne aktive DNA kann nicht gematcht werden. DNA messen und aktiv schalten.",
                    "begruendung": "faas_medien.directus_aktive_dna_version_id ist leer.",
                    "quelle_modell": "waechter",
                    "dedup_key": key,
                })
            continue
        # DNA veraltet?
        tage = _tage_seit(m.get("arbeits_dna_stand"))
        if tage is not None and tage >= DNA_ALT_TAGE:
            key = f"hygiene|{slug}|DNA alt"
            if key not in dedup:
                dedup.add(key)
                befunde.append({
                    "typ": "hygiene", "status": "offen", "prioritaet": "tief",
                    "medium_id": slug, "stiftung_id": None,
                    "titel": f"Medium-DNA von {slug} ist {tage} Tage alt",
                    "beschreibung": "Empfehlung: DNA auffrischen, damit das Matching aktuell bleibt.",
                    "begruendung": f"arbeits_dna_stand > {DNA_ALT_TAGE} Tage.",
                    "quelle_modell": "waechter",
                    "dedup_key": key,
                })
    return befunde


# ─── Hauptlauf ────────────────────────────────────────────────────────────────

# ─── Lebenszyklus: überholte Vorschläge schliessen ──────────────────────────

WOCHEN_PRAEFIXE = ("stau", "goldentwurf")


def _ueberholte_finden(offen: list[dict]) -> list[tuple[str, str]]:
    """(id, grund) aller offenen Vorschläge, die keine Aussage mehr treffen.

    Zwei Klassen, beide entstehen durch das Anlege-Muster des Wächters selbst:
      1. Wochenmeldungen (`stau|<woche>`, `goldentwurf|<woche>`) werden je Woche
         NEU angelegt, die alte aber nie geschlossen. Am 27.07.2026 lagen
         dadurch vier Sichtungs-Stau-Meldungen (30/56/51/56 Pakete) gleichzeitig
         offen. Nur die jüngste je Präfix bleibt stehen.
      2. Fristmeldungen, deren Termin vorbei ist. Der Wächter legt für
         vergangene Fristen korrekt keine neuen an, schliesst die alten aber
         nicht: JournaFONDS (15.06.) und netidee (07.07.) standen im Juli noch
         je dreifach offen, einmal pro Fenster (14/7/2 Tage).
    """
    zu_schliessen: list[tuple[str, str]] = []

    wochen: dict[str, list[dict]] = {}
    for v in offen:
        praefix = (v.get("dedup_key") or "").split("|")[0]
        if praefix in WOCHEN_PRAEFIXE:
            wochen.setdefault(praefix, []).append(v)
    for praefix, gruppe in wochen.items():
        gruppe.sort(key=lambda v: v.get("ts") or "", reverse=True)
        for v in gruppe[1:]:
            zu_schliessen.append((v["id"], f"durch neuere {praefix}-Wochenmeldung überholt"))

    aussch_ids, app_ids = set(), set()
    for v in offen:
        teile = (v.get("dedup_key") or "").split("|")
        if v.get("typ") != "frist" or len(teile) < 4:
            continue
        if teile[2] == "aussch" and teile[3].isdigit():
            aussch_ids.add(teile[3])
        elif teile[1] == "app" and teile[2].isdigit():
            app_ids.add(teile[2])

    termine: dict[str, date | None] = {}
    if aussch_ids:
        for a in _get(f"/items/ausschreibungen?limit=-1&fields=id,deadline"
                      f"&filter[id][_in]={','.join(sorted(aussch_ids))}"):
            termine[f"aussch:{a['id']}"] = _als_date(a.get("deadline"))
    if app_ids:
        for a in _get(f"/items/applications?limit=-1&fields=id,frist"
                      f"&filter[id][_in]={','.join(sorted(app_ids))}"):
            termine[f"app:{a['id']}"] = _als_date(a.get("frist"))

    heute = _heute()
    for v in offen:
        teile = (v.get("dedup_key") or "").split("|")
        if v.get("typ") != "frist" or len(teile) < 4:
            continue
        schluessel = (f"aussch:{teile[3]}" if teile[2] == "aussch"
                      else f"app:{teile[2]}" if teile[1] == "app" else None)
        termin = termine.get(schluessel) if schluessel else None
        if termin and termin < heute:
            zu_schliessen.append((v["id"], f"Frist am {termin.isoformat()} abgelaufen"))
    return zu_schliessen


def schliesse_ueberholte(apply: bool) -> int:
    offen = _get(f"/items/agent_vorschlaege?limit=-1&filter[status][_eq]=offen"
                 f"&filter[mandant][_eq]={MANDANT}&fields=id,typ,ts,titel,dedup_key")
    zu_schliessen = _ueberholte_finden(offen)
    if not zu_schliessen:
        return 0
    log.info("Überholte Vorschläge: %d", len(zu_schliessen))
    for vid, grund in zu_schliessen[:20]:
        titel = next((v["titel"] for v in offen if v["id"] == vid), vid)
        log.info("  schliessen: %s  (%s)", titel[:60], grund)
    if not apply:
        return 0
    geschlossen = 0
    for vid, _grund in zu_schliessen:
        try:
            _req("PATCH", f"/items/agent_vorschlaege/{vid}", {"status": "abgeloest"})
            geschlossen += 1
        except urllib.error.HTTPError as e:
            log.error("PATCH fehlgeschlagen (%s): %s", vid, e.read().decode()[:200])
    log.info("Geschlossen: %d / %d", geschlossen, len(zu_schliessen))
    return geschlossen


def lauf(apply: bool) -> int:
    if not DIRECTUS_TOKEN:
        log.error("Kein DIRECTUS_TOKEN (Env / ~/.hermes/.env).")
        return 2

    aktive_media = _get(f"/items/faas_medien?limit=-1&filter[is_active][_eq]=true"
                        f"&filter[mandant][_eq]={MANDANT}"
                        f"&fields=slug,name,is_active,directus_aktive_dna_version_id,arbeits_dna_stand,slack_channel")
    applications = _get(f"/items/applications?limit=-1&filter[mandant][_eq]={MANDANT}"
                        f"&fields=id,medium_id,stiftung_id,stiftung_name,status,frist,"
                        f"date_updated,drive_link,gesichtet_am,zuletzt_geaendert_quelle,paket")
    dedup = lade_dedup_keys()
    log.info("Mandant: %s | Aktive Medien: %d | Applications: %d | bestehende Vorschläge (dedup): %d",
             MANDANT, len(aktive_media), len(applications), len(dedup))

    befunde: list[dict] = []
    # Match-Vorschläge macht seit Phase 2 der Paket-Builder, Funktion bleibt als Referenz.
    befunde += sammle_fristen_ausschreibungen(dedup)
    befunde += sammle_fristen_applications(applications, dedup)
    befunde += sammle_entwurfs_anstoss(applications, dedup)
    befunde += sammle_hygiene(aktive_media, dedup)
    befunde += sammle_sichtungs_stau(applications, dedup)
    befunde += sammle_gold_ohne_entwurf(applications, dedup)
    # Mandanten-Stempel auf jeden Vorschlag (Trennung in der Inbox)
    for b in befunde:
        b["mandant"] = MANDANT

    outbox_dedup = lade_outbox_dedup_keys()
    entwuerfe = sammle_outbox_entwuerfe(aktive_media, applications, outbox_dedup)
    log.info("Neue Outbox-Entwürfe: %d", len(entwuerfe))

    nach_typ: dict[str, int] = {}
    for b in befunde:
        nach_typ[b["typ"]] = nach_typ.get(b["typ"], 0) + 1
    log.info("Neue Befunde: %d  %s", len(befunde), nach_typ)

    if not apply:
        for b in befunde[:40]:
            log.info("  [%s/%s] %s", b["typ"], b["prioritaet"], b["titel"])
        if len(befunde) > 40:
            log.info("  ... +%d weitere", len(befunde) - 40)
        for e in entwuerfe:
            log.info("  [outbox/%s] %s -> %s", e["anlass"], e["medium_id"], e["empfaenger"])
        schliesse_ueberholte(False)
        log.info("DRY-RUN: nichts geschrieben. Mit --apply anlegen.")
        return 0

    angelegt = 0
    for b in befunde:
        try:
            _req("POST", "/items/agent_vorschlaege", b)
            angelegt += 1
        except urllib.error.HTTPError as e:
            log.error("POST fehlgeschlagen (%s): %s", b["titel"], e.read().decode()[:200])
    log.info("Angelegt: %d / %d", angelegt, len(befunde))

    for e in entwuerfe:
        try:
            _req("POST", "/items/agent_outbox", e)
        except urllib.error.HTTPError as err:
            log.error("Outbox-POST fehlgeschlagen (%s): %s", e["anlass"], err.read().decode()[:200])

    # Zum Schluss, damit die eben angelegte Wochenmeldung als die jüngste gilt:
    # überholte Vorschläge schliessen, statt sie unbegrenzt offen liegenzulassen.
    schliesse_ueberholte(True)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="FaaS-Wächter: proaktive Vorschläge")
    ap.add_argument("--apply", action="store_true", help="Vorschläge wirklich anlegen (sonst dry-run)")
    args = ap.parse_args()
    return lauf(apply=args.apply)


if __name__ == "__main__":
    sys.exit(main())
