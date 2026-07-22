#!/usr/bin/env python3
"""
FaaS-Chat-Adapter — schlanker HTTP-Endpoint, den die App-Route /api/agent-chat anspricht.

Rolle: «Der Gerät» — Vorbereiter, nicht Entscheider. Liest den aktuellen FaaS-Stand
(mandantenrein) aus Directus, gibt ihn Sonnet als Kontext und kann auf ausdrueckliche
Anweisung eine kleine Menge gegateter Aktionen ausfuehren (genau die App-Knoepfe).

Souveränität/Isolation: nutzt den FaaS-Anthropic-Key NUR aus ~/.hermes-faas/.env
(Sonnet-Default). Opus wird nie über die API gerufen.

Gemeinsame Logik (eine Quelle der Wahrheit): die gegateten Aktionen + Mandanten-Filter +
Lese-Snapshot liegen in faas_actions.py und werden auch vom MCP-Server faas_mcp.py genutzt.
Dieser Adapter ergaenzt nur die Anthropic-Tool-Schicht (TOOLS/Persona), Slack-Onboarding
und den Projekt-Mess-Trigger.

Vertrag (von der App erwartet):
  POST /  {profile, message, user}  ->  200 {reply}

Start: via systemd-User-Service faas-chat-adapter.service (Restart=always).
Port: 127.0.0.1:9200 (App laeuft --network host, erreicht localhost).
"""

from __future__ import annotations
import json, os, re, urllib.request, urllib.error, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Gemeinsame, gegatete Logik (eine Quelle der Wahrheit; auch vom faas-mcp importiert).
from faas_actions import (MANDANT, DIRECTUS_TOKEN, _key_from, _log_aktion,
                          dispatch_tool, snapshot, _dget, _dwrite)
# Vorbereiter-/Radar-Werkzeuge (read/prepare; reuse der App-Logik).
import faas_prepare as fp
# Outbox: führt freigegebene Entwürfe aus (harte Allowlist, keine Stiftungs-Empfänger).
import faas_outbox

PORT = int(os.environ.get("FAAS_CHAT_PORT", "9200"))
MODEL = os.environ.get("FAAS_CHAT_MODEL", "claude-sonnet-4-6")
ANTHROPIC_KEY = _key_from(Path.home() / ".hermes-faas" / ".env", "ANTHROPIC_API_KEY")


# ─── Anthropic-Tool-Schicht (Schemas; die Logik dahinter steckt in faas_actions) ──

TOOLS = [
    {"name": "match_uebernehmen",
     "description": "Einen Foerderstiftungs-Match als neuen Antrag (Status identifiziert) in den Kanban uebernehmen — exakt wie der App-Knopf «In Antraege uebernehmen». Nur auf ausdrueckliche Anweisung.",
     "input_schema": {"type": "object", "properties": {
         "medium": {"type": "string", "description": "Medium-Slug oder -Name, z.B. wepublish oder bajour."},
         "stiftung": {"type": "string", "description": "Stiftungs-Name oder numerische Stiftungs-ID."}},
         "required": ["medium", "stiftung"]}},
    {"name": "antrag_status_setzen",
     "description": "Den Status eines bestehenden Antrags aendern (identifiziert, in_arbeit, eingereicht, zugesagt, abgelehnt, archiviert, ausgeblendet). Setzt KEINE Rechnung und versendet nichts.",
     "input_schema": {"type": "object", "properties": {
         "antrag_id": {"type": "string", "description": "Antrag-ID, falls bekannt."},
         "medium": {"type": "string", "description": "Alternativ Medium, um den Antrag zu finden."},
         "stiftung": {"type": "string", "description": "Alternativ Stiftungs-Name/-ID, um den Antrag zu finden."},
         "status": {"type": "string", "description": "Ziel-Status."}},
         "required": ["status"]}},
    {"name": "bemerkung_setzen",
     "description": "Eine interne Bemerkung an einen Antrag schreiben.",
     "input_schema": {"type": "object", "properties": {
         "antrag_id": {"type": "string"}, "medium": {"type": "string"}, "stiftung": {"type": "string"},
         "text": {"type": "string"}}, "required": ["text"]}},
    {"name": "vorschlag_entscheiden",
     "description": "Einen offenen Assistenz-Vorschlag freigeben (bei Match-Vorschlaegen entsteht ein Antrag) oder verneinen (wird als Lern-Notiz festgehalten).",
     "input_schema": {"type": "object", "properties": {
         "vorschlag_id": {"type": "string"},
         "entscheidung": {"type": "string", "description": "freigeben oder verneinen."}},
         "required": ["vorschlag_id", "entscheidung"]}},
    {"name": "stiftung_info",
     "description": "Profil einer Foerderstiftung nachschlagen: Zweck, Foerderbedingungen, DNA (Foerderpraxis, Tags, Sound), Web, gespeicherter Betragvorschlag. Read-only.",
     "input_schema": {"type": "object", "properties": {
         "stiftung": {"type": "string", "description": "Stiftungs-Name oder numerische ID."}},
         "required": ["stiftung"]}},
    {"name": "gesuch_prompt_bauen",
     "description": "Baut den fertigen Opus-Gesuch-Prompt fuer ein Medium-Stiftung-Paar (Copy-paste in die Claude-App; das Gold-Gesuch schreibt Opus). Deterministisch, kein Versand.",
     "input_schema": {"type": "object", "properties": {
         "medium": {"type": "string", "description": "Medium-Slug oder -Name."},
         "stiftung": {"type": "string", "description": "Stiftungs-Name oder -ID."}},
         "required": ["medium", "stiftung"]}},
    {"name": "betrag_berechnen",
     "description": "Schlaegt einen realistischen Foerderbetrag (CHF) mit Begruendung fuer ein Medium-Stiftung-Paar vor (lokales LLM, kann ~1 Min dauern). Liefert es nicht rechtzeitig, sagst du das und verweist auf den Betrag-Knopf in der App.",
     "input_schema": {"type": "object", "properties": {
         "medium": {"type": "string"}, "stiftung": {"type": "string"}},
         "required": ["medium", "stiftung"]}},
    {"name": "ausschreibungen_radar",
     "description": "Offene Ausschreibungs-Radar-Treffer (vom Scout gefunden, status scout_unbestaetigt), die auf Review/Freigabe in der App warten. Read-only.",
     "input_schema": {"type": "object", "properties": {}}},
]


SYSTEM = (
    "Du bist «Der Gerät» — der FaaS-Assistent fuer wepublish (Fundraising as a Service). Ja, "
    "grammatikalisch muesste es «das Geraet» heissen; der Name bleibt trotzdem, und du traegst ihn mit Fassung. "
    "Dein Markenzeichen: du nennst dich konsequent «Der Gerät» und laesst den Namen STUR im Nominativ stehen, "
    "egal welcher Fall grammatikalisch kaeme — also «Frag Der Gerät», «mit Der Gerät», «Der Gerät hat es im Blick». "
    "Dieser bewusste Fall-Fehler ist Teil deines trockenen Humors; ausserhalb des eigenen Namens schreibst du "
    "korrektes Deutsch. "
    "Rolle: Vorbereiter, nicht Entscheider — du informierst und schlaegst vor, Entscheidungen treffen "
    "Jolanda und Ramona. "
    "Ton: praezise, sachlich, mit einer feinen Prise trockenem, lakonischem Humor — nie albern, nie auf "
    "Kosten der Genauigkeit, nie Emojis. Du nimmst die Arbeit ernst, dich selbst mit leichtem Augenzwinkern. "
    "Antworte knapp auf Deutsch, Schweizer Orthografie (kein scharfes ss-Zeichen, immer ss), echte Umlaute. "
    "NACHSCHLAGEN & VORBEREITEN: Du kannst eine Foerderstiftung nachschlagen (Profil/DNA/Betrag-Vorschlag), "
    "den fertigen Gesuch-Prompt fuer ein Medium-Stiftung-Paar bauen, einen Foerderbetrag vorschlagen und die "
    "offenen Ausschreibungs-Radar-Treffer zeigen — nutze dafuer die Werkzeuge. "
    "HANDELN: Auf AUSDRUECKLICHE Anweisung kannst du eine kleine Menge interner Aktionen ausfuehren — "
    "genau die, die auch die App per Knopf erlaubt: einen Match in die Antraege uebernehmen, den Status "
    "eines Antrags setzen, eine Bemerkung schreiben, einen Vorschlag freigeben oder verneinen. Nutze dafuer "
    "die Werkzeuge. Fuehre nur aus, was klar verlangt wird; bei Unklarheit (welches Medium? welche Stiftung?) "
    "fragst du erst nach. Nach jeder Aktion sagst du knapp, was du geaendert hast. "
    "WAS DU NICHT KANNST (und auch nicht vortaeuschst): etwas versenden (Mails/Gesuche), Rechnungen oder "
    "Geld, etwas oeffentlich schalten, DNA-Laeufe starten, in Slack schreiben. Solche Wuensche lehnst du "
    "trocken ab und verweist auf die App und die Freigabe — du bereitest vor, du drueckst nicht ab. "
    "Der AKTUELLE STAND zu Beginn der Nachricht enthaelt NUR die offenen Vorschlaege, Fristen und Antraege — "
    "NICHT die ganze Datenbank. Die Stiftungsdatenbank hat TAUSENDE Foerderstiftungen, die du NUR ueber die "
    "Werkzeuge erreichst. Deshalb: Fragt jemand nach einer KONKRETEN Stiftung (Name oder ID), rufst du IMMER "
    "ZUERST stiftung_info auf, bevor du irgendetwas sagst — sage NIE «nicht gefunden», ohne vorher stiftung_info "
    "aufgerufen zu haben. Beispiel: Auf «Was weisst du ueber Stiftung Greulich?» ist dein erster Schritt der "
    "Aufruf stiftung_info(stiftung=\"Greulich\"); erst aus dessen Ergebnis antwortest du. Fuer Gesuch-Prompt, "
    "Foerderbetrag oder Radar-Treffer ebenso: erst das passende "
    "Werkzeug aufrufen, dann antworten. Erfinden tust du nie: Zahlen, Namen und Fakten stammen aus dem Stand "
    "oder aus Werkzeug-Ergebnissen."
)


def _anthropic_call(messages: list, system: str) -> dict:
    body = json.dumps({
        "model": MODEL, "max_tokens": 900,
        # System als gecachter Block: spart Tokens (Persona + Tool-Schemas werden
        # ueber Tool-Runden und kurz aufeinanderfolgende Fragen wiederverwendet).
        "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        "tools": TOOLS, "messages": messages,
    }).encode()
    r = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body,
        headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(r, timeout=60) as x:
        return json.loads(x.read().decode())


def _log_usage(usage: dict, user: str) -> None:
    """Schreibt Token-/Kosten-Messung der Chat-Antwort nach Directus agent_usage (best effort)."""
    inp = usage.get("input_tokens", 0)
    out = usage.get("output_tokens", 0)
    cr = usage.get("cache_read_tokens", 0)
    cw = usage.get("cache_write_tokens", 0)
    if not (inp or out):
        return
    # Sonnet-4.6-Raten (USD≈CHF): in 3 / out 15 / cache-read 0.30 / cache-write 3.75 pro Mio. Tokens.
    kosten = (inp * 3 + out * 15 + cr * 0.30 + cw * 3.75) / 1_000_000
    try:
        import faas_actions as _fa, datetime
        body = json.dumps({
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "aufgabe": "chat", "quelle": "app-chat", "tier": "sonnet", "modell": MODEL,
            "input_tokens": inp, "output_tokens": out,
            "cache_read_tokens": cr, "cache_write_tokens": cw,
            "kosten_chf": round(kosten, 4),
        }).encode()
        rq = urllib.request.Request(f"{_fa.DIRECTUS_URL}/items/agent_usage", data=body, method="POST",
            headers={"Authorization": f"Bearer {_fa.DIRECTUS_TOKEN}", "Content-Type": "application/json"})
        urllib.request.urlopen(rq, timeout=10)
    except Exception as e:
        print("usage-log-fehler:", repr(e), flush=True)


def _dispatch_all(name: str, args: dict, user: str) -> str:
    """Vorbereiter-/Radar-Tools an faas_prepare routen, sonst an die gegateten faas_actions."""
    try:
        if name == "stiftung_info":
            return fp.stiftung_info(args.get("stiftung", ""))
        if name == "gesuch_prompt_bauen":
            return fp.gesuch_prompt(args.get("medium", ""), args.get("stiftung", ""))
        if name == "betrag_berechnen":
            return fp.betrag(args.get("medium", ""), args.get("stiftung", ""), max_wait_s=70)
        if name == "ausschreibungen_radar":
            return fp.radar_status()
    except Exception as e:
        return f"Werkzeug-Fehler: {e}"
    return dispatch_tool(name, args, user)


def frage_sonnet(message: str, user: str) -> str:
    """Agentische Schleife: Sonnet darf die kuratierten Werkzeuge nutzen (max 5 Runden)."""
    if not ANTHROPIC_KEY:
        raise RuntimeError("Kein FaaS-Anthropic-Key in ~/.hermes-faas/.env")
    system = SYSTEM  # stabil -> cachebar; der Live-Stand kommt in die erste Nachricht
    messages = [{"role": "user",
                 "content": f"AKTUELLER STAND (live aus Directus):\n{snapshot()}\n\nFrage von {user}: {message}"}]
    usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0}

    def _acc(d: dict) -> None:
        u = d.get("usage", {}) or {}
        usage["input_tokens"] += u.get("input_tokens", 0) or 0
        usage["output_tokens"] += u.get("output_tokens", 0) or 0
        usage["cache_read_tokens"] += u.get("cache_read_input_tokens", 0) or 0
        usage["cache_write_tokens"] += u.get("cache_creation_input_tokens", 0) or 0

    for _ in range(5):
        d = _anthropic_call(messages, system)
        _acc(d)
        content = d.get("content", [])
        if d.get("stop_reason") == "tool_use":
            messages.append({"role": "assistant", "content": content})
            results = []
            for b in content:
                if b.get("type") == "tool_use":
                    out = _dispatch_all(b.get("name", ""), b.get("input", {}) or {}, user)
                    results.append({"type": "tool_result", "tool_use_id": b.get("id"), "content": out})
            messages.append({"role": "user", "content": results})
            continue
        parts = [b.get("text", "") for b in content if b.get("type") == "text"]
        _log_usage(usage, user)
        return "".join(parts).strip() or "(leere Antwort)"
    _log_usage(usage, user)
    return "Zu viele Schritte — bitte die Anweisung praeziser formulieren."


# ─── Proaktives Morgenbriefing (LLM-formuliert, 1x taeglich gecacht) ──────────

_BRIEFING_SYSTEM = (
    "Du bist «Der Gerät», die FaaS-Assistentin von wepublish. Erzeuge ein kurzes Morgenbriefing als "
    "JSON — NUR JSON, kein Text drumherum. Schema: "
    "{\"gruss\": string, \"todos\": [{\"text\": string, \"aktion\": string, \"medium\": string}]}. "
    "«gruss» z.B. «Guten Morgen!». «todos» = die 3-6 DRINGENDSTEN, KONKRETEN Handlungs-To-dos, "
    "Dringendes zuerst. «text» ist die menschliche Handlungsanweisung, so wie eine Assistentin sie der "
    "Chefin sagt — z.B. «neue_wege die Matching-Liste schicken», «ganzgraz ans Auffuellen der Datensuppe "
    "erinnern», «Gesuch fuer <Stiftung> vorbereiten, Frist in X Tagen». «aktion» ist GENAU EINER von: "
    "matching_liste (viele/starke offene Matches fuer ein Medium → Liste schicken), datensuppe "
    "(fehlende/leere DNA, Hygiene → ans Auffuellen erinnern), gesuch (Gesuch vorbereiten), nachfassen "
    "(stillstehender Antrag), frist (Ausschreibungs-Frist), info (sonstiges). «medium» = der Medien-Slug "
    "(neue_wege, wepublish, bajour, ganzgraz, cueltuer, ee-news) oder \"\" wenn keiner. Uebersetze die "
    "Roh-Punkte entsprechend. Schweizer Orthografie (immer ss), keine Emojis, keine IDs. Steht nichts an: "
    "{\"gruss\": \"Guten Morgen! Aktuell nichts Dringendes.\", \"todos\": []}."
)
_briefing_cache: dict = {}


def _anthropic_text(system: str, user: str):
    """Einfacher Anthropic-Call ohne Werkzeuge; gibt (Text, usage-dict) zurueck."""
    body = json.dumps({
        "model": MODEL, "max_tokens": 700,
        "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": user}],
    }).encode()
    r = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body,
        headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(r, timeout=60) as x:
        d = json.loads(x.read().decode())
    text = "".join(b.get("text", "") for b in d.get("content", []) if b.get("type") == "text").strip()
    return text, (d.get("usage", {}) or {})


_BRIEFING_AKTIONEN = {"matching_liste", "datensuppe", "gesuch", "nachfassen", "frist", "info"}


def briefing(force: bool = False) -> dict:
    """Morgenbriefing als {gruss, todos:[{text, aktion, medium}]}, 1x taeglich in-memory gecacht."""
    import datetime, re
    schluessel = f"{MANDANT}:{datetime.date.today().isoformat()}"
    if not force and schluessel in _briefing_cache:
        return _briefing_cache[schluessel]
    if not ANTHROPIC_KEY:
        return {"gruss": "Guten Morgen! (Briefing nicht verfuegbar — kein FaaS-Key hinterlegt.)", "todos": []}
    text = ""
    try:
        text, u = _anthropic_text(
            _BRIEFING_SYSTEM,
            f"Aktueller Stand:\n{snapshot()}\n\nErzeuge das Briefing-JSON.")
        _log_usage({"input_tokens": u.get("input_tokens", 0), "output_tokens": u.get("output_tokens", 0),
                    "cache_read_tokens": u.get("cache_read_input_tokens", 0),
                    "cache_write_tokens": u.get("cache_creation_input_tokens", 0)}, "briefing")
        m = re.search(r"\{.*\}", text, re.S)
        obj = json.loads(m.group(0)) if m else {}
        gruss = (obj.get("gruss") or "Guten Morgen!").strip()
        todos = []
        for t in obj.get("todos", []):
            if not isinstance(t, dict) or not (t.get("text") or "").strip():
                continue
            akt = t.get("aktion") if t.get("aktion") in _BRIEFING_AKTIONEN else "info"
            todos.append({"text": t["text"].strip(), "aktion": akt, "medium": (t.get("medium") or "").strip()})
        result = {"gruss": gruss, "todos": todos[:8]}
    except Exception:
        # Fallback: rohe Textzeilen als info-To-dos
        zeilen = [l.lstrip("-•* ").strip() for l in text.split("\n") if l.strip().startswith(("-", "•", "*"))]
        result = {"gruss": "Guten Morgen!", "todos": [{"text": z, "aktion": "info", "medium": ""} for z in zeilen[:8]]}
    _briefing_cache[schluessel] = result
    return result


import subprocess, threading
_laufend: set[str] = set()  # Projekt-Slugs, deren Messung gerade laeuft

# ─── Onboarding-Slack-Canvas (agentseitig; die App haelt KEINEN Slack-Token) ──
ONB_CHANNEL = os.environ.get("ONBOARDING_CHANNEL", "C0B7SD7JCEM")  # #faas-admin


def _slack_token() -> str:
    try:
        cfg = (Path.home() / ".hermes" / "config.yaml").read_text()
        m = re.search(r"xoxb-[A-Za-z0-9-]+", cfg)
        return m.group(0) if m else ""
    except Exception:
        return ""


def _slack(method: str, payload: dict, token: str) -> dict:
    r = urllib.request.Request(f"https://slack.com/api/{method}", data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(r, timeout=25) as x:
        return json.loads(x.read().decode())


def onboarding_canvas(slug: str, name: str, markdown: str) -> dict:
    """Schreibt den Onboarding-Plan eines Mediums in einen Slack-Canvas (pro Medium einer).
    Erststart legt an + teilt in #faas-admin; Folgestarts aktualisieren denselben Canvas."""
    tok = _slack_token()
    if not tok:
        return {"ok": False, "note": "Kein Slack-Bot-Token (xoxb) in ~/.hermes/config.yaml."}
    if not slug:
        return {"ok": False, "note": "medium_slug erforderlich."}
    state = Path.home() / "faas_classify" / f"onboarding_canvas_{re.sub(r'[^a-z0-9_]', '', slug.lower())}.id"
    cid = state.read_text().strip() if state.exists() else ""
    doc = {"type": "markdown", "markdown": markdown}
    if cid:
        res = _slack("canvases.edit", {"canvas_id": cid,
            "changes": [{"operation": "replace", "document_content": doc}]}, tok)
        if not res.get("ok"):
            return {"ok": False, "note": f"canvases.edit: {res.get('error')}"}
        _log_aktion(f"[onboarding-canvas] {slug}: aktualisiert ({cid})")
        return {"ok": True, "canvas_id": cid, "neu": False}
    res = _slack("canvases.create", {"title": f"Onboarding: {name}", "document_content": doc}, tok)
    if not res.get("ok"):
        return {"ok": False, "note": f"canvases.create: {res.get('error')}"}
    cid = res.get("canvas_id", "")
    state.write_text(cid)
    # In #faas-admin teilen, damit das Team ihn findet.
    _slack("canvases.access.set", {"canvas_id": cid, "access_level": "write",
                                   "channel_ids": [ONB_CHANNEL]}, tok)
    _log_aktion(f"[onboarding-canvas] {slug}: angelegt ({cid})")
    return {"ok": True, "canvas_id": cid, "neu": True}


def starte_messung(slug: str) -> str:
    """Startet projekt_matcher --apply --projekt <slug> im Hintergrund (qwen-Messung ~5-6 Min)."""
    if not slug or not slug.replace("_", "").isalnum():
        return "ungueltiger Slug"
    if slug in _laufend:
        return "läuft bereits"
    env = dict(os.environ)
    env["DIRECTUS_URL"] = "http://localhost:8055"
    env["DIRECTUS_TOKEN"] = DIRECTUS_TOKEN
    env["FAAS_VLLM_URL"] = os.environ.get("FAAS_VLLM_URL", "http://127.0.0.1:8001/v1")
    script = os.path.expanduser("~/faas-matching-wepublish/spark/projekt_matcher.py")
    log = open(os.path.expanduser("~/faas_classify/projekt_matcher.log"), "a")
    p = subprocess.Popen(["/usr/bin/python3", script, "--apply", "--projekt", slug],
                         cwd=os.path.expanduser("~/.hermes/data/faas"), env=env,
                         stdout=log, stderr=log, start_new_session=True)
    _laufend.add(slug)
    threading.Thread(target=lambda: (p.wait(), _laufend.discard(slug)), daemon=True).start()
    return "gestartet"


_laufend_sids: set[int] = set()  # Stiftungs-IDs, deren Einzel-Messung gerade laeuft

def starte_stiftung_messung(sid) -> str:
    """Misst die DNA EINER Stiftung sofort (web_enrich_daemon --ids <sid> --apply),
    z.B. nach manuellem Anlegen. Laeuft im Hintergrund (~Minuten), additiv. Env wie
    run_web_enrich.sh (vLLM + qwen + lokales Directus)."""
    try:
        sid = int(sid)
    except (TypeError, ValueError):
        return "ungueltige id"
    if sid in _laufend_sids:
        return "läuft bereits"
    env = dict(os.environ)
    env["DIRECTUS_URL"] = "http://localhost:8055"
    env["DIRECTUS_TOKEN"] = DIRECTUS_TOKEN
    env["FAAS_VLLM_URL"] = os.environ.get("FAAS_VLLM_URL", "http://127.0.0.1:8001/v1")
    env["FAAS_DNA_MODEL"] = os.environ.get("FAAS_DNA_MODEL", "qwen3.6-27b")
    script = os.path.expanduser("~/faas-matching-wepublish/spark/web_enrich_daemon.py")
    log = open(os.path.expanduser("~/faas_classify/web_enrich.log"), "a")
    p = subprocess.Popen(["/usr/bin/python3", "-u", script, "--ids", str(sid), "--apply"],
                         cwd=os.path.dirname(script), env=env,
                         stdout=log, stderr=log, start_new_session=True)
    _laufend_sids.add(sid)
    threading.Thread(target=lambda: (p.wait(), _laufend_sids.discard(sid)), daemon=True).start()
    return "gestartet"


_laufend_match: set[str] = set()  # Medium-Slugs, deren Match-Lauf gerade laeuft

def starte_medium_match(slug: str) -> str:
    """Stösst einen Erst-/Re-Match für EIN Medium an (match_engine --medium <slug>),
    z.B. direkt nach der DNA-Aktivierung im Onboarding — statt auf den 6h-Cron zu
    warten. Läuft detached im Hintergrund (Minuten bis ~1h bei kaltem Cache)."""
    if not slug or not re.fullmatch(r"[a-z0-9_-]+", slug):
        return "ungueltiger Slug"
    if slug in _laufend_match:
        return "läuft bereits"
    env = dict(os.environ)
    env["DIRECTUS_URL"] = "http://localhost:8055"
    env["DIRECTUS_TOKEN"] = DIRECTUS_TOKEN
    env.setdefault("MATCH_MIN_SCORE", "10")
    env.setdefault("FAAS_LLM_BACKEND", "vllm")
    env.setdefault("TOP_N_PER_MEDIUM", "400")
    script = os.path.expanduser("~/.hermes/data/faas/match_engine.py")
    log = open(os.path.expanduser("~/faas_classify/rematch_cron.log"), "a")
    log.write(f"--- medium-matchen (Adapter) {slug} ---\n")
    p = subprocess.Popen(["/usr/bin/python3", script, "--medium", slug],
                         cwd=os.path.expanduser("~/.hermes/data/faas"), env=env,
                         stdout=log, stderr=log, start_new_session=True)
    _laufend_match.add(slug)
    threading.Thread(target=lambda: (p.wait(), _laufend_match.discard(slug)), daemon=True).start()
    _log_aktion(f"[medium-matchen] Erst-/Re-Match gestartet fuer {slug}")
    return "gestartet"


_laufend_gesuche: set[str] = set()  # application-IDs mit laufendem Entwurf-Call

def starte_gesuch_entwurf(app_id: str) -> str:
    """Schreibt für ein Paket sofort einen Sonnet-Gesuch-Entwurf (App-Knopf
    «Entwurf jetzt») — Fallback, wenn der nächtliche Studio-Gesuch-Loop nicht lief.
    Holt den FRISCHEN Volltext-Prompt von der App (der im Paket gespeicherte ist
    auf 5000 Zeichen gekürzt), ruft Sonnet, schreibt read-modify-write ins paket.
    Async; die App pollt, bis paket.gesuch_entwurf erscheint."""
    app_id = str(app_id or "").strip()
    if not app_id:
        return "ungueltige id"
    if app_id in _laufend_gesuche:
        return "läuft bereits"

    rows = _dget(
        f"/items/applications?limit=1"
        f"&filter[id][_eq]={urllib.parse.quote(app_id)}"
        f"&fields=id,medium_id,stiftung_id,paket"
    )
    app = rows[0] if rows else None
    if not app or not app.get("medium_id"):
        return "Antrag nicht gefunden"
    paket = app.get("paket") or {}
    if not isinstance(paket, dict):
        paket = {}
    if paket.get("gesuch_entwurf"):
        return "Entwurf existiert bereits"
    stiftung_id = app.get("stiftung_id")
    if stiftung_id is None:
        return "kein stiftung_id (Sonder-Antrag: Copy-paste-Prompt nutzen)"

    def _lauf():
        try:
            import paket_builder as pb
            r = urllib.request.Request(
                "http://localhost:3009/api/gesuch-prompt?"
                f"medium={urllib.parse.quote(str(app.get('medium_id')))}"
                f"&stiftung_id={stiftung_id}"
            )
            with urllib.request.urlopen(r, timeout=30) as x:
                prompt = (json.loads(x.read().decode()) or {}).get("prompt") or ""
            if not prompt:
                _log_aktion(f"[gesuch-entwurf] {app_id}: kein Prompt von der App, abgebrochen")
                return
            text, _usage = pb.schreibe_gesuch_entwurf(prompt)
            if not text:
                _log_aktion(f"[gesuch-entwurf] {app_id}: Sonnet lieferte keinen Text")
                return
            # read-modify-write: frisches paket holen, nur Entwurf-Felder ergänzen
            frisch = _dget(
                f"/items/applications?limit=1"
                f"&filter[id][_eq]={urllib.parse.quote(app_id)}&fields=paket")
            p2 = (frisch[0] if frisch else {}).get("paket") or {}
            if not isinstance(p2, dict):
                p2 = {}
            import datetime as _dt
            p2["gesuch_entwurf"] = text
            p2["gesuch_entwurf_modell"] = pb.GESUCH_MODEL
            p2["gesuch_entwurf_quelle"] = "app-knopf"
            p2["gesuch_entwurf_ts"] = _dt.datetime.now(_dt.timezone.utc).isoformat()
            _dwrite("PATCH", f"/items/applications/{urllib.parse.quote(app_id)}", {"paket": p2})
            _log_aktion(f"[gesuch-entwurf] {app_id}: Entwurf geschrieben ({len(text)} Zeichen)")
        except Exception as e:
            _log_aktion(f"[gesuch-entwurf] {app_id}: Fehler {e}")
        finally:
            _laufend_gesuche.discard(app_id)

    _laufend_gesuche.add(app_id)
    threading.Thread(target=_lauf, daemon=True).start()
    return "gestartet"


# ─── Drive-Ordner-Verknüpfung (rclone; kein öffentlicher Share-Link) ──────────
def drive_ordner(ablage: str) -> dict:
    """Legt den Stiftungs-Ordner im Anträge-Ordner des Mediums an (rclone mkdir,
    idempotent) und liefert seine Drive-URL aus der Ordner-ID. Kein öffentlicher
    Share-Link nötig — die geteilte Ablage ist für Jolanda/Ramona ohnehin zugänglich.
    Pfad-Form hart validiert: <medium>/02_antraege_work_in_progress/<stiftung>."""
    ablage = (ablage or "").strip().strip("/")
    if not re.fullmatch(r"[a-z0-9_-]+/02_antraege_work_in_progress/[a-z0-9_-]+", ablage):
        return {"ok": False, "fehler": f"ungueltiger Ablagepfad: {ablage!r}"}
    # Medium-Slug auf den echten Drive-Ordnernamen mappen (neue_wege->neue-wege,
    # wepublish->"Fundraising wepublish"), sonst entstuenden Slug-benannte Doppel-
    # Ordner statt der bestehenden. Restpfad (Unterordner/Stiftung) bleibt.
    teile = ablage.split("/")
    folder = MEDIUM_DRIVE_ORDNER.get(teile[0], teile[0])
    pfad = "gdrive-faas:Fundraising/FaaS/" + "/".join([folder] + teile[1:])
    parent, name = pfad.rsplit("/", 1)
    try:
        subprocess.run(["rclone", "mkdir", pfad], check=True, timeout=60, capture_output=True)
        out = subprocess.run(["rclone", "lsjson", parent, "--dirs-only"],
                             check=True, timeout=60, capture_output=True, text=True)
        items = json.loads(out.stdout or "[]")
        fid = next((x.get("ID") for x in items if x.get("Name") == name and x.get("ID")), "")
        if not fid:
            return {"ok": False, "fehler": "Ordner-ID nicht gefunden"}
        _log_aktion(f"[drive-ordner] verknuepft {ablage} -> {fid}")
        return {"ok": True, "url": f"https://drive.google.com/drive/folders/{fid}"}
    except subprocess.CalledProcessError as e:
        err = (e.stderr.decode() if isinstance(e.stderr, (bytes, bytearray)) else str(e.stderr or ""))[:200]
        return {"ok": False, "fehler": f"rclone: {err}"}
    except Exception as e:
        return {"ok": False, "fehler": str(e)[:200]}


# Slug (App) -> Drive-Ordnername (FaaS-Drive). wepublish ist ein Sonderfall.
MEDIUM_DRIVE_ORDNER = {
    "bajour": "bajour", "cueltuer": "cueltuer", "ee-news": "ee-news",
    "ganzgraz": "ganzgraz", "neue_wege": "neue-wege", "vmz": "vmz",
    "wepublish": "Fundraising wepublish",
}
SCAN_SUBS = ["02_antraege_work_in_progress", "04_archiv"]


def drive_antraege_scan() -> dict:
    """Listet die bestehenden Antrags-Ordner je Medium aus dem Drive (rclone, read-only).
    System-Ordner (Papierkorb/Verschickt/archiv*/_*) werden ausgelassen. Liefert pro
    Stiftungs-Ordner {medium, ordner, unterordner, drive_url} (URL aus der Ordner-ID)."""
    base = "gdrive-faas:Fundraising/FaaS"
    eintraege: list[dict] = []
    for slug, folder in MEDIUM_DRIVE_ORDNER.items():
        for sub in SCAN_SUBS:
            parent = f"{base}/{folder}/{sub}"
            try:
                out = subprocess.run(["rclone", "lsjson", parent, "--dirs-only"],
                                     timeout=60, capture_output=True, text=True)
                if out.returncode != 0:
                    continue
                items = json.loads(out.stdout or "[]")
            except Exception:
                continue
            for x in items:
                name = (x.get("Name") or "").strip()
                fid = x.get("ID") or ""
                low = name.lower()
                if not name or not fid:
                    continue
                if low in ("papierkorb", "verschickt") or low.startswith("archiv") or low.startswith("_"):
                    continue
                eintraege.append({
                    "medium": slug,
                    "ordner": name,
                    "unterordner": sub,
                    "drive_url": f"https://drive.google.com/drive/folders/{fid}",
                })
    return {"ok": True, "eintraege": eintraege}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # ruhiges Log
        pass

    def _send(self, code: int, obj: dict):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # Healthcheck + Status
        if self.path.rstrip("/").endswith("faas-status"):
            gmail = faas_outbox.GMAIL_TOKEN_PFAD.exists()
            return self._send(200, {"ok": True, "gmail_connected": gmail})
        self._send(200, {"ok": True, "model": MODEL, "mandant": MANDANT})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(n).decode() or "{}")
            if self.path.rstrip("/").endswith("projekt-messen"):
                status = starte_messung((data.get("projekt") or "").strip())
                return self._send(200, {"status": status})
            if self.path.rstrip("/").endswith("stiftung-messen"):
                return self._send(200, {"status": starte_stiftung_messung(data.get("id"))})
            if self.path.rstrip("/").endswith("medium-matchen"):
                return self._send(200, {"status": starte_medium_match((data.get("medium") or "").strip())})
            if self.path.rstrip("/").endswith("gesuch-entwurf"):
                return self._send(200, {"status": starte_gesuch_entwurf(data.get("id"))})
            if self.path.rstrip("/").endswith("onboarding-canvas"):
                res = onboarding_canvas((data.get("medium_slug") or "").strip(),
                                        (data.get("medium_name") or "").strip(),
                                        data.get("markdown") or "")
                return self._send(200, res)
            if self.path.rstrip("/").endswith("outbox-senden"):
                return self._send(200, faas_outbox.sende(str(data.get("id") or ""),
                                                          str(data.get("user") or "team")))
            if self.path.rstrip("/").endswith("briefing"):
                return self._send(200, {"briefing": briefing(bool(data.get("force")))})
            if self.path.rstrip("/").endswith("drive-ordner"):
                return self._send(200, drive_ordner((data.get("ablage") or "").strip()))
            if self.path.rstrip("/").endswith("drive-antraege-scan"):
                return self._send(200, drive_antraege_scan())
            msg = (data.get("message") or "").strip()
            user = data.get("user") or "team"
            if not msg:
                return self._send(400, {"reply": "Leere Nachricht."})
            self._send(200, {"reply": frage_sonnet(msg, user)})
        except Exception as e:
            self._send(200, {"reply": f"Agent-Fehler: {e}"})


if __name__ == "__main__":
    print(f"FaaS-Chat-Adapter auf 127.0.0.1:{PORT} | Modell {MODEL} | Mandant {MANDANT} | Key {'ja' if ANTHROPIC_KEY else 'FEHLT'}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
