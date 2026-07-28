#!/usr/bin/env python3
"""
Erzeugt ein selbst-aktualisierendes Status-HTML zur Stiftungs-DNA-Verarbeitung.
Laeuft auf dem Spark (Studio-unabhaengig). Liest Directus-Live-Zahlen (Klassifikation,
DNA-Abdeckung pro Land), Prozess-Status, Manifest und Lauf-Log
-> ~/faas_classify/status_web/index.html (meta-refresh 60s).
Wird per Cron alle paar Minuten neu erzeugt; ein http.server auf :8899 serviert es.

Kernfrage, die das HTML beantwortet: wie viele von wie vielen Foerderstiftungen
sind schon wie verarbeitet (web-veredelt / stammdaten-DNA / offen), pro Land.
"""
from __future__ import annotations
import json, os, re, subprocess, urllib.request, urllib.parse
from datetime import datetime, timezone
from pathlib import Path

DIRECTUS = "http://localhost:8055"
LOG = Path.home() / "faas_classify" / "web_enrich.log"
MANIFEST = Path.home() / "faas_classify" / "webenrich_manifest.json"
OUT_DIR = Path.home() / "faas_classify" / "status_web"
OUT = OUT_DIR / "index.html"
OUT_DIR.mkdir(parents=True, exist_ok=True)

LAENDER = ["CH", "AT", "DE", "LI"]


def token():
    p = Path.home() / "faas_classify" / ".dtoken"
    if p.exists():
        return p.read_text().strip()
    for l in (Path.home() / ".hermes" / ".env").read_text().splitlines():
        if l.startswith("DIRECTUS_TOKEN"):
            return l.split("=", 1)[1].strip().strip('"')
    return ""


TOK = token()


def dcount(coll, params: dict):
    """params: dict von Directus-Filtern (ohne aggregate). Gibt int oder None."""
    try:
        q = dict(params)
        q["aggregate[count]"] = "id"
        url = f"{DIRECTUS}/items/{coll}?" + urllib.parse.urlencode(q)
        r = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOK}"})
        with urllib.request.urlopen(r, timeout=25) as x:
            d = json.loads(x.read().decode())["data"][0]["count"]
            return int(d["id"]) if isinstance(d, dict) else int(d)
    except Exception:
        return None


def laeuft():
    try:
        return subprocess.run(["pgrep", "-f", "[w]eb_enrich_daemon"], capture_output=True).returncode == 0
    except Exception:
        return False


def lese_lauf():
    """Statistik + letzte Treffer aus dem aktuellen (letzten) Lauf-Abschnitt."""
    if not LOG.exists():
        return {}, [], None, None
    zeilen = [l for l in LOG.read_text(errors="replace").splitlines() if "GPU belegt" not in l]
    starts = [i for i, l in enumerate(zeilen) if "=== Web-Enrich" in l and "Stiftungen offen" in l]
    abschnitt = zeilen[starts[-1]:] if starts else zeilen
    offen = None
    m = re.search(r"\|\s*(\d+)\s+Stiftungen offen", abschnitt[0]) if abschnitt else None
    if m:
        offen = int(m.group(1))
    stats, treffer, akt = {}, [], 0
    for l in abschnitt:
        mm = re.search(r"\[(\d+)/(\d+)\]\s+\d+\s+(.+?)\s+\|\s+(\w+)", l)
        if mm:
            akt = int(mm.group(1))
            st = mm.group(4)
            stats[st] = stats.get(st, 0) + 1
            if st.startswith("veredelt"):
                treffer.append(l.split("] ", 1)[-1] if "] " in l else l)
    return stats, treffer[-12:], offen, akt


def land_breakdown():
    """Pro Land: Foerderer, matchbare DNA (qwen3.6-v3), davon web-veredelt."""
    out = {}
    for L in LAENDER:
        foerder = dcount("stiftungen", {"filter[ist_foerderstiftung][_eq]": "true", "filter[land][_eq]": L})
        matchbar = dcount("stiftungs_dna", {
            "filter[is_active][_eq]": "true",
            "filter[klassifiziert_by][_contains]": "qwen3.6-v3",
            "filter[stiftung_id][land][_eq]": L,
        })
        web = dcount("stiftungs_dna", {
            "filter[is_active][_eq]": "true",
            "filter[klassifiziert_by][_contains]": "webenrich",
            "filter[stiftung_id][land][_eq]": L,
        })
        out[L] = {"foerder": foerder or 0, "matchbar": matchbar or 0, "web": web or 0}
    return out


APO = "’"  # typografisches Tausender-Trennzeichen fuer die Anzeige


def fmt(x):
    if not isinstance(x, int):
        return x if x is not None else "?"
    return f"{x:,}".replace(",", APO)


def main():
    now = datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M:%S")
    run = laeuft()
    man = {"erledigt": [], "kein_web": []}
    try:
        man = json.load(open(MANIFEST))
    except Exception:
        pass

    def mlen(key):
        v = man.get(key, 0)
        return len(v) if isinstance(v, (list, dict)) else int(v or 0)

    erl, kw = mlen("erledigt"), mlen("kein_web")
    stats, treffer, offen, akt = lese_lauf()
    lb = land_breakdown()

    pool_total = sum(v["foerder"] for v in lb.values())
    matchbar_total = sum(v["matchbar"] for v in lb.values())
    web_total = sum(v["web"] for v in lb.values())
    stamm_total = max(0, matchbar_total - web_total)
    offen_total = sum(max(0, v["foerder"] - v["matchbar"]) for v in lb.values())
    pct_total = round(100 * matchbar_total / pool_total) if pool_total else 0
    de_offen = (lb["DE"]["foerder"] + lb["LI"]["foerder"]
                - lb["DE"]["matchbar"] - lb["LI"]["matchbar"])

    badge = ('<span style="color:#3ddc7d">&#9679; l&auml;uft</span>' if run
             else '<span style="color:#ff5a5a">&#9679; gestoppt</span>')
    prog = f"{akt} / {offen}" if offen else (str(akt) if akt else "&mdash;")
    pct_run = f"{100*akt/offen:.0f}%" if offen and akt else ""

    def bar(pct, farbe):
        pct = max(0, min(100, pct))
        return (f"<div style='background:#242833;border-radius:5px;height:9px;width:120px;"
                f"display:inline-block;vertical-align:middle'>"
                f"<div style='background:{farbe};height:9px;border-radius:5px;width:{pct}%'></div></div>")

    land_rows = ""
    for L in LAENDER:
        v = lb[L]
        f, mb, web = v["foerder"], v["matchbar"], v["web"]
        stamm = max(0, mb - web)
        pct = round(100 * mb / f) if f else 0
        off = max(0, f - mb)
        farbe = "#3ddc7d" if pct >= 95 else ("#f0b429" if pct > 0 else "#4a4f5a")
        pct_lbl = f"{min(pct,100)}%" + (" <span style='color:#3ddc7d'>&#10003;</span>" if pct >= 100 else "")
        land_rows += (
            "<tr>"
            f"<td style='font-weight:600'>{L}</td>"
            f"<td style='text-align:right'>{fmt(f)}</td>"
            f"<td style='text-align:right;color:#3ddc7d'>{fmt(web)}</td>"
            f"<td style='text-align:right;color:#9fd0ff'>{fmt(stamm)}</td>"
            f"<td style='text-align:right;color:#ff9a9a'>{fmt(off)}</td>"
            f"<td style='padding-left:14px'>{bar(pct, farbe)} "
            f"<span style='font-size:12px;color:#8a8f98'>{pct_lbl}</span></td>"
            "</tr>"
        )

    def row(k, v):
        return f"<tr><td>{k}</td><td style='text-align:right;font-weight:600'>{v if v is not None else '?'}</td></tr>"

    statrows = "".join(row(k, v) for k, v in sorted(stats.items(), key=lambda x: -x[1]))
    trefferrows = "".join(f"<li>{t}</li>" for t in reversed(treffer)) or "<li>noch keine in diesem Lauf</li>"

    html = f"""<!doctype html><html lang=de><head><meta charset=utf-8>
<meta http-equiv="refresh" content="60">
<meta name=viewport content="width=device-width,initial-scale=1">
<title>FaaS DNA-Verarbeitung &middot; Status</title>
<style>
body{{font-family:'Space Mono',ui-monospace,Menlo,monospace;background:#0f1115;color:#e6e8ec;margin:0;padding:28px;line-height:1.55;max-width:900px}}
h1{{font-size:21px;margin:0 0 4px}} .sub{{color:#8a8f98;font-size:13px;margin-bottom:24px}}
.grid{{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px}}
.card{{background:#171a21;border:1px solid #242833;border-radius:12px;padding:15px 18px;min-width:150px}}
.card .n{{font-size:29px;font-weight:700}} .card .l{{color:#8a8f98;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}}
.megabar{{background:#242833;border-radius:8px;height:16px;width:100%;max-width:640px;margin:14px 0 6px;overflow:hidden}}
.megabar>div{{background:linear-gradient(90deg,#3ddc7d,#2bb968);height:16px}}
table{{border-collapse:collapse;width:100%;max-width:640px;margin-top:6px}}
th,td{{padding:6px 8px;border-bottom:1px solid #242833;font-size:14px}}
th{{color:#8a8f98;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:right;font-weight:600}}
th:first-child{{text-align:left}} th:last-child{{text-align:left;padding-left:14px}}
h2{{font-size:13px;color:#8a8f98;text-transform:uppercase;letter-spacing:.05em;margin:30px 0 8px}}
ul{{padding-left:18px}} li{{font-size:12.5px;color:#c4c8d0;margin:3px 0}}
.note{{background:#1c1810;border:1px solid #3a3115;border-radius:10px;padding:12px 16px;font-size:13px;color:#e8c988;margin:18px 0;max-width:640px}}
.legend{{color:#6a6f78;font-size:11.5px;margin-top:4px}}
.foot{{color:#5a5f68;font-size:11px;margin-top:30px}}
code{{color:#9fd0ff}}
</style></head><body>
<h1>FaaS &middot; Stiftungs-DNA-Verarbeitung {badge}</h1>
<div class=sub>L&auml;uft auf dem Spark &middot; Stand {now} &middot; aktualisiert sich automatisch (60s)</div>

<div class=grid>
  <div class=card><div class=n>{fmt(matchbar_total)}</div><div class=l>mit matchbarer DNA</div></div>
  <div class=card><div class=n>{fmt(pool_total)}</div><div class=l>F&ouml;rderpool gesamt</div></div>
  <div class=card><div class=n style="color:#3ddc7d">{fmt(web_total)}</div><div class=l>davon web-veredelt (Premium)</div></div>
  <div class=card><div class=n style="color:#ff9a9a">{fmt(offen_total)}</div><div class=l>noch offen</div></div>
</div>
<div class=megabar><div style="width:{pct_total}%"></div></div>
<div class=legend>{pct_total}% des F&ouml;rderpools hat eine matchbare DNA ({fmt(web_total)} mit echtem Web-Crawl, {fmt(stamm_total)} nur aus Stammdaten)</div>

<h2>Pro Land &mdash; wie viele von wie vielen</h2>
<table>
<tr><th>Land</th><th>F&ouml;rderer</th><th>web-veredelt</th><th>stammdaten</th><th>offen</th><th>Abdeckung</th></tr>
{land_rows}
</table>
<div class=legend>web-veredelt = mit echtem Website-Crawl (h&ouml;chste Qualit&auml;t) &middot; stammdaten = nur aus Registerdaten gemessen &middot; offen = noch keine matchbare DNA</div>

<div class=note><b>Schritt D l&auml;uft (seit 06.07., 2 Worker: Spark + Studio):</b> ~13'421 DE/LI-F&ouml;rderer MIT Zwecktext werden gemessen (~5'354 ohne Zwecktext zur&uuml;ckgestellt, kommen sp&auml;ter). Aktuell noch offen: {fmt(de_offen)} &mdash; die Zahl sinkt, w&auml;hrend die Worker laufen (grob ~1 Woche).</div>

<h2>Aktueller Lauf</h2>
<div class=grid>
  <div class=card><div class=n>{prog}</div><div class=l>Fortschritt {pct_run}</div></div>
  <div class=card><div class=n>{fmt(erl)}</div><div class=l>veredelt (Manifest)</div></div>
  <div class=card><div class=n>{fmt(kw)}</div><div class=l>kein Web (&uuml;bersprungen)</div></div>
</div>
<h2>Status im aktuellen Lauf</h2>
<table>{statrows or '<tr><td>noch keine Daten</td><td></td></tr>'}</table>
<h2>Zuletzt veredelt</h2>
<ul>{trefferrows}</ul>

<div class=foot>Not-Aus Daemon: <code>pkill -f "[w]eb_enrich_daemon"</code> &middot; Quelle: Directus + ~/faas_classify/web_enrich.log &middot; Voll-Stand: <code>python3 ~/faas_classify/pool_pyramide.py</code></div>
</body></html>"""
    OUT.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    main()
