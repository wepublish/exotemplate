#!/usr/bin/env python3
"""
setup_gmail_oauth.py -- OAuth-2.0-Einrichtung für den Gmail-Versand (send-only).

Läuft auf dem Mac (nicht auf dem Spark). Erfordert eine client_secret.json
aus der Google Cloud Console. Schreibt das Token nach ~/.faas_gmail/token.json
und gibt den scp-Befehl aus, um es auf den Spark zu übertragen.

Verwendung:
  python3 setup_gmail_oauth.py client_secret.json

Voraussetzungen:
  - Google Cloud Projekt mit aktivierter Gmail API
  - OAuth-2.0-Client-ID (Typ: Desktop-Anwendung)
  - client_secret.json aus der Console heruntergeladen
  - Python >= 3.8 (nur stdlib)

Vollständige Anleitung: 2026-06-11_gmail_einrichtung_fundraising.md
"""
from __future__ import annotations

import http.server
import json
import os
import stat
import sys
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

REDIRECT_URI = "http://localhost:8765"
SCOPE = "https://www.googleapis.com/auth/gmail.send"
TOKEN_PFAD = Path.home() / ".faas_gmail" / "token.json"


def lese_client_secret(pfad: str) -> tuple[str, str]:
    """Liest client_id und client_secret aus der heruntergeladenen JSON-Datei."""
    try:
        d = json.loads(Path(pfad).read_text())
    except FileNotFoundError:
        print(f"Fehler: Datei nicht gefunden: {pfad}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Fehler beim Lesen der client_secret.json: {e}")
        sys.exit(1)
    installed = d.get("installed") or d.get("web") or {}
    client_id = installed.get("client_id") or d.get("client_id", "")
    client_secret = installed.get("client_secret") or d.get("client_secret", "")
    if not client_id or not client_secret:
        print("Fehler: client_id oder client_secret nicht in der Datei gefunden.")
        sys.exit(1)
    return client_id, client_secret


def baue_auth_url(client_id: str) -> str:
    params = urllib.parse.urlencode({
        "client_id":     client_id,
        "redirect_uri":  REDIRECT_URI,
        "response_type": "code",
        "scope":         SCOPE,
        "access_type":   "offline",
        "prompt":        "consent",
    })
    return f"https://accounts.google.com/o/oauth2/auth?{params}"


class _CodeEmpfaenger(http.server.BaseHTTPRequestHandler):
    code: str | None = None

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        _CodeEmpfaenger.code = (params.get("code") or [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(
            b"<h2>Autorisierung abgeschlossen.</h2>"
            b"<p>Dieses Fenster kann geschlossen werden.</p>"
        )

    def log_message(self, format: str, *args: object) -> None:
        pass  # kein Output auf der Konsole


def warte_auf_code() -> str:
    server = http.server.HTTPServer(("localhost", 8765), _CodeEmpfaenger)
    server.timeout = 120
    print("Warte auf Weiterleitung von Google (Timeout 120 Sekunden) ...")
    server.handle_request()
    if not _CodeEmpfaenger.code:
        print("Fehler: Kein Autorisierungs-Code empfangen.")
        sys.exit(1)
    return _CodeEmpfaenger.code


def tausche_code_gegen_token(client_id: str, client_secret: str, code: str) -> dict:
    body = urllib.parse.urlencode({
        "client_id":     client_id,
        "client_secret": client_secret,
        "code":          code,
        "redirect_uri":  REDIRECT_URI,
        "grant_type":    "authorization_code",
    }).encode()
    r = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(r, timeout=30) as x:
            return json.loads(x.read().decode())
    except urllib.error.HTTPError as e:
        print(f"Fehler beim Token-Austausch: {e.code} {e.read().decode()[:300]}")
        sys.exit(1)


def speichere_token(client_id: str, client_secret: str, token_antwort: dict) -> None:
    refresh_token = token_antwort.get("refresh_token")
    if not refresh_token:
        print("Fehler: Kein Refresh-Token in der Antwort. 'prompt=consent' wurde übergeben -- bitte erneut versuchen.")
        sys.exit(1)
    TOKEN_PFAD.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    TOKEN_PFAD.write_text(json.dumps({
        "client_id":     client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
    }, indent=2))
    TOKEN_PFAD.chmod(0o600)
    print(f"Token gespeichert: {TOKEN_PFAD}")


def main() -> None:
    if len(sys.argv) < 2:
        print("Verwendung: python3 setup_gmail_oauth.py client_secret.json")
        sys.exit(1)

    client_id, client_secret = lese_client_secret(sys.argv[1])

    auth_url = baue_auth_url(client_id)
    print(f"\nBrowser öffnet sich zur Google-Anmeldung.")
    print(f"Falls der Browser nicht öffnet, hier manuell aufrufen:\n{auth_url}\n")
    webbrowser.open(auth_url)

    code = warte_auf_code()
    print("Code empfangen, tausche gegen Token ...")

    token_antwort = tausche_code_gegen_token(client_id, client_secret, code)
    speichere_token(client_id, client_secret, token_antwort)

    spark_host = os.environ.get("SPARK_HOST", "dergeraet@spark")
    print(
        f"\nToken auf den Spark übertragen:\n"
        f"  ssh {spark_host} 'mkdir -p ~/.faas_gmail && chmod 700 ~/.faas_gmail'\n"
        f"  scp {TOKEN_PFAD} {spark_host}:~/.faas_gmail/token.json\n"
        f"  ssh {spark_host} 'chmod 600 ~/.faas_gmail/token.json'\n"
    )
    print("Einrichtung abgeschlossen.")


if __name__ == "__main__":
    main()
