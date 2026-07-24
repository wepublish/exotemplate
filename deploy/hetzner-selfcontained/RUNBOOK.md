# RUNBOOK – FaaS self-contained auf Hetzner-VPS

Ziel: FaaS (Postgres + Directus + Next.js-Front) self-contained auf
`root@167.233.56.27` (Docker 29.6 + Compose v5 vorinstalliert).

Dieses Runbook trennt strikt:

- **TEIL A – SICHER:** kein Produktivzugriff, keine Live-Daten. Boot-Test mit
  leerer DB. Beliebig oft wiederholbar, kein Risiko fuer den laufenden Betrieb.
- **TEIL B – PRODUKTION:** nur mit ausdruecklichem GO im Moment der Ausfuehrung.
  Beruehrt Live-Daten, pausiert Schreiber und macht den DNS-Cutover.

> **Grundregel:** Solange TEIL B nicht ausdruecklich freigegeben ist, laeuft der
> komplette Altbetrieb (Spark + Cloudflare-Tunnel + Pipeline) unveraendert
> weiter. TEIL A aendert daran nichts.

> **Zweite adversariale Pruefung eingearbeitet (24.07., Preflight gegen den realen
> Spark-Live-Zustand).** Die fruehere Fassung legte nur einzelne Prozesse stumm und
> repointete nur "den Daemon". Der Live-Check zeigte ~18 aktive Cron-Schreiber
> (teils im 2-Minuten-Takt), einen per Cron/@reboot neu startenden DE/LI-Daemon,
> Directus auf 0.0.0.0:8055 und ein hartcodiertes `localhost:8055` in `scout.py`.
> Die 20 bestaetigten Befunde sind unten eingearbeitet. Die entscheidende Aenderung:
> **die Cron-Quelle als Ganzes stilllegen und den Directus-Container als harten
> Choke-Point stoppen** (nicht PIDs einzeln einfrieren), und beim Resume **ALLE**
> Schreiber neu gegen die VPS starten (nie `kill -CONT` des Alt-Daemons).

---

## Architektur (Interim-Topologie)

```
                    Hetzner-VPS (self-contained)
   ┌─────────────────────────────────────────────────────┐
   │  front (Next.js, 127.0.0.1:3000)                     │
   │     └─ DIRECTUS_URL = http://directus:8055 (intern)  │
   │  directus (11.17.2, 127.0.0.1:8055 + Tailscale-IP)   │
   │     └─ DB_HOST = postgres (intern)                   │
   │  postgres (15, Volume pgdata, NICHT exponiert)       │
   │  cloudflared (host-network ODER im Compose-Netz)     │
   └─────────────────────────────────────────────────────┘
             ▲                              ▲
             │ Tailscale                    │ Tailscale (interim)
   ┌─────────┴──────────┐        ┌──────────┴─────────────────────┐
   │ Spark-Crawler :8891│        │ Spark: Pipeline (Python, noch   │
   │ (Firecrawl, interim)│       │ NICHT nach TS portiert) schreibt│
   └────────────────────┘        │ ueber die Directus-HTTP-API der │
                                 │ VPS (DIRECTUS_URL -> VPS-TS-IP) │
                                 └─────────────────────────────────┘
```

**Warum so:** Die schwere Python-Pipeline (Anreicherung/Matching) ist **noch
nicht nach TypeScript portiert**. Uebergangsweise laeuft sie weiter auf dem
Spark und schreibt ueber Tailscale in die Hetzner-Directus (per HTTP-API, NICHT
direkt in Postgres). App + Directus + Postgres laufen bereits self-contained auf
Hetzner. Sobald der Port fertig ist, faellt die Spark-Abhaengigkeit weg.

Deshalb braucht die VPS **Tailscale**. `tailscale up` erfordert **interaktive
Autorisierung** – manueller Schritt, nicht automatisierbar (A0c).

**cloudflared auf der VPS (wichtig, CN-04):** Die App-Ports sind auf 127.0.0.1
gebunden. Ein Bridge-Container erreicht `localhost:3000`/`:8055` NICHT. cloudflared
daher entweder mit `--network host` betreiben (dann loesen `localhost:3000/:8055`
auf den Host auf) ODER in das Compose-Netz aufnehmen und den Ingress auf die
Service-Namen `http://front:3000` / `http://directus:8055` zeigen lassen. NICHT das
Spark-Muster (0.0.0.0-Bridge) unbesehen uebernehmen.

**Embeddings/Qdrant entfallen** (per Code-Analyse belegt). Kein Qdrant-Container.

**Crawler-Empfehlung:** Interim den **Spark-Crawler ueber Tailscale**
weiternutzen (`FIRECRAWL_URL=http://100.80.47.49:8891`). Nur falls der Spark ganz
abgeschaltet wird: Crawler-Image ist lokal/ARM64 gebaut -> auf x86_64 **neu bauen**.

---

## Vorab-Checkliste "nichts vergessen"

Vor TEIL A durchgehen, vor TEIL B **vollstaendig** abgehakt:

- [ ] **Secrets 1:1 aus dem Altsystem (NICHT neu wuerfeln):** `KEY`, `SECRET` —
      auf dem Spark **inline** im `environment:`-Block von
      `/home/dergeraet/wepublish/faas/stiftungsdatenbank/docker-compose.yml`
      (es gibt dort KEINE separate `.env`).
      **KEY/SECRET-Mismatch => alle verschluesselten Felder + Sessions kaputt.**
- [ ] **`DB_PASSWORD` ueber TEIL A und TEIL B KONSTANT halten (S1).** Es ist ein
      rein internes Passwort (Postgres und Directus teilen dieselbe `${DB_PASSWORD}`).
      Wird es zwischen A und B geaendert, traegt die in TEIL A gebootete Rolle noch
      das alte Passwort und Directus kommt gegen die restaurierte DB nicht hoch
      (SCRAM-Auth-Fehler, verschleiert durch `trust`-lokalen `dropdb`). Also: einen
      Wert waehlen und behalten (Wert muss NICHT der Spark-Wert sein, da die DB nur
      Daten, nicht die Rolle mitbringt). Alternativ vor B4 `down -v` (pgdata leeren,
      vor B4 unbedenklich) und mit dem finalen Wert neu hochziehen.
- [ ] **`DIRECTUS_TOKEN` 1:1 uebernehmen** (kommt mit dem DB-Dump, da statisch am
      User gespeichert; die `--exclude`-Tabellen betreffen ihn nicht). **Kopplung:**
      derselbe Token wird von der Front UND von allen Spark-Schreibern genutzt.
- [ ] **Neu erzeugen:** `PORTAL_SESSION_SECRET` (`openssl rand -hex 32`).
- [ ] **`ANTHROPIC_API_KEY`** gesetzt.
- [ ] **`PUBLIC_URL`, `PORTAL_BASE_URL`, beide `*_URL_ALLOW_LIST`** auf die echte
      Domain (z.B. `https://matching.winkelriedtoechter.ch`). Sonst brechen
      Reset-/Invite-Mails und Portal-Magic-Links **still**.
- [ ] **Keine Platzhalter mehr in `.env`:** `grep -n '__' .env` muss leer sein.
- [ ] **Admin-Login nach Restore (DRS-6):** Nach dem `pg_restore` gilt der
      **Spark-Admin-Account**, NICHT die `.env`-`ADMIN_PASSWORD` (die wirkt nur beim
      Bootstrap gegen eine leere DB). Beim Smoke-Test mit den Spark-Credentials
      anmelden; falls unbekannt, im Container zuruecksetzen:
      `docker compose exec directus npx directus users passwd --email <admin> --password <neu>`.
- [ ] **uploads** (`data/uploads`) + **extensions** (`data/extensions`, inkl.
      directus-extension-sync) vom Spark mitnehmen.
- [ ] **Firewall** auf der VPS: `ufw` default deny incoming, nur SSH (22) +
      `tailscale0`. App-Ports auf 127.0.0.1 (A0e).
- [ ] **Crontab-Sicherung des Spark eingeplant** (B1): `crontab -l > backup` vor
      dem Stilllegen, damit der Resume (B9) die Schreiber wieder aktivieren kann.
- [ ] **Directus-Bindung an die VPS-Tailscale-IP eingeplant** (B9): Compose um
      `"<VPS-TS-IP>:8055:8055"` erweitern, erst NACH `tailscale up` (IP vorher
      unbekannt), dann Recreate. NIE 0.0.0.0. Postgres bleibt unexponiert.
- [ ] **Backup-Plan konkret** (B10): VPS-Timer + Skript + Off-Site NAS + Restore-Test;
      Spark-`faas_daily_backup.sh` nach Cutover deaktivieren (dumpt sonst die tote DB).
- [ ] **Directus-Versions-Abgleich:** Template `apps/directus/package.json` pinnt
      11.13.4, Compose + Spark laufen 11.17.2 -> vor Betrieb auf 11.17.x bumpen.

---

# TEIL A – SICHER (leere DB, kein Produktivzugriff)

Ziel: beweisen, dass der Stack auf der VPS bootet, bevor Live-Daten angefasst
werden. Beliebig wiederholbar.

### A0 – Vorbereitung auf der VPS
**A0a. Repo/Paket auf die VPS bringen** (git clone; `front` wird aus `../../apps/front` gebaut).

**A0b. `.env` anlegen:**
```bash
cd deploy/hetzner-selfcontained
cp .env.example .env
# Fuer TEIL A genuegen frische Werte fuer KEY/SECRET/ADMIN_PASSWORD.
# ACHTUNG DB_PASSWORD (S1): denselben Wert waehlen, den TEIL B behaelt.
chmod 600 .env
```

**A0c. Tailscale (manuell, interaktiv):**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up          # interaktiver Autorisierungslink; Geraet im Tailnet freigeben
tailscale ip -4       # VPS-Tailscale-IP notieren -> wird in B9 (Compose-Binding) gebraucht
tailscale status      # eigene VPS-IP (100.x) + Spark-IP sichtbar?
```
Fuer TEIL A optional, fuer TEIL B Pflicht.

**A0d. Leere Bind-Mount-Ordner:** `mkdir -p data/uploads data/extensions`

**A0e. Firewall setzen:**
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow in on tailscale0
ufw --force enable
ufw status verbose
```

### A1 – Config validieren
```bash
docker compose config
```

### A2 – Stack hochziehen (leere DB)
```bash
docker compose up -d --build
docker compose ps      # postgres healthy, directus healthy, front up
```

### A3 – Boot-Tests
```bash
curl -sS http://127.0.0.1:8055/server/ping        # -> "pong"
curl -sS -I http://127.0.0.1:3000                 # -> HTTP 200/3xx
docker compose exec directus wget --version >/dev/null && echo "wget im Image ok"
```

### A4 – (Optional) Schema-Test auf leerer DB
Nur isoliert. **NICHT gegen eine befuellte DB** (`directus-sync push` ist destruktiv, siehe B5).

### A-Rollback
```bash
docker compose down          # Container weg, Volume pgdata bleibt
docker compose down -v       # loescht pgdata-Volume
rm -rf data/uploads data/extensions
```
> **Nur vor B4 gefahrlos.** Ab B4 (Produktionsdaten geladen) sind `down -v` /
> `rm -rf data/*` VERBOTEN – sie loeschen den Produktivbestand.

---

# TEIL B – PRODUKTION (nur mit ausdruecklichem GO im Moment)

> **STOP.** Vor jedem Schritt ein ausdrueckliches GO fuer genau diesen Moment.
> Bis zum Cutover (B7) laeuft der Altbetrieb parallel weiter (trivialer Rueckweg).
> Ab **B9** ist der Point-of-no-return ueberschritten (F6) – danach ist Rollback
> verlustbehaftet.

### B0 – Voraussetzungen (alle erfuellt?)
- [ ] TEIL A auf der VPS gruen.
- [ ] `.env`: Alt-`KEY`/`SECRET`, `DB_PASSWORD` = derselbe Wert wie in TEIL A (S1),
      `DIRECTUS_TOKEN` = Alt-Wert 1:1, `PUBLIC_URL`/`PORTAL_BASE_URL`/beide
      `*_URL_ALLOW_LIST` auf die echte Domain, `ANTHROPIC_API_KEY` gesetzt.
      `grep -n '__' .env` LEER.
- [ ] Firewall aktiv (A0e), Ports nicht oeffentlich.
- [ ] Tailscale aktiv, `tailscale ip -4` notiert (fuer B9), Spark erreichbar.
- [ ] cloudflared-Netzwerkmodus geklaert (CN-04: host-network oder Compose-Netz).
- [ ] Wartungsfenster deklariert (B1). Fenster strikt kurz halten.

### B1 – ALLE Schreiber stilllegen (Cron-Quelle + Choke-Point, nicht PIDs einzeln)
Der Dump (B2) ist ein Snapshot. Alles, was danach in die **Alt**-DB geschrieben
wird, geht beim Cutover verloren. `kill -STOP` + `pgrep` genuegt NICHT (Q1/Q2/Q3/F1):
Cron feuert weiter (u.a. `embedding_pass` alle 2 Min, `run_rematch` alle 6 h), und
`run_web_enrich.sh` startet den DE/LI-Daemon per `05:35`-Cron und `@reboot` neu.
Directus ist zudem auf 0.0.0.0:8055 erreichbar, eine Cloudflare-Access-Regel deckt
Direktzugriffe nicht (Q5/CN-02). Daher: **Scheduler abschalten + Directus stoppen.**

**Auf dem Spark, Mutationen – nur mit GO, in dieser Reihenfolge:**
```bash
# 1) Operator/Portal-Schreibpfad zu: Alt-Front WIRKLICH stoppen (nicht nur Access, CN-02)
docker stop faas-matching

# 2) Crontab sichern, dann KOMPLETT entfernen (deaktiviert auch @reboot + 05:35-Relaunch)
crontab -l > ~/scripts/crontab_backup_pre_cutover_$(date +%Y%m%d_%H%M).txt
crontab -r
# Gegenpruefen, ob FaaS-Jobs auch woanders liegen:
sudo crontab -l 2>/dev/null | grep -i faas || true
ls -la /etc/cron.d/ ; grep -ri faas /etc/crontab /etc/cron.d/ 2>/dev/null || true

# 3) systemd-User-Daemons stoppen (persistente Schreiber ausserhalb Cron)
systemctl --user stop faas-chat-adapter faas-slack-daemon 2>/dev/null || true

# 4) Laufenden DE/LI-Daemon beenden (nicht nur STOP) und verifizieren
kill 3752801        # aktuelle PID per 'pgrep -af web_enrich_daemon.py' bestaetigen
pgrep -af 'web_enrich_daemon.py' || echo "Daemon weg"

# 5) HARTER CHOKE-POINT: Directus-Container stoppen -> kein HTTP-API-Schreiber mehr moeglich
docker stop stiftungsdatenbank-spark
```
**Ruhe verifizieren (Pflicht):** 2x im Abstand von ~60 s die Zeilenzahlen von
`match_results`, `stiftungs_dna`, `medium_dna` messen (direkt im Postgres-Container,
der laeuft weiter fuer den Dump). Erst wenn sie sich NICHT mehr aendern, weiter zu B2.
Diese eingefrorenen Werte sind der **Referenz-Snapshot fuer B6**.
```bash
docker exec directus-postgres-spark psql -U directus -d directus_db -tAc \
 "SELECT 'stiftungen',count(*) FROM stiftungen
  UNION ALL SELECT 'match_results',count(*) FROM match_results
  UNION ALL SELECT 'stiftungs_dna',count(*) FROM stiftungs_dna
  UNION ALL SELECT 'medium_dna',count(*) FROM medium_dna
  UNION ALL SELECT 'applications',count(*) FROM applications;"
```
> **B1-Rollback:** `docker start stiftungsdatenbank-spark faas-matching`;
> `crontab ~/scripts/crontab_backup_pre_cutover_*.txt`;
> `systemctl --user start faas-chat-adapter faas-slack-daemon`; Daemon laeuft per
> Cron/@reboot wieder an. Altbetrieb normal, TEIL B beenden.

### B2 – pg_dump der Live-DB (Ballast ausschliessen)
`pg_dump` laeuft direkt im Postgres-Container; Directus darf dafuer gestoppt sein.
```bash
DUMP=directus_db_$(date +%Y%m%d_%H%M).dump
docker exec directus-postgres-spark pg_dump -U directus -d directus_db \
  -Fc --no-owner --no-privileges \
  --exclude-table-data='public.directus_revisions' \
  --exclude-table-data='public.directus_activity' \
  --exclude-table-data='public.match_results_backup_2026_05_15' \
  -f /tmp/$DUMP
docker cp directus-postgres-spark:/tmp/$DUMP ./
echo "$DUMP"
```
> **B2-Rollback:** reiner Lesevorgang; Dump-Datei bei Abbruch loeschen.

### B3 – Transfer + uploads/extensions
```bash
scp ./$DUMP root@167.233.56.27:/root/faas/deploy/hetzner-selfcontained/
rsync -a <spark>:/home/dergeraet/wepublish/faas/stiftungsdatenbank/data/uploads/    ./data/uploads/
rsync -a <spark>:/home/dergeraet/wepublish/faas/stiftungsdatenbank/data/extensions/ ./data/extensions/
```

### B4 – Restore: DB frisch aufsetzen (Pflicht!), dann restaurieren
Nach dem A-Boot ist `directus_db` nicht leer. Deshalb verwerfen und frisch anlegen:
```bash
docker compose stop directus front
docker compose exec postgres dropdb   -U directus directus_db
docker compose exec postgres createdb -U directus directus_db
docker compose exec -T postgres \
  pg_restore -U directus -d directus_db --no-owner --no-privileges < ./$DUMP
```
> Postgres-Major 15 (Quelle 15.x). **DB_PASSWORD-Falle (S1):** Directus verbindet
> gleich per TCP (SCRAM) mit `${DB_PASSWORD}` gegen die Rolle `directus`. Traegt die
> Rolle noch ein anderes Passwort (weil in A ein anderer Wert gebootet wurde),
> in-place korrigieren:
> `docker compose exec postgres psql -U directus -c "ALTER USER directus PASSWORD '<wert>';"`.
> **Admin (DRS-6):** ab jetzt gilt der Spark-Admin-Account, nicht `.env ADMIN_PASSWORD`.
> **B4-Rollback:** `dropdb`/`createdb` -> leer; erneut restoren oder TEIL B beenden.
> **`down -v` / `rm -rf data/*` ab hier VERBOTEN.**

### B5 – Directus + Front gegen die restaurierte DB starten
**KEIN `directus-sync push` / `schema:load` in Produktion** (destruktiv). Das Schema
kommt mit dem `pg_restore`.
```bash
docker compose up -d directus
curl -sS http://127.0.0.1:8055/server/ping     # pong
docker compose up -d front
```
> Schema-Abgleich spaeter nur nicht-destruktiv (`directus-sync diff`/`pull`), nie `push`.

### B6 – Verifikation gegen den FROZEN-Snapshot aus B1
Nicht gegen hartcodierte Zahlen pruefen (die Spark-DB waechst laufend; die alten
Notiz-Werte 40184/36462/4630 sind veraltet). Gegen die in **B1 eingefrorenen** Werte:
```bash
docker compose exec postgres psql -U directus -d directus_db -tAc \
  "SELECT 'stiftungen',count(*) FROM stiftungen
   UNION ALL SELECT 'match_results',count(*) FROM match_results
   UNION ALL SELECT 'stiftungs_dna',count(*) FROM stiftungs_dna
   UNION ALL SELECT 'medium_dna',count(*) FROM medium_dna
   UNION ALL SELECT 'applications',count(*) FROM applications;"
```
Muss den B1-Snapshot exakt treffen.
> **B6-Rollback:** bei Abweichung Cutover NICHT durchfuehren, per B4-Rollback neu
> restoren, Ursache klaeren.

### B7 – Cloudflare/DNS-Cutover
Token-managed (gleiche Tunnel-ID -> keine DNS-Aenderung).
1. **Zuerst (CN-07) klaeren, ob `fundraising.wepublish.cloud` denselben Tunnel teilt.**
   Wenn ja und der Origin nur auf dem Spark existiert: Spark-cloudflared fuer diesen
   Hostnamen weiterlaufen lassen oder Origin vorher auf die VPS bringen/separaten
   Tunnel. Diese Frage MUSS vor Schritt 4 (Spark-Connector-Stopp) beantwortet sein.
2. `cloudflared` auf der VPS mit **demselben** `TUNNEL_TOKEN` starten
   (Netzwerkmodus laut CN-04). Public-Hostname-Service-URL auf den VPS-Front-Port
   zeigen lassen. Achtung (CN-08): eine geteilte Service-URL kann Spark `:3009` und
   VPS `:3000` nicht gleichzeitig bedienen -> Service-URL-Umstellung und
   Connector-Wechsel gemeinsam planen; VPS vorab ueber privaten Pfad verifizieren.
3. **Vor dem Umschalten** end-to-end pruefen (Passwort-Reset-Link UND
   Portal-Magic-Link) ueber den Tunnel-Hostnamen.
4. Erst wenn die VPS-App stabil live ist: **Spark-cloudflared stoppen**
   (Mutation, nur mit GO).
> **B7-Rollback (schnellster Rueckweg):** Spark-cloudflared wieder starten, VPS-
> cloudflared stoppen. **Zusaetzlich (CN-08): die Dashboard-Service-URL wieder auf
> den Spark-Wert (`:3009`) zuruecksetzen**, sonst 502t der Spark-Connector.

### B8 – Smoke-Test Portal + Cockpit
- [ ] `/portal/login` ohne Access-Login erreichbar (Bypass greift).
- [ ] `/` verlangt Access-Login (Operator-Schutz greift).
- [ ] Cockpit laedt, Treffer sichtbar (`match_results`).
- [ ] Directus-Admin-Login ok – mit **Spark-Admin-Credentials** (DRS-6), nicht `.env`.
- [ ] **Passwort-Reset-Mail + Portal-Magic-Link** end-to-end.
- [ ] LLM-Stichprobe -> prueft `ANTHROPIC_API_KEY`.

### B9 – Interim-Schreibpfad herstellen + ALLE Schreiber neu gegen die VPS (POINT OF NO RETURN)
Ab hier schreibt die Pipeline in die VPS-DB; ein Spark-Rollback wird verlustbehaftet (F6).

**9a. Directus an die Tailscale-IP binden (F5/CN-05) – VOR dem Resume:**
```bash
# Voraussetzung: 'tailscale up' erledigt, VPS-TS-IP aus 'tailscale ip -4'.
# Compose (ports) um die TS-Bindung ergaenzen (zusaetzlich zu 127.0.0.1), NIE 0.0.0.0:
#   - "127.0.0.1:8055:8055"
#   - "<VPS-TS-IP>:8055:8055"
docker compose up -d directus            # Recreate mit neuer Bindung
# Vom Spark aus verifizieren, BEVOR Schreiber loslaufen:
ssh <spark> 'curl -sS http://<VPS-TS-IP>:8055/server/ping'   # -> pong
```

**9b. ALLE Schreiber repointen (Q4/F4/S2) – nicht nur den Daemon:**
```bash
# Auf dem Spark, in der GEMEINSAMEN Env-Quelle der Pipeline
# (.hermes/.env / Daemon-Env / run_*.sh-Exports):
#   DIRECTUS_URL   = http://<VPS-TS-IP>:8055   (nicht localhost)
#   DIRECTUS_TOKEN = derselbe Token wie in der VPS-.env (1:1)
# scout.py hat localhost:8055 HARTCODIERT -> explizit ueberschreiben
#   (Cron setzt export DIRECTUS_URL vor dem Aufruf, bzw. Default im Skript patchen).
# Gegenpruefen, dass KEIN Schreiber mehr auf localhost:8055 zeigt:
grep -rn 'localhost:8055\|127.0.0.1:8055' /home/dergeraet/faas-matching-wepublish/spark \
     /home/dergeraet/scripts_v2 || echo "kein localhost-Rest"
```

**9c. Schreiber neu starten – NIE `kill -CONT` des Alt-Daemons (Q4):**
Der in B1 beendete Daemon ist tot; ein fortgesetzter haette die alte Env
(localhost) und schriebe in die tote DB. Reihenfolge zwingend **Repoint (9b) VOR
Crontab-Restore**:
```bash
# 1) Crontab wiederherstellen (bringt Daemon-Relaunch + alle Cron-Schreiber zurueck,
#    jetzt mit VPS-Env):
crontab ~/scripts/crontab_backup_pre_cutover_*.txt
# 2) systemd-Daemons mit VPS-Env starten:
systemctl --user start faas-chat-adapter faas-slack-daemon
# 3) Alte Directus (stiftungsdatenbank-spark) + alte Front (faas-matching) BLEIBEN
#    gestoppt -> keine versehentlichen Schreibzugriffe auf die tote DB.
```
**Verifizieren:** VPS-Zeilenzahlen wachsen, Alt-Spark-DB-Zaehler bleiben eingefroren.
> Postgres NICHT nach aussen oeffnen. Bis der TS-Port fertig ist, bleibt dieser
> Spark->VPS-Schreibpfad die Uebergangsloesung.

### B10 – Backup einrichten (Pflicht nach Cutover)
Die VPS-DB ist ab jetzt die alleinige produktive Wahrheit.
```bash
# a) Taeglicher, ballastfreier Dump auf der VPS (systemd-Timer ODER cron):
#    docker exec <pg> pg_dump -U directus -d directus_db -Fc --no-owner --no-privileges \
#      --exclude-table-data=public.directus_revisions \
#      --exclude-table-data=public.directus_activity -f /backup/directus_db_$(date +\%F).dump
# b) Off-Site zur NAS Winkelried ueber Tailscale – EINMAL real verifizieren:
#    rsync -a /backup/ <nas-ts>:/faas-backup/   && echo "rsync ok"
# c) Freshness-/Erfolgskontrolle (Timer-Status, Dateigroesse/-alter pruefen).
# d) Periodischer RESTORE-TEST (Dump in Wegwerf-DB laden, Zeilenzahlen pruefen).
```
**Wichtig (F8):** Auf dem Spark `faas_daily_backup.sh` (Cron `30 3`) nach dem Cutover
**deaktivieren/umwidmen** – sonst sichert es weiter die tote Spark-DB (Scheingruen).

---

## Gesamt-Rollback

**Vor B9** (Altbetrieb lief die ganze Zeit weiter, trivial):
```bash
# Spark: Scheduler + Dienste + Alt-App zurueck
crontab ~/scripts/crontab_backup_pre_cutover_*.txt
systemctl --user start faas-chat-adapter faas-slack-daemon
docker start stiftungsdatenbank-spark faas-matching
# Cloudflare-Wartungsregel entfernen
# Falls B7 erfolgt: Spark-cloudflared starten, VPS-cloudflared stoppen,
#   Dashboard-Service-URL auf :3009 zuruecksetzen (CN-08)
# VPS: Stack stoppen — NUR 'docker compose down', NIEMALS 'down -v' nach B4
docker compose down
```

**Nach B9 (Point-of-no-return, F6):** Der B2-Dump ist KEIN gueltiges Rollback-Ziel
mehr (er kennt keine Post-Cutover-Schreibvorgaenge). Rollback nur noch als
**Forward-Fix auf der VPS** oder als **Reverse-Dump VPS -> Spark** (VPS quiescen,
dumpen, auf den Spark zuruueckspielen, Schreiber wieder auf localhost). Nicht mehr
"einfach den Spark anwerfen".
