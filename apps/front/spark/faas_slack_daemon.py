#!/usr/bin/env python3
"""
faas_slack_daemon — Socket-Mode-Daemon fuer das interaktive Roadmap-Pult.

Empfaengt Block-Actions aus #faas-admin (Freigabe-Buttons der Medium-Stationen,
Status-Overflows der Antraege), fuehrt sie ueber die gegateten faas_actions aus und
aktualisiert anschliessend das Pult (faas_roadmap_render). Reagiert NUR auf
#faas-admin (Allowlist) — nie auf #p-faas-* (medien-sichtbar, tabu).

Wichtig (Importierbarkeit fuer Tests): slack_sdk wird NUR in main() bzw. im
__main__-Block geladen. Die reine Parse-Logik (parse_action) und die
Aktions-Verarbeitung (verarbeite_action) sind ohne slack_sdk importierbar.

Tokens:
  ~/.hermes/.env         SLACK_APP_TOKEN (xapp-)
  ~/.hermes/config.yaml  xoxb-Bot-Token (wie faas_kanban_sync)

Env:
  FAAS_ROADMAP_CHANNEL   #faas-admin (Default C0B7SD7JCEM) — Allowlist
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from pathlib import Path

# faas_actions (gegatete Aktionen) und der Renderer sind ohne slack_sdk importierbar.
from faas_actions import (
    DIRECTUS_URL,
    MANDANT,
    akt_antrag_status,
    akt_roadmap_freigabe,
    _dget,
    _dwrite,
)
import faas_roadmap_render

# Ausgangs-Stati, die ein Modal (Betrag bzw. Grund) oeffnen statt direkt zu setzen.
AUSGANG_STATI = ("zugesagt", "abgelehnt")

ADMIN_CHANNEL = os.environ.get("FAAS_ROADMAP_CHANNEL", "C0B7SD7JCEM")  # #faas-admin
LOG_PFAD = Path.home() / "faas_classify" / "slack_daemon.log"


def _logger() -> logging.Logger:
    lg = logging.getLogger("slack-daemon")
    if lg.handlers:
        return lg
    lg.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s  %(levelname)-7s %(message)s", "%Y-%m-%d %H:%M:%S")
    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(fmt)
    lg.addHandler(sh)
    try:
        LOG_PFAD.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(LOG_PFAD)
        fh.setFormatter(fmt)
        lg.addHandler(fh)
    except Exception:
        pass
    return lg


log = _logger()


def _slack_app_token() -> str:
    for l in (Path.home() / ".hermes" / ".env").read_text().splitlines():
        if l.startswith("SLACK_APP_TOKEN"):
            return l.split("=", 1)[1].strip().strip('"')
    return ""


def _slack_bot_token() -> str:
    cfg = (Path.home() / ".hermes" / "config.yaml").read_text()
    m = re.search(r"xoxb-[A-Za-z0-9-]+", cfg)
    return m.group(0) if m else ""


def parse_action(action_id_str: str) -> dict:
    """Parst die action_id (kompaktes JSON) und validiert das Schema.

    Erlaubt zwei Formen:
      {"k":"frei","m":<medium>,"s":<int>,"v":<bool>}
      {"k":"astat","a":<antrag_id>}
    Gibt das dict zurueck oder wirft ValueError bei ungueltiger Eingabe.
    """
    try:
        d = json.loads(action_id_str)
    except (TypeError, ValueError) as e:
        raise ValueError(f"action_id ist kein gueltiges JSON: {e}") from e
    if not isinstance(d, dict):
        raise ValueError("action_id ist kein JSON-Objekt")
    k = d.get("k")
    if k == "frei":
        if not d.get("m") or not isinstance(d.get("s"), int) or not isinstance(d.get("v"), bool):
            raise ValueError("frei-Action unvollstaendig")
        return d
    if k == "astat":
        if not d.get("a"):
            raise ValueError("astat-Action ohne Antrag-ID")
        return d
    raise ValueError(f"unbekannte Action-Art {k!r}")


def _medium_von_antrag(antrag_id: str) -> str | None:
    """Liest das medium_id einer Antrags-Zeile (mandantenrein)."""
    try:
        hits = _dget(f"/items/applications?limit=1&filter[id][_eq]={antrag_id}"
                     f"&filter[mandant][_eq]={MANDANT}&fields=medium_id")
        return hits[0].get("medium_id") if hits else None
    except Exception:
        return None


def _antrag_name(antrag_id: str) -> str:
    """Stiftungsname eines Antrags fuer den Modal-Titel (best effort)."""
    try:
        hits = _dget(f"/items/applications?limit=1&filter[id][_eq]={antrag_id}"
                     f"&filter[mandant][_eq]={MANDANT}&fields=stiftung_name,medium_id")
        if hits:
            return f"{hits[0].get('stiftung_name') or 'Antrag'} ({hits[0].get('medium_id')})"
    except Exception:
        pass
    return "Antrag"


def baue_ausgang_modal(ziel: str, antrag_id: str, titel_name: str) -> dict:
    """Modal-View fuer Zusage (Betrag in CHF) bzw. Absage (Grund). Reine Logik,
    ohne slack_sdk importierbar (testbar)."""
    if ziel == "zugesagt":
        titel, label, hint, block_id = ("Zusage erfassen", "Zugesagter Betrag (CHF)",
                                        "Nur Zahl, z.B. 20000", "betrag")
    else:
        titel, label, hint, block_id = ("Absage erfassen", "Grund der Absage",
                                        "Ein Satz genuegt", "grund")
    cb = json.dumps({"k": "ausgang", "a": str(antrag_id), "z": ziel}, separators=(",", ":"))
    return {
        "type": "modal",
        "callback_id": cb,
        "title": {"type": "plain_text", "text": titel},
        "submit": {"type": "plain_text", "text": "Speichern"},
        "close": {"type": "plain_text", "text": "Abbrechen"},
        "blocks": [
            {"type": "section", "text": {"type": "mrkdwn", "text": f"*{titel_name}*"}},
            {"type": "input", "block_id": block_id, "optional": True,
             "label": {"type": "plain_text", "text": label},
             "element": {"type": "plain_text_input", "action_id": "wert",
                         "placeholder": {"type": "plain_text", "text": hint}}},
        ],
    }


def verarbeite_view_submission(view: dict, username: str) -> str | None:
    """Verarbeitet ein abgeschicktes Ausgang-Modal (Zusage mit Betrag / Absage mit
    Grund). Gibt das betroffene Medium zurueck (fuer Re-Render) oder None."""
    try:
        cb = json.loads(view.get("callback_id") or "")
    except (TypeError, ValueError):
        return None
    if not isinstance(cb, dict) or cb.get("k") != "ausgang":
        return None
    antrag_id, ziel = cb.get("a"), cb.get("z")
    if not antrag_id or ziel not in AUSGANG_STATI:
        return None

    roh = ""
    werte = (view.get("state") or {}).get("values") or {}
    for block in werte.values():
        if isinstance(block, dict):
            el = block.get("wert") or {}
            if isinstance(el, dict) and (el.get("value") or "").strip():
                roh = el["value"].strip()
                break

    msg = akt_antrag_status(str(antrag_id), None, None, ziel, username)
    log.info("ausgang Antrag %s -> %s: %s", antrag_id, ziel, msg)

    extra: dict = {}
    if ziel == "zugesagt" and roh:
        zahl = re.sub(r"[^0-9]", "", roh)
        if zahl:
            extra["betrag_zugesagt_chf"] = int(zahl)
    if ziel == "abgelehnt" and roh:
        extra["bemerkung"] = roh[:2000]
    if extra:
        try:
            _dwrite("PATCH", f"/items/applications/{antrag_id}", extra)
        except Exception as e:
            log.error("Ausgang-Zusatz-PATCH fehlgeschlagen (%s): %s", antrag_id, e)
    return _medium_von_antrag(str(antrag_id))


def verarbeite_action(action: dict, username: str) -> str | None:
    """Fuehrt EINE Block-Action aus. Gibt das betroffene Medium zurueck (fuer Re-Render).

    Loggt Fehler und gibt None zurueck, wenn nichts oder kein eindeutiges Medium ermittelbar.
    """
    aid_str = action.get("action_id") or action.get("value") or ""
    try:
        aid = parse_action(aid_str)
    except ValueError as e:
        log.error("Action ignoriert (%s): %s", e, aid_str)
        return None

    if aid["k"] == "frei":
        res = akt_roadmap_freigabe(aid["m"], aid["s"], aid["v"], user=username)
        if not res.get("ok"):
            log.error("Freigabe fehlgeschlagen: %s", res.get("fehler"))
        return aid["m"]

    if aid["k"] == "astat":
        antrag_id = aid["a"]
        ziel = ""
        sel = action.get("selected_option") or {}
        if isinstance(sel, dict):
            ziel = sel.get("value", "")
        if not ziel:
            log.error("astat ohne Zielstatus fuer Antrag %s", antrag_id)
            return None
        medium = _medium_von_antrag(antrag_id)
        msg = akt_antrag_status(antrag_id, None, None, ziel, username)
        log.info("astat Antrag %s -> %s: %s", antrag_id, ziel, msg)
        return medium

    return None


def main() -> int:
    # slack_sdk NUR hier laden, damit der Modul-Import (und die Tests) ohne slack_sdk laufen.
    from threading import Event
    from slack_sdk.socket_mode import SocketModeClient
    from slack_sdk.socket_mode.request import SocketModeRequest
    from slack_sdk.socket_mode.response import SocketModeResponse
    from slack_sdk.web import WebClient

    app_token = _slack_app_token()
    bot_token = _slack_bot_token()
    if not app_token or not bot_token:
        log.error("Kein SLACK_APP_TOKEN (xapp) oder Bot-Token (xoxb) gefunden.")
        return 2

    web = WebClient(token=bot_token)
    client = SocketModeClient(app_token=app_token, web_client=web)

    def handler(c: "SocketModeClient", req: "SocketModeRequest") -> None:
        # Envelope IMMER zuerst acken.
        try:
            c.send_socket_mode_response(SocketModeResponse(envelope_id=req.envelope_id))
        except Exception as e:
            log.error("ack fehlgeschlagen: %s", e)

        try:
            if req.type != "interactive":
                return
            payload = req.payload or {}

            # Ausgang-Modal abgeschickt (Zusage mit Betrag / Absage mit Grund)
            if payload.get("type") == "view_submission":
                username = (payload.get("user") or {}).get("username", "slack")
                medium = verarbeite_view_submission(payload.get("view") or {}, username)
                if medium:
                    try:
                        faas_roadmap_render.render_medium(medium)
                    except Exception as e:
                        log.error("Re-Render von %s fehlgeschlagen: %s", medium, e)
                return

            if payload.get("type") != "block_actions":
                return

            # Allowlist: nur #faas-admin. Andere Kanaele (besonders #p-faas-*) ignorieren.
            kanal = (payload.get("channel") or {}).get("id")
            if kanal != ADMIN_CHANNEL:
                log.info("Action ausserhalb #faas-admin ignoriert (Kanal %s).", kanal)
                return

            username = (payload.get("user") or {}).get("username", "slack")
            betroffene: set[str] = set()
            voll_render = False
            for action in payload.get("actions", []):
                # Zusage/Absage: Modal oeffnen (Betrag/Grund erfassen) statt direkt setzen
                sel = action.get("selected_option") or {}
                ziel = sel.get("value", "") if isinstance(sel, dict) else ""
                if ziel in AUSGANG_STATI:
                    try:
                        aid = parse_action(action.get("action_id") or action.get("value") or "")
                    except ValueError:
                        aid = {}
                    if aid.get("k") == "astat" and payload.get("trigger_id"):
                        try:
                            web.views_open(
                                trigger_id=payload["trigger_id"],
                                view=baue_ausgang_modal(ziel, aid["a"], _antrag_name(aid["a"])),
                            )
                        except Exception as e:
                            log.error("views_open fehlgeschlagen (%s): %s — setze Status direkt.",
                                      aid.get("a"), e)
                            medium = verarbeite_action(action, username)
                            if medium:
                                betroffene.add(medium)
                        continue
                medium = verarbeite_action(action, username)
                if medium:
                    betroffene.add(medium)
                else:
                    # Konnte kein eindeutiges Medium ermitteln -> sicherheitshalber alles rendern.
                    voll_render = True

            if voll_render:
                faas_roadmap_render.render_all()
            else:
                for medium in betroffene:
                    try:
                        faas_roadmap_render.render_medium(medium)
                    except Exception as e:
                        log.error("Re-Render von %s fehlgeschlagen: %s", medium, e)
        except Exception as e:
            log.error("Handler-Fehler (Daemon laeuft weiter): %s", e)

    client.socket_mode_request_listeners.append(handler)
    log.info("Socket-Mode-Daemon startet (Mandant %s, Directus %s, Kanal %s).",
             MANDANT, DIRECTUS_URL, ADMIN_CHANNEL)
    client.connect()
    Event().wait()  # blockiert dauerhaft
    return 0


if __name__ == "__main__":
    sys.exit(main())
