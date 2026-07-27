# Vergleichsbasis vereinheitlichen + Wächter-Meldungen zustellen

Stand: 2026-07-27

## Ausgangslage

Beim Versuch, für die DNA-Nachveredelung (Punkt C der Übergabe) einen Guardrail zu entwerfen, zeigte sich, dass die Messgrundlage selbst nicht tragfähig ist.

**Befund 1 — ein Drittel der Treffer ist veraltet.** Von 3'145 Zeilen in `match_results` stammten 1'038 von vor dem jeweils letzten Lauf, die ältesten vom 5. Juni. Vier der sechs Medien hatten keine einzige Zeile mit dem Institutionalitäts-Modifikator.

Ursache: `match_engine.py` bewertet je Lauf nur `candidates[:TOP_N_PER_MEDIUM]`. Wer aus dem Kandidatenfeld fällt, behält seinen alten Wert unbegrenzt, obwohl die Zeile in der UPSERT-Map steht. Migros-Kulturprozent trug bei cueltuer einen Rechenstand vom 8. Juli und rankte damit auf Platz 8 mit einem Wert, den die heutige Engine nie berechnet hat.

Ausgeschlossen als Ursache: die Bindung an die `medium_dna`-Version. Die Altzeilen hängen an der **aktiven** Version v11; der Top-N-Schnitt ist der alleinige Grund.

**Befund 2 — der Wächter meldet ins Leere.** In `agent_vorschlaege` standen 95 offene Einträge, darunter «Medium solvio hat keine aktive DNA» vom 4. Juni, dasselbe für vmz vom 4. Juni und zwolf vom 8. Juli. Drei onboardete Medien waren monatelang für das Matching unsichtbar, ohne dass es jemand erfuhr. Die Erkennung funktioniert, der Weg zu einem Menschen fehlt.

## Leitprinzip

Alle Stiftungen müssen mit derselben Elle gemessen werden. Das gilt auf zwei Ebenen: die DNA entsteht ausschliesslich mit qwen3.6-v3 auf dem Spark (Entscheid vom 2026-06-02, erzwungen über `MATCH_MIN_TIER`), und die Treffer müssen aus demselben Rechenstand stammen. Solange ein Drittel der Zeilen aus verschiedenen Wochen und von zwei Engine-Ständen kommt, kalibriert jede Nachjustierung gegen ein bewegliches Ziel.

## Teil 1 — Kandidatenmenge erweitern

Die UPSERT-Map wird vor dem Kandidatenaufbau geladen. Die zu bewertende Menge ist danach die Vereinigung aus den Top-N nach Math-Score und allen Stiftungen, die für dieses Medium und diese DNA-Version bereits eine Zeile haben.

Umgesetzt in `pipeline/spark/match_engine.py`:

- `load_existing_match_result_ids` wandert vor die Kandidatenschleife.
- Der Abbruch `if math_score <= 0: continue` gilt nicht mehr für Stiftungen mit bestehender Zeile. Sonst könnte eine Zeile, deren Math-Score auf 0 gefallen ist, nie mehr aufgefrischt werden.
- Die Auswahl liegt in der reinen Funktion `waehle_zu_bewertende(candidates, existing_match_ids, top_n)` und ist damit testbar.
- Der Lauf protokolliert beide Zahlen getrennt: «Top-400: 400 + 166 bestehende Zeilen ausserhalb der Top-N = 566 zu bewerten».

Bewusst nicht gewählt: nicht aufgefrischte Zeilen löschen (destruktiv, schrumpft jedes Medium hart auf die Top-N) oder die Frische erst im Portal filtern (behebt nur das Symptom, Gütetest und SQL-Auswertungen blieben verfälscht).

Kosten: gering. Der Cache greift, ein typischer Lauf hat rund 400 Cache-Treffer bei ein bis zwei Modellaufrufen. Der Institutionalitäts-Modifikator wird auch bei Cache-Treffern frisch gerechnet.

Nebenwirkungen: Projekt-Zeilen hängen an eigenen Projekt-DNA-Versionen und stehen nicht in der Map, sie bleiben unberührt. Eine bestehende Zeile, deren Stiftung inzwischen einen Ausschluss auslöst, wird aufgefrischt und trägt danach den Ausschluss-Zustand.

Abgedeckt durch vier Tests in `pipeline/tests/test_match_engine_unit.py`: Top-N ohne bestehende Zeilen, bestehende Zeile ausserhalb der Top-N wird mitbewertet (der Migros-Fall), keine Doppelten, ausgeschlossene bestehende Zeile wird aufgefrischt.

## Teil 2 — Wächter-Meldungen zustellen

`pipeline/spark/faas_waechter_push.py`, nach dem Muster von `faas_briefing_push.py`. Liest offene `agent_vorschlaege`, verdichtet sie und postet nach #faas-admin (C0B7SD7JCEM).

- Gruppiert nach Typ, in fester Reihenfolge: Fristen (zeitkritisch) und Hygiene (verrottet unbemerkt) ausgeschrieben, Gesuch-Entwürfe nur als Zähler. Ohne diese Gruppierung deckten beim ersten Lauf 77 Entwürfe die 11 Hygiene-Meldungen zu.
- Jede Meldung geht genau einmal raus. Der Zustand liegt in `~/faas_classify/waechter_push_state.json`, bewusst nicht in `agent_outbox`, damit der Push den Wächter-Datenfluss nicht berührt.
- Gibt es nichts Neues, wird nichts gepostet.
- `--dry-run` ist Standard, `--apply` postet, `--alle` ignoriert den Zustand.

## Teil 1b — zwei weitere Ursachen, erst bei der Verifikation sichtbar

Der Top-N-Schnitt war nur die erste von drei Ursachen. Die Prüflatte nach dem ersten Volldurchgang zeigte weiter 1'067 eingefrorene Zeilen.

**Schreib-Schwelle.** `push_match_result` brach bei `combined < MATCH_MIN_SCORE` ab – auch für **bestehende** Zeilen. Da der Institutionalitäts-Modifikator bis zu 25 Punkte abzieht, rutschten viele Zeilen unter die Schwelle 10 und behielten ihren alten, höheren Score. 1'047 Zeilen waren so eingefroren, 73 davon oberhalb der Anzeigeschwelle 20 und damit im Portal sichtbar. Behoben: existiert eine Zeile, wird sie fortgeschrieben, auch unter der Schwelle oder bei abweichendem Tier. Neue Zeilen entstehen unverändert erst ab Score 10. Sechs Tests decken alle vier Kombinationen ab.

**Duplikat-Filter.** `load_stiftungen` filtert `duplicate_of IS NULL`, Duplikate sind also nie Kandidaten – ihre bestehenden Zeilen dadurch für jeden Lauf unerreichbar. Folge: der Media Forward Fund stand unter der Zweit-ID 46988 in **allen fünf** Medien doppelt und rankte mit eingefrorenen 79–86 jeweils über dem kanonischen Eintrag 11991 (bei cueltuer 79 gegen 35). Behoben durch `cleanup_duplikat_match_results`, aufgerufen je Medium direkt nach der UPSERT-Map; entfernt die Zeilen und nimmt sie aus der Map, damit der Push-Loop nicht auf Gelöschtes patcht. Sechs Tests, inklusive Idempotenz und Batching.

Lehre für die Zukunft: **bei Zweifeln an einer Rangfolge zuerst `computed_at` prüfen, nicht den Score interpretieren.** Eine Zeile mit altem Zeitstempel trägt einen Wert, den die heutige Engine nie berechnet hat.

## Teil 4 — Riegel gegen das falsche Mess-Modell

Bei der Veredelung der drei Gruppe-A-Stiftungen fiel auf, dass `~/.hermes/.env` `FAAS_DNA_MODEL` auf einen Altwert setzt (`nemotron-3-super:120b-a12b`). Nur die Wrapper `run_web_enrich.sh` und `run_rematch.sh` überschreiben ihn danach; ein manueller Aufruf, der bloss die `.env` sourct, misst mit dem falschen Modell.

Das ist gefährlicher, als es klingt: `push_dna` stempelt `klassifiziert_by` **hart** auf `qwen3.6-v3-webenrich*`, unabhängig vom tatsächlich verwendeten Modell. Ein Lauf mit einem anderen Modell hätte also DNA geschrieben, die falsch als qwen-v3 etikettiert ist, den Tier-Filter der Engine passiert und die einheitliche Mess-Elle still gebrochen hätte.

Behoben durch einen harten Riegel: `web_enrich_daemon.py` bricht bei `--apply` ab, wenn `FAAS_DNA_MODEL` nicht dem erwarteten Produktionsmodell entspricht, mit Hinweis auf die Ursache. Dry-Runs bleiben unbeeinträchtigt, weil sie nichts schreiben. Überschreibbar via `FAAS_DNA_MODELL_ERWARTET`, falls das Produktionsmodell wechselt.

Nicht gewählt: `klassifiziert_by` aus dem Modellnamen ableiten. Der Tier-Filter der Engine prüft auf «qwen» **und** «v3»; ein abgeleitetes `qwen3.6-27b-webenrich` enthielte kein «v3» und würde die DNA verwerfen. Der Riegel ist der sichere Weg.

## Verifikation

Nach Teil 1 ein vollständiger Re-Match über alle sechs Medien, danach die Prüflatte: null Zeilen mit einem Rechenstand vor dem Lauf und null Zeilen ohne Institutionalitäts-Modifikator, Projekt-Zeilen ausgenommen. Anschliessend der Gütetest, um den Migros-Rang auf sauberer Basis zu messen.

Bei Teil 2 zuerst der Dry-Run, dann ein einmaliges `--apply` nach ausdrücklicher Freigabe, weil Slack nach aussen wirkt. Erst danach ein Cron-Eintrag.

## Teil 3 — Lebenszyklus der Wächter-Vorschläge (nachgezogen)

Der Rückstau war nicht nur Anzeigelärm, sondern ein Lebenszyklus-Loch: der Wächter legt Wochenmeldungen (`stau|<woche>`, `goldentwurf|<woche>`) je Woche neu an und schliesst die alte nie, und abgelaufene Fristmeldungen bleiben offen stehen. Am 27.07. lagen dadurch vier Sichtungs-Stau-Meldungen und je drei abgelaufene Fristmeldungen für JournaFONDS (15.06.) und netidee (07.07.) gleichzeitig offen.

Einmalige Bereinigung: 12 Einträge auf `abgeloest` gesetzt, 95 offene wurden zu 83. Übrig bleiben 77 Gesuch-Entwürfe und sechs echte, aktuelle Punkte.

Dauerhaft behoben in `pipeline/spark/faas_waechter.py` durch `schliesse_ueberholte`, aufgerufen am Ende von `lauf()` — nach dem Anlegen, damit die eben erzeugte Wochenmeldung als die jüngste gilt. Zwei Regeln: je Wochenpräfix bleibt nur die jüngste offen, und Fristmeldungen werden geschlossen, sobald der Termin vorbei ist. Termine kommen aus `ausschreibungen.deadline` beziehungsweise `applications.frist`, aufgelöst über die id im `dedup_key`.

Bewusst konservativ: ist kein Termin auffindbar, bleibt die Meldung offen. Dauerbefunde ohne Wochenpräfix, etwa «Medium vmz hat keine aktive DNA», werden nie angetastet. Sieben Tests in `pipeline/tests/test_waechter_lebenszyklus.py` deckten das ab, inklusive der beiden Nicht-Anfass-Fälle.

Nebeneffekt: `faas_waechter.py` ist damit erstmals im Monorepo versioniert. Vorher existierte es nur auf dem Spark — dieselbe Drift-Gefahr, die beim Doppelpfad von `match_engine.py` zugeschlagen hat.

## Offen, bewusst nicht Teil dieser Änderung

- Der eigentliche Guardrail für konservative DNA-Messung bei dünnem Belegmaterial. Ob er noch nötig ist, entscheidet sich nach der Messung auf sauberer Basis.
- Die `schon_webenrich`-Sperre im Daemon, die eine bewusste Nachveredelung verhindert.
- Der doppelte `zwolf`-Datensatz in `faas_medien` (id 13 und 14).
- Der erste `--apply`-Lauf des Wächter-Push, weil Slack nach aussen wirkt.
