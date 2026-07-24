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

> **Adversariale Pruefung eingearbeitet (23.07.):** Die HOCH-Befunde eines
> Audit-Durchlaufs sind hier bereits behoben: Ports nicht oeffentlich (Compose
> bindet 127.0.0.1), KEIN `directus-sync push` in Produktion (destruktiv),
> `dropdb/createdb` als Pflicht vor Restore, Wartungsfenster/Quiesce ALLER
> Schreiber vor dem Dump, `down -v` nach Produktionsdaten verboten, Firewall +
> Backup als Pflichtschritte.

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
Autorisierung** (Nutzerin/Lukas gibt das Geraet im Tailnet frei) – manueller
Schritt, nicht automatisierbar (A0c).

**Embeddings/Qdrant entfallen** (per Code-Analyse belegt: Kandidatenauswahl im
Matching nutzt reinen Tag-Math, kein Qdrant; die Front zeigt nur einen
vorberechneten `embedding_score` an). Kein Qdrant-Container.

**Crawler-Empfehlung:** Interim den **Spark-Crawler ueber Tailscale**
weiternutzen (`FIRECRAWL_URL=http://100.80.47.49:8891`, zustandslos, kein
Datenrisiko). Nur falls der Spark ganz abgeschaltet wird: Crawler-Image ist
lokal gebaut (nicht Registry) und ARM64 -> auf x86_64 **neu bauen**
(`docker save/load` reicht bei Arch-Wechsel NICHT).

---

## Vorab-Checkliste "nichts vergessen"

Vor TEIL A durchgehen, vor TEIL B **vollstaendig** abgehakt:

- [ ] **Secrets 1:1 aus dem Altsystem (NICHT neu wuerfeln):** `KEY`, `SECRET`,
      `DB_PASSWORD` — auf dem Spark unter
      `/home/dergeraet/wepublish/faas/stiftungsdatenbank/`.
      **KEY/SECRET-Mismatch => alle verschluesselten Felder + Sessions kaputt.**
- [ ] **`DIRECTUS_TOKEN` 1:1 uebernehmen** (kommt ohnehin mit dem DB-Dump).
      **Kopplung:** derselbe Token wird von der Front UND vom Spark-Daemon
      genutzt. Neu erzeugen bricht einen der beiden -> stille 401. Nur bewusst
      rotieren und dann Front-`.env` UND Spark-Daemon-Env GEMEINSAM angleichen.
- [ ] **Neu erzeugen** (kein Alt-Wert noetig): `PORTAL_SESSION_SECRET`
      (`openssl rand -hex 32`).
- [ ] **`ANTHROPIC_API_KEY`** gesetzt (nicht in env-check erfasst -> Ausfall
      erst zur Nutzungszeit; Claude-Anbindung end-to-end bereits verifiziert).
- [ ] **`PUBLIC_URL`, `PORTAL_BASE_URL`, `PASSWORD_RESET_URL_ALLOW_LIST`,
      `USER_INVITE_URL_ALLOW_LIST`** auf die echte Domain gesetzt
      (z.B. `https://matching.winkelriedtoechter.ch`). Sonst brechen
      Reset-/Invite-Mails und Portal-Magic-Links **still** nach dem Cutover.
- [ ] **Keine Platzhalter mehr in `.env`:** `grep -n '__' .env` muss leer sein
      (non-empty Platzhalter taeuschen die `:?`-Guards und env-check -> App
      bootet gruen, aber jeder Directus-Call 401/403).
- [ ] **uploads** (`data/uploads`) + **extensions** (`data/extensions`, inkl.
      directus-extension-sync) vom Spark mitnehmen.
- [ ] **Firewall** auf der VPS: `ufw` default deny incoming, nur SSH (22) +
      Tailscale. Die App-Ports sind auf 127.0.0.1 gebunden, aber ufw ist die
      zweite Verteidigungslinie (A0e).
- [ ] **Backup-Plan** nach dem Cutover eingeplant (B10): taeglicher pg_dump +
      Off-Site (NAS Winkelried), sonst ist die eine VPS-Disk der Single Point of
      Failure fuer den gesamten Produktivbestand.
- [ ] **Tailscale-Auth** eingeplant (`tailscale up`, interaktiv).
- [ ] **Directus-Versions-Abgleich:** Template `apps/directus/package.json`
      pinnt 11.13.4, Compose + Spark laufen 11.17.2. Vor produktivem Betrieb im
      Repo auf 11.17.x bumpen (Migrationen sind versionsabhaengig).

---

# TEIL A – SICHER (leere DB, kein Produktivzugriff)

Ziel: beweisen, dass der Stack auf der VPS bootet, bevor irgendwelche Live-Daten
angefasst werden. Beliebig wiederholbar.

### A0 – Vorbereitung auf der VPS

**A0a. Repo/Paket auf die VPS bringen** (git clone des Repos, da `front` aus
`../../apps/front` gebaut wird).

**A0b. `.env` anlegen:**
```bash
cd deploy/hetzner-selfcontained
cp .env.example .env
# Fuer TEIL A genuegen FRISCHE Werte fuer KEY/SECRET/DB_PASSWORD/ADMIN_PASSWORD
# (nur gegen leere DB getestet). Platzhalter (__...) trotzdem alle ersetzen.
chmod 600 .env
```

**A0c. Tailscale (manuell, interaktiv):**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up      # interaktiver Autorisierungslink; Geraet im Tailnet freigeben
tailscale status  # eigene VPS-IP (100.x) + Spark-IP sichtbar?
```
Fuer TEIL A optional, fuer TEIL B Pflicht (Crawler/Pipeline-Anbindung).

**A0d. Leere Bind-Mount-Ordner** (fuer den reinen Boot-Test):
```bash
mkdir -p data/uploads data/extensions
```

**A0e. Firewall setzen** (bevor irgendetwas laeuft):
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow in on tailscale0        # Tailnet-Verkehr (Directus 8055 via TS)
ufw --force enable
ufw status verbose
```
> Die Compose-Ports sind bereits auf 127.0.0.1 gebunden (nicht 0.0.0.0); ufw ist
> die zweite Verteidigungslinie. Directus 8055 ist damit nur lokal (Tunnel) und
> ueber das Tailscale-Interface (interim Pipeline) erreichbar, nie oeffentlich.

### A1 – Config validieren
```bash
docker compose config    # interpoliert .env, meldet fehlende Pflichtwerte
```

### A2 – Stack hochziehen (leere DB)
```bash
docker compose up -d --build
docker compose ps        # postgres healthy, directus healthy, front up
```
Directus fuehrt beim ersten Start automatisch `bootstrap` gegen die leere DB aus
(Schema-Grundgeruest + Admin).

### A3 – Boot-Tests
```bash
curl -sS http://127.0.0.1:8055/server/ping        # -> "pong"
curl -sS -I http://127.0.0.1:3000                 # -> HTTP 200/3xx
docker compose exec directus wget --version >/dev/null && echo "wget im Image ok (Healthcheck-Abhaengigkeit)"
```

### A4 – (Optional) Schema-Test auf leerer DB
Nur um das versionierte Schema isoliert zu testen. **NICHT gegen eine mit Daten
befuellte DB laufen lassen** (`directus-sync push` ist destruktiv – siehe B5):
```bash
cd apps/directus
# DIRECTUS_URL/-TOKEN auf die (leere) VPS-Directus zeigen, dann:
npm run schema:load     # directus-sync push — NUR gegen leere Test-DB
```

### A-Rollback
```bash
docker compose down          # Container weg, Volume pgdata bleibt
docker compose down -v       # ACHTUNG: loescht das pgdata-Volume
rm -rf data/uploads data/extensions
```
> **Nur solange KEINE Produktionsdaten geladen sind (also ausschliesslich vor
> B4) ist `down -v` / `rm -rf data/*` gefahrlos.** Nach dem Restore (B4) zeigen
> beide Befehle auf den echten Produktivbestand und loeschen ihn irreversibel –
> ab B4 VERBOTEN. TEIL A ist bis dahin beliebig wiederholbar.

---

# TEIL B – PRODUKTION (nur mit ausdruecklichem GO im Moment)

> **STOP.** Vor jedem Schritt dieses Teils muss ein ausdrueckliches GO fuer genau
> diesen Moment vorliegen. Kein GO = nicht ausfuehren. Bis zum Cutover (B7) laeuft
> der Altbetrieb parallel weiter (trivialer Rueckweg).

### B0 – Voraussetzungen (alle erfuellt?)
- [ ] TEIL A auf der VPS gruen.
- [ ] `.env`: echte Alt-`KEY`/`SECRET`/`DB_PASSWORD`, `DIRECTUS_TOKEN` = Alt-Wert
      1:1, `PUBLIC_URL`/`PORTAL_BASE_URL`/beide `*_URL_ALLOW_LIST` auf die echte
      Domain, `ANTHROPIC_API_KEY` gesetzt. `grep -n '__' .env` ist LEER.
- [ ] Firewall aktiv (A0e), Ports nicht oeffentlich.
- [ ] Tailscale aktiv, Spark erreichbar (`tailscale status`). VPS-Tailscale-IP
      notiert (fuer B9).
- [ ] Wartungsfenster deklariert (B1).

### B1 – Wartungsfenster + ALLE Schreiber stilllegen (Datenverlust vermeiden)
Der Dump (B2) ist ein Snapshot. Alles, was zwischen Dump und Cutover (B7) noch
in die **Alt**-DB geschrieben wird, geht sonst verloren. Daher VOR dem Dump ein
Wartungsfenster und **alle Schreiber** stilllegen (nicht nur der DE/LI-Daemon).
**Auf dem Spark, Mutationen – nur mit GO:**
```bash
# 1) Alt-App schreibgeschuetzt/Wartung: Operatorinnen + Portal duerfen nicht mehr
#    schreiben (Cloudflare-Access-Wartungsregel ODER Alt-Front kurz stoppen).
# 2) Anreicherungs-/Matching-Pipeline + DE/LI-Daemon pausieren:
pgrep -af 'web_enrich_daemon.py'          # DE/LI-Daemon (stabile Kommando-Kennung)
pgrep -af 'match_engine.py|paket_builder.py|scout.py'   # weitere Schreiber pruefen
kill -STOP <PID>   # je Prozess; haelt an ohne Fortschrittsverlust
```
> Das Fenster zwischen B2 und B7 strikt kurz halten. **B1-Rollback:**
> `kill -CONT <PID>` je Prozess + Wartungsregel entfernen -> Altbetrieb laeuft
> normal weiter, TEIL B beenden.

### B2 – pg_dump der Live-DB (Ballast ausschliessen)
`directus_revisions` (~5.6 GB) + `directus_activity` sind ~89% der DB und reiner
Audit-Ballast; Struktur bleibt, nur die Datenzeilen entfallen -> Dump schrumpft
von ~6.4 GB auf ~0.7 GB. **Einen** Dateinamen-Variablenwert verwenden
(kein doppeltes `$(date)` – sonst Mismatch ueber Mitternacht):
```bash
DUMP=directus_db_$(date +%Y%m%d_%H%M).dump
docker exec directus-postgres-spark pg_dump -U directus -d directus_db \
  -Fc --no-owner --no-privileges \
  --exclude-table-data='public.directus_revisions' \
  --exclude-table-data='public.directus_activity' \
  --exclude-table-data='public.match_results_backup_2026_05_15' \
  -f /tmp/$DUMP
docker cp directus-postgres-spark:/tmp/$DUMP ./
echo "$DUMP"   # Dateiname merken, in B3/B4 wiederverwenden
```
> **B2-Rollback:** reiner Lesevorgang; Dump-Datei bei Abbruch loeschen.

### B3 – Transfer + uploads/extensions
```bash
scp ./$DUMP root@167.233.56.27:/root/faas/deploy/hetzner-selfcontained/
rsync -a <spark>:/home/dergeraet/wepublish/faas/stiftungsdatenbank/data/uploads/    ./data/uploads/
rsync -a <spark>:/home/dergeraet/wepublish/faas/stiftungsdatenbank/data/extensions/ ./data/extensions/
```
> **B3-Rollback:** Zieldateien auf der VPS loeschen; Quelle unangetastet.

### B4 – Restore: DB frisch aufsetzen (Pflicht!), dann restaurieren
Nach dem A-Boot ist `directus_db` durch den Bootstrap **NICHT leer**. Ein
`pg_restore` dagegen liefe in „relation already exists" und laedt Daten nur
teilweise (stiller Verlust). Deshalb die DB VOR dem Restore verwerfen und frisch
anlegen – das entfernt auch die mit Frisch-Secrets gebooteten Reste:
```bash
docker compose stop directus front           # nichts darf nebenher schreiben
docker compose exec postgres dropdb   -U directus directus_db
docker compose exec postgres createdb -U directus directus_db
docker compose exec -T postgres \
  pg_restore -U directus -d directus_db --no-owner --no-privileges < ./$DUMP
```
> Postgres-Major 15 (Quelle 15.x) – passt. **B4-Rollback:** `dropdb`/`createdb`
> -> leer; erneut restoren oder TEIL B beenden. Solange B7 nicht erfolgt ist,
> laeuft der Altbetrieb ungestoert.

### B5 – Directus + Front gegen die restaurierte DB starten
Das **vollstaendige Schema kommt mit dem pg_restore** (B4). **KEIN
`directus-sync push` / `schema:load` in Produktion** – der Repo-Snapshot ist
aelter als Produktion (11.13.4, Welle-1 uncommitted) und `push` reconciled
DESTRUKTIV: er wuerde in Produktion vorhandene, im Repo unbekannte Collections/
Felder samt Daten loeschen (stiller Schemaruecksprung + Datenverlust).
```bash
docker compose up -d directus
curl -sS http://127.0.0.1:8055/server/ping     # pong
docker compose up -d front
```
> Falls spaeter ein Schema-Abgleich gewuenscht ist: nur **nicht-destruktiv**
> pruefen (`directus-sync diff`/`pull`), niemals `push` gegen Produktion.

### B6 – Verifikation (Zeilenzahlen gegen den Spark)
```bash
docker compose exec postgres psql -U directus -d directus_db -tAc \
  "SELECT 'stiftungen', count(*) FROM stiftungen
   UNION ALL SELECT 'match_results', count(*) FROM match_results
   UNION ALL SELECT 'stiftungs_dna', count(*) FROM stiftungs_dna
   UNION ALL SELECT 'applications', count(*) FROM applications;"
```
Gegen die (lesend ermittelten) Spark-Werte abgleichen. Erwartet u.a.
stiftungen ~40184, stiftungs_dna ~36462, match_results ~4630.
> **B6-Rollback:** bei Abweichung Cutover NICHT durchfuehren, per B4-Rollback neu
> restoren, Ursache klaeren.

### B7 – Cloudflare/DNS-Cutover
Der Tunnel ist token-managed (gleiche Tunnel-ID -> keine DNS-Aenderung noetig).
1. `cloudflared` auf der VPS mit **demselben** `TUNNEL_TOKEN` wie auf dem Spark
   starten. Public-Hostname-Regel im Dashboard auf die VPS-App zeigen lassen.
2. **Vor dem Umschalten** end-to-end pruefen (ueber den Tunnel-Hostnamen):
   Passwort-Reset-Mail-Link UND Portal-Magic-Link funktionieren (haengt an
   korrekt gesetztem `PUBLIC_URL`/`PORTAL_BASE_URL`/Allow-Lists — B0).
3. Erst wenn die VPS-App stabil live verifiziert ist: **Spark-cloudflared
   stoppen** (Mutation auf dem Spark, nur mit GO). Sonst balanced Cloudflare ueber
   beide Connectoren.
4. Klaeren, ob `fundraising.wepublish.cloud` an denselben Tunnel gebunden ist.
> **B7-Rollback (schnellster Rueckweg):** Spark-cloudflared wieder starten, VPS-
> cloudflared stoppen -> Traffic geht sofort auf die unveraenderte Spark-App.

### B8 – Smoke-Test Portal + Cockpit
- [ ] `/portal/login` ohne Access-Login erreichbar (Bypass greift).
- [ ] `/` verlangt Access-Login (Operator-Schutz greift).
- [ ] Cockpit laedt, Treffer sichtbar (`match_results`).
- [ ] Directus-Admin-Login ok (KEY/SECRET korrekt -> Sessions gueltig).
- [ ] **Passwort-Reset-Mail + Portal-Magic-Link** end-to-end (Zugangsschicht!).
- [ ] LLM-Stichprobe (DNA-Messung/Betrag-Recherche) -> prueft `ANTHROPIC_API_KEY`.

### B9 – Spark-Pipeline auf die VPS richten + Schreiber fortsetzen
Die Pipeline schreibt **ueber die Directus-HTTP-API** (nicht direkt in Postgres –
Postgres bleibt unexponiert). Umzustellen ist also **`DIRECTUS_URL` + `DIRECTUS_TOKEN`**
des Spark-Daemons, keine DB-Verbindung:
```bash
# Auf dem Spark, in der Daemon-/Pipeline-Env:
#   DIRECTUS_URL = http://<VPS-Tailscale-IP>:8055   (nicht localhost)
#   DIRECTUS_TOKEN = derselbe Token wie in der VPS-.env (1:1)
# Voraussetzung: Directus ist auf dem Tailscale-Interface der VPS gebunden
#   (Compose-ports: zusaetzlich "<VPS-TS-IP>:8055:8055"; NIE 0.0.0.0), ufw erlaubt tailscale0.
kill -CONT <PID>   # pausierte Schreiber (B1) fortsetzen
```
> Postgres NICHT nach aussen oeffnen. Bis der TS-Port fertig ist, bleibt dieser
> Spark->VPS-Schreibpfad die Uebergangsloesung.

### B10 – Backup einrichten (Pflicht nach Cutover)
Ab jetzt ist die VPS-DB die alleinige produktive Wahrheit. Ohne Backup ist die
eine Disk der Single Point of Failure.
```bash
# Taeglicher, ballastfreier Dump per systemd-Timer/Cron auf der VPS,
# danach Off-Site (NAS Winkelried via Tailscale, oder Drive):
#   docker exec <pg> pg_dump ... --exclude-table-data=directus_revisions ...
#   rsync dump -> NAS
```
Zusaetzlich optional taeglicher Volume-Snapshot.

---

## Gesamt-Rollback (Notausstieg TEIL B)

Solange **B7 (Cutover)** nicht vollzogen ist, ist der Rueckweg trivial (Altbetrieb
lief die ganze Zeit weiter):
```bash
# Spark: pausierte Schreiber fortsetzen
kill -CONT <PID>
# Wartungsregel entfernen
# VPS: Stack stoppen — ABER: NUR `docker compose down`, NIEMALS `down -v`,
# sobald in B4 Produktionsdaten geladen wurden (loescht sonst den Produktivbestand).
docker compose down
```
Nach B7: zuerst Cloudflare zurueckdrehen (B7-Rollback), dann VPS stoppen.
