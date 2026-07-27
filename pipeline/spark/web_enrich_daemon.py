#!/usr/bin/env python3
"""
Web-Enricher — laufende, additive Anreicherung der Stiftungs-DNA.
Pro Stiftung: echte URL finden (SearXNG) -> Sanity-Check (qwen) -> crawlen (faas-crawler)
-> qwen-Web-DNA messen -> Basis-Betrag schaetzen -> (im --apply) atomar aktiv schalten + Stiftung
neu matchen. Default --dry-run: misst + zeigt, schreibt NICHTS (Pilot, Live-System unberuehrt).

Reuse: run_pilot_nothink (K) = Mess-Kern; url_discovery = URL-Suche; match_engine = Re-Match.
GPU-Vorfahrt: pausiert, solange ein match_engine.py-Prozess laeuft (nicht-invasiv).

Lauf:
  FAAS_VLLM_URL=http://127.0.0.1:8001/v1 DIRECTUS_TOKEN=... \
  python3 web_enrich_daemon.py --from-top 15 --dry-run
  ... --apply           # scharf: schreibt + flippt + re-matcht
  ... --ids 7152,11981  # gezielte Stiftungs-IDs
"""
from __future__ import annotations
import argparse, datetime, json, os, subprocess, sys, time, urllib.request, urllib.parse
sys.path.insert(0, os.path.expanduser("~/dna_pilot"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_pilot_nothink as K          # Mess-Kern (SYSTEM, build_user, ollama_chat, parse_json, calc_schaerfe, VOCAB_SET)
import url_discovery as UD             # finde_kandidaten(name)

DIRECTUS = os.environ.get("DIRECTUS_URL", "http://localhost:8055").rstrip("/")
TOKEN = os.environ.get("DIRECTUS_TOKEN", "")
CRAWLER = os.environ.get("FAAS_CRAWLER_URL", "http://127.0.0.1:8891").rstrip("/") + "/v1/scrape"
MODEL = os.environ.get("FAAS_DNA_MODEL", "qwen3.6-27b")
MIN_TAGS = 8
KORPUS_CAP = 6000  # Web-Korpus-Cap: haelt input+max_tokens unter vLLM max_model_len 8192 (sonst HTTP 400 -> mess_fehler)
LOG = os.path.expanduser("~/faas_classify/web_enrich.log")
MANIFEST = os.path.expanduser("~/faas_classify/webenrich_manifest.json")


def http(method, path, body=None, timeout=40):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{DIRECTUS}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as x:
            raw = x.read().decode()
            return x.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:200]}


def dget(path):
    _, b = http("GET", path)
    d = b.get("data", []) if isinstance(b, dict) else []
    return d if isinstance(d, list) else [d]


def log(msg):
    line = f"{datetime.datetime.now().isoformat()[:19]} {msg}"
    print(line, flush=True)
    try:
        open(LOG, "a").write(line + "\n")
    except Exception:
        pass


def gpu_frei_warten():
    """GPU-Vorfahrt: warten, solange die Match-Engine laeuft (nicht-invasiv via pgrep)."""
    while True:
        try:
            r = subprocess.run(["pgrep", "-f", "match_engine.py"], capture_output=True, text=True)
            if r.returncode != 0:
                return
        except Exception:
            return
        log("  GPU belegt (match_engine laeuft) — warte 60s")
        time.sleep(60)


# ─── Crawl ────────────────────────────────────────────────────────────────────
def crawl(url, timeout=40):
    body = json.dumps({"url": url, "formats": ["markdown"]}).encode()
    r = urllib.request.Request(CRAWLER, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as x:
            return (json.loads(x.read().decode()).get("data", {}) or {}).get("markdown", "") or ""
    except Exception:
        return ""


# ─── Sanity-Check (qwen): gehoert die Seite zur Stiftung? ──────────────────────
SANITY_SYS = ("Du pruefst, ob eine Webseite die OFFIZIELLE Eigenseite einer bestimmten "
    "Foerderstiftung ist (nicht ein Verzeichnis, Register, Zeitungsartikel oder eine ANDERE "
    "Organisation). Antworte AUSSCHLIESSLICH mit JSON: "
    '{"ist_eigenseite": true|false, "konfidenz": 0-100, "grund": "kurz"}')


def sanity_check(name, zwecktext, url, md):
    user = (f"Stiftung: {name}\nZweck: {(zwecktext or '')[:600]}\nGeprüfte URL: {url}\n\n"
            f"Seiteninhalt (Auszug):\n{(md or '')[:2500]}")
    try:
        resp = K.ollama_chat(MODEL, SANITY_SYS, user, timeout=120)
        d = K.parse_json(resp.get("message", {}).get("content", "")) or {}
    except Exception as e:
        return False, 0, f"sanity-fehler {e}"
    return bool(d.get("ist_eigenseite")) and int(d.get("konfidenz", 0)) >= 70, \
        int(d.get("konfidenz", 0)), str(d.get("grund", ""))[:120]


# ─── Basis-Betrag (qwen, stiftungs-eigen) ──────────────────────────────────────
AMOUNT_SYS = ("Du bist kritischer Experte fuer Schweizer Stiftungsfinanzierung. Schaetze den "
    "TYPISCHEN, realistischen Foerderbetrag (CHF) dieser Stiftung pro Gesuch — stiftungs-eigen, "
    "nicht auf ein konkretes Projekt bezogen. Stuetze dich auf belegte Foerdersummen aus dem Text; "
    "wenn nichts belegt ist, schaetze konservativ aus Zweck/Groesse und sage das. "
    'Antworte AUSSCHLIESSLICH mit JSON: {"chf": int|null, "spanne": "z.B. 5000-20000"|null, '
    '"begruendung": "kurz, mit Beleg"}')


def schaetze_betrag(stamm, md):
    user = (f"Stiftung: {stamm.get('Stiftungsname')}\nZweck: {(stamm.get('zwecktext') or '')[:500]}\n"
            f"Foerderbedingungen: {(stamm.get('foerderbedingungen') or '')[:400]}\n"
            f"Belegte Summen (Stammdaten): {stamm.get('foerdersummen_range') or stamm.get('foerderbeitraege') or '?'}\n"
            f"\nWebseite (Auszug):\n{(md or '')[:3000]}")
    try:
        resp = K.ollama_chat(MODEL, AMOUNT_SYS, user, timeout=120)
        return K.parse_json(resp.get("message", {}).get("content", "")) or None
    except Exception:
        return None


def get_stamm(sid):
    d = dget(f"/items/stiftungen/{sid}?fields=id,Stiftungsname,sitz,region,zwecktext,"
             "foerderbedingungen,foerdersummen_range,foerderbeitraege,webseite")
    return d[0] if d else None


def aktive_dna(sid):
    d = dget(f"/items/stiftungs_dna?filter[stiftung_id][_eq]={sid}&filter[is_active][_eq]=true"
             "&sort=-id&limit=1&fields=id,version_id,version_number,schaerfe_prozent,klassifiziert_by,quellen")
    return d[0] if d else None


# ─── DNA messen (mit Web-Korpus) ───────────────────────────────────────────────
def messe_web_dna(stamm, md):
    korpus = (md or "")[:KORPUS_CAP]
    dna = None
    for _ in range(2):
        stift = {"stiftung_id": stamm["id"], "stammdaten": stamm, "crawl": {"ok": True, "korpus_text": korpus}}
        try:
            resp = K.ollama_chat(MODEL, K.SYSTEM, K.build_user(stift))
            dna = K.parse_json(resp.get("message", {}).get("content", ""))
            if dna and dna.get("tags"):
                break
        except Exception:
            korpus = korpus[:max(0, len(korpus) // 2)]  # Kontext-Ueberlauf -> Korpus halbieren, erneut
            time.sleep(2)
    if not dna or not dna.get("tags"):
        return None
    dna["tags"] = [t for t in dna["tags"] if t.get("tag_slug") in K.VOCAB_SET]
    dna["exclusion_tags"] = [t for t in dna.get("exclusion_tags", []) if t.get("tag_slug") in K.VOCAB_SET]
    return dna if len(dna["tags"]) >= MIN_TAGS else None


# ─── Schreiben (nur --apply): neue Web-Version aktiv, Betrag, Re-Match ──────────
def push_dna(sid, stamm, dna, betrag, url, has_web):
    """Schreibt eine neue aktive DNA-Version (web ODER stammdaten). Additiv: alte Version
    wird inaktiv, neue aktiv. Der Match-Cache invalidiert automatisch (neue version_id)."""
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    zt = stamm.get("zwecktext") or stamm.get("foerderbedingungen") or ""
    sch = K.calc_schaerfe(dna, has_web, zt)
    vorg = aktive_dna(sid)
    nv = (vorg.get("version_number", 1) + 1) if vorg else 2
    if vorg:
        st, _ = http("PATCH", f"/items/stiftungs_dna/{vorg['id']}", {"is_active": False})
        if st not in (200, 204):
            return {"ok": False, "stage": "deact", "code": st}
    suffix = "web-v" if has_web else "v"
    quellen = {"datenbasis": "stammdaten+web" if has_web else "stammdaten",
               "stammdaten_directus_id": sid, "embedding_at": None,
               "embedding_collection": "faas_stiftungen_dna",
               "notizen": (f"web-enrich {now[:10]}, Crawl {url}" if has_web else f"web-enrich {now[:10]}, stammdaten-only (keine Eigenseite)")}
    if has_web:
        quellen["web_url"] = url
    payload = {"stiftung_id": sid, "stiftung_name": stamm.get("Stiftungsname"),
        "version_id": f"stiftung-{sid}-{now[:10]}-{suffix}{nv}", "version_number": nv,
        "vorgaenger_version_id": vorg.get("version_id") if vorg else None, "is_active": True,
        "klassifiziert_at": now,
        "klassifiziert_by": "qwen3.6-v3-webenrich" if has_web else "qwen3.6-v3-webenrich-stamm",
        "vocabulary_version_at_creation": 3,
        "sound_feeling": dna.get("sound_feeling", ""), "tags": dna["tags"],
        "exclusion_tags": dna.get("exclusion_tags", []), "foerderpraxis": dict(dna.get("foerderpraxis") or {}),
        "schaerfe_prozent": sch, "quellen": quellen}
    st, b = http("POST", "/items/stiftungs_dna", payload)
    if st not in (200, 201, 204):
        return {"ok": False, "stage": "post", "code": st, "body": str(b)[:200]}
    upd = {}
    if has_web:
        upd["web_url"] = url
    if betrag:
        upd["betrag_vorschlag"] = {**betrag, "quelle": "web-enrich" if has_web else "stammdaten", "stand": now[:10]}
    if upd:
        http("PATCH", f"/items/stiftungen/{sid}", upd)
    return {"ok": True, "schaerfe": sch, "version": payload["version_id"]}


# Re-Match laeuft als periodischer Cron (match_engine --medium X, warmer Cache; der Cache
# invalidiert pro upgegradeter Stiftung automatisch). Kein Inline-Re-Match noetig.


# ─── Queue ──────────────────────────────────────────────────────────────────
def queue_from_top(n):
    """Distinct Stiftungs-IDs aus den aktuellen Top-Matches ueber alle Medien."""
    medien = [m["slug"] for m in dget("/items/faas_medien?filter[is_active][_eq]=true"
                                      "&filter[mandant][_eq]=wepublish&fields=slug&limit=-1")]
    seen, ids = set(), []
    for m in medien:
        for r in dget(f"/items/match_results?filter[medium_id][_eq]={m}&filter[dna_quality_tier][_eq]=qwen_v3"
                      f"&sort=-score&limit={n}&fields=stiftung_id"):
            sid = r["stiftung_id"]
            if sid not in seen:
                seen.add(sid); ids.append(sid)
    return ids


def queue_pool(laender=("CH", "AT"), nur_stammdaten=False):
    """Alle Foerderstiftungen der gewaehlten Laender, priorisiert: Top-Match-Foerderer zuerst,
    dann Stiftungen MIT Zwecktext-Substanz, leere Stammdaten zuletzt (Wert landet frueh).
    nur_stammdaten=True laesst die leeren Stammdaten ganz weg (Schritt D: DE/LI ohne Zwecktext
    zurueckstellen, statt teuer per Websuche zu raten)."""
    top = queue_from_top(50)
    seen = set(top)
    rest, leer = [], []
    for land in laender:
        for filt, ziel in (("&filter[zwecktext][_nempty]=true", rest), ("&filter[zwecktext][_empty]=true", leer)):
            for r in dget(f"/items/stiftungen?filter[ist_foerderstiftung][_eq]=true&filter[land][_eq]={land}"
                          f"{filt}&sort=id&limit=-1&fields=id"):
                sid = r["id"]
                if sid not in seen:
                    seen.add(sid); ziel.append(sid)
    return (top + rest) if nur_stammdaten else (top + rest + leer)


def lade_manifest():
    try:
        return json.load(open(MANIFEST))
    except Exception:
        return {"erledigt": [], "kein_web": []}


def speichere_manifest(m):
    json.dump(m, open(MANIFEST, "w"), ensure_ascii=False)


def hat_qwen_dna(vorg):
    return bool(vorg and "qwen" in str(vorg.get("klassifiziert_by") or ""))


def stammdaten_fallback(sid, stamm, vorg, apply, man, status_grund):
    """Keine Eigenseite gefunden. Hat die Stiftung schon eine qwen-DNA -> nichts tun (kein_web).
    Sonst Stammdaten-qwen-DNA messen (schliesst die ~3200er-Luecke -> bringt neue Matches)."""
    name = stamm.get("Stiftungsname")
    if hat_qwen_dna(vorg):
        man["kein_web"].append(sid)
        return {"sid": sid, "name": name, "status": "kein_web_qwen_da", "grund": status_grund}
    inhalt = ((stamm.get("zwecktext") or "") + (stamm.get("foerderbedingungen") or "")).strip()
    if len(inhalt) < 10:
        # Leere-Waechter: ohne Stammdaten-Substanz erreicht die Messung nie MIN_TAGS
        # (temp=0, deterministisch) — terminal markieren statt taeglich neu zu scheitern.
        man["kein_web"].append(sid)
        return {"sid": sid, "name": name, "status": "kein_inhalt", "grund": status_grund}
    gpu_frei_warten()
    dna = messe_web_dna(stamm, "")  # md leer -> reine Stammdaten-Messung
    if not dna:
        return {"sid": sid, "name": name, "status": "mess_fehler", "grund": status_grund}
    zt = stamm.get("zwecktext") or ""
    res = {"sid": sid, "name": name, "status": "gemessen_stamm",
           "schaerfe_alt": (vorg or {}).get("schaerfe_prozent"),
           "schaerfe_neu": K.calc_schaerfe(dna, False, zt), "tags": len(dna["tags"]), "betrag": None}
    if apply:
        betrag = schaetze_betrag(stamm, "")
        pr = push_dna(sid, stamm, dna, betrag, None, has_web=False)
        res["push"] = pr; res["betrag"] = betrag
        if pr.get("ok"):
            man["erledigt"].append(sid); res["status"] = "veredelt_stamm"
    return res


def enrich_one(sid, apply, man):
    stamm = get_stamm(sid)
    if not stamm:
        return {"sid": sid, "status": "no_stamm"}
    name = stamm.get("Stiftungsname")
    vorg = aktive_dna(sid)
    if vorg and "webenrich" in str(vorg.get("klassifiziert_by") or ""):
        man["erledigt"].append(sid)  # schon von dieser Pipeline (egal welche Maschine) -> skip
        return {"sid": sid, "name": name, "status": "schon_webenrich"}
    kand = UD.finde_kandidaten(name)
    # Manuell angelegte Stiftungen tragen die echte Webseite in den Stammdaten —
    # diese als ersten Kandidaten nehmen (direkt crawlen statt per Suche raten).
    web = (stamm.get("webseite") or "").strip()
    if web.startswith("http") and web not in kand:
        # Verzeichnis-Links (spheriq & Co.) in den Stammdaten sind keine Eigenseiten —
        # nicht crawlen/sanity-pruefen, das kostet nur LLM-Zeit.
        host = urllib.parse.urlparse(web).netloc.lower()
        if not any(b in host for b in getattr(UD, "BLOCK", ())):
            kand = [web] + kand
    if not kand:
        return stammdaten_fallback(sid, stamm, vorg, apply, man, "keine_url")
    # Kandidaten der Reihe nach: crawlen + Sanity, ersten Treffer nehmen
    gewaehlt, md = None, ""
    for url in kand[:3]:
        gpu_frei_warten()
        c = crawl(url)
        if len(c) < 300:
            continue
        ok, konf, grund = sanity_check(name, stamm.get("zwecktext"), url, c)
        log(f"  [{sid}] {url} -> sanity={'JA' if ok else 'nein'} ({konf}%) {grund}")
        if ok:
            gewaehlt, md = url, c
            break
    if not gewaehlt:
        return stammdaten_fallback(sid, stamm, vorg, apply, man, "sanity_abgelehnt")
    gpu_frei_warten()
    dna = messe_web_dna(stamm, md)
    if not dna:
        return {"sid": sid, "name": name, "status": "mess_fehler", "url": gewaehlt}
    zt = stamm.get("zwecktext") or ""
    sch_web = K.calc_schaerfe(dna, True, zt)
    sch_alt = vorg.get("schaerfe_prozent") if vorg else None
    gpu_frei_warten()
    betrag = schaetze_betrag(stamm, md)
    res = {"sid": sid, "name": name, "status": "gemessen", "url": gewaehlt,
           "schaerfe_alt": sch_alt, "schaerfe_web": sch_web, "tags": len(dna["tags"]),
           "betrag": betrag}
    if apply:
        pr = push_dna(sid, stamm, dna, betrag, gewaehlt, has_web=True)
        res["push"] = pr
        if pr.get("ok"):
            man["erledigt"].append(sid)
            res["status"] = "veredelt"
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-top", type=int, default=0, help="Top-N Match-Stiftungen je Medium als Queue")
    ap.add_argument("--pool", action="store_true", help="Voller CH+AT-Foerderstiftungs-Pool (priorisiert)")
    ap.add_argument("--ids", default="", help="Komma-Liste Stiftungs-IDs")
    ap.add_argument("--apply", action="store_true", help="Scharf: schreibt + flippt + re-matcht")
    ap.add_argument("--dry-run", action="store_true", help="(Default) nur messen + zeigen, kein Schreiben")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--force", action="store_true",
                    help="Manifest-Filter (erledigt/kein_web/fehl) ignorieren. Noetig fuer die "
                         "Nachveredelung bereits einmal veredelter Stiftungen - sonst werden sie "
                         "STILL uebersprungen und der Lauf meldet nur '0 Stiftungen offen'.")
    ap.add_argument("--shard", default="", help="i/n fuer disjunktes Multi-Maschinen-Sharding, z.B. 0/2")
    ap.add_argument("--laender", default="CH,AT", help="Laender-Filter fuer --pool, z.B. DE,LI (Schritt D)")
    ap.add_argument("--nur-stammdaten", action="store_true",
                    help="Nur Foerderer MIT Zwecktext messen, leere Stammdaten zurueckstellen (Schritt D)")
    args = ap.parse_args()
    if not TOKEN:
        sys.exit("DIRECTUS_TOKEN fehlt")
    man = lade_manifest()
    if args.ids:
        ids = [int(x) for x in args.ids.split(",") if x.strip()]
    elif args.pool:
        ids = queue_pool(tuple(x.strip().upper() for x in args.laender.split(",") if x.strip()),
                         nur_stammdaten=args.nur_stammdaten)
    elif args.from_top:
        ids = queue_from_top(args.from_top)
    else:
        sys.exit("--pool, --from-top N oder --ids angeben")
    erl, kw = set(man["erledigt"]), set(man["kein_web"])
    fehl = man.setdefault("fehl", {})  # sid(str) -> Anzahl mess_fehler; ab 2 uebersprungen (Manifest-Reset oeffnet neu)
    if args.force:
        # Nachveredelung: bereits erledigte IDs bewusst nochmals durchlassen.
        vorher = len(ids)
        log(f"  --force: Manifest-Filter uebersprungen ({vorher} IDs bleiben in der Queue)")
    else:
        ids = [i for i in ids if i not in erl and i not in kw and fehl.get(str(i), 0) < 2]
    if args.shard:
        si, sn = (int(x) for x in args.shard.split("/"))
        ids = [s for s in ids if s % sn == si]
        log(f"  Shard {si}/{sn}: {len(ids)} Stiftungen in diesem Shard")
    if args.limit:
        ids = ids[:args.limit]
    log(f"=== Web-Enrich {'APPLY' if args.apply else 'DRY-RUN'} | {len(ids)} Stiftungen offen | Modell {MODEL} ===")
    stats = {}
    for i, sid in enumerate(ids, 1):
        r = enrich_one(sid, args.apply, man)
        st = r.get("status", "?")
        stats[st] = stats.get(st, 0) + 1
        if st == "mess_fehler":
            fehl[str(sid)] = fehl.get(str(sid), 0) + 1
        if st in ("gemessen", "veredelt", "gemessen_stamm", "veredelt_stamm"):
            b = r.get("betrag") or {}
            sneu = r.get("schaerfe_web", r.get("schaerfe_neu"))
            log(f"[{i}/{len(ids)}] {sid} {r['name'][:40]} | {st} | Schärfe {r.get('schaerfe_alt')}→{sneu} "
                f"| Tags {r.get('tags')} | Betrag {b.get('chf')} | {r.get('url') or 'stammdaten'}")
        else:
            log(f"[{i}/{len(ids)}] {sid} {(r.get('name') or '')[:40]} | {st}")
        if args.apply and (i % 5 == 0 or st.startswith("veredelt")):
            speichere_manifest(man)
    if args.apply:
        speichere_manifest(man)
    log(f"=== Fertig: {json.dumps(stats, ensure_ascii=False)} ===")


if __name__ == "__main__":
    main()
