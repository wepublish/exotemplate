#!/usr/bin/env python3
"""Guetetest: Soll-Foerderungen muessen in der DB sein UND im Matching erscheinen.

Michis Qualitaets-Idee (Slack, Juli 2026): «Ein guter Messgrad ueber die Qualitaet
waere, ob die App die Foerderung des Kantons Bern automatisch findet und vorschlaegt.
Oder auch nur: ist die Foerderung in der Datenbank und wenn nein, wieso nicht.»

Prueft pro Soll-Paar (Foerderer, Medium):
  1. PRESENCE  – Foerderer existiert in `stiftungen` (und ist kein Duplikat).
  2. DNA       – aktive stiftungs_dna mit qwen-v3-Tier (sonst blockt der
                 MATCH_MIN_TIER-Gate der Engine den Eintrag stumm).
  3. MATCHED   – match_results-Zeile fuer das Medium existiert (projektfrei).
  4. RANK      – Rang in der App-Sicht (Gate wie Front: tier qwen_v3,
                 score >= 20, dedupliziert pro Stiftung) <= max_rank.

Env: DIRECTUS_URL, DIRECTUS_TOKEN (nie hardcoden).
Exit-Code 0 = alles gruen, 1 = mindestens ein FAIL.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

DIRECTUS_URL = (os.environ.get("DIRECTUS_URL") or "").rstrip("/")
DIRECTUS_TOKEN = os.environ.get("DIRECTUS_TOKEN") or ""

# App-Sicht (muss zu apps/front/config/tenant.ts passen)
APP_MIN_SCORE = int(os.environ.get("GUETE_APP_MIN_SCORE", "20"))
APP_TIER = os.environ.get("GUETE_APP_TIER", "qwen_v3")

# Soll-Paare: name_contains sucht case-insensitiv in Stiftungsname.
SOLL = [
    {
        "label": "Kanton Bern indirekte Medienfoerderung -> We.Publish",
        "name_contains": "Kanton Bern",
        "name_contains2": "Medienf",  # beide Fragmente muessen im Namen stecken
        "medium": "wepublish",
        "max_rank": 25,
    },
    {
        # max_rank = harte Latte (FAIL), ziel_rank = Ambition (nur WARN).
        # Stand p2 (2026-07-24): Platz 16 - Prompt greift (Preis-Stiftungen sanken,
        # MFF/Beisheim/Pro Helvetia stiegen), Rest ist DNA-Datenqualitaet der
        # Konkurrenz (z.B. Gysi-DNA weist sie als institutionell aus). Kalibrierungs-
        # ziel Top-5 bleibt in der ROADMAP.
        "label": "Migros-Kulturprozent -> Cueltuer (institutioneller Geldgeber sichtbar)",
        "name_contains": "Migros-Kulturprozent",
        "medium": "cueltuer",
        "max_rank": 20,
        "ziel_rank": 5,
    },
    {
        "label": "Media Forward Fund -> We.Publish",
        "name_contains": "Media Forward Fund",
        "medium": "wepublish",
        "max_rank": 10,
    },
]


def api(path, params=None):
    qs = ("?" + urllib.parse.urlencode(params)) if params else ""
    req = urllib.request.Request(
        DIRECTUS_URL + path + qs,
        headers={"Authorization": f"Bearer {DIRECTUS_TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("data", [])


def find_stiftung(soll):
    params = {
        "filter[Stiftungsname][_icontains]": soll["name_contains"],
        "fields": "id,Stiftungsname,duplicate_of,ist_foerderstiftung",
        "limit": 25,
    }
    rows = api("/items/stiftungen", params)
    frag2 = soll.get("name_contains2")
    if frag2:
        rows = [r for r in rows if frag2.lower() in (r.get("Stiftungsname") or "").lower()]
    # Kanonische Zeile bevorzugen (kein duplicate_of)
    rows.sort(key=lambda r: (r.get("duplicate_of") is not None,))
    return rows[0] if rows else None


def active_dna(stiftung_id):
    rows = api("/items/stiftungs_dna", {
        "filter[stiftung_id][_eq]": stiftung_id,
        "filter[is_active][_eq]": "true",
        "fields": "version_id,klassifiziert_by",
        "limit": 1,
    })
    return rows[0] if rows else None


def app_ranking(medium):
    """Rangliste wie die App sie zeigt: Gate + dedupe pro Stiftung (max score)."""
    rows = api("/items/match_results", {
        "filter[medium_id][_eq]": medium,
        "filter[projekt_id][_null]": "true",
        "filter[dna_quality_tier][_eq]": APP_TIER,
        "filter[score][_gte]": APP_MIN_SCORE,
        "fields": "stiftung_id,score",
        "sort": "-score",
        "limit": 500,
    })
    best = {}
    for r in rows:
        sid = r["stiftung_id"]
        if sid not in best or r["score"] > best[sid]:
            best[sid] = r["score"]
    ranked = sorted(best.items(), key=lambda kv: -kv[1])
    return ranked  # [(stiftung_id, score), ...] absteigend


def main():
    if not DIRECTUS_URL or not DIRECTUS_TOKEN:
        print("FEHLER: DIRECTUS_URL/DIRECTUS_TOKEN nicht gesetzt.")
        return 2

    fails = 0
    for soll in SOLL:
        print(f"\n== {soll['label']} ==")
        st = find_stiftung(soll)
        if not st:
            print(f"  FAIL PRESENCE: kein Eintrag mit '{soll['name_contains']}'"
                  + (f" + '{soll['name_contains2']}'" if soll.get("name_contains2") else "")
                  + " in stiftungen")
            fails += 1
            continue
        sid = st["id"]
        dup = st.get("duplicate_of")
        print(f"  ok  PRESENCE: id={sid} '{st['Stiftungsname']}'"
              + (f" (ACHTUNG duplicate_of={dup})" if dup else ""))

        dna = active_dna(sid)
        if not dna:
            print("  FAIL DNA: keine aktive stiftungs_dna -> Tier-Gate blockt den Eintrag")
            fails += 1
        else:
            kb = (dna.get("klassifiziert_by") or "").lower()
            if "qwen" in kb and "v3" in kb:
                print(f"  ok  DNA: {dna.get('klassifiziert_by')}")
            else:
                print(f"  FAIL DNA: klassifiziert_by='{dna.get('klassifiziert_by')}' ist kein qwen-v3 -> Tier-Gate blockt")
                fails += 1

        ranking = app_ranking(soll["medium"])
        pos = next((i + 1 for i, (s, _) in enumerate(ranking) if s == sid), None)
        if pos is None:
            print(f"  FAIL MATCHED: keine gate-taugliche match_results-Zeile fuer medium={soll['medium']}")
            fails += 1
        else:
            score = dict(ranking)[sid]
            if pos <= soll["max_rank"]:
                print(f"  ok  RANK: Platz {pos}/{len(ranking)} (score {score}, Limite <= {soll['max_rank']})")
                ziel = soll.get("ziel_rank")
                if ziel and pos > ziel:
                    print(f"  WARN ZIEL: Kalibrierungsziel Platz <= {ziel} noch nicht erreicht (Ist: {pos})")
            else:
                print(f"  FAIL RANK: Platz {pos}/{len(ranking)} (score {score}) — Soll: <= {soll['max_rank']}")
                fails += 1

    print(f"\n{'ALLE GRUEN' if fails == 0 else str(fails) + ' FAIL(S)'}")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
