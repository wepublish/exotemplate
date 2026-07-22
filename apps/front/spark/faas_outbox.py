#!/usr/bin/env python3
"""
faas_outbox.py -- führt freigegebene agent_outbox-Entwürfe aus.

Gate-Kette (hart, in dieser Reihenfolge):
  1. Eintrag existiert, Mandant stimmt, Status ist `entwurf`.
  2. Allowlist:
     - Slack: nur an den im Onboarding hinterlegten Medien-Kanal
       (faas_medien.slack_channel), an #p-faas-* oder an interne Kanäle.
     - Mail: Empfänger muss in faas_medien.kontakt_emails enthalten sein
       ODER exakt `fundraising@wepublish.ch` sein.
  3. Erst nach bestandener Prüfung: Status `freigegeben` (mit User-Stempel),
     dann Ausführung, dann `versendet` bzw. `fehler`.

Gmail-Setup: Token unter ~/.faas_gmail/token.json (client_id, client_secret,
refresh_token). Einrichtung: spark/setup_gmail_oauth.py auf dem Mac ausführen,
dann per scp auf den Spark übertragen. Anleitung:
2026-06-11_gmail_einrichtung_fundraising.md im Workspace.

Stiftungen sind nie Empfänger -- es gibt schlicht keinen Pfad dorthin.
Slack-Token agentseitig aus ~/.hermes/config.yaml (wie faas_kanban_sync).
"""
from __future__ import annotations

import base64
import email.mime.text
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DIRECTUS_URL = os.environ.get("WAECHTER_DIRECTUS_URL", "http://localhost:8055").rstrip("/")
MANDANT = os.environ.get("WAECHTER_MANDANT", "wepublish")
INTERNE_KANAELE = {"#faas-admin", os.environ.get("KANBAN_CHANNEL", "C0B7SD7JCEM")}
AKTIONS_LOG = Path.home() / "faas_classify" / "agent_aktionen.log"
GMAIL_TOKEN_PFAD = Path.home() / ".faas_gmail" / "token.json"
GMAIL_FROM = "fundraising@wepublish.ch"


def _directus_token() -> str:
    for l in (Path.home() / ".hermes" / ".env").read_text().splitlines():
        if l.startswith("DIRECTUS_TOKEN"):
            return l.split("=", 1)[1].strip().strip('"')
    return ""


def _slack_token() -> str:
    cfg = (Path.home() / ".hermes" / "config.yaml").read_text()
    m = re.search(r"xoxb-[A-Za-z0-9-]+", cfg)
    return m.group(0) if m else ""


def _d(method: str, path: str, payload: dict | None = None) -> dict | list | None:
    tok = _directus_token()
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(
        f"{DIRECTUS_URL}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(r, timeout=30) as resp:
        raw = resp.read().decode()
        return json.loads(raw).get("data") if raw.strip() else None


def _slack(method: str, payload: dict) -> dict:
    r = urllib.request.Request(
        f"https://slack.com/api/{method}",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {_slack_token()}",
                 "Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(r, timeout=20) as resp:
        return json.loads(resp.read().decode())


def _log(user: str, text: str) -> None:
    AKTIONS_LOG.parent.mkdir(parents=True, exist_ok=True)
    with AKTIONS_LOG.open("a") as f:
        f.write(f"{datetime.now(timezone.utc).isoformat()} [outbox] {user}: {text}\n")


# ─── Gmail-Hilfsfunktionen ────────────────────────────────────────────────────

def _gmail_token() -> str | None:
    """Liest ~/.faas_gmail/token.json und holt einen frischen Access-Token.

    Erwartet das Format {client_id, client_secret, refresh_token}.
    Gibt den Access-Token zurück oder None bei Fehler.
    """
    if not GMAIL_TOKEN_PFAD.exists():
        return None
    try:
        t = json.loads(GMAIL_TOKEN_PFAD.read_text())
    except Exception:
        return None
    body = urllib.parse.urlencode({
        "client_id":     t.get("client_id", ""),
        "client_secret": t.get("client_secret", ""),
        "refresh_token": t.get("refresh_token", ""),
        "grant_type":    "refresh_token",
    }).encode()
    try:
        r = urllib.request.Request(
            "https://oauth2.googleapis.com/token",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(r, timeout=15) as x:
            d = json.loads(x.read().decode())
        return d.get("access_token") or None
    except Exception:
        return None


def _sende_mail(eintrag: dict) -> dict:
    """Sendet einen Mail-Outbox-Eintrag über die Gmail API (send-only).

    Baut eine RFC-822-Nachricht, base64url-kodiert sie und postet sie
    an /gmail/v1/users/me/messages/send.
    Gibt {ok: True} oder {ok: False, fehler: str} zurück.
    """
    access_token = _gmail_token()
    if not access_token:
        return {
            "ok": False,
            "fehler": (
                "Mail-Versand noch nicht eingerichtet. "
                "Anleitung: 2026-06-11_gmail_einrichtung_fundraising.md"
            ),
        }

    empfaenger = (eintrag.get("empfaenger") or "").strip()
    betreff = (eintrag.get("betreff") or eintrag.get("anlass") or "FaaS-Nachricht").strip()
    inhalt = (eintrag.get("inhalt") or "").strip()

    # RFC 822 -- UTF-8, kein Attachment
    msg = email.mime.text.MIMEText(inhalt, "plain", "utf-8")
    msg["From"] = GMAIL_FROM
    msg["To"] = empfaenger
    msg["Subject"] = betreff

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    payload = json.dumps({"raw": raw}).encode()
    r = urllib.request.Request(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        data=payload,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    try:
        with urllib.request.urlopen(r, timeout=30) as x:
            resp = json.loads(x.read().decode())
        return {"ok": True, "gmail_id": resp.get("id")}
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:300]
        return {"ok": False, "fehler": f"Gmail API: {e.code} {err}"}
    except Exception as e:
        return {"ok": False, "fehler": f"Gmail API: {e}"}


# ─── Allowlist ────────────────────────────────────────────────────────────────

def _allowlist_ok(eintrag: dict, medium: dict) -> tuple[bool, str]:
    """Prüft, ob der Empfänger in der Allowlist des Mediums steht."""
    if eintrag.get("typ") == "slack":
        kanal = (eintrag.get("empfaenger") or "").strip()
        if not kanal:
            return False, "Kein Empfänger-Kanal gesetzt."
        erlaubt = set(INTERNE_KANAELE)
        if medium.get("slack_channel"):
            erlaubt.add(str(medium["slack_channel"]).strip())
        if kanal in erlaubt or kanal.startswith("#p-faas-"):
            return True, ""
        return False, f"Slack-Kanal {kanal!r} ist nicht in der Allowlist."

    if eintrag.get("typ") == "mail":
        empfaenger = (eintrag.get("empfaenger") or "").strip()
        if not empfaenger:
            return False, "Kein Mail-Empfänger gesetzt."
        # fundraising@wepublish.ch ist immer erlaubt (interne Adresse)
        if empfaenger == GMAIL_FROM:
            return True, ""
        kontakt_emails = medium.get("kontakt_emails") or []
        if isinstance(kontakt_emails, str):
            try:
                kontakt_emails = json.loads(kontakt_emails)
            except Exception:
                kontakt_emails = []
        if empfaenger in kontakt_emails:
            return True, ""
        return False, (
            f"Mail-Empfänger {empfaenger!r} ist nicht in kontakt_emails des Mediums "
            f"und nicht die interne Versand-Adresse."
        )

    return False, f"Typ {eintrag.get('typ')!r} wird nicht über die Outbox versendet."


# ─── Haupt-Gate ───────────────────────────────────────────────────────────────

def sende(outbox_id: str, user: str) -> dict:
    """Versendet GENAU einen Outbox-Entwurf. Rückgabe {ok, status?, fehler?}."""
    if not outbox_id:
        return {"ok": False, "fehler": "id erforderlich."}
    try:
        e = _d("GET", f"/items/agent_outbox/{outbox_id}")
    except urllib.error.HTTPError:
        e = None
    if not isinstance(e, dict):
        return {"ok": False, "fehler": "Outbox-Eintrag nicht gefunden."}
    if (e.get("mandant") or "wepublish") != MANDANT:
        return {"ok": False, "fehler": "Eintrag gehört einem anderen Mandanten."}
    if e.get("status") != "entwurf":
        return {"ok": False, "fehler": f"Status ist {e.get('status')!r}, nicht entwurf."}

    medien = _d("GET", f"/items/faas_medien?limit=1&filter[slug][_eq]={e.get('medium_id')}"
                       f"&fields=slug,slack_channel,kontakt_emails")
    medium = medien[0] if isinstance(medien, list) and medien else {}
    ok, grund = _allowlist_ok(e, medium)
    if not ok:
        return {"ok": False, "fehler": grund}

    jetzt = datetime.now(timezone.utc).isoformat()
    _d("PATCH", f"/items/agent_outbox/{outbox_id}",
       {"status": "freigegeben", "freigegeben_von": user, "freigegeben_am": jetzt})

    typ = e.get("typ")

    if typ == "slack":
        res = _slack("chat.postMessage", {"channel": e["empfaenger"], "text": e.get("inhalt") or ""})
        if res.get("ok"):
            _d("PATCH", f"/items/agent_outbox/{outbox_id}",
               {"status": "versendet", "versendet_am": datetime.now(timezone.utc).isoformat()})
            _log(user, f"slack an {e['empfaenger']} ({e.get('anlass')}, medium {e.get('medium_id')})")
            return {"ok": True, "status": "versendet"}
        _d("PATCH", f"/items/agent_outbox/{outbox_id}",
           {"status": "fehler", "fehler_text": str(res.get("error"))})
        return {"ok": False, "fehler": f"Slack: {res.get('error')}"}

    if typ == "mail":
        # Kein Access-Token -> Status bleibt entwurf (nicht auf fehler setzen)
        access_token = _gmail_token()
        if not access_token:
            _d("PATCH", f"/items/agent_outbox/{outbox_id}", {"status": "entwurf"})
            return {
                "ok": False,
                "fehler": (
                    "Mail-Versand noch nicht eingerichtet. "
                    "Anleitung: 2026-06-11_gmail_einrichtung_fundraising.md"
                ),
            }
        res = _sende_mail(e)
        if res.get("ok"):
            _d("PATCH", f"/items/agent_outbox/{outbox_id}",
               {"status": "versendet", "versendet_am": datetime.now(timezone.utc).isoformat()})
            _log(user, f"mail an {e.get('empfaenger')} ({e.get('anlass')}, medium {e.get('medium_id')})")
            return {"ok": True, "status": "versendet"}
        _d("PATCH", f"/items/agent_outbox/{outbox_id}",
           {"status": "fehler", "fehler_text": res.get("fehler", "unbekannter Fehler")})
        return {"ok": False, "fehler": res.get("fehler")}

    return {"ok": False, "fehler": f"Typ {typ!r} wird nicht versendet."}
