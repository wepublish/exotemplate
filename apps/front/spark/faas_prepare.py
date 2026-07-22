#!/usr/bin/env python3
"""
faas_prepare — Vorbereiter-Werkzeuge fuer «Der Gerät» (read/prepare, NICHT aussen-schreibend).

Im Gegensatz zu faas_actions (reine gegatete Directus-Schreibaktionen, nur stdlib) rufen
diese Werkzeuge die bereits getestete App-Logik (HTTP, :3009) bzw. lesen Directus — damit der
Cockpit-Agent einen Antrag VORBEREITEN kann (Gesuch-Prompt bauen, Betrag berechnen,
Stiftungs-Profil), ohne Logik zu duplizieren. Kein Versand, kein Schreiben nach aussen.

Bewusst getrennt von faas_actions, damit dessen HTTP-Freiheit/Gate-Reinheit erhalten bleibt.

Env: FAAS_APP_URL (Default http://localhost:3009); Directus-Zugriff geerbt aus faas_actions.
"""
from __future__ import annotations
import json, os, re, time, urllib.request, urllib.parse
import faas_actions as fa

APP_URL = os.environ.get("FAAS_APP_URL", "http://localhost:3009").rstrip("/")


_STIFTUNG_STOPWORDS = {"stiftung", "stiftungen", "fonds", "fondation", "foundation", "verein",
                       "der", "die", "das", "des", "the", "of", "und", "and", "fund", "funds"}


def _find_stiftung(such: str):
    """(id, name) per numerischer ID oder Name. Robust: Volltext-icontains; sonst generische
    Woerter (Stiftung/Fonds/…) wegfiltern und nach dem laengsten signifikanten Wort suchen,
    damit z.B. «Stiftung Greulich» auch «GREULICH STIFTUNG KULTURPREIS» findet."""
    such = (such or "").strip()
    if not such:
        return None
    if such.isdigit():
        rows = fa._dget(f"/items/stiftungen?limit=1&filter[id][_eq]={such}&fields=id,Stiftungsname")
        return (rows[0]["id"], rows[0].get("Stiftungsname")) if rows else None

    def _q(term: str):
        return fa._dget(f"/items/stiftungen?limit=5&filter[Stiftungsname][_icontains]={urllib.parse.quote(term)}&fields=id,Stiftungsname")

    rows = _q(such)
    if not rows:
        woerter = [w for w in re.split(r"[\s,]+", such) if len(w) >= 3 and w.lower() not in _STIFTUNG_STOPWORDS]
        for w in sorted(woerter, key=len, reverse=True):
            rows = _q(w)
            if rows:
                break
    return (rows[0]["id"], rows[0].get("Stiftungsname")) if rows else None


def _app_get(path: str, timeout: int = 30) -> dict:
    r = urllib.request.Request(f"{APP_URL}{path}")
    with urllib.request.urlopen(r, timeout=timeout) as x:
        return json.loads(x.read().decode())


def _app_post(path: str, body: dict, timeout: int = 30) -> dict:
    r = urllib.request.Request(f"{APP_URL}{path}", data=json.dumps(body).encode(), method="POST",
                               headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as x:
        return json.loads(x.read().decode())


def gesuch_prompt(medium: str, stiftung: str) -> str:
    """Fertigen Opus-Gesuch-Prompt fuer ein Medium-Stiftung-Paar bauen (Copy-paste in die Claude-App)."""
    m = fa._find_medium(medium)
    if not m:
        return f"Kein aktives Medium «{medium}» (Mandant {fa.MANDANT}) gefunden."
    st = _find_stiftung(stiftung)
    if not st:
        return f"Keine Stiftung «{stiftung}» gefunden."
    sid, sname = st
    try:
        d = _app_get(f"/api/gesuch-prompt?medium={urllib.parse.quote(m['slug'])}&stiftung_id={sid}")
    except Exception as e:
        return f"Gesuch-Prompt-Route nicht erreichbar: {e}"
    if d.get("error"):
        return f"Fehler: {d['error']}"
    prompt = d.get("prompt", "")
    ablage = d.get("ablage", "")
    return (f"Gesuch-Prompt fuer «{sname}» / {m['name']} (Ablage: {ablage}).\n"
            f"Diesen Prompt in der Claude-App an Opus 4.8 geben:\n\n{prompt}")


def betrag(medium: str, stiftung: str, max_wait_s: int = 130) -> str:
    """Realistischen Foerderbetrag (CHF) vorschlagen lassen (lokales Spark-LLM, ~1-2 Min)."""
    m = fa._find_medium(medium)
    if not m:
        return f"Kein aktives Medium «{medium}» gefunden."
    st = _find_stiftung(stiftung)
    if not st:
        return f"Keine Stiftung «{stiftung}» gefunden."
    sid, sname = st
    try:
        start = _app_post("/api/calculate-amount", {"stiftung_id": sid, "medium_id": m["slug"]})
    except Exception as e:
        return f"Betrag-Route nicht erreichbar: {e}"
    job = start.get("job_id")
    if not job:
        return f"Kein Job gestartet: {start}"
    waited = 0
    while waited < max_wait_s:
        time.sleep(5)
        waited += 5
        try:
            s = _app_get(f"/api/calculate-amount?job_id={urllib.parse.quote(job)}")
        except Exception as e:
            return f"Betrag-Status nicht lesbar: {e}"
        if s.get("status") == "done":
            r = s.get("result", {})
            return (f"Betrag-Vorschlag fuer «{sname}» / {m['name']}: CHF {r.get('suggested_amount')}.\n"
                    f"Begruendung: {r.get('reasoning')}")
        if s.get("status") == "error":
            return f"Betrag-Berechnung fehlgeschlagen: {s.get('error')}"
    return f"Betrag-Berechnung laeuft noch (>{max_wait_s}s, lokales LLM ausgelastet) — bitte spaeter erneut fragen."


def _tagnames(tags) -> list:
    out = []
    if isinstance(tags, list):
        for t in tags:
            if isinstance(t, str):
                out.append(t)
            elif isinstance(t, dict):
                out.append(t.get("tag_slug") or t.get("slug") or t.get("name") or "")
    return [x for x in out if x][:15]


def stiftung_info(stiftung: str) -> str:
    """Profil einer Foerderstiftung aus Directus (Stammdaten + aktive DNA). Read-only."""
    st = _find_stiftung(stiftung)
    if not st:
        return f"Keine Stiftung «{stiftung}» gefunden."
    sid, sname = st
    rows = fa._dget(f"/items/stiftungen?limit=1&filter[id][_eq]={sid}"
                    "&fields=id,Stiftungsname,sitz,land,kategorie,zwecktext,foerderbedingungen,foerdersummen_range,web_url,betrag_vorschlag")
    s = rows[0] if rows else {}
    dna = fa._dget(f"/items/stiftungs_dna?limit=1&filter[stiftung_id][id][_eq]={sid}&filter[is_active][_eq]=true"
                   "&fields=sound_feeling,foerderpraxis,tags")
    d = dna[0] if dna else {}
    teile = [f"Stiftung «{s.get('Stiftungsname', sname)}» (ID {sid})"]
    if s.get("sitz") or s.get("land"):
        teile.append(f"Sitz: {s.get('sitz') or '-'} / {s.get('land') or '-'}")
    if s.get("kategorie"):
        teile.append(f"Kategorie: {s.get('kategorie')}")
    if s.get("zwecktext"):
        teile.append(f"Zweck: {str(s.get('zwecktext'))[:600]}")
    if s.get("foerderbedingungen"):
        teile.append(f"Foerderbedingungen: {str(s.get('foerderbedingungen'))[:400]}")
    if s.get("foerdersummen_range"):
        teile.append(f"Foerdersummen-Bereich: {s.get('foerdersummen_range')}")
    if d.get("foerderpraxis"):
        teile.append(f"DNA-Foerderpraxis: {str(d.get('foerderpraxis'))[:400]}")
    if d.get("sound_feeling"):
        teile.append(f"DNA-Sound/Feeling: {str(d.get('sound_feeling'))[:300]}")
    tg = _tagnames(d.get("tags"))
    if tg:
        teile.append("DNA-Tags: " + ", ".join(tg))
    if s.get("web_url"):
        teile.append(f"Web: {s.get('web_url')}")
    if s.get("betrag_vorschlag"):
        teile.append(f"Gespeicherter Betrag-Vorschlag: {s.get('betrag_vorschlag')}")
    return "\n".join(teile)


def radar_status() -> str:
    """Offene Ausschreibungs-Radar-Treffer (status=scout_unbestaetigt), die auf Review in der App warten."""
    rows = fa._dget("/items/ausschreibungen?limit=20&sort=-id&filter[status][_eq]=scout_unbestaetigt"
                    "&fields=id,titel,kategorie,url,deadline")
    if not rows:
        return ("Keine unbestaetigten Radar-Treffer. (Der Ausschreibungs-Scout laeuft werktags 07:00 und legt "
                "neue Funde als «scout_unbestaetigt» an — sie erscheinen hier und zur Freigabe in der App.)")
    teile = [f"{len(rows)} unbestaetigte Ausschreibungs-Treffer (zur Review/Freigabe in der App):"]
    for r in rows[:15]:
        frist = str(r.get("deadline"))[:10] if r.get("deadline") else "-"
        teile.append(f"  - {r.get('titel', '?')} [{r.get('kategorie') or '-'}] Frist {frist} {r.get('url') or ''}")
    return "\n".join(teile)
