#!/usr/bin/env python3
"""
Paket-Builder -- nächtlicher Cron (03:15, wird im Deploy-Task installiert).

Baut aus starken Match-Ergebnissen vollständige Förderpakete und legt sie als
applications mit ausgefülltem `paket`-Feld an. Pro Medium wird ein Budget
(Env BUILDER_BUDGET) eingehalten: bereits vom Paket-Builder angelegte, noch
nicht gesichtete Anträge zählen gegen das Budget.

Für jedes Paket wird optional ein Slack-Entwurf in agent_outbox vorbereitet
(status=vorbereitet), wenn das Medium einen slack_channel gesetzt hat.

Modi:
  --dry-run   (Default) zeigt geplante Pakete, schreibt NICHTS, startet KEINE Betrag-Jobs.
  --apply     legt applications + outbox-Zeilen an.
  --limit N   maximale Pakete gesamt (für Tests).
  --medium M  nur dieses Medium (Slug).

Env-Konfiguration (mit Defaults):
  BUILDER_STRONG_SCORE  60       ab welchem Match-Score ein Kandidat gilt
  BUILDER_BUDGET        8        max. offene Paket-Builder-Anträge pro Medium
                                 (pro Medium übersteuerbar via faas_medien.paket_budget)
  BUILDER_VERFALL_TAGE  30       ungesichtete Pakete verfallen nach N Tagen
  BUILDER_WIEDERVORLAGE_TAGE 90  verfallene Stiftungen werden nach N Tagen wieder vorschlagbar
  GOLD_BETRAG           20000    Betrag-Schwelle für Gold-Status (CHF)
  GOLD_SCORE            75       Score-Schwelle für Gold-Status (alternativ zum Betrag)
  APP_URL               http://localhost:3009
  WAECHTER_MANDANT      wepublish
  WAECHTER_DIRECTUS_URL http://localhost:8055
  DIRECTUS_TOKEN        (aus ~/.hermes/.env)

Crontab-Beispiel (Cron wird im Deploy-Task installiert):
  15 3 * * * /usr/bin/python3 /home/dergeraet/faas-matching-wepublish/spark/paket_builder.py --apply >> /home/dergeraet/faas_classify/paket_builder.log 2>&1
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ─── Anthropic-Key (FaaS-isoliert aus ~/.hermes-faas/.env) ──────────────────

def _faas_key() -> str:
    """Liest den FaaS-Anthropic-Key ausschliesslich aus ~/.hermes-faas/.env.
    Gibt leeren String zurück, wenn Datei oder Key fehlen."""
    pfad = Path.home() / ".hermes-faas" / ".env"
    if not pfad.exists():
        return ""
    for zeile in pfad.read_text().splitlines():
        zeile = zeile.strip()
        if zeile.startswith("ANTHROPIC_API_KEY") and "=" in zeile:
            return zeile.split("=", 1)[1].strip().strip('"')
    return ""


_ANTHROPIC_KEY: str | None = None  # einmalig geladen, None = noch nicht versucht
_KEY_FEHLER_GEMELDET = False        # einmalig warnen, nicht bei jedem Paket


def _get_anthropic_key() -> str:
    global _ANTHROPIC_KEY, _KEY_FEHLER_GEMELDET
    if _ANTHROPIC_KEY is None:
        _ANTHROPIC_KEY = _faas_key()
        if not _ANTHROPIC_KEY and not _KEY_FEHLER_GEMELDET:
            log.warning(
                "Kein ANTHROPIC_API_KEY in ~/.hermes-faas/.env — "
                "Gesuch-Entwürfe werden übersprungen. "
                "Pakete werden trotzdem gebaut."
            )
            _KEY_FEHLER_GEMELDET = True
    return _ANTHROPIC_KEY

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("paket_builder")


# ─── Env ────────────────────────────────────────────────────────────────────

def _lade_env() -> None:
    """Lädt ~/.hermes/.env in os.environ (DIRECTUS_URL wird überschrieben, da
    die .env auf die öffentliche Cloudflare-URL zeigt -- 403 von localhost)."""
    pfad = Path.home() / ".hermes" / ".env"
    if not pfad.exists():
        return
    for zeile in pfad.read_text().splitlines():
        zeile = zeile.strip()
        if not zeile or zeile.startswith("#") or "=" not in zeile:
            continue
        k, v = zeile.split("=", 1)
        k = k.strip()
        if k == "DIRECTUS_URL":
            continue
        os.environ.setdefault(k, v.strip().strip('"'))


_lade_env()

DIRECTUS_URL = os.environ.get("WAECHTER_DIRECTUS_URL", "http://localhost:8055").rstrip("/")
DIRECTUS_TOKEN = os.environ.get("DIRECTUS_TOKEN", "")
MANDANT = os.environ.get("WAECHTER_MANDANT", "wepublish")
APP_URL = os.environ.get("APP_URL", "http://localhost:3009").rstrip("/")

STRONG_SCORE = int(os.environ.get("BUILDER_STRONG_SCORE", "60"))
BUDGET = int(os.environ.get("BUILDER_BUDGET", "8"))
GOLD_BETRAG = int(os.environ.get("GOLD_BETRAG", "20000"))
GOLD_SCORE = int(os.environ.get("GOLD_SCORE", "75"))
VERFALL_TAGE = int(os.environ.get("BUILDER_VERFALL_TAGE", "30"))
WIEDERVORLAGE_TAGE = int(os.environ.get("BUILDER_WIEDERVORLAGE_TAGE", "90"))
VERFALL_BEMERKUNG = "Paket verfallen (ungesichtet > %d Tage)" % VERFALL_TAGE

TIMEOUT = 30
BETRAG_POLL_INTERVAL = 10   # Sekunden zwischen Poll-Anfragen
BETRAG_POLL_CAP = 480       # Maximal 8 Minuten warten

GESUCH_MODEL = os.environ.get("BUILDER_GESUCH_MODEL", "claude-sonnet-4-6")
GESUCH_SYSTEM = (
    "Du bist Gesuchs-Texter für Schweizer Medien-Fundraising. "
    "Führe die folgenden Anweisungen vollständig aus und liefere NUR den fertigen Gesuchstext, "
    "ohne Vorbemerkungen. Schweizer Orthografie, keine Gedankenstriche, echte Umlaute."
)

# Sonnet-4.6-Raten (USD, ~=CHF): in 3 / out 15 / cache-read 0.30 / cache-write 3.75 pro Mio.
_SONNET_RATES = {"inp": 3.0, "out": 15.0, "cr": 0.30, "cw": 3.75}


# ─── Directus-Helfer ────────────────────────────────────────────────────────

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


def _post(path: str, body: dict) -> dict:
    res = _req("POST", path, body)
    if isinstance(res, dict):
        return res.get("data", res)
    return {}


def _patch(path: str, body: dict) -> dict:
    res = _req("PATCH", path, body)
    if isinstance(res, dict):
        return res.get("data", res)
    return {}


# ─── App-Helfer (Betrag + Gesuch-Prompt) ────────────────────────────────────

def _app_post(path: str, body: dict, timeout: int = TIMEOUT) -> dict:
    r = urllib.request.Request(
        f"{APP_URL}{path}",
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(r, timeout=timeout) as x:
        return json.loads(x.read().decode())


def _app_get(path: str, timeout: int = TIMEOUT) -> dict:
    r = urllib.request.Request(f"{APP_URL}{path}")
    with urllib.request.urlopen(r, timeout=timeout) as x:
        return json.loads(x.read().decode())


def _berechne_betrag(stiftung_id: int, medium_slug: str) -> dict | None:
    """Startet den Betrag-Job und pollt bis zu BETRAG_POLL_CAP Sekunden.
    Gibt {suggested_amount, reasoning} zurück, oder None bei Fehler/Timeout."""
    try:
        start = _app_post(
            "/api/calculate-amount",
            {"stiftung_id": stiftung_id, "medium_id": medium_slug},
        )
    except Exception as e:
        log.warning("Betrag-Route nicht erreichbar: %s", e)
        return None
    job_id = start.get("job_id")
    if not job_id:
        log.warning("Kein job_id beim Betrag-Start: %s", start)
        return None
    gewartet = 0
    while gewartet < BETRAG_POLL_CAP:
        time.sleep(BETRAG_POLL_INTERVAL)
        gewartet += BETRAG_POLL_INTERVAL
        try:
            s = _app_get(f"/api/calculate-amount?job_id={urllib.parse.quote(job_id)}")
        except Exception as e:
            log.warning("Betrag-Poll fehlgeschlagen: %s", e)
            return None
        status = s.get("status")
        if status == "done":
            return s.get("result") or {}
        if status == "error":
            log.warning("Betrag-Job fehlgeschlagen: %s", s.get("error"))
            return None
    log.warning(
        "Betrag-Timeout nach %ds (stiftung_id=%s, medium=%s).",
        BETRAG_POLL_CAP, stiftung_id, medium_slug,
    )
    return None


def _hole_gesuch_prompt(stiftung_id: int, medium_slug: str) -> tuple[str, str]:
    """Gibt (prompt, ablage) zurück. Bei Fehler leer."""
    try:
        d = _app_get(
            f"/api/gesuch-prompt?medium={urllib.parse.quote(medium_slug)}&stiftung_id={stiftung_id}"
        )
    except Exception as e:
        log.warning("Gesuch-Prompt-Route nicht erreichbar: %s", e)
        return "", ""
    if d.get("error"):
        log.warning("Gesuch-Prompt Fehler: %s", d["error"])
        return "", ""
    return d.get("prompt", ""), d.get("ablage", "")


# ─── Sonnet-Gesuchentwurf ───────────────────────────────────────────────────

def _log_usage_builder(usage: dict) -> None:
    """Schreibt Token-/Kosten-Messung eines Gesuch-Entwurfs nach agent_usage (best effort).
    Felder und Raten identisch mit _log_usage im faas_chat_adapter."""
    inp = usage.get("input_tokens", 0) or 0
    out = usage.get("output_tokens", 0) or 0
    cr  = usage.get("cache_read_input_tokens", 0) or 0
    cw  = usage.get("cache_creation_input_tokens", 0) or 0
    if not (inp or out):
        return
    kosten = (inp * _SONNET_RATES["inp"] + out * _SONNET_RATES["out"]
              + cr * _SONNET_RATES["cr"] + cw * _SONNET_RATES["cw"]) / 1_000_000
    if not DIRECTUS_TOKEN:
        return
    try:
        body = json.dumps({
            "ts": datetime.now(timezone.utc).isoformat(),
            "aufgabe": "gesuch_entwurf",
            "quelle": "paket-builder",
            "kontext": "gesuch_entwurf",
            "tier": "sonnet",
            "modell": GESUCH_MODEL,
            "input_tokens": inp,
            "output_tokens": out,
            "cache_read_tokens": cr,
            "cache_write_tokens": cw,
            "kosten_chf": round(kosten, 4),
        }).encode()
        rq = urllib.request.Request(
            f"{DIRECTUS_URL}/items/agent_usage",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {DIRECTUS_TOKEN}",
                "Content-Type": "application/json",
            },
        )
        urllib.request.urlopen(rq, timeout=10)
    except Exception as e:
        log.warning("agent_usage-Log fehlgeschlagen: %s", e)


def schreibe_gesuch_entwurf(gesuch_prompt: str) -> tuple[str | None, dict]:
    """Ruft Sonnet mit dem Gesuch-Prompt auf und gibt (text, usage-dict) zurück.
    Bei fehlendem Key oder API-Fehler: (None, {}). Kein Call im dry-run --
    diese Funktion nur aus dem apply-Pfad aufrufen."""
    key = _get_anthropic_key()
    if not key:
        return None, {}
    body = json.dumps({
        "model": GESUCH_MODEL,
        "max_tokens": 2500,
        "system": GESUCH_SYSTEM,
        "messages": [{"role": "user", "content": gesuch_prompt}],
    }).encode()
    r = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    try:
        # 240s: der Volltext-Prompt (mit eingebettetem Paradegesuch) ist gross,
        # non-streaming kommt die Antwort erst am Ende — 90s war zu knapp.
        with urllib.request.urlopen(r, timeout=240) as x:
            d = json.loads(x.read().decode())
        text = "".join(
            b.get("text", "") for b in d.get("content", []) if b.get("type") == "text"
        ).strip()
        usage = d.get("usage", {}) or {}
        _log_usage_builder(usage)
        return text or None, usage
    except Exception as e:
        log.warning("Sonnet-Gesuch-Entwurf fehlgeschlagen: %s", e)
        return None, {}


# ─── Budget-Berechnung + Verfall ────────────────────────────────────────────

def _offene_paket_antraege(medium_slug: str, alle_apps: list[dict]) -> int:
    """Anzahl vom Paket-Builder angelegter, noch nicht gesichteter Anträge
    für dieses Medium. Nutzt den bereits geladenen alle_apps-Batch."""
    return sum(
        1
        for a in alle_apps
        if (
            a.get("medium_id") == medium_slug
            and a.get("zuletzt_geaendert_quelle") == "paket-builder"
            and a.get("status") == "identifiziert"
            and not a.get("gesichtet_am")
        )
    )


def _paket_alter_tage(app: dict) -> float | None:
    """Alter des Pakets in Tagen (aus paket.gebaut_am). None wenn kein Stempel."""
    paket = app.get("paket")
    if not isinstance(paket, dict):
        return None
    roh = paket.get("gebaut_am")
    if not roh:
        return None
    try:
        gebaut = datetime.fromisoformat(str(roh).replace("Z", "+00:00"))
    except ValueError:
        return None
    if gebaut.tzinfo is None:
        gebaut = gebaut.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - gebaut).total_seconds() / 86400


def _verfalle_alte_pakete(alle_apps: list[dict], apply: bool) -> int:
    """Ungesichtete Paket-Anträge älter als VERFALL_TAGE auf ausgeblendet setzen,
    damit sie das Budget nicht dauerhaft blockieren. Mutiert alle_apps in place,
    damit die nachfolgende Budget-Rechnung den neuen Zustand sieht."""
    verfallen = 0
    for a in alle_apps:
        if (
            a.get("zuletzt_geaendert_quelle") != "paket-builder"
            or a.get("status") != "identifiziert"
            or a.get("gesichtet_am")
        ):
            continue
        alter = _paket_alter_tage(a)
        if alter is None or alter < VERFALL_TAGE:
            continue
        if apply:
            try:
                _patch(f"/items/applications/{a.get('id')}", {
                    "status": "ausgeblendet",
                    "bemerkung": VERFALL_BEMERKUNG,
                })
            except urllib.error.HTTPError as e:
                log.warning("Verfall-PATCH fehlgeschlagen (%s): %s",
                            a.get("id"), e.read().decode()[:200])
                continue
        a["status"] = "ausgeblendet"
        a["bemerkung"] = VERFALL_BEMERKUNG
        verfallen += 1
        log.info("[%s] Paket verfallen (%.0f Tage ungesichtet): %s%s",
                 a.get("medium_id"), alter, a.get("stiftung_name") or a.get("stiftung_id"),
                 "" if apply else " (dry-run, nicht geschrieben)")
    return verfallen


# ─── Matching-Listen-Digest ─────────────────────────────────────────────────

DIGEST_MIN = int(os.environ.get("DIGEST_MIN", "10"))


def _lade_outbox_dedup() -> set[str]:
    """Dedup-Keys aller bestehenden agent_outbox-Zeilen.
    Gibt ein leeres Set zurück, wenn Directus nicht erreichbar ist."""
    keys: set[str] = set()
    try:
        rows = _get("/items/agent_outbox?limit=-1&fields=dedup_key")
        for r in rows:
            k = r.get("dedup_key")
            if k:
                keys.add(k)
    except Exception as e:
        log.warning("Outbox-Dedup laden fehlgeschlagen: %s", e)
    return keys


def baue_digest(
    slug: str,
    medium_name: str,
    kontakt_emails: list,
    matches: list[dict],
    app_dedup: set[str],
    outbox_dedup: set[str],
    apply: bool,
) -> dict | None:
    """Baut einen Mail-Digest-Entwurf in agent_outbox, wenn Bedingungen erfüllt.

    Bedingungen:
    - Medium hat mindestens eine kontakt_email.
    - Mindestens DIGEST_MIN match_results (score >= STRONG_SCORE, projekt_id null)
      sind NICHT in app_dedup (also noch keine Anträge daraus).
    - Dedup-Key outbox|digest|<slug>|<YYYY-MM> noch nicht in outbox_dedup.

    Gibt den neuen outbox-Eintrag zurück, oder None wenn übersprungen.
    """
    if not kontakt_emails or not isinstance(kontakt_emails, list):
        return None

    empfaenger = kontakt_emails[0]

    # Kandidaten, die noch keinen Antrag haben
    offen = [
        m for m in matches
        if f"{slug}|{m.get('stiftung_id')}" not in app_dedup
    ]
    if len(offen) < DIGEST_MIN:
        log.info(
            "[%s] Digest übersprungen: %d offene Kandidaten < DIGEST_MIN=%d.",
            slug, len(offen), DIGEST_MIN,
        )
        return None

    monat = datetime.now(timezone.utc).strftime("%Y-%m")
    dedup_key = f"outbox|digest|{slug}|{monat}"
    if dedup_key in outbox_dedup:
        log.info("[%s] Digest übersprungen: dedup_key %s bereits in outbox.", slug, dedup_key)
        return None

    # Top-10 für den Digest-Text
    top10 = sorted(offen, key=lambda x: x.get("score") or 0, reverse=True)[:10]

    zeilen = []
    for i, m in enumerate(top10, 1):
        name = m.get("stiftung_name") or f"Stiftung {m.get('stiftung_id')}"
        score = m.get("score") or 0
        betrag_recherche = m.get("betrag_recherche")
        if isinstance(betrag_recherche, dict) and betrag_recherche.get("suggested_amount"):
            betrag_zusatz = f", CHF {betrag_recherche['suggested_amount']}"
        else:
            betrag_zusatz = ""
        zeilen.append(f"{i}. {name} (Score {score}{betrag_zusatz})")

    liste = "\n".join(zeilen)
    inhalt = (
        f"Unsere Matching-Maschine hat neue passende Förderstiftungen für {medium_name} identifiziert.\n\n"
        f"{liste}\n\n"
        f"Meldet euch, dann besprechen wir die Liste und die nächsten Schritte.\n\n"
        f"Der Gerät, FaaS"
    )
    betreff = f"Neue Förderempfehlungen für {medium_name}"

    if not apply:
        log.info(
            "[%s] Digest DRY-RUN: %d Kandidaten, Entwurf würde erstellt (empfaenger=%s).",
            slug, len(offen), empfaenger,
        )
        return None

    try:
        zeile = _post("/items/agent_outbox", {
            "typ": "mail",
            "anlass": "matching_liste",
            "status": "entwurf",
            "medium_id": slug,
            "empfaenger": empfaenger,
            "betreff": betreff,
            "inhalt": inhalt,
            "erstellt_von": "paket-builder",
            "dedup_key": dedup_key,
            "mandant": MANDANT,
        })
        log.info(
            "[%s] Digest-Entwurf angelegt (id=%s, empfaenger=%s, %d Kandidaten).",
            slug, zeile.get("id"), empfaenger, len(offen),
        )
        return zeile
    except urllib.error.HTTPError as e:
        log.warning("[%s] Digest-POST fehlgeschlagen: %s", slug, e.read().decode()[:200])
        return None


# ─── Dedup ──────────────────────────────────────────────────────────────────

def _lade_app_dedup(alle_apps: list[dict]) -> set[str]:
    """Dedup-Set aller (medium_id, stiftung_id)-Paare über ALLE Status.
    Verhindert Doppeleinträge unabhängig davon, ob der Antrag ausgeblendet ist.

    Einzige Ausnahme (Wiedervorlage): vom Builder verfallene Pakete geben die
    Stiftung nach WIEDERVORLAGE_TAGE wieder frei — sonst wäre jede einmal
    unbeachtete Stiftung für immer aus dem System."""
    keys: set[str] = set()
    for a in alle_apps:
        if not a.get("medium_id") or a.get("stiftung_id") is None:
            continue
        if (
            a.get("status") == "ausgeblendet"
            and str(a.get("bemerkung") or "").startswith("Paket verfallen")
        ):
            alter = _paket_alter_tage(a)
            if alter is not None and alter >= WIEDERVORLAGE_TAGE:
                continue  # Wiedervorlage: blockiert nicht mehr
        keys.add(f"{a.get('medium_id')}|{a.get('stiftung_id')}")
    return keys


# ─── Hauptlauf ──────────────────────────────────────────────────────────────

def lauf(apply: bool, limit: int | None, nur_medium: str | None) -> int:
    if not DIRECTUS_TOKEN:
        log.error("Kein DIRECTUS_TOKEN (Env / ~/.hermes/.env).")
        return 2

    # Aktive Medien (mandantenrein) -- kontakt_emails für Digest-Versand mitladen
    aktive_media = _get(
        f"/items/faas_medien?limit=-1"
        f"&filter[is_active][_eq]=true"
        f"&filter[mandant][_eq]={MANDANT}"
        f"&fields=slug,name,slack_channel,kontakt_emails,paket_budget"
    )
    if nur_medium:
        aktive_media = [m for m in aktive_media if m.get("slug") == nur_medium]
        if not aktive_media:
            log.error("Medium '%s' nicht gefunden oder inaktiv.", nur_medium)
            return 1

    log.info("Mandant: %s | Aktive Medien: %d | STRONG_SCORE=%d | BUDGET=%d",
             MANDANT, len(aktive_media), STRONG_SCORE, BUDGET)

    # Alle bestehenden Anträge des Mandanten vorab laden (für Dedup und Budget)
    alle_apps = _get(
        f"/items/applications?limit=-1"
        f"&filter[mandant][_eq]={MANDANT}"
        f"&fields=id,medium_id,stiftung_id,stiftung_name,status,"
        f"zuletzt_geaendert_quelle,gesichtet_am,bemerkung,paket"
    )
    log.info("Bestehende Anträge geladen: %d (Dedup-Basis)", len(alle_apps))

    # Verfall: alte ungesichtete Pakete geben ihr Budget frei
    verfallen = _verfalle_alte_pakete(alle_apps, apply)
    if verfallen:
        log.info("Verfallen gesamt: %d Pakete (> %d Tage ungesichtet).", verfallen, VERFALL_TAGE)

    app_dedup = _lade_app_dedup(alle_apps)

    # Outbox-Dedup einmalig laden (monatliche Digest-Dedup, Wächter-Entwürfe)
    outbox_dedup = _lade_outbox_dedup()
    log.info("Outbox-Dedup geladen: %d Keys", len(outbox_dedup))

    gesamt_gebaut = 0
    iso_jetzt = datetime.now(timezone.utc).isoformat()

    for m in aktive_media:
        slug = m.get("slug") or ""
        medium_name = m.get("name") or slug
        slack_kanal = m.get("slack_channel") or ""
        kontakt_emails = m.get("kontakt_emails") or []
        if isinstance(kontakt_emails, str):
            # Directus liefert manchmal einen JSON-String statt einer Liste
            try:
                kontakt_emails = json.loads(kontakt_emails)
            except Exception:
                kontakt_emails = []

        # Budget prüfen (pro Medium via faas_medien.paket_budget, sonst Default)
        budget_limit = m.get("paket_budget") or BUDGET
        offene = _offene_paket_antraege(slug, alle_apps)
        budget = budget_limit - offene
        if budget <= 0:
            # WICHTIG: kein continue — der Digest unten läuft unabhängig vom Budget.
            log.info("[%s] Budget erschöpft (%d offene Paket-Anträge, Budget=%d), "
                     "keine neuen Pakete — Digest läuft trotzdem.",
                     slug, offene, budget_limit)
            budget = 0

        # Kandidaten laden (Score >= STRONG_SCORE, projekt_id null, sort -score)
        kandidaten = _get(
            f"/items/match_results?limit=30"
            f"&filter[medium_id][_eq]={urllib.parse.quote(slug)}"
            f"&filter[score][_gte]={STRONG_SCORE}"
            f"&filter[projekt_id][_null]=true"
            f"&sort=-score"
            f"&fields=id,stiftung_id,score,begruendung,betrag_recherche"
        )
        log.info("[%s] Budget=%d | Kandidaten=%d", slug, budget, len(kandidaten))

        gebaut = 0
        uebersprungen_dedup = 0
        stiftung_name_cache: dict[int | str, str] = {}  # id -> Name, für Digest

        for k in kandidaten:
            if budget <= 0:
                break
            if limit is not None and gesamt_gebaut >= limit:
                log.info("--limit %d erreicht, Lauf beendet.", limit)
                return 0

            stiftung_id = k.get("stiftung_id")
            score = k.get("score") or 0
            begruendung = (k.get("begruendung") or "")

            # Dedup über ALLE Status
            dedup_key = f"{slug}|{stiftung_id}"
            if dedup_key in app_dedup:
                uebersprungen_dedup += 1
                continue

            # Stiftungsname holen
            stiftung_row = _get(
                f"/items/stiftungen?limit=1"
                f"&filter[id][_eq]={stiftung_id}"
                f"&fields=id,Stiftungsname,einreichung"
            )
            if not stiftung_row:
                log.warning("[%s] Stiftung %s nicht in Directus, übersprungen.", slug, stiftung_id)
                continue
            stiftung_name = stiftung_row[0].get("Stiftungsname") or f"Stiftung {stiftung_id}"
            stiftung_name_cache[stiftung_id] = stiftung_name
            einreichung_raw = stiftung_row[0].get("einreichung")

            # Betrag bestimmen
            betrag_result: dict | None = None
            betrag_hinweis = ""

            betrag_recherche = k.get("betrag_recherche")
            if isinstance(betrag_recherche, dict) and betrag_recherche.get("suggested_amount") is not None:
                betrag_result = betrag_recherche
                log.info("  [%s] %s: Betrag aus betrag_recherche: CHF %s",
                         slug, stiftung_name, betrag_result.get("suggested_amount"))
            elif apply:
                log.info("  [%s] %s: starte Betrag-Job ...", slug, stiftung_name)
                betrag_result = _berechne_betrag(stiftung_id, slug)
                if betrag_result:
                    log.info("  [%s] %s: Betrag CHF %s",
                             slug, stiftung_name, betrag_result.get("suggested_amount"))
                else:
                    betrag_hinweis = "Betrag-Berechnung nicht erfolgreich."
                    log.warning("  [%s] %s: Betrag nicht verfügbar, Paket trotzdem gebaut.",
                                slug, stiftung_name)
            else:
                # Dry-run: nur melden
                log.info("  [%s] %s: Betrag wird nachts berechnet (dry-run).", slug, stiftung_name)

            # Gesuch-Prompt (nur bei apply)
            gesuch_prompt_text = ""
            gesuch_ablage = ""
            if apply:
                gesuch_prompt_text, gesuch_ablage = _hole_gesuch_prompt(stiftung_id, slug)

            # Gold-Status bestimmen
            betrag_chf = None
            if betrag_result:
                betrag_chf = betrag_result.get("suggested_amount")
            gold = bool(
                (betrag_chf is not None and betrag_chf >= GOLD_BETRAG)
                or score >= GOLD_SCORE
            )

            # Nur Gold-Pakete bauen. Routine-Pakete (nicht Gold) sind nicht
            # gewünscht (Entscheid Jolanda 2026-06-19): nicht-Gold wird komplett
            # übersprungen — keine Application, kein Entwurf, kein Slack-Entwurf.
            # Solche Treffer bleiben in der Förderstiftungen-Liste und können von
            # Hand übernommen werden.
            if not gold:
                log.info("  [%s] %s: nicht Gold (Score %d) — übersprungen (nur Gold-Pakete).",
                         slug, stiftung_name, score)
                continue

            # Einreichungs-Check
            if einreichung_raw and isinstance(einreichung_raw, dict) and einreichung_raw.get("felder"):
                einreichungs_check = {
                    "formular_erfasst": True,
                    "hinweis": "",
                }
            else:
                einreichungs_check = {
                    "formular_erfasst": False,
                    "hinweis": "Einreichungsweg noch nicht erfasst",
                }

            # Paket-JSON zusammenbauen
            paket = {
                "score": score,
                "begruendung_kurz": begruendung[:300],
                "betrag": betrag_result,
                "betrag_hinweis": betrag_hinweis,
                "gold": gold,
                "gesuch_prompt": gesuch_prompt_text[:5000] if gesuch_prompt_text else "",
                "gesuch_ablage": gesuch_ablage,
                "einreichungs_check": einreichungs_check,
                "outbox_ids": [],
                "gebaut_am": iso_jetzt,
            }

            if not apply:
                betrag_info = (
                    f"CHF {betrag_chf}" if betrag_chf is not None
                    else ("vorhanden" if betrag_recherche else "wird nachts berechnet")
                )
                # Nur Gold-Pakete erreichen diese Stelle (Opus-Copy-paste-Prompt).
                entwurf_info = "Gold: Opus-Prompt (Copy-paste)"
                log.info(
                    "  DRY-RUN [%s] %s | Score %d | Gold: %s | Betrag: %s | Einreichung: %s | %s",
                    slug, stiftung_name, score, gold,
                    betrag_info, "erfasst" if einreichungs_check["formular_erfasst"] else "fehlt",
                    entwurf_info,
                )
                gebaut += 1
                gesamt_gebaut += 1
                budget -= 1
                # Auch im Dry-run dedupen, sonst erscheint dieselbe Stiftung
                # bei mehreren Match-Zeilen doppelt in der Vorschau.
                app_dedup.add(dedup_key)
                continue

            # Application anlegen (apply)
            try:
                neue_app = _post("/items/applications", {
                    "medium_id": slug,
                    "stiftung_id": stiftung_id,
                    "stiftung_name": stiftung_name,
                    "status": "identifiziert",
                    "station": 1,
                    "mandant": MANDANT,
                    "verantwortung": "der-geraet",
                    "zuletzt_geaendert_quelle": "paket-builder",
                    "paket": paket,
                })
            except urllib.error.HTTPError as e:
                log.error("Application POST fehlgeschlagen (%s / %s): %s",
                          slug, stiftung_name, e.read().decode()[:200])
                continue

            app_id = neue_app.get("id")
            if not app_id:
                log.error("Application POST ohne ID-Rückmeldung (%s / %s).", slug, stiftung_name)
                continue

            # Gold-Paket: Der Opus-Copy-paste-Prompt liegt im Paket; das Gesuch
            # schreibt Jolanda in der Claude-App (Opus 4.8). KEIN automatischer
            # Entwurf (Entscheid Jolanda 2026-06-19: nur Gold, Copy-paste-Weg).
            log.info("  [%s] %s: Gold-Paket — Opus-Prompt bereit (Copy-paste).",
                     slug, stiftung_name)

            # Dedup-Set aktualisieren (verhindert Doppel beim nächsten Medium-Schleifen)
            app_dedup.add(dedup_key)

            log.info(
                "  [%s] Paket gebaut: %s | Score %d | Gold: %s | app_id=%s",
                slug, stiftung_name, score, gold, app_id,
            )

            # Slack-Entwurf (nur wenn slack_channel gesetzt)
            if slack_kanal:
                betrag_zusatz = ""
                if betrag_chf is not None:
                    betrag_zusatz = f", Betrag CHF {betrag_chf}"
                inhalt = (
                    f"Neue Förderempfehlung für {slug}: {stiftung_name} (Score {score}"
                    f"{betrag_zusatz}). {begruendung[:300]} Details in der FaaS-App."
                )
                # Eigener Key-Name — das Set outbox_dedup darf nicht überschrieben
                # werden (Shadowing-Bug bis 07/2026: machte die Digest-Dedup kaputt).
                paket_outbox_key = f"outbox|paket|{app_id}"
                try:
                    outbox_row = _post("/items/agent_outbox", {
                        "typ": "slack",
                        "anlass": "foerderpaket",
                        "status": "vorbereitet",
                        "medium_id": slug,
                        "application_id": str(app_id),
                        "stiftung_id": stiftung_id,
                        "empfaenger": slack_kanal,
                        "inhalt": inhalt,
                        "erstellt_von": "paket-builder",
                        "dedup_key": paket_outbox_key,
                        "mandant": MANDANT,
                    })
                    outbox_id = outbox_row.get("id")
                except urllib.error.HTTPError as e:
                    log.warning("Outbox-POST fehlgeschlagen: %s", e.read().decode()[:200])
                    outbox_id = None

                # Outbox-ID in paket.outbox_ids zurückschreiben
                if outbox_id:
                    paket_aktuell = dict(paket)
                    paket_aktuell["outbox_ids"] = [str(outbox_id)]
                    try:
                        _patch(f"/items/applications/{app_id}", {"paket": paket_aktuell})
                    except urllib.error.HTTPError as e:
                        log.warning("PATCH outbox_ids fehlgeschlagen: %s", e.read().decode()[:200])

            gebaut += 1
            gesamt_gebaut += 1
            budget -= 1

        log.info(
            "[%s] Abschluss: Budget=%d, gebaut=%d, dedup-übersprungen=%d",
            slug, budget_limit - offene, gebaut, uebersprungen_dedup,
        )

        # Matching-Listen-Digest: Mail-Entwurf für das Medium, wenn genug offene Kandidaten.
        # Kandidaten-Liste um Stiftungsnamen anreichern (für lesbaren Digest-Text).
        # Bei erschöpftem Budget ist der Namens-Cache leer -> fehlende Namen im Batch holen.
        fehlende_ids = [
            str(kand.get("stiftung_id")) for kand in kandidaten
            if kand.get("stiftung_id") is not None
            and kand.get("stiftung_id") not in stiftung_name_cache
        ]
        if fehlende_ids:
            try:
                for row in _get(
                    f"/items/stiftungen?limit=-1"
                    f"&filter[id][_in]={','.join(fehlende_ids)}"
                    f"&fields=id,Stiftungsname"
                ):
                    if row.get("Stiftungsname"):
                        stiftung_name_cache[row["id"]] = row["Stiftungsname"]
                        stiftung_name_cache[str(row["id"])] = row["Stiftungsname"]
            except Exception as e:
                log.warning("[%s] Digest-Namensauflösung fehlgeschlagen: %s", slug, e)
        kandidaten_mit_namen = []
        for kand in kandidaten:
            sid = kand.get("stiftung_id")
            kand_enriched = dict(kand)
            if sid in stiftung_name_cache:
                kand_enriched["stiftung_name"] = stiftung_name_cache[sid]
            elif str(sid) in stiftung_name_cache:
                kand_enriched["stiftung_name"] = stiftung_name_cache[str(sid)]
            kandidaten_mit_namen.append(kand_enriched)
        baue_digest(
            slug=slug,
            medium_name=medium_name,
            kontakt_emails=kontakt_emails,
            matches=kandidaten_mit_namen,
            app_dedup=app_dedup,
            outbox_dedup=outbox_dedup,
            apply=apply,
        )

    log.info("Paket-Builder fertig. Gesamt gebaut: %d", gesamt_gebaut)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="FaaS Paket-Builder: Förderpakete aus starken Matches")
    ap.add_argument("--apply", action="store_true",
                    help="Anträge wirklich anlegen (sonst dry-run)")
    ap.add_argument("--limit", type=int, default=None,
                    help="Maximale Pakete gesamt (für Tests)")
    ap.add_argument("--medium", type=str, default=None,
                    help="Nur dieses Medium verarbeiten (Slug)")
    args = ap.parse_args()

    mode = "apply" if args.apply else "dry-run"
    log.info("Paket-Builder gestartet (Modus: %s | MANDANT=%s | APP_URL=%s)",
             mode, MANDANT, APP_URL)
    return lauf(apply=args.apply, limit=args.limit, nur_medium=args.medium)


if __name__ == "__main__":
    sys.exit(main())
