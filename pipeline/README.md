# FaaS-Pipeline (Spark)

Die schwere Arbeit von FaaS laeuft nicht in der App, sondern als Python-Pipeline auf
dem GPU-Host **Spark** (`dergeraet`): Recherche, DNA-Messung, Matching, Waechter und
die Slack-Nachzeichnung. Dieses Verzeichnis ist die **einzige Quelle** dafuer.

| Ordner | Inhalt |
| --- | --- |
| [`spark/`](spark/) | alle Skripte, die auf dem Spark laufen |
| [`systemd/`](systemd/) | die Unit-Dateien der Dauerdienste |
| [`tests/`](tests/) | Tests der Engine und des Waechters |
| [`MANIFEST.tsv`](MANIFEST.tsv) | **verbindlich:** je Datei der echte Deploy-Pfad, der Takt und der Zweck |

## Warum ein Manifest

Die Skripte liegen auf dem Spark historisch an fuenf verschiedenen Orten, nicht alle
im gleichen Ordner. Am 27.07.2026 hat das drei Tage gekostet: der Cron fuehrte eine
alte Kopie der Match-Engine aus, waehrend die versionierte Datei unberuehrt daneben
lag. Deployte Datei und Repo stimmten ueberein, die Tests waren gruen, und trotzdem
war die Aenderung wirkungslos.

Deshalb haelt `MANIFEST.tsv` fuer jede Datei fest, **wohin sie deployt wird und was
sie startet**, und `scripts/verify-spark.sh` prueft das gegen die Wirklichkeit:

```bash
scripts/verify-spark.sh
```

Das Skript hasht jede deployte Datei auf dem Spark und vergleicht sie mit dem
Repo-Stand. Ausgabe `abweichend: 0` heisst: der Spark fuehrt genau diesen Stand aus.
Bei einer Abweichung zuerst klaeren, welche Fassung gilt, und erst dann angleichen.

## Dauerdienste (systemd)

| Datei | Takt | Zweck |
| --- | --- | --- |
| `embedding_webhook.service` | systemd (system) | Unit fuer den Embedding-Webhook |
| `embedding_webhook_server.py` | systemd embedding_webhook.service | Webhook, der embedding_pass anstoesst |
| `faas-chat-adapter.service` | systemd (user) | Unit fuer den Chat-Adapter |
| `faas-directus-forward.service` | systemd (user) | Unit fuer den Interim-Schreibpfad |
| `faas-slack-daemon.service` | systemd (user) | Unit fuer den Slack-Daemon |
| `faas-status-web.service` | systemd (user) | Unit fuer die Status-Seite auf :8899 |
| `faas_chat_adapter.py` | systemd faas-chat-adapter.service | Status-Chat und gegatete Aktionen, HTTP :9200 |
| `faas_directus_forward.py` | systemd faas-directus-forward.service | Interim-Schreibpfad Spark 127.0.0.1:8055 -> VPS-Directus ueber Tailscale |
| `faas_slack_daemon.py` | systemd faas-slack-daemon.service | Slack Socket-Mode Daemon (Roadmap-Pult) |

Die user-Units liegen auf dem Spark unter `~/.config/systemd/user/`, die
System-Unit unter `/etc/systemd/system/`. Genaue Pfade: `MANIFEST.tsv`.

## Geplante Laeufe (cron)

| Datei | Takt | Zweck |
| --- | --- | --- |
| `duplicate_detector.py` | cron 0 5 1 * * | Duplikat-Erkennung im Stiftungspool |
| `embedding_pass.py` | cron */2 * * * * (medium_dna) + 15 4 * * * (stiftungs_dna) | Erzeugt die Embeddings, mit denen die Engine rechnet |
| `faas_briefing_push.py` | cron 30 7 * * * | Taegliches Briefing nach Slack |
| `faas_datenfluss_waechter.py` | cron 12 * * * * | Ueberwacht den Datenfluss der Pipeline |
| `faas_health_probe.sh` | cron */15 * * * * | Health-Probe Directus/Qdrant/vLLM, Alert per Slack-DM |
| `faas_heartbeat.py` | cron */5 * * * * | Lebenszeichen des FaaS-Stacks |
| `faas_kanban_sync.py` | cron 17 * * * * | Haelt den Slack-Canvas je Medium aktuell |
| `faas_lern_detektor.py` | cron 25 * * * * | Erkennt Lernnotizen aus Operator-Verhalten |
| `faas_roadmap_render.py` | cron */15 * * * * | Rendert die Roadmap-Ansicht |
| `faas_roadmap_slack.py` | cron */15 * * * * (flock) | Haelt je Medium EINE Status-Nachricht im Medien-Channel, Ereignisse als Thread |
| `faas_spark_liveness.sh` | cron */5 * * * * | Lebenszeichen des Spark |
| `faas_stale_detection.sh` | cron 0 4 * * 0 | Erkennt veraltete Stiftungsdaten |
| `faas_waechter.py` | cron */12 * * * * | Proaktiver Waechter, legt agent_vorschlaege an |
| `faas_waechter_push.py` | cron 45 7 * * * | Stellt offene Waechter-Meldungen in #faas-admin zu |
| `kanal_waechter.py` | cron 8,38 * * * * | Waechter ueber die Slack-Kanaele |
| `mount_gdrive_faas_datensuppe.sh` | cron @reboot | Mountet die Drive-Datensuppe |
| `paket_builder.py` | cron 15 3 * * * | Baut Gesuchspakete |
| `run_projekt_matcher.sh` | cron 30 4 * * * | Wrapper fuer projekt_matcher.py |
| `run_rematch.sh` | cron 20 */6 * * * | Re-Match-Lauf, Medienliste dynamisch aus Directus, flock-gesichert |
| `run_web_enrich.sh` | cron 35 5 * * * + @reboot | Wrapper fuer die Web-Veredelung |
| `scout.py` | cron 0 7 * * 1-5 | Sucht neue Ausschreibungen und Stiftungen |
| `web_enrich_status.py` | cron */3 * * * * | Schreibt den Fortschritt der Veredelung fuer die Status-Seite |
| `write_dashboard_snapshot_spark.py` | cron 30 7 * * * | Dashboard-Schnappschuss; liegt noch in der Altablage |

## Von anderen Skripten aufgerufen

| Datei | Takt | Zweck |
| --- | --- | --- |
| `faas_actions.py` | Bibliothek | Gemeinsame Aktionen, von Adapter und Daemon genutzt |
| `faas_outbox.py` | Bibliothek | Ausgangskorb fuer Slack-Nachrichten |
| `match_engine.py` | via run_rematch.sh | Match-Engine: bewertet Medium x Stiftung, schreibt match_results |
| `projekt_matcher.py` | via run_projekt_matcher.sh | Matching fuer Projekt-Zeilen |
| `sonder_dna.py` | via nachlauf_sonder.sh | DNA fuer Sonderfoerderer (Kirchen, Lotterien) |
| `sonder_matcher.py` | via nachlauf_sonder.sh | Matching fuer Sonderfoerderer |
| `web_enrich_daemon.py` | via run_web_enrich.sh | Web-Veredelung der Stiftungs-DNA |

## Werkzeuge, Einmal-Skripte, Tests

| Datei | Takt | Zweck |
| --- | --- | --- |
| `classify_runner_vllm.py` | nicht deployt | Klassifizierungslauf gegen vLLM, nur im Repo |
| `cleanup_deep_matches.py` | manuell | Aufraeumwerkzeug fuer match_results |
| `de_ja_stichprobe.py` | manuell | Stichprobe DE/JA-Klassifikation |
| `faas_deadman_nas.py` | manuell | Totmannschalter Richtung NAS |
| `faas_mcp.py` | manuell | MCP-Schnittstelle zur Pipeline |
| `faas_prepare.py` | manuell | Vorbereitung von Laeufen |
| `nachlauf_sonder.sh` | manuell | Nachlauf Sonderfoerderer |
| `reclassify_check.py` | manuell | Kontrolle der Klassifizierung |
| `run_classify.sh` | nicht deployt | Wrapper fuer classify_runner_vllm.py, nur im Repo |
| `scout_quellen.json` | Daten | Quellenliste fuer scout.py |
| `setup_gmail_oauth.py` | einmalig | Gmail-OAuth (historisch) |
| `setup_medium_events.py` | einmalig | Legt die Collection medium_events an |
| `setup_outbox_jobs.py` | einmalig | Outbox-Jobs |
| `setup_phase2_felder.py` | einmalig | Phase-2-Felder |
| `setup_portal_schema.py` | einmalig | Portal-Schema in Directus |
| `setup_roadmap.py` | einmalig | Roadmap-Felder |
| `setup_sonder_collection.py` | einmalig | Collection Sonderfoerderer |
| `setup_sonder_dna_felder.py` | einmalig | DNA-Felder Sonderfoerderer |
| `test_roadmap_slack.py` | Test | Tests der Slack-Roadmap |
| `test_slack_roadmap.py` | Test | aeltere Testdatei derselben Sache |
| `url_discovery.py` | manuell | Findet Stiftungs-Webseiten |

## Deploy-Pfade ausserhalb des Pipeline-Ordners

Diese Dateien liegen auf dem Spark **nicht** in `~/faas-matching-wepublish/spark/`.
Wer sie kopiert, muss den Zielpfad beachten, sonst laeuft weiter die alte Fassung:

| Datei | Deploy-Pfad auf dem Spark |
| --- | --- |
| `duplicate_detector.py` | `/home/dergeraet/scripts_v2/duplicate_detector.py` |
| `embedding_pass.py` | `/home/dergeraet/scripts_v2/embedding_pass.py` |
| `embedding_webhook.service` | `/etc/systemd/system/embedding_webhook.service` |
| `embedding_webhook_server.py` | `/home/dergeraet/scripts_v2/embedding_webhook/server.py` |
| `faas-chat-adapter.service` | `/home/dergeraet/.config/systemd/user/faas-chat-adapter.service` |
| `faas-directus-forward.service` | `/home/dergeraet/.config/systemd/user/faas-directus-forward.service` |
| `faas-slack-daemon.service` | `/home/dergeraet/.config/systemd/user/faas-slack-daemon.service` |
| `faas-status-web.service` | `/home/dergeraet/.config/systemd/user/faas-status-web.service` |
| `faas_directus_forward.py` | `/home/dergeraet/faas_directus_forward.py` |
| `faas_health_probe.sh` | `/home/dergeraet/scripts/faas_health_probe.sh` |
| `faas_spark_liveness.sh` | `/home/dergeraet/scripts/faas_spark_liveness.sh` |
| `faas_stale_detection.sh` | `/home/dergeraet/scripts/faas_stale_detection.sh` |
| `kanal_waechter.py` | `/home/dergeraet/scripts/kanal_waechter.py` |
| `mount_gdrive_faas_datensuppe.sh` | `/home/dergeraet/scripts/mount_gdrive_faas_datensuppe.sh` |
| `run_projekt_matcher.sh` | `/home/dergeraet/faas_classify/run_projekt_matcher.sh` |
| `write_dashboard_snapshot_spark.py` | `/home/dergeraet/.hermes/data/faas/write_dashboard_snapshot_spark.py` |

## Zugangsdaten

Kein Skript enthaelt Zugangsdaten. Alles kommt zur Laufzeit aus `~/.hermes/.env`
beziehungsweise `~/.hermes/config.yaml` auf dem Spark. Bei der Bereinigung am
28.07.2026 wurde ein statischer Directus-Token aus `faas_health_probe.sh` entfernt;
das Skript liest ihn jetzt wie alle anderen aus der Secret-Datei.

## Was die Engine liest und schreibt

`match_engine.py` bewertet jedes Paar Medium x Stiftung und schreibt `match_results`.
Beruecksichtigt werden nur Medien mit **aktiver** `medium_dna` (die Medienliste holt
`run_rematch.sh` dynamisch aus Directus) und nur Stiftungs-DNA im Tier `qwen_v3`.
Geschrieben wird ab Score 10, die App zeigt ab 20.
