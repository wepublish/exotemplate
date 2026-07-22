# Hetzner-Deploy, Phase 1

Dieses Paket bringt die FaaS-App (Next.js) auf einen Hetzner-Server. **Nur die
App läuft hier.** Directus, vLLM (LLM), der Crawler und der Hermes-Adapter
bleiben auf dem Spark und werden über Tailscale erreicht - das ist der von
Jolanda entschiedene zweiphasige Aufbau (Datenmodell + Rechenlast bleiben
souverän auf eigener Hardware). Der Directus-Umzug auf Hetzner selbst
(Phase 2) ist ein separates, späteres Projekt und nicht Teil dieses Pakets.

## 1. Docker + Tailscale installieren

Auf dem frischen Hetzner-Host (Debian/Ubuntu):

```bash
# Docker (offizielles Install-Skript)
curl -fsSL https://get.docker.com | sh

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

Beim `tailscale up` erscheint ein Link zur Geräte-Autorisierung im
gemeinsamen Tailnet (dasselbe Tailnet, in dem auch der Spark hängt). Danach
ist der Spark unter seiner Tailscale-IP (`100.x.y.z`) vom Hetzner-Host aus
erreichbar - dieselbe Adresse wie in `.env` (siehe Schritt 2).

## 2. `.env` füllen

```bash
cp .env.example .env
```

Dann `.env` mit echten Werten füllen:

- Die vier **Pflicht**-Variablen (`DIRECTUS_URL`, `DIRECTUS_TOKEN`,
  `PORTAL_SESSION_SECRET`, `PORTAL_BASE_URL`) müssen gesetzt sein, sonst
  warnt die App beim ersten API-Aufruf einmalig in den Logs (siehe
  `src/lib/env-check.ts`) und einzelne Routen antworten mit 403/503.
- Die Tailscale-IP des Spark (`100.x.y.z` in der Vorlage) ersetzt man durch
  den echten Wert - `tailscale status` auf dem Hetzner-Host zeigt sie an.
- Die optionalen Variablen (LLM-Fallback, `HERMES_API_KEY`,
  `FAAS_AGENT_ENABLED`, `PORTAL_TREFFER_LIMIT`, `DATENSUPPE_BASE`)
  degradieren sauber, wenn sie leer bleiben - siehe Kommentare in
  `.env.example`.

`.env` selbst nie committen (liegt bewusst nicht im Repo, nur `.env.example`).

## 3. Starten

```bash
docker compose up -d --build
```

Die App ist danach unter Port 3000 des Hetzner-Hosts erreichbar (dahinter
liegt Cloudflare, siehe Abschnitt "Cloudflare-Regeln" unten).

Config-Validierung (ohne zu starten):

```bash
docker compose config
```

## Checkliste: Spark-Dienste über Tailscale erreichbar

Vom Hetzner-Host aus prüfen, **bevor** `docker compose up` läuft (Spark-IP
durch die echte Tailscale-Adresse ersetzen):

```bash
# Directus (GraphQL/REST)
curl -sS http://100.x.y.z:8055/server/ping

# vLLM (LLM für Betrag-Recherche, DNA-Messung, Gesuch-Vorbau)
curl -sS http://100.x.y.z:8001/v1/models

# Firecrawl-kompatibler Crawler
curl -sS http://100.x.y.z:8891/v1/scrape -X POST \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","formats":["markdown"]}'

# Hermes-Adapter ("Der Gerät", Assistenten-Chat)
curl -sS http://100.x.y.z:9200/faas-status
```

Antwortet einer dieser Aufrufe nicht (Timeout, Connection refused), zuerst
`tailscale status` auf beiden Maschinen prüfen (Spark muss im selben Tailnet
und erreichbar sein), erst danach die App starten.

## rclone-Mount (optional, für `DATENSUPPE_BASE`)

Die Ein-Knopf-DNA-Generierung liest bei Bedarf aus der geteilten Drive-Ablage
(`Fundraising/FaaS`, dasselbe rclone-Remote `gdrive-faas:` wie auf dem Spark).
Auf Hetzner ist dieser Mount **optional** - ohne ihn lässt die App die
Datensuppe-Quelle einfach aus (sichtbare Warnung, kein Absturz).

Falls gewünscht:

1. `rclone.conf` mit dem `gdrive-faas:`-Remote (Credentials aus dem
   bestehenden Spark-Setup, NICHT neu erstellen) neben `docker-compose.yml`
   ablegen - niemals ins Repo committen.
2. Den auskommentierten `rclone-datensuppe`-Service in
   `docker-compose.yml` einkommentieren (Mount `gdrive-faas:Fundraising/FaaS`
   read-only nach `/datensuppe`).
3. Bei `faas-app` das Volume `datensuppe:/datensuppe:ro` eintragen und in
   `.env` `DATENSUPPE_BASE=/datensuppe` setzen.

## Cloudflare-Regeln (Zusammenfassung)

- **Operator-Pfade bleiben hinter Cloudflare Access** (nur Jolanda/Ramona):
  `/`, `/agent`, `/applications`, `/api/directus`,
  `/api/zugangsverwaltung`, `/api/gesuch-freigeben`,
  `/api/gesuch-text-erfassen`, `/api/matching-freischalten` und alle
  weiteren Operator-Seiten/-Routen.
- **Bypass für das Medien-Portal** (Everyone, kein Access-Login - das
  Portal authentifiziert sich selbst per Magic-Link):
  `matching.winkelriedtoechter.ch/portal/*` und
  `matching.winkelriedtoechter.ch/api/portal/*`.
- Alles andere bleibt hinter Access.

Für die vollständige Schritt-für-Schritt-Anleitung (Access-Policy anlegen,
Bypass-Regel-Reihenfolge, Testschritte) siehe die Workspace-Anleitung
`2026-07-09_cloudflare_portal_regeln.md` - wird hier bewusst nicht dupliziert.

## Phase 2 (Hinweis, nicht Teil dieses Pakets)

Dieses Paket deckt nur Phase 1 ab: die App zieht auf Hetzner um, Directus
und die GPU-gestützten Dienste (vLLM, Crawler, Hermes-Adapter) bleiben auf
dem Spark und werden per Tailscale angesprochen. Ein möglicher
Directus-Umzug auf Hetzner (Phase 2) ist ein eigenes, späteres Projekt mit
eigener Planung (Datenmigration, Backup-Strategie, GPU-Frage) und wird hier
nicht vorweggenommen.
