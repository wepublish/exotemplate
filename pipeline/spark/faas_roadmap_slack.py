#!/usr/bin/env python3
"""
faas_roadmap_slack -- zeichnet den Medien-Workflow als Roadmap im Slack-Channel
des jeweiligen Mediums nach (Entscheid der Nutzerin vom 28.07.2026).

Pro Medium-Channel haelt das Skript GENAU EINE Status-Nachricht aktuell:
chat.postMessage beim ersten Lauf, danach chat.update auf die gemerkte ts.
Neue Eintraege aus `medium_events` werden als kurze Thread-Antwort an diese
Nachricht gehaengt; die Historie liegt damit im Thread, der Channel bleibt
sauber, und der aktuelle Stand ist jederzeit in der Status-Nachricht sichtbar.

Sicherheitsregel (gleich wie faas_outbox.py): gepostet wird AUSSCHLIESSLICH in
den Channel aus faas_medien.slack_channel des jeweiligen Mediums. Medien ohne
slack_channel oder ohne is_active=true werden uebersprungen. Es gibt keinen
Codepfad zu einem anderen Ziel.

Verhalten im Detail:
  - Erstlauf pro Medium: posten, ts + aufgeloeste Channel-ID im State merken.
    Bereits vorhandene Alt-Ereignisse werden NICHT nachtraeglich in den Thread
    gepostet (Baseline = juengstes vorhandenes Ereignis); die Status-Nachricht
    zeigt den aktuellen Stand ohnehin.
  - Folgelaeufe: chat.update auf dieselbe ts — aber NUR, wenn sich der
    gerenderte Text seit dem letzten Post geaendert hat (text_hash im State;
    Wunsch der Nutzerin vom 29.07.2026: «bitte nur updates schicken, wenns
    updates gibt»). Einmal in 24 h wird trotzdem aktualisiert
    (FORCE_UPDATE_SEK): so heilt sich eine von Hand geloeschte Nachricht
    selbst, denn nur die Antwort von chat.update verraet message_not_found.
    Wechselt der konfigurierte slack_channel oder wurde die Nachricht
    geloescht (message_not_found), wird neu gepostet und der State erneuert.
  - Fehlt die Collection `medium_events` (legt der Hauptprozess parallel an),
    meldet das Skript «Collection medium_events fehlt», rendert nur den
    Stationen-Teil und endet mit Exit 0.
  - Idempotent: ohne neue Ereignisse entstehen keine neuen Thread-Posts;
    chat.update mit identischem Stationen-Stand ist unkritisch.
  - Ein Medium mit kaputtem Channel blockiert die anderen nicht; der State
    wird nach jedem Medium fortgeschrieben.

Quellen / Env:
  ~/.hermes/.env         DIRECTUS_TOKEN (Directus auf der VPS, vom Spark via
                         Tailscale-Forwarder auf localhost:8055; DIRECTUS_URL
                         aus der .env wird bewusst ignoriert, wie
                         faas_waechter_push)
  ~/.hermes/config.yaml  xoxb-Bot-Token (wie faas_heartbeat)
  WAECHTER_MANDANT       (Default wepublish)

State: ~/faas_classify/roadmap_slack_state.json
       {slug: {ts, channel, kanal_konfig, letzter_event_ts, text_hash, text_ts}}
       `channel` ist die von Slack aufgeloeste Channel-ID (chat.update braucht
       eine ID, faas_medien.slack_channel kann auch ein #name sein);
       `kanal_konfig` ist der konfigurierte Wert zur Wechsel-Erkennung.

Modi:  --dry-run (Default, zeigt nur, was gepostet wuerde)  |  --apply
       --medium <slug>  nur dieses Medium bearbeiten
Cron-Empfehlung:  */15 * * * *  /usr/bin/python3 ~/faas-matching-wepublish/spark/faas_roadmap_slack.py --apply
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path


def _lade_env() -> None:
    """Laedt ~/.hermes/.env in os.environ, damit das Skript aus dem Cron ohne
    Wrapper laeuft (identisch zu faas_waechter_push.py). DIRECTUS_URL wird
    bewusst uebersprungen: das Skript laeuft Spark-lokal und erreicht Directus
    ueber den Tailscale-Forwarder auf localhost:8055."""
    pfad = Path.home() / ".hermes" / ".env"
    if not pfad.exists():
        return
    for zeile in pfad.read_text().splitlines():
        zeile = zeile.strip()
        if not zeile or zeile.startswith("#") or "=" not in zeile:
            continue
        k, v = zeile.split("=", 1)
        if k.strip() == "DIRECTUS_URL":
            continue
        os.environ.setdefault(k.strip(), v.strip().strip('"'))


_lade_env()

DIRECTUS = "http://localhost:8055"
TOKEN = os.environ.get("DIRECTUS_TOKEN", "")
MANDANT = os.environ.get("WAECHTER_MANDANT", "wepublish")
STATE = Path.home() / "faas_classify" / "roadmap_slack_state.json"
MAX_THREAD_EVENTS = 10  # Deckel je Thread-Antwort, Rest nur als Zaehler
# Unveraenderten Text ueberspringen, aber spaetestens nach 24 h trotzdem
# aktualisieren: nur die chat.update-Antwort verraet eine geloeschte Nachricht.
FORCE_UPDATE_SEK = 24 * 3600


def text_fingerabdruck(text: str) -> str:
    """Kurzer, stabiler Hash des gerenderten Status-Texts fuer den State.

    Die «Stand: …»-Zeile bleibt draussen: sie traegt den Render-Zeitpunkt und
    waere sonst bei jedem Lauf anders — der Skip griffe nie. Nebeneffekt,
    bewusst so gewollt: «Stand» in der Nachricht zeigt damit, wann sich
    zuletzt inhaltlich etwas geaendert hat (spaetestens alle 24 h erneuert,
    siehe FORCE_UPDATE_SEK)."""
    kern = "\n".join(z for z in text.splitlines() if not z.startswith("Stand: "))
    return hashlib.sha256(kern.encode("utf-8")).hexdigest()[:16]

# Fehler von chat.update, nach denen neu gepostet statt aufgegeben wird.
REPOST_FEHLER = {"message_not_found", "channel_not_found", "is_archived",
                 "cant_update_message", "not_in_channel"}

# Antrags-Status, die als Gesuchs-Zaehler in Station 7 erscheinen.
# ('freigegeben' ist bewusst NICHT dabei: die Operator-Freigabe lebt im
# portal-json der Application, nicht im status-Feld.)
GESUCH_STATUS = ["in_arbeit", "eingereicht", "zugesagt", "abgelehnt"]
GESUCH_LABEL = {"in_arbeit": "in Arbeit", "eingereicht": "eingereicht",
                "zugesagt": "zugesagt", "abgelehnt": "abgelehnt"}


def stamp() -> str:
    return time.strftime("%F %T")


# --- Token / HTTP ------------------------------------------------------------

def slack_token() -> str:
    cfg = (Path.home() / ".hermes" / "config.yaml").read_text()
    m = re.search(r"xoxb-[A-Za-z0-9-]+", cfg)
    if not m:
        raise RuntimeError("Kein xoxb-Token in ~/.hermes/config.yaml")
    return m.group(0)


def dget(pfad: str) -> list:
    req = urllib.request.Request(DIRECTUS + pfad,
                                 headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r).get("data", [])
    return d if isinstance(d, list) else [d]


def slack_call(method: str, payload: dict, token: str) -> dict:
    req = urllib.request.Request(
        f"https://slack.com/api/{method}", data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


# --- Daten holen --------------------------------------------------------------

def hole_medien() -> list[dict]:
    return dget("/items/faas_medien?limit=-1"
                f"&filter[is_active][_eq]=true&filter[mandant][_eq]={MANDANT}"
                "&fields=slug,name,slack_channel,is_active,"
                "dna_medium_freigabe,matching_freigeschaltet,logo_hochgeladen"
                "&sort=slug")


def hole_dna_aktiv() -> set[str]:
    rows = dget("/items/medium_dna?limit=-1&filter[is_active][_eq]=true&fields=medium_id")
    return {r.get("medium_id") for r in rows if r.get("medium_id")}


def hole_applications() -> dict[str, list[dict]]:
    rows = dget(f"/items/applications?limit=-1&filter[mandant][_eq]={MANDANT}"
                "&fields=medium_id,status")
    nach_medium: dict[str, list[dict]] = {}
    for r in rows:
        nach_medium.setdefault(r.get("medium_id") or "", []).append(r)
    return nach_medium


def events_verfuegbar() -> bool:
    """True, wenn die Collection medium_events abfragbar ist. Sie wird vom
    Hauptprozess parallel angelegt; solange sie fehlt, antwortet Directus mit
    403/404 und das Skript rendert nur den Stationen-Teil."""
    try:
        dget("/items/medium_events?limit=1&fields=id")
        return True
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return False
        raise


def hole_events() -> dict[str, list[dict]]:
    rows = dget("/items/medium_events?limit=-1&sort=date_created"
                "&fields=id,medium_id,typ,titel,detail,actor,date_created")
    nach_medium: dict[str, list[dict]] = {}
    for r in rows:
        nach_medium.setdefault(r.get("medium_id") or "", []).append(r)
    return nach_medium


# --- Texte bauen --------------------------------------------------------------

def _fmt_ts(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return d.astimezone().strftime("%d.%m.%Y %H:%M")
    except Exception:
        return str(iso)


def baue_status_text(m: dict, dna_aktiv: bool, apps: list[dict]) -> str:
    """Baut die eine Status-Nachricht eines Mediums: sieben Stationen mit
    [x]/[ ]-Haekchen, Station 6 mit Zaehler, Station 7 mit Gesuchs-Zaehlern."""
    zaehler = {s: 0 for s in GESUCH_STATUS}
    ausgewaehlt = 0
    for a in apps:
        s = (a.get("status") or "").strip()
        if s != "ausgeblendet":
            ausgewaehlt += 1
        if s in zaehler:
            zaehler[s] += 1
    gesuche_total = sum(zaehler.values())
    gesuch_text = ", ".join(f"{zaehler[s]} {GESUCH_LABEL[s]}" for s in GESUCH_STATUS)

    stationen = [
        (True, "Onboarding gestartet"),
        (bool(m.get("logo_hochgeladen")), "Logo und Unterlagen"),
        (dna_aktiv, "DNA aktiv"),
        (bool(m.get("dna_medium_freigabe")), "DNA vom Medium freigegeben"),
        (bool(m.get("matching_freigeschaltet")), "Matching freigegeben"),
        (ausgewaehlt >= 1, f"Stiftungen ausgewählt ({ausgewaehlt})"),
        (gesuche_total >= 1, f"Gesuche: {gesuch_text}"),
    ]

    name = m.get("name") or m.get("slug") or ""
    zeilen = [f"*Roadmap {name}*",
              f"Stand: {time.strftime('%d.%m.%Y %H:%M')}", ""]
    for nr, (erreicht, titel) in enumerate(stationen, 1):
        marke = "[x]" if erreicht else "[ ]"
        zeilen.append(f"{marke} {nr}. {titel}")
    return "\n".join(zeilen)


def baue_thread_text(events: list[dict]) -> str:
    """Eine kurze Thread-Antwort je Lauf, alle neuen Ereignisse gesammelt."""
    zeilen = ["Neu auf der Roadmap:"]
    for e in events[:MAX_THREAD_EVENTS]:
        titel = (e.get("titel") or e.get("typ") or "Ereignis").strip()
        zeile = f"· {_fmt_ts(e.get('date_created'))}  {titel}"
        actor = (e.get("actor") or "").strip()
        if actor:
            zeile += f"  ({actor})"
        zeilen.append(zeile)
        detail = (e.get("detail") or "").strip()
        if detail:
            zeilen.append(f"    _{detail[:200]}_")
    if len(events) > MAX_THREAD_EVENTS:
        zeilen.append(f"· und {len(events) - MAX_THREAD_EVENTS} weitere Ereignisse")
    return "\n".join(zeilen)


# --- State --------------------------------------------------------------------

def lade_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {}


def speichere_state(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2))


# --- Kern ---------------------------------------------------------------------

def verarbeite_medium(m: dict, dna_set: set[str], apps: list[dict],
                      events: list[dict], st: dict, stok: str | None,
                      apply_: bool) -> None:
    """Rendert und postet die Roadmap EINES Mediums. Mutiert `st` (den
    State-Eintrag des Mediums) schrittweise, damit der Aufrufer nach jedem
    Medium sichern kann und ein Abbruch keine ts verliert."""
    slug = m["slug"]
    # Sicherheitsregel: einziges erlaubtes Ziel ist der Channel des Mediums.
    kanal_konfig = (m.get("slack_channel") or "").strip()
    if not kanal_konfig:
        raise ValueError("kein slack_channel gesetzt")

    text = baue_status_text(m, slug in dna_set, apps)
    erstlauf = not st.get("ts")
    kanal_wechsel = (not erstlauf) and st.get("kanal_konfig") not in (None, kanal_konfig)
    max_ev_ts = max((e.get("date_created") or "" for e in events), default="")

    # Erstlauf: Baseline setzen, Alt-Ereignisse nicht nachposten. ISO-Strings
    # aus Directus sind einheitlich formatiert, lexikografischer Vergleich ok.
    if erstlauf:
        neue_events = []
    else:
        seit = st.get("letzter_event_ts") or ""
        neue_events = [e for e in events if (e.get("date_created") or "") > seit]

    fingerabdruck = text_fingerabdruck(text)
    frisch = (time.time() - float(st.get("text_ts") or 0)) < FORCE_UPDATE_SEK
    unveraendert = (not erstlauf and not kanal_wechsel
                    and st.get("text_hash") == fingerabdruck and frisch)

    if not apply_:
        aktion = ("chat.postMessage (Erstlauf)" if erstlauf
                  else "chat.postMessage (Channel-Wechsel)" if kanal_wechsel
                  else "NICHTS (Stand unveraendert)" if unveraendert
                  else f"chat.update auf ts {st.get('ts')}")
        print(f"{stamp()} | {slug}: wuerde {aktion} nach {kanal_konfig} ausfuehren, "
              f"{len(neue_events)} neue Ereignisse")
        print(f"----- Status-Nachricht {slug} -----")
        print(text)
        if neue_events:
            print(f"----- Thread-Antwort {slug} -----")
            print(baue_thread_text(neue_events))
        print()
        return

    ts, channel_id = st.get("ts"), st.get("channel")
    repost = erstlauf or kanal_wechsel or not channel_id
    if not repost and unveraendert:
        print(f"{stamp()} | {slug}: Stand unveraendert, kein chat.update.")
    elif not repost:
        r = slack_call("chat.update", {"channel": channel_id, "ts": ts, "text": text}, stok)
        if r.get("ok"):
            print(f"{stamp()} | {slug}: Status-Nachricht aktualisiert (ts {ts}).")
            st.update({"text_hash": fingerabdruck, "text_ts": time.time()})
        elif r.get("error") in REPOST_FEHLER:
            print(f"{stamp()} | {slug}: chat.update meldet {r.get('error')}, poste neu.")
            repost = True
        else:
            raise RuntimeError(f"chat.update: {r.get('error')}")

    if repost:
        r = slack_call("chat.postMessage", {"channel": kanal_konfig, "text": text}, stok)
        if not r.get("ok"):
            raise RuntimeError(f"chat.postMessage: {r.get('error')}")
        ts = r["ts"]
        channel_id = r.get("channel") or kanal_konfig
        print(f"{stamp()} | {slug}: Status-Nachricht gepostet (ts {ts}, channel {channel_id}).")
        st.update({"text_hash": fingerabdruck, "text_ts": time.time()})

    # ts sofort merken, bevor der Thread-Post laufen kann: schlaegt der fehl,
    # geht die Nachricht beim naechsten Lauf nicht verloren (kein Doppel-Post).
    st.update({"ts": ts, "channel": channel_id, "kanal_konfig": kanal_konfig})

    if neue_events:
        r = slack_call("chat.postMessage",
                       {"channel": channel_id, "thread_ts": ts,
                        "text": baue_thread_text(neue_events)}, stok)
        if not r.get("ok"):
            raise RuntimeError(f"Thread-Antwort: {r.get('error')}")
        print(f"{stamp()} | {slug}: {len(neue_events)} Ereignis(se) in den Thread gestellt.")

    # Ereignis-Zeiger erst NACH erfolgreichem Thread-Post fortschreiben;
    # beim Erstlauf Baseline auf das juengste vorhandene Ereignis.
    if erstlauf or neue_events:
        st["letzter_event_ts"] = max(st.get("letzter_event_ts") or "", max_ev_ts)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Roadmap-Status je Medium in dessen Slack-Channel (eine "
                    "Nachricht pro Channel, Historie im Thread).")
    ap.add_argument("--apply", action="store_true", help="Wirklich posten.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Nur anzeigen (Default; gewinnt gegen --apply).")
    ap.add_argument("--medium", help="Nur dieses Medium (Slug) bearbeiten.")
    args = ap.parse_args()
    apply_ = args.apply and not args.dry_run

    if not TOKEN:
        sys.exit("DIRECTUS_TOKEN fehlt (~/.hermes/.env)")

    medien = hole_medien()
    if args.medium:
        medien = [m for m in medien if m.get("slug") == args.medium]
        if not medien:
            sys.exit(f"Medium {args.medium!r} nicht gefunden oder nicht aktiv.")
    ohne_kanal = [m.get("slug") for m in medien if not (m.get("slack_channel") or "").strip()]
    medien = [m for m in medien if (m.get("slack_channel") or "").strip()]
    if ohne_kanal:
        print(f"{stamp()} | uebersprungen (kein slack_channel): {', '.join(sorted(ohne_kanal))}")
    if not medien:
        print(f"{stamp()} | Keine aktiven Medien mit slack_channel, nichts zu tun.")
        return 0

    dna_set = hole_dna_aktiv()
    apps_nach_medium = hole_applications()
    if events_verfuegbar():
        events_nach_medium = hole_events()
    else:
        events_nach_medium = {}
        print(f"{stamp()} | Collection medium_events fehlt, Events werden "
              "uebersprungen (nur Stationen-Teil).")

    stok = slack_token() if apply_ else None
    state = lade_state()

    fehler = 0
    for m in medien:
        slug = m.get("slug") or ""
        st = state.get(slug) or {}
        try:
            verarbeite_medium(m, dna_set, apps_nach_medium.get(slug, []),
                              events_nach_medium.get(slug, []), st, stok, apply_)
        except Exception as e:
            fehler += 1
            print(f"{stamp()} | [FEHLER] {slug}: {e}")
        if apply_ and st:
            state[slug] = st
            speichere_state(state)

    modus = "apply" if apply_ else "dry-run"
    print(f"{stamp()} | fertig ({modus}): {len(medien)} Medium/Medien, {fehler} Fehler.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
