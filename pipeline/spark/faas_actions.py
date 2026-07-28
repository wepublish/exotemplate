#!/usr/bin/env python3
"""
faas_actions — gemeinsame, gegatete FaaS-Aktions- und Lese-Logik (eine Quelle der Wahrheit).

Reine Directus-Logik (nur stdlib): die vier kuratierten Schreibaktionen, die EXAKT die
Ein-Klick-Aktionen der App spiegeln, plus ein mandantenreiner Lese-Snapshot. KEINE HTTP-
oder Anthropic-Abhaengigkeit. Wird sowohl vom HTTP-Adapter «Der Gerät» (faas_chat_adapter.py)
als auch vom MCP-Server (faas_mcp.py) importiert — damit Gates und Mandanten-Filter an
genau einer Stelle leben und nicht auseinanderdriften.

Harte Aussen-Gates bleiben strukturell erhalten: es gibt bewusst KEINE Funktion fuer
Versand, Geld/Rechnung, Veroeffentlichung, DNA-Laeufe oder Slack-Schreiben.

Env: WAECHTER_MANDANT (Default wepublish), WAECHTER_DIRECTUS_URL (Default localhost:8055),
DIRECTUS_TOKEN (sonst aus ~/.hermes/.env).
"""
from __future__ import annotations
import json, os, urllib.request, urllib.parse
from datetime import datetime, timezone
from pathlib import Path

MANDANT = os.environ.get("WAECHTER_MANDANT", "wepublish")
DIRECTUS_URL = os.environ.get("WAECHTER_DIRECTUS_URL", "http://localhost:8055").rstrip("/")


def _key_from(path: Path, name: str) -> str:
    if not path.exists():
        return ""
    for l in path.read_text().splitlines():
        if l.strip().startswith(name) and "=" in l:
            return l.split("=", 1)[1].strip().strip('"')
    return ""


DIRECTUS_TOKEN = os.environ.get("DIRECTUS_TOKEN") or _key_from(Path.home() / ".hermes" / ".env", "DIRECTUS_TOKEN")


def _dget(path: str) -> list:
    r = urllib.request.Request(f"{DIRECTUS_URL}{path}", headers={"Authorization": f"Bearer {DIRECTUS_TOKEN}"})
    with urllib.request.urlopen(r, timeout=20) as x:
        d = json.loads(x.read().decode()).get("data", [])
        return d if isinstance(d, list) else [d]


def _dwrite(method: str, path: str, body: dict) -> dict:
    """POST/PATCH gegen Directus. Gibt das geschriebene Item zurueck."""
    r = urllib.request.Request(
        f"{DIRECTUS_URL}{path}", data=json.dumps(body).encode(), method=method,
        headers={"Authorization": f"Bearer {DIRECTUS_TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=25) as x:
        return json.loads(x.read().decode()).get("data", {})


# ─── Handelnde Aktionen (kuratiert, gegatet, mandantenrein) ───────────────────
# Spiegeln EXAKT die Ein-Klick-Aktionen der App. Es gibt bewusst KEINE Funktion fuer
# Versand, Geld/Rechnung, Veroeffentlichung, DNA-Laeufe oder Slack-Schreiben —
# diese Aussen-Gates bleiben strukturell erhalten.

STATUS_STATION = {
    "identifiziert": 1, "in_arbeit": 2, "eingereicht": 3, "zugesagt": 4,
    "abgelehnt": 5, "archiviert": 6, "ausgeblendet": 7,
}
_AKTIONS_LOG = os.path.expanduser("~/faas_classify/agent_aktionen.log")


def _log_aktion(text: str) -> None:
    try:
        with open(_AKTIONS_LOG, "a") as f:
            f.write(text.rstrip() + "\n")
    except Exception:
        pass


def _find_medium(such: str) -> dict | None:
    """Medium per Slug (exakt) oder Name (icontains), mandantenrein."""
    such = (such or "").strip()
    if not such:
        return None
    M = f"&filter[mandant][_eq]={MANDANT}&filter[is_active][_eq]=true"
    for q in (f"filter[slug][_eq]={urllib.parse.quote(such)}",
              f"filter[name][_icontains]={urllib.parse.quote(such)}"):
        hits = _dget(f"/items/faas_medien?limit=5&{q}{M}&fields=id,slug,name")
        if hits:
            return hits[0]
    return None


def _find_application(antrag_id: str | None, medium: str | None, stiftung: str | None) -> dict | None:
    M = f"&filter[mandant][_eq]={MANDANT}"
    if antrag_id:
        hits = _dget(f"/items/applications?limit=1&filter[id][_eq]={urllib.parse.quote(str(antrag_id))}{M}"
                     "&fields=id,medium_id,stiftung_id,stiftung_name,status,station,bemerkung,eingereicht_am,entschieden_am")
        return hits[0] if hits else None
    if medium:
        m = _find_medium(medium)
        if not m:
            return None
        q = f"/items/applications?limit=10&filter[medium_id][_eq]={m['slug']}{M}&filter[status][_nin]=archiviert,ausgeblendet&fields=id,medium_id,stiftung_id,stiftung_name,status,station,bemerkung,eingereicht_am,entschieden_am"
        hits = _dget(q)
        if stiftung:
            s = stiftung.strip().lower()
            hits = [h for h in hits if s in (h.get("stiftung_name") or "").lower()
                    or s == str(h.get("stiftung_id"))]
        return hits[0] if len(hits) == 1 else (hits[0] if hits and stiftung else None)
    return None


def akt_match_uebernehmen(medium: str, stiftung: str, user: str) -> str:
    m = _find_medium(medium)
    if not m:
        return f"Kein aktives Medium «{medium}» (Mandant {MANDANT}) gefunden."
    # Match suchen (per Stiftungs-Name oder -ID) -> stiftung_id + Name bestimmen.
    sid, sname = None, None
    if stiftung.strip().isdigit():
        sid = int(stiftung.strip())
        sn = _dget(f"/items/stiftungen?limit=1&filter[id][_eq]={sid}&fields=id,Stiftungsname")
        sname = sn[0].get("Stiftungsname") if sn else None
    else:
        sn = _dget(f"/items/stiftungen?limit=5&filter[Stiftungsname][_icontains]={urllib.parse.quote(stiftung)}&fields=id,Stiftungsname")
        if sn:
            sid, sname = sn[0]["id"], sn[0].get("Stiftungsname")
    if sid is None:
        return f"Keine Stiftung «{stiftung}» gefunden."
    # Doppel-Antrag vermeiden.
    vorhanden = _dget(f"/items/applications?limit=1&filter[mandant][_eq]={MANDANT}&filter[medium_id][_eq]={m['slug']}&filter[stiftung_id][_eq]={sid}&fields=id,status")
    if vorhanden:
        return f"«{sname}» ist fuer {m['name']} bereits als Antrag erfasst (Status {vorhanden[0].get('status')}). Nichts geaendert."
    item = _dwrite("POST", "/items/applications", {
        "medium_id": m["slug"], "stiftung_id": sid, "stiftung_name": sname,
        "status": "identifiziert", "station": 1, "mandant": MANDANT,
        "verantwortung": user or "offen", "zuletzt_geaendert_quelle": "assistent-chat",
    })
    _log_aktion(f"[uebernehmen] {user}: {m['slug']} <- Stiftung {sid} ({sname}) -> Antrag {item.get('id')}")
    return f"Erledigt: «{sname}» fuer {m['name']} als Antrag angelegt (Status identifiziert)."


def akt_antrag_status(antrag_id: str | None, medium: str | None, stiftung: str | None, status: str, user: str) -> str:
    status = (status or "").strip().lower()
    if status not in STATUS_STATION:
        return f"Unbekannter Status «{status}». Erlaubt: {', '.join(STATUS_STATION)}."
    a = _find_application(antrag_id, medium, stiftung)
    if not a:
        return "Kein eindeutiger Antrag gefunden — bitte Medium und Stiftung (oder Antrag-ID) nennen."
    patch = {"status": status, "station": STATUS_STATION[status],
             "zuletzt_geaendert_quelle": "assistent-chat"}
    # Auto-Stempel (gleiche Logik wie bauStatusPatch in der App): nur wenn leer
    jetzt = datetime.now(timezone.utc).isoformat()
    if status == "eingereicht" and not a.get("eingereicht_am"):
        patch["eingereicht_am"] = jetzt
    if status in ("zugesagt", "abgelehnt") and not a.get("entschieden_am"):
        patch["entschieden_am"] = jetzt
    _dwrite("PATCH", f"/items/applications/{a['id']}", patch)
    _log_aktion(f"[status] {user}: Antrag {a['id']} ({a.get('stiftung_name')}) {a.get('status')} -> {status}")
    return f"Erledigt: Antrag «{a.get('stiftung_name')}» ({a.get('medium_id')}) auf «{status}» gesetzt."


def akt_bemerkung(antrag_id: str | None, medium: str | None, stiftung: str | None, text: str, user: str) -> str:
    a = _find_application(antrag_id, medium, stiftung)
    if not a:
        return "Kein eindeutiger Antrag gefunden — bitte Medium und Stiftung (oder Antrag-ID) nennen."
    _dwrite("PATCH", f"/items/applications/{a['id']}", {
        "bemerkung": (text or "")[:2000], "zuletzt_geaendert_quelle": "assistent-chat"})
    _log_aktion(f"[bemerkung] {user}: Antrag {a['id']} ({a.get('stiftung_name')})")
    return f"Erledigt: Bemerkung an Antrag «{a.get('stiftung_name')}» gesetzt."


def akt_vorschlag(vorschlag_id: str, entscheidung: str, user: str) -> str:
    entscheidung = (entscheidung or "").strip().lower()
    if entscheidung not in ("freigeben", "verneinen"):
        return "Entscheidung muss «freigeben» oder «verneinen» sein."
    vs = _dget(f"/items/agent_vorschlaege?limit=1&filter[id][_eq]={urllib.parse.quote(str(vorschlag_id))}&filter[mandant][_eq]={MANDANT}"
               "&fields=id,typ,titel,medium_id,stiftung_id,stiftung_name,status")
    if not vs:
        return f"Kein Vorschlag {vorschlag_id} (Mandant {MANDANT}) gefunden."
    v = vs[0]
    if entscheidung == "freigeben":
        _dwrite("PATCH", f"/items/agent_vorschlaege/{v['id']}", {"status": "freigegeben"})
        nachsatz = ""
        if v.get("typ") == "match" and v.get("medium_id") and v.get("stiftung_id") is not None:
            doppel = _dget(f"/items/applications?limit=1&filter[mandant][_eq]={MANDANT}&filter[medium_id][_eq]={v['medium_id']}&filter[stiftung_id][_eq]={v['stiftung_id']}&fields=id")
            if not doppel:
                item = _dwrite("POST", "/items/applications", {
                    "medium_id": v["medium_id"], "stiftung_id": v["stiftung_id"],
                    "stiftung_name": v.get("stiftung_name"), "status": "identifiziert", "station": 1,
                    "mandant": MANDANT, "verantwortung": user or "offen",
                    "zuletzt_geaendert_quelle": "assistent-chat"})
                nachsatz = f" Antrag {item.get('id')} angelegt."
        _log_aktion(f"[vorschlag] {user}: {v['id']} freigegeben.{nachsatz}")
        return f"Erledigt: Vorschlag «{v.get('titel')}» freigegeben.{nachsatz}"
    # verneinen -> Lern-Notiz
    _dwrite("PATCH", f"/items/agent_vorschlaege/{v['id']}", {"status": "verneint"})
    _dwrite("POST", "/items/agent_lessons", {
        "scope": "medium", "mandant": MANDANT, "medium_id": v.get("medium_id"),
        "stiftung_id": v.get("stiftung_id"),
        "kategorie": "foerderprofil" if v.get("typ") == "match" else v.get("typ"),
        "quelle": "verworfen", "notiz": f"Vorschlag verneint von {user}: {v.get('titel')}"[:1000],
        "aktiv": True})
    _log_aktion(f"[vorschlag] {user}: {v['id']} verneint -> Lern-Notiz")
    return f"Erledigt: Vorschlag «{v.get('titel')}» verneint und als Lern-Notiz festgehalten."


def akt_roadmap_freigabe(medium: str, station_nr, wert, user: str = "slack") -> dict:
    """Setzt die Freigabe einer Medium-Station (nr 1/3/5/7) in faas_roadmap.

    Read-modify-write auf das json-Feld `stationen`: setzt `freigegeben` der
    passenden Station auf bool(wert), laesst dokument_link/notiz unangetastet.
    Harte Guard: nur Medium-Stationen sind freigebbar (We.Publish-Stationen
    2/4/6/8 sind abgeleitet, KEINE Freigabe).

    Rueckgabe-Dict: bei Erfolg {ok: True, medium, station, freigegeben};
    bei Fehler {ok: False, fehler: <text>}.
    """
    try:
        station_nr = int(station_nr)
    except (TypeError, ValueError):
        return {"ok": False, "fehler": "station nicht freigebbar"}
    if station_nr not in (1, 3, 5, 7):
        return {"ok": False, "fehler": "station nicht freigebbar"}

    rows = _dget(f"/items/faas_roadmap?limit=1"
                 f"&filter[medium_id][_eq]={urllib.parse.quote(str(medium))}"
                 f"&filter[mandant][_eq]={MANDANT}&fields=id,stationen")
    if not rows:
        return {"ok": False, "fehler": "keine roadmap-zeile"}
    row = rows[0]

    # stationen auf 8 Eintraege (nr 1..8) normalisieren, vorhandene Werte erhalten.
    roh = row.get("stationen")
    vorhanden: dict[int, dict] = {}
    if isinstance(roh, list):
        for s in roh:
            if isinstance(s, dict) and isinstance(s.get("nr"), int):
                vorhanden[s["nr"]] = s
    neu = []
    for n in range(1, 9):
        s = vorhanden.get(n, {})
        eintrag = {
            "nr": n,
            "freigegeben": s.get("freigegeben") if isinstance(s.get("freigegeben"), bool) else None,
            "dokument_link": s.get("dokument_link"),
            "notiz": s.get("notiz"),
        }
        if n == station_nr:
            eintrag["freigegeben"] = bool(wert)
        neu.append(eintrag)

    _dwrite("PATCH", f"/items/faas_roadmap/{row['id']}",
            {"stationen": neu, "aktualisiert_quelle": "slack"})
    _log_aktion(f"[roadmap] {user}: {medium} Station {station_nr} freigegeben={bool(wert)}")
    return {"ok": True, "medium": medium, "station": station_nr, "freigegeben": bool(wert)}


def dispatch_tool(name: str, args: dict, user: str) -> str:
    """Routet einen Tool-Aufruf (vom Adapter genutzt) auf die akt_*-Aktionen."""
    try:
        if name == "match_uebernehmen":
            return akt_match_uebernehmen(args.get("medium", ""), args.get("stiftung", ""), user)
        if name == "antrag_status_setzen":
            return akt_antrag_status(args.get("antrag_id"), args.get("medium"), args.get("stiftung"),
                                     args.get("status", ""), user)
        if name == "bemerkung_setzen":
            return akt_bemerkung(args.get("antrag_id"), args.get("medium"), args.get("stiftung"),
                                 args.get("text", ""), user)
        if name == "vorschlag_entscheiden":
            return akt_vorschlag(args.get("vorschlag_id", ""), args.get("entscheidung", ""), user)
        return f"Unbekanntes Werkzeug {name}."
    except Exception as e:
        return f"Aktion fehlgeschlagen: {e}"


def snapshot() -> str:
    """Kompakter, mandantenreiner Stand: aktive Medien, offene Vorschlaege (nach Typ), Fristen, Antraege."""
    M = f"&filter[mandant][_eq]={MANDANT}"
    teile = []
    try:
        medien = _dget(f"/items/faas_medien?limit=-1&filter[is_active][_eq]=true{M}&fields=slug,name")
        teile.append("Aktive Medien: " + ", ".join(f"{m.get('name')} ({m.get('slug')})" for m in medien))
    except Exception as e:
        teile.append(f"(Medien nicht lesbar: {e})")
    try:
        vs = _dget(f"/items/agent_vorschlaege?limit=-1&filter[status][_eq]=offen{M}&fields=typ,titel,medium_id,frist,prioritaet")
        nach_typ: dict[str, int] = {}
        for v in vs:
            nach_typ[v.get("typ", "?")] = nach_typ.get(v.get("typ", "?"), 0) + 1
        teile.append(f"Offene Vorschlaege: {len(vs)}  {nach_typ}")
        fristen = [v for v in vs if v.get("typ") == "frist"]
        if fristen:
            teile.append("Offene Fristen:\n" + "\n".join(
                f"  - {v.get('titel')} (Medium {v.get('medium_id') or '-'}, Frist {str(v.get('frist'))[:10]})" for v in fristen[:15]))
        andere = [v for v in vs if v.get("typ") != "frist"]
        if andere:
            teile.append("Weitere offene Vorschlaege (Auszug):\n" + "\n".join(
                f"  - [{v.get('typ')}/{v.get('prioritaet')}] {v.get('titel')}" for v in andere[:20]))
    except Exception as e:
        teile.append(f"(Vorschlaege nicht lesbar: {e})")
    try:
        apps = _dget(f"/items/applications?limit=-1&filter[status][_nin]=archiviert,ausgeblendet{M}&fields=status,stiftung_name,medium_id,frist")
        nach_status: dict[str, int] = {}
        for a in apps:
            nach_status[a.get("status", "?")] = nach_status.get(a.get("status", "?"), 0) + 1
        teile.append(f"Offene Antraege: {len(apps)}  {nach_status}")
    except Exception as e:
        teile.append(f"(Antraege nicht lesbar: {e})")
    return "\n".join(teile)
