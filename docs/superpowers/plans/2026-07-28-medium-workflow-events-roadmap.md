# Medium-Workflow: Ereignis-Schicht, Hallo+Magic-Link, Slack-Roadmap — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der komplette Medium-Lebenszyklus (Aufnahme → Zugang → DNA → Matching-Freigabe → Stiftungswahl → Gesuch → Einreichung → Zusage/Abrechnung) schreibt Ereignisse nach `medium_events`, wird automatisch als Roadmap im Slack-Channel des Mediums nachgezeichnet, und die zwei manuellen Lücken (Hallo+Magic-Link in einem Schritt, Benachrichtigung bei Matching-Freigabe) bekommen versandfertige Mail-Entwürfe.

**Architecture:** Die App (Next.js, `apps/front`) schreibt fire-and-forget-Ereignisse über die bestehende `lib/medium-events.ts` in die neue Directus-Collection `medium_events`. Der bereits geschriebene Spark-Konsument `faas_roadmap_slack.py` (Repo `faas-matching-wepublish`) hält pro Medium-Channel EINE Status-Nachricht aktuell und hängt neue Ereignisse als Thread-Antworten an. Mail bleibt bewusst ohne SMTP (Entscheid 28.07.2026): versandfertige Entwürfe via `MailEntwurfButton`/mailto.

**Tech Stack:** Next.js 15 Pages Router, Jest (`npm test` in `apps/front`), Directus REST (`/items/...`), Python 3 stdlib (Spark-Skripte), Slack Web API (xoxb auf dem Spark).

## Global Constraints

- Sprachregeln: Schweizer Deutsch, «ss» statt ß, echte Umlaute in Strings/Kommentaren; Dateinamen ASCII.
- Kein automatischer Mail-Versand (Entscheid 28.07.2026) — nur mailto-Entwürfe.
- Ereignis-Schreiben darf NIE die eigentliche Aktion scheitern lassen (`void schreibeMediumEvent(...)`).
- Ereignis-Titel sind medien-sichtbar (landen im Medium-Slack-Channel): keine Scores, keine internen Bemerkungen.
- Route-Logik wird über `src/lib/*-routen.test.ts` getestet (Handler direkt, portal-guard gemockt, relative Pfade in `jest.mock`).
- Directus-Schema nur additiv (neue Collection/Felder), nie destruktiv.
- Front-Deploy baut auf dem Mac (`deploy-front.sh`), nie auf der VPS; Deploy nur nach kurzer Bestätigung.

---

### Task 1: `medium-events.ts` finalisieren (mandant) + Tests

**Files:**
- Modify: `apps/front/src/lib/medium-events.ts`
- Create: `apps/front/src/lib/medium-events.test.ts`

**Interfaces:**
- Produces: `schreibeMediumEvent(ev: MediumEvent): Promise<void>` — schreibt `{medium_id, mandant, typ, titel, detail, actor}` nach `/items/medium_events`, wirft nie.

- [x] **Step 1:** In `medium-events.ts` `mandant: tenant.key` in den POST-Body aufnehmen (`import { tenant } from '../../config/tenant'`).
- [x] **Step 2:** Test schreiben (`global.fetch` gemockt): (a) korrekter Body inkl. mandant, (b) kein Throw bei fetch-Reject, (c) kein fetch ohne `DIRECTUS_TOKEN`.
- [x] **Step 3:** `npx jest medium-events` → grün. Commit.

### Task 2: Ereignisse in den Portal-Routen

**Files:**
- Modify: `apps/front/src/pages/api/portal/einloesen.ts` (nach `loeseZugangEin`-Erfolg: `portal_login`, titel «Im Portal angemeldet», actor E-Mail)
- Modify: `apps/front/src/pages/api/portal/dna.ts` (nach `setzeDnaFreigabe`: `dna_freigegeben`, titel «Fundraising-DNA vom Medium freigegeben», actor E-Mail)
- Modify: `apps/front/src/pages/api/portal/anschreiben.ts` (nach `legeApplicationAn`: `stiftung_gewaehlt`, titel «Stiftung ausgewählt: <Name>», actor E-Mail)
- Test: bestehende `portal-routen.test.ts`, `portal-dna-routen.test.ts`, `portal-anschreiben-routen.test.ts` ergänzen (`jest.mock('./medium-events')`, Aufruf mit typ/medium_id asserten)

- [x] Steps: je Route Event einbauen (`void schreibeMediumEvent(...)`), Test ergänzen, `npx jest portal-routen portal-dna portal-anschreiben` grün, Commit.

### Task 3: Ereignisse in den Operator-Routen + DNA-Aktivierung

**Files:**
- Modify: `apps/front/src/pages/api/zugangsverwaltung.ts` (`aktionAnlegen`, nur bei NEU angelegtem Zugang: `zugang_erstellt`, detail = E-Mail)
- Modify: `apps/front/src/pages/api/gesuch-freigeben.ts` (Felder um `medium_id,stiftung_name` erweitern; nach PATCH: `gesuch_freigegeben`, titel «Gesuch bereit: <Stiftung>»)
- Modify: `apps/front/src/pages/api/portal/gesuch-aktion.ts` (final → `gesuch_final`; abgeschickt → `gesuch_eingereicht` mit Betrag im detail; zusage → `zusage` mit Betrag + agent_vorschlag «Zusage eingegangen … Abrechnung prüfen» (prioritaet hoch, dedup `portal|zusage|<app-id>`); absage → `absage`)
- Modify: `apps/front/src/pages/api/medium-knowledge/generate-dna.ts` (nach erfolgreichem `aktiviereDna`: `dna_aktiv`, detail Version/Schärfe)
- Modify: `apps/front/src/pages/api/activate-medium-dna.ts` (nach Aktivierung: `dna_aktiv`)
- Test: `portal-steuerung-routen.test.ts`, `portal-gesuche-routen.test.ts` ergänzen.

- [x] Steps: Events einbauen, Tests ergänzen, betroffene Suiten grün, Commit.

### Task 4: Hallo + Magic-Link in einem Schritt (Medium-Aufnahme)

**Files:**
- Modify: `apps/front/src/lib/portal-guard.ts` — neuer Helfer `legeZugangAnMitLink(email, mediumSlug, wer, secret): Promise<{ link: string; bestehend: boolean }>` (Dedup-Logik aus `aktionAnlegen` extrahiert).
- Modify: `apps/front/src/pages/api/zugangsverwaltung.ts` — `aktionAnlegen` nutzt den Helfer.
- Create: `apps/front/src/pages/api/medium-aufnehmen.ts` — Operator-only (istPortalZugriffAufProxy-Guard). POST `{name, website?, email?}`: Slug bilden (slugify aus `@/graphql/projekte`), Duplikat-Check per Directus-Filter (slug+mandant) → 409 `{bereits_vorhanden, slug}`; Medium anlegen (Felder wie `neuesMediumAnlegen` in onboarding.tsx inkl. `wepublish_api_url`-Vorschlag); Event `medium_aufgenommen`; falls email: Zugang via Helfer + Event `zugang_erstellt` → 200 `{slug, link?}`.
- Modify: `apps/front/src/pages/onboarding.tsx` — Feld «Kontakt-E-Mail (optional)», Aufruf der neuen Route statt `createMedium`-Mutation; bei zurückgegebenem Link Panel mit Link + `MailEntwurfButton` (MAIL_EINLADUNG, `an=email`, {medium} und {link} gefüllt).
- Create: `apps/front/src/lib/medium-aufnehmen-routen.test.ts`.

- [x] Steps: Helfer + Refactor, Route, UI, Tests, Suiten grün, Commit.

### Task 5: Benachrichtigung bei Matching-Freigabe (Mail-Entwurf)

**Files:**
- Modify: `apps/front/src/lib/portal-texte.ts` — neue Vorlage `MAIL_MATCHING_FREI` ({name}, {medium}, {absender}; Text: Treffer geprüft und freigeschaltet, Anmeldung über die Login-Seite des Portals).
- Modify: `apps/front/src/lib/portal-texte.test.ts` — Fülltest.
- Modify: `apps/front/src/pages/portal-steuerung.tsx` — nach erfolgreichem Freischalten Dialog/Panel mit `MailEntwurfButton` (an = E-Mail des ersten aktiven Zugangs des Mediums, sonst leer).

- [x] Steps: Vorlage + Test, UI-Anbindung, Suite grün, Commit.

### Task 6: Spark-Seite — Setup-Skript, Roadmap-Skript versionieren, Python-Tests

**Files (Repo `~/code/faas-matching-wepublish`):**
- Create: `spark/setup_medium_events.py` — idempotent (Muster `setup_roadmap.py`): Collection `medium_events` mit Feldern uuid-PK, `medium_id` (string), `mandant` (string, default wepublish), `typ` (string), `titel` (string), `detail` (text), `actor` (string), `date_created` (timestamp, special date-created). Dry-run Default, `--apply` führt aus.
- Existing: `spark/faas_roadmap_slack.py` (aus letzter Session, kritisch reviewen).
- Create: `spark/test_roadmap_slack.py` — Tests für `baue_status_text` (Häkchen-Logik, Gesuchs-Zähler, ausgeblendet zählt nicht) und `baue_thread_text` (Deckel MAX_THREAD_EVENTS, detail-Kürzung).

- [x] Steps: Setup-Skript, Review, Tests (`python3 -m pytest spark/test_roadmap_slack.py`), Commit+Push repo2.

### Task 7: Verifikation + Sichern

- [x] `npx tsc --noEmit` und volle Jest-Suite in `apps/front` grün.
- [x] `~/code/wepublish-faas/scripts/save.sh "feat(workflow): Ereignis-Schicht + Hallo mit Magic-Link + Matching-Freigabe-Mail"`.
- [x] Repo2 committen und pushen.

### Task 8: Infrastruktur (teils nach Bestätigung)

- [x] `setup_medium_events.py` auf den Spark kopieren und mit `--apply` ausführen (Collection additiv anlegen, via Tailscale-Forwarder localhost:8055 → VPS-Directus).
- [x] `faas_roadmap_slack.py` + Test auf den Spark kopieren (`spark:~/faas-matching-wepublish/spark/`), `--dry-run` ausführen und Ausgabe prüfen.
- [x] **Nach Bestätigung («Komplett live», 28.07.):** `deploy-front.sh` → Image `faas-front:ba276c9` live; Cron auf dem Spark installiert (`*/15`, flock `/tmp/faas_roadmap_slack.lock`, Log `~/logs/faas_roadmap_slack.log`); erster Lauf: 8 Medien-Channels gepostet, 0 Fehler; Payload-Smoke-Test gegen die Live-Collection bestanden.

## Self-Review

- Spec-Abdeckung: Hallo+Magic-Link (T4), DNA-Weg existiert + Events (T2/T3), Matching-Sichtung existiert, Freigabe-Meldung Mail (T5) + Slack (T6-Skript, Event aus bestehendem matching-freischalten), Stiftungswahl-Event (T2), Gesuch-Speicherung/Bearbeitung/Export existiert + Events (T3), Einreichung markieren existiert + Event (T3), Slack-Roadmap automatisch (T6/T8), Zusage → Abrechnung existiert (/abrechnung) + Zusage-Event + Abrechnungs-Vorschlag (T3). Lücke SMTP bleibt bewusst (Entscheid, dokumentiert).
- Typen: `MediumEventTyp` deckt alle verdrahteten Typen ab (bereits in medium-events.ts definiert).
