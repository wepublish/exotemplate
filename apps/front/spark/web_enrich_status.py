#!/usr/bin/env python3
"""
Erzeugt ein selbst-aktualisierendes Status-HTML zum Web-Enrichment-Lauf.
Laeuft auf dem Spark (Studio-unabhaengig). Liest Prozess-Status, Manifest, Lauf-Log
und Directus-Live-Zahlen -> ~/faas_classify/web_enrich_status.html (meta-refresh 60s).
Wird per Cron alle paar Minuten neu erzeugt; ein http.server auf :8899 serviert es.
"""
from __future__ import annotations
import json, os, re, subprocess, urllib.request
from datetime import datetime, timezone
from pathlib import Path

DIRECTUS = "http://localhost:8055"
LOG = Path.home() / "faas_classify" / "web_enrich.log"
MANIFEST = Path.home() / "faas_classify" / "webenrich_manifest.json"
OUT_DIR = Path.home() / "faas_classify" / "status_web"
OUT = OUT_DIR / "index.html"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def token():
    for l in (Path.home() / ".hermes" / ".env").read_text().splitlines():
        if l.startswith("DIRECTUS_TOKEN"):
            return l.split("=", 1)[1].strip().strip('"')
    return ""


TOK = token()


def dcount(coll, flt):
    try:
        url = f"{DIRECTUS}/items/{coll}?{flt}&aggregate[count]=id"
        r = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOK}"})
        with urllib.request.urlopen(r, timeout=20) as x:
            return int(json.loads(x.read().decode())["data"][0]["count"]["id"])
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
    # letzten Lauf-Start finden
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


def main():
    now = datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M:%S")
    run = laeuft()
    man = {"erledigt": [], "kein_web": []}
    try:
        man = json.load(open(MANIFEST))
    except Exception:
        pass
    stats, treffer, offen, akt = lese_lauf()
    web_dna = dcount("stiftungs_dna", "filter[is_active][_eq]=true&filter[klassifiziert_by][_icontains]=webenrich")
    qwen_dna = dcount("stiftungs_dna", "filter[is_active][_eq]=true&filter[klassifiziert_by][_icontains]=qwen")
    betrag = dcount("stiftungen", "filter[betrag_vorschlag][_nnull]=true")
    erl, kw = len(man.get("erledigt", [])), len(man.get("kein_web", []))

    badge = ('<span style="color:#0a0">● läuft</span>' if run
             else '<span style="color:#c00">● gestoppt</span>')
    prog = f"{akt} / {offen}" if offen else (str(akt) if akt else "—")
    pct = f"{100*akt/offen:.1f}%" if offen and akt else ""

    def row(k, v):
        return f"<tr><td>{k}</td><td style='text-align:right;font-weight:600'>{v if v is not None else '?'}</td></tr>"

    statrows = "".join(row(k, v) for k, v in sorted(stats.items(), key=lambda x: -x[1]))
    trefferrows = "".join(f"<li>{t}</li>" for t in reversed(treffer)) or "<li>noch keine in diesem Lauf</li>"

    html = f"""<!doctype html><html lang=de><head><meta charset=utf-8>
<meta http-equiv="refresh" content="60">
<title>Web-Enrichment Status</title>
<style>
body{{font-family:'Space Mono',ui-monospace,Menlo,monospace;background:#0f1115;color:#e6e8ec;margin:0;padding:28px;line-height:1.5}}
h1{{font-size:20px;margin:0 0 4px}} .sub{{color:#8a8f98;font-size:13px;margin-bottom:22px}}
.grid{{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:22px}}
.card{{background:#171a21;border:1px solid #242833;border-radius:12px;padding:16px 18px;min-width:180px}}
.card .n{{font-size:30px;font-weight:700}} .card .l{{color:#8a8f98;font-size:12px;text-transform:uppercase;letter-spacing:.04em}}
table{{border-collapse:collapse;width:100%;max-width:420px}} td{{padding:5px 8px;border-bottom:1px solid #242833;font-size:14px}}
h2{{font-size:14px;color:#8a8f98;text-transform:uppercase;letter-spacing:.05em;margin:24px 0 8px}}
ul{{padding-left:18px}} li{{font-size:13px;color:#c4c8d0;margin:3px 0}}
.foot{{color:#5a5f68;font-size:11px;margin-top:26px}}
</style></head><body>
<h1>Web-Enrichment {badge}</h1>
<div class=sub>Stiftungs-DNA-Anreicherung (Web-Crawl + Betrag) · läuft auf dem Spark · Stand {now} · aktualisiert sich automatisch</div>
<div class=grid>
  <div class=card><div class=n>{prog}</div><div class=l>Fortschritt aktueller Lauf {pct}</div></div>
  <div class=card><div class=n>{erl}</div><div class=l>veredelt (Manifest)</div></div>
  <div class=card><div class=n>{web_dna if web_dna is not None else '?'}</div><div class=l>Web-DNAs aktiv (gesamt)</div></div>
  <div class=card><div class=n>{betrag if betrag is not None else '?'}</div><div class=l>Stiftungen mit Betrag</div></div>
  <div class=card><div class=n>{qwen_dna if qwen_dna is not None else '?'}</div><div class=l>qwen-DNAs aktiv (gesamt)</div></div>
  <div class=card><div class=n>{kw}</div><div class=l>kein Web (übersprungen)</div></div>
</div>
<h2>Status im aktuellen Lauf</h2>
<table>{statrows or '<tr><td>noch keine Daten</td><td></td></tr>'}</table>
<h2>Zuletzt veredelt</h2>
<ul>{trefferrows}</ul>
<div class=foot>Not-Aus: <code>pkill -f "[w]eb_enrich_daemon"</code> · Quelle: ~/faas_classify/web_enrich.log + Directus</div>
</body></html>"""
    OUT.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    main()
