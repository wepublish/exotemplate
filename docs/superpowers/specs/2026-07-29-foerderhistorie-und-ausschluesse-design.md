# Förderhistorie und Stiftungs-Ausschlüsse je Medium

Datum: 2026-07-29 · Status: umgesetzt in dieser Session

## Problem

Beim Self-Onboarding kann ein Medium bisher nur Freitext hinterlassen (Fragebogen,
Feld «No-Gos»). Es gibt keinen strukturierten Ort für zwei Dinge, die das Medium
besser weiss als jede Recherche:

1. **Förderhistorie:** welche Stiftungen haben das Medium in der Vergangenheit
   gefördert (wann, mit wie viel, wofür) – und wo wurde ein Gesuch abgelehnt.
2. **Ausschlüsse:** welche Stiftungen kommen für künftige Gesuche nicht (mehr)
   in Frage (Befangenheit, Zerwürfnis, Statuten-Grenze, einmalige Förderung usw.).

Das bestehende «Nicht relevant»-Ausblenden greift erst NACH der
Matching-Freischaltung auf der Treffer-Seite und modelliert keinen Betrag,
kein Jahr, keinen Grund auf Vorrat.

## Entscheid: eigene Collection `medium_foerderhistorie`

Erwogene Alternativen:

- **Applications mit Status `ausgeblendet` wiederverwenden** (wie Treffer-
  Ausblenden): verworfen. Applications modellieren Gesuchs-Prozess, nicht
  Beziehungs-Wissen; Jahr/Betrag hätten keinen Platz; vor der Freischaltung
  sollen keine Applications entstehen.
- **Nur Freitext im Fragebogen:** existiert schon, bleibt bestehen – aber ohne
  Engine-Wirkung und ohne strukturierte Auswertung.
- **Neue Collection (gewählt):** ein Datensatz pro Medium-Stiftungs-Sachverhalt.

### Felder

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| id | integer PK | – |
| mandant | string | wie überall (`wepublish`) |
| medium_id | string | Medium-Slug (Konvention wie applications/medium_knowledge) |
| stiftung_id | integer, nullable | verknüpfte Stiftung, wenn per Suche gefunden |
| stiftung_name | string | immer gesetzt (Freitext-Fallback) |
| typ | string | `erhalten` \| `abgelehnt` \| `ausgeschlossen` |
| jahr | integer, nullable | Jahr der Förderung/Ablehnung |
| betrag | integer, nullable | CHF, nur bei `erhalten` sinnvoll |
| zweck | text, nullable | wofür gefördert/beantragt |
| ausgeschlossen | boolean | «kommt künftig nicht mehr in Frage» (bei typ `ausgeschlossen` immer true) |
| ausschluss_grund | text, nullable | Grund des Ausschlusses |
| quelle | string | `portal` \| `operator` |
| erfasst_von | string, nullable | E-Mail der erfassenden Person |
| aktiv | boolean | Soft-Delete-Flag |
| knowledge_id | integer, nullable | verknüpfter medium_knowledge-Eintrag (siehe unten) |
| date_created / date_updated | timestamp | Directus-Standard |

## Wirkung

1. **Portal-Treffer:** Stiftungen mit aktivem Ausschluss (typ `ausgeschlossen`
   ODER Flag `ausgeschlossen`) werden in `kuratiereTreffer` herausgefiltert
   (vor dem Limit-Schnitt, wie das bestehende ausgeblendet-Filtern). Stiftungen
   mit Historie-Eintrag bekommen ein Badge «Frühere Förderung …» auf der
   Trefferkarte.
2. **Match-Engine (Spark):** lädt einmal pro Lauf die Ausschluss-Map
   (`load_medium_ausschluesse`), überspringt ausgeschlossene Stiftungen als
   Kandidaten (kein LLM-Budget) und löscht bestehende `match_results`-Zeilen
   des Mediums für ausgeschlossene Stiftungen
   (`cleanup_ausschluss_match_results`, spiegelbildlich zur Duplikat-Hygiene –
   sonst frieren die Zeilen ein, siehe Befund vom 27.07.). Fehlt die
   Collection, warnt die Engine und läuft ohne Ausschlüsse weiter.
3. **DNA + Wissens-Score:** Einträge vom typ `erhalten`/`abgelehnt` erzeugen
   zusätzlich einen `medium_knowledge`-Eintrag (Kategorie
   `previous_application`). Damit fliessen sie ohne neue Pipeline-Plumbing in
   die Ein-Knopf-DNA und in den Vollständigkeits-Score. Die knowledge_id steht
   am Historie-Eintrag; beim Löschen wird der Wissens-Eintrag mitgelöscht.
4. **Ereignis-Schicht:** jeder Portal-Eintrag schreibt ein
   `medium_events`-Ereignis `foerderhistorie_erfasst` (erscheint als
   Thread-Antwort in der Slack-Roadmap; das Skript verkraftet neue Typen).
5. **Bewusst KEINE Score-Änderung** für Historie-Einträge in v1: Die am 27.07.
   verifizierte Vergleichsbasis bleibt unangetastet. Ein Bonus für belegte
   frühere Förderer ist ein möglicher späterer Schritt; die Daten dafür
   entstehen jetzt. Zusatznutzen: `erhalten`-Einträge sind Grundwahrheit für
   den Gütetest (`guetetest_soll_foerderungen.py`).

## Bausteine

- **`src/lib/foerderhistorie.ts`** (rein, getestet): Eingabe-Validierung,
  Ausschluss-Set, Badge-Labels, Knowledge-Payload.
- **`/api/portal/foerderhistorie`** (GET/POST/DELETE, Session-Medium, kein
  Freischalt-Gate – Onboarding ist genau die Phase davor).
- **`/api/portal/stiftung-suche`** (GET, Typeahead: min. 2 Zeichen, max. 8
  Ergebnisse, nur id/Name/Sitz – kein DB-Dump).
- **`/api/foerderhistorie`** (Operator, GET je Medium; bewusst NICHT unter
  `/api/portal/*` wegen der Cloudflare-Access-Präfix-Regel).
- **Portal-Onboarding-Seite:** neuer Block «Bisherige Förderungen &
  Ausschlüsse» (Typeahead, typ-abhängige Felder, Liste mit Entfernen).
- **Operator-Onboarding-Seite:** kompakte Lese-Ansicht je gewähltes Medium.
- **Engine:** `load_medium_ausschluesse`, Kandidaten-Skip,
  `cleanup_ausschluss_match_results`; Unit-Tests in
  `pipeline/tests/test_match_engine_unit.py`.

## Deploy-Reihenfolge

1. Collection additiv auf der VPS-Directus anlegen (REST, kein directus-sync
   push), Smoke-Test.
2. Front bauen, Tests, `deploy-front.sh` (GraphQL-Query der Treffer-Route
   referenziert die neue Collection – Collection MUSS vor dem Front-Deploy
   existieren).
3. Engine per scp auf den Spark (Pfad aus `pipeline/MANIFEST.tsv`), danach
   `scripts/verify-spark.sh`.
