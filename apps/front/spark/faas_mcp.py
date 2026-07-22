#!/usr/bin/env python3
"""
faas-mcp — MCP-Server fuer die gegateten FaaS-Aktionen + Lese-Stand.

Importiert faas_actions (eine Quelle der Wahrheit gemeinsam mit dem HTTP-Adapter
«Der Gerät»). Exponiert NUR die vier kuratierten Schreibaktionen + den mandantenreinen
Status. Es gibt bewusst KEINE Tools fuer Versand, Geld/Rechnung, Veroeffentlichung,
DNA-Laeufe oder Slack — diese Aussen-Gates bleiben strukturell erhalten (durch Weglassen).

Zweck: damit das kuenftige FaaS-Hermes-Profil und Hermes Desktop genau dieselben
gegateten Aktionen nutzen koennen wie die App und «Der Gerät» — ueber das offene
MCP-Protokoll, ohne Logik zu duplizieren.

Start (stdio):       <venv>/bin/python faas_mcp.py
Hermes-Registrierung (config.yaml des FaaS-Profils):
    faas:
      command: /home/dergeraet/faas-mcp/venv/bin/python
      args: [/home/dergeraet/faas-matching-wepublish/spark/faas_mcp.py]
      env: { DIRECTUS_TOKEN: <token>, WAECHTER_MANDANT: wepublish,
             WAECHTER_DIRECTUS_URL: http://localhost:8055 }
"""
from __future__ import annotations
import faas_actions as fa
import faas_prepare as fp
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("faas")


@mcp.tool()
def faas_status() -> str:
    """Mandantenreiner FaaS-Stand: aktive Medien, offene Vorschlaege (nach Typ), offene Fristen, offene Antraege. Read-only."""
    return fa.snapshot()


@mcp.tool()
def match_uebernehmen(medium: str, stiftung: str, user: str = "hermes") -> str:
    """Einen Foerderstiftungs-Match als neuen Antrag (Status identifiziert) uebernehmen — exakt wie der App-Knopf «In Antraege uebernehmen». Nur auf ausdrueckliche Anweisung. medium = Slug/Name, stiftung = Name oder numerische ID."""
    return fa.akt_match_uebernehmen(medium, stiftung, user)


@mcp.tool()
def antrag_status_setzen(status: str, antrag_id: str = "", medium: str = "", stiftung: str = "", user: str = "hermes") -> str:
    """Status eines bestehenden Antrags setzen: identifiziert, in_arbeit, eingereicht, zugesagt, abgelehnt, archiviert, ausgeblendet. Setzt KEINE Rechnung und versendet nichts. Antrag via antrag_id ODER medium+stiftung."""
    return fa.akt_antrag_status(antrag_id or None, medium or None, stiftung or None, status, user)


@mcp.tool()
def bemerkung_setzen(text: str, antrag_id: str = "", medium: str = "", stiftung: str = "", user: str = "hermes") -> str:
    """Interne Bemerkung an einen Antrag schreiben (max 2000 Zeichen). Antrag via antrag_id ODER medium+stiftung."""
    return fa.akt_bemerkung(antrag_id or None, medium or None, stiftung or None, text, user)


@mcp.tool()
def vorschlag_entscheiden(vorschlag_id: str, entscheidung: str, user: str = "hermes") -> str:
    """Einen offenen Assistenz-Vorschlag «freigeben» (bei Match-Vorschlaegen entsteht ein Antrag) oder «verneinen» (wird als Lern-Notiz festgehalten)."""
    return fa.akt_vorschlag(vorschlag_id, entscheidung, user)


# ─── Vorbereiter-Werkzeuge (read/prepare, kein Versand, kein Aussen-Schreiben) ───

@mcp.tool()
def gesuch_prompt_bauen(medium: str, stiftung: str) -> str:
    """Baut den fertigen Opus-Gesuch-Prompt fuer ein Medium-Stiftung-Paar (Copy-paste in die Claude-App, Gold-Gesuch schreibt Opus 4.8). Deterministisch, kein Versand. medium = Slug/Name, stiftung = Name oder numerische ID."""
    return fp.gesuch_prompt(medium, stiftung)


@mcp.tool()
def betrag_berechnen(medium: str, stiftung: str) -> str:
    """Schlaegt einen realistischen Foerderbetrag (CHF) mit Begruendung fuer ein Medium-Stiftung-Paar vor. Laeuft ~1-2 Min auf dem lokalen Spark-LLM. medium = Slug/Name, stiftung = Name oder ID."""
    return fp.betrag(medium, stiftung)


@mcp.tool()
def stiftung_info(stiftung: str) -> str:
    """Profil einer Foerderstiftung: Zweck, Foerderbedingungen, DNA (Foerderpraxis, Tags, Sound), Web, gespeicherter Betragvorschlag. stiftung = Name oder ID. Read-only."""
    return fp.stiftung_info(stiftung)


@mcp.tool()
def ausschreibungen_radar() -> str:
    """Offene Ausschreibungs-Radar-Treffer (vom Scout werktags gefunden, status=scout_unbestaetigt), die auf Review/Freigabe in der App warten. Read-only."""
    return fp.radar_status()


if __name__ == "__main__":
    mcp.run()
