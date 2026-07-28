#!/usr/bin/env python3
"""Within-Source-Duplikat-Detector.

Findet Stiftungen mit gleichem normalisiertem Namen + gleicher register_source +
gleichem Land, die beide mit aktiver DNA und lifecycle_status='aktiv' sind.

Kein automatisches Merge - schreibt nur einen Bericht und exitiert mit RC=0
(kein Befund) oder RC=1 (Befund vorhanden, manueller Review noetig).

Cron: 0 5 1 * * (Erster Tag im Monat, 05:00).

Output: /home/dergeraet/logs/duplicate_report_<YYYYMM>.md
"""
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def psql(sql, timeout=60):
    cmd = ["docker", "exec", "-i", "directus-postgres-spark",
           "psql", "-U", "directus", "-d", "directus_db",
           "-t", "-A", "-F", "\t"]
    proc = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"psql: {proc.stderr.strip()[:300]}")
    return proc.stdout.strip()


SQL_DETECT = """
WITH cleaned AS (
  SELECT
    s.id, s."Stiftungsname", s.land, s.sitz, s.register_source, s.webseite,
    LOWER(REGEXP_REPLACE(s."Stiftungsname", '[\\s,\\.\\-_/()]+', '', 'g')) AS name_norm,
    EXISTS (SELECT 1 FROM stiftungs_dna sd WHERE sd.stiftung_id = s.id AND sd.is_active = TRUE) AS hat_dna
  FROM stiftungen s
  WHERE s.lifecycle_status = 'aktiv'
)
SELECT
  c1.register_source,
  c1.land,
  c1.id, c1."Stiftungsname", COALESCE(c1.sitz, ''), COALESCE(c1.webseite, ''),
  c2.id, c2."Stiftungsname", COALESCE(c2.sitz, ''), COALESCE(c2.webseite, '')
FROM cleaned c1
JOIN cleaned c2 ON c1.name_norm = c2.name_norm
                AND c1.register_source = c2.register_source
                AND c1.land = c2.land
                AND c1.id < c2.id
                AND c1.hat_dna = TRUE AND c2.hat_dna = TRUE
                AND length(c1.name_norm) > 8
ORDER BY c1.register_source, c1.id;
"""


def main():
    out = psql(SQL_DETECT)
    pairs = []
    for line in out.split("\n"):
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < 10:
            continue
        pairs.append({
            "src": parts[0], "land": parts[1],
            "a_id": int(parts[2]), "a_name": parts[3], "a_sitz": parts[4], "a_web": parts[5],
            "b_id": int(parts[6]), "b_name": parts[7], "b_sitz": parts[8], "b_web": parts[9],
        })

    today = datetime.now().strftime("%Y-%m-%d")
    yyyymm = datetime.now().strftime("%Y%m")
    log_path = Path(f"/home/dergeraet/logs/duplicate_report_{yyyymm}.md")

    md_lines = [
        f"# Duplikat-Pruefung {today}",
        "",
        f"Within-Source-Duplikate mit beidseitiger aktiver DNA und gleichem Land/Quelle.",
        f"",
        f"**Gefunden:** {len(pairs)} Paar(e). Manueller Review noetig (DB-Schreiben nicht automatisch).",
        "",
    ]
    if pairs:
        md_lines.append("| Quelle | Land | A: id / name / sitz | B: id / name / sitz |")
        md_lines.append("|---|---|---|---|")
        for p in pairs:
            a = f"{p['a_id']} / {p['a_name'][:40]} / {p['a_sitz']}"
            b = f"{p['b_id']} / {p['b_name'][:40]} / {p['b_sitz']}"
            md_lines.append(f"| {p['src']} | {p['land']} | {a} | {b} |")
    else:
        md_lines.append("_Keine Duplikate gefunden._")

    log_path.write_text("\n".join(md_lines), encoding="utf-8")
    print(f"Report: {log_path} ({len(pairs)} Paare)")
    sys.exit(1 if pairs else 0)


if __name__ == "__main__":
    main()
