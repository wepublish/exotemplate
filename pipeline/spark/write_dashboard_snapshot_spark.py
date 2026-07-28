#!/usr/bin/env python3
"""
write_dashboard_snapshot_spark.py

Spark-native Variante von write_dashboard_snapshot.py.
Statt SSH-Aufrufe gegen den Spark werden Statusinformationen lokal abgegriffen.

Quelle: Directus-REST-API plus lokale Spark-Agent-Logs.
Ziel: dashboard_snapshot.json lokal, dann via rclone nach Drive uploaden.

Geplant als OS-Cron auf dem Spark, taeglich nach dem Tageswaechter-Lauf.

Autor: Jolanda Spiess plus Claude (Anthropic), 30.04.2026.
"""

import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

# ============================================================
# KONFIGURATION
# ============================================================

DIRECTUS_URL = os.environ.get("DIRECTUS_URL", "https://stiftungen.winkelriedtoechter.ch")
DIRECTUS_TOKEN = os.environ.get("DIRECTUS_TOKEN", "YCo6WnHKCqb3nUFqIAfl8UQIyoVdo4P3")

SPARK_LOG_DIR = os.environ.get("SPARK_LOG_DIR", str(Path.home() / "stiftungen_agent_logs"))

# Lokales Output-File (auf dem Spark)
OUTPUT_PATH = Path(os.environ.get(
    "DASHBOARD_SNAPSHOT_PATH",
    str(Path.home() / ".hermes/data/faas/dashboard_snapshot.json")
))

# rclone-Ziel im Drive: gdrive-jolanda:_workspace/wepublish_faas_entwicklung/snapshots/
RCLONE_REMOTE = os.environ.get(
    "RCLONE_REMOTE_PATH",
    "gdrive-jolanda:_workspace/wepublish_faas_entwicklung/snapshots/"
)
# Cowork-Drive-Suche findet eine Datei nur, wenn sie im Drive-Search-Index ist;
# der Cowork-Snapshot-Reader sucht nach `faas_dashboard_snapshot.json`. Daher
# laden wir unter diesem Namen hoch:
DRIVE_TARGET_NAME = os.environ.get("DRIVE_TARGET_NAME", "faas_dashboard_snapshot.json")

DATENQUALITAET_VALUES = [
    "verifiziert", "ki_ungeprueft", "phantom",
    "teilweise", "vollstaendig", "disqualifiziert",
]


# ============================================================
# DIRECTUS-ZUGRIFF
# ============================================================

def directus_get(endpoint, params=None):
    if not DIRECTUS_TOKEN:
        raise RuntimeError("DIRECTUS_TOKEN nicht gesetzt")
    headers = {"Authorization": f"Bearer {DIRECTUS_TOKEN}"}
    url = f"{DIRECTUS_URL}{endpoint}"
    resp = requests.get(url, headers=headers, params=params or {}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_total_count():
    data = directus_get("/items/stiftungen", {"limit": 0, "meta": "total_count"})
    return int(data["meta"]["total_count"])


def fetch_count_by_quality():
    out = {}
    for val in DATENQUALITAET_VALUES:
        data = directus_get("/items/stiftungen", {
            "filter[datenqualitaet][_eq]": val,
            "limit": 0, "meta": "filter_count"
        })
        out[val] = int(data["meta"]["filter_count"])
    return out


def fetch_foerderstiftungen_pool():
    total_pool = directus_get("/items/stiftungen", {
        "filter[ist_foerderstiftung][_eq]": "true",
        "limit": 0, "meta": "filter_count"
    })["meta"]["filter_count"]

    classified_pool = directus_get("/items/stiftungen", {
        "filter[ist_foerderstiftung][_eq]": "true",
        "filter[datenqualitaet][_neq]": "ki_ungeprueft",
        "limit": 0, "meta": "filter_count"
    })["meta"]["filter_count"]

    return {"total": int(total_pool), "classified": int(classified_pool)}


def fetch_throughput_last_7_days():
    today = datetime.now(timezone.utc).date()
    out = []
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        start = day.isoformat() + "T00:00:00Z"
        end = (day + timedelta(days=1)).isoformat() + "T00:00:00Z"
        try:
            data = directus_get("/items/stiftungen", {
                "filter[verifiziert_datum][_gte]": start,
                "filter[verifiziert_datum][_lt]": end,
                "limit": 0, "meta": "filter_count"
            })
            count = int(data["meta"]["filter_count"])
        except Exception:
            count = 0
        out.append({"tag": day.strftime("%d.%m"), "count": count})
    return out


def fetch_phantom_quote_last_7_days():
    today = datetime.now(timezone.utc).date()
    out = []
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        start = day.isoformat() + "T00:00:00Z"
        end = (day + timedelta(days=1)).isoformat() + "T00:00:00Z"
        try:
            total_data = directus_get("/items/stiftungen", {
                "filter[verifiziert_datum][_gte]": start,
                "filter[verifiziert_datum][_lt]": end,
                "limit": 0, "meta": "filter_count"
            })
            total = int(total_data["meta"]["filter_count"])
            phantom_data = directus_get("/items/stiftungen", {
                "filter[verifiziert_datum][_gte]": start,
                "filter[verifiziert_datum][_lt]": end,
                "filter[datenqualitaet][_eq]": "phantom",
                "limit": 0, "meta": "filter_count"
            })
            phantom = int(phantom_data["meta"]["filter_count"])
            pct = (phantom / total * 100) if total > 0 else 0.0
        except Exception:
            pct = 0.0
        out.append({"tag": day.strftime("%d.%m"), "pct": round(pct, 1)})
    return out


# ============================================================
# LOKALE SPARK-AGENT-PROBE (kein SSH)
# ============================================================

def local_command(cmd):
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
        if result.returncode != 0:
            return None
        return result.stdout.strip()
    except Exception:
        return None


def fetch_spark_agent_status():
    screen_check = local_command("screen -ls | grep stiftungen-agent || echo none")
    is_running = bool(screen_check) and "stiftungen-agent" in screen_check and "none" not in screen_check.lower().split('\n')[-1] if screen_check else False
    # robuste Variante: explizit
    is_running = bool(screen_check) and "stiftungen-agent" in screen_check and screen_check.strip() != "none"

    last_log = local_command(
        f"ls -t {SPARK_LOG_DIR}/agent_*.log 2>/dev/null | head -1 | xargs tail -1 2>/dev/null"
    )
    if not last_log:
        # Fallback auf agent_screen.log
        last_log = local_command(
            f"tail -1 {SPARK_LOG_DIR}/agent_screen.log 2>/dev/null"
        )

    last_mod = local_command(
        f"ls -t {SPARK_LOG_DIR}/agent_*.log 2>/dev/null | head -1 | xargs stat -c '%y' 2>/dev/null"
    )
    if not last_mod:
        last_mod = local_command(
            f"stat -c '%y' {SPARK_LOG_DIR}/agent_screen.log 2>/dev/null"
        )

    return {
        "is_running": is_running,
        "last_log_line": last_log[:300] if last_log else None,
        "last_log_modified": last_mod,
    }


# ============================================================
# CLOUDFLARE-PROBE
# ============================================================

def check_cloudflare():
    try:
        resp = requests.get(f"{DIRECTUS_URL}/server/health", timeout=10)
        return resp.status_code == 200
    except Exception:
        return False


# ============================================================
# TAGESWAECHTER-MELDUNG
# ============================================================

def build_tageswaechter_message(kpis, phantom_quote, agent_status):
    today_str = datetime.now().strftime("%d.%m.%Y %H:%M")
    last_throughput = phantom_quote[-1] if phantom_quote else None

    lines = [f"Tageswaechter {today_str}"]
    if agent_status.get("is_running"):
        lines.append("- Stiftungen-Agent v3.1b laeuft, Screen-Session aktiv")
    else:
        lines.append("- ACHTUNG: Spark-Agent nicht erreichbar oder Screen-Session weg")

    if last_throughput:
        lines.append(f"- Phantom-Quote letzte 24h: {last_throughput['pct']} Prozent")

    lines.append(f"- Restbestand ki_ungeprueft: {kpis['by_quality'].get('ki_ungeprueft', 0)}")
    lines.append(f"- Foerderstiftungen-Pool klassifiziert: "
                 f"{kpis['foerderstiftungen']['classified']} / "
                 f"{kpis['foerderstiftungen']['total']}")
    return "\n".join(lines)


# ============================================================
# RCLONE-UPLOAD
# ============================================================

def rclone_upload(local_path):
    """Lade die Datei nach Drive hoch. Nutzt rclone copyto, damit der Zielname stimmt."""
    target = RCLONE_REMOTE.rstrip("/") + "/" + DRIVE_TARGET_NAME
    cmd = [
        "rclone", "copyto",
        str(local_path),
        target,
        "--retries", "3",
        "--low-level-retries", "5",
        "--timeout", "120s",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if result.returncode != 0:
            print(f"  rclone-Fehler: {result.stderr.strip()}")
            return False
        return True
    except Exception as e:
        print(f"  rclone-Exception: {e}")
        return False


# ============================================================
# MAIN
# ============================================================

def main():
    print(f"[{datetime.now().isoformat()}] Snapshot wird erzeugt (Spark-native)...")

    snapshot = {
        "snapshot_at": datetime.now(timezone.utc).isoformat(),
        "snapshot_source": "write_dashboard_snapshot_spark.py v1 (on Spark)",
    }

    try:
        snapshot["kpis"] = {
            "total": fetch_total_count(),
            "by_quality": fetch_count_by_quality(),
            "foerderstiftungen": fetch_foerderstiftungen_pool(),
        }
    except Exception as e:
        snapshot["kpis_error"] = str(e)
        print(f"  Fehler bei Directus-KPIs: {e}")

    try:
        snapshot["seven_day_throughput"] = fetch_throughput_last_7_days()
    except Exception as e:
        snapshot["throughput_error"] = str(e)

    try:
        snapshot["seven_day_phantom_quote"] = fetch_phantom_quote_last_7_days()
    except Exception as e:
        snapshot["phantom_quote_error"] = str(e)

    snapshot["agent_status"] = fetch_spark_agent_status()
    snapshot["cloudflare_ok"] = check_cloudflare()

    if "kpis" in snapshot:
        try:
            snapshot["tageswaechter_message"] = build_tageswaechter_message(
                snapshot["kpis"],
                snapshot.get("seven_day_phantom_quote", []),
                snapshot["agent_status"]
            )
        except Exception as e:
            snapshot["tageswaechter_error"] = str(e)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)

    print(f"[{datetime.now().isoformat()}] Snapshot lokal geschrieben: {OUTPUT_PATH}")

    # Drive-Upload
    if rclone_upload(OUTPUT_PATH):
        print(f"[{datetime.now().isoformat()}] rclone-Upload erfolgreich.")
    else:
        print(f"[{datetime.now().isoformat()}] rclone-Upload FEHLGESCHLAGEN.")
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
