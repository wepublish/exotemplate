# faas-matching-wepublish

Single-operator-Matching-Liste für die We.Publish-Stiftung. Die App zeigt pro Medium nach Score sortierte Förderstiftungen mit DNA-Begründung. Datenquelle ist die FaaS-Directus-Instanz (GraphQL-API). Schreibt nichts — read-only MVP.

Bewusst entlang des wepublish-Stacks gebaut (Next.js, MUI, Apollo Client), damit eine Übergabe an wepublish-Entwickler ohne Kontext-Aufwand möglich ist.

Vollständige Konzept- und Datenmodell-Spezifikation: `2026-05-29_app_matching_ui_spec.md` im FaaS-Entwicklungsordner.

---

## Stack

| Schicht | Technologie |
|---|---|
| Framework | Next.js 15 (Pages Router) |
| UI | React 19 + MUI 9 |
| Datenzugriff | Apollo Client 4 (GraphQL) |
| Typen | TypeScript; GraphQL-Codegen optional (aktuell `any`-getypt) |
| Tests | Jest + Testing Library |

---

## Env-Variablen

Kopiere `.env.local.example` und trage die Werte ein:

```bash
cp .env.local.example .env.local
```

| Variable | Bedeutung |
|---|---|
| `NEXT_PUBLIC_DIRECTUS_URL` | Basis-URL der Directus-Instanz (ohne abschliessendes `/`) |
| `NEXT_PUBLIC_DIRECTUS_TOKEN` | Bearer-Token für den Directus-Zugriff |

**Hinweis zum Token:** Das `NEXT_PUBLIC_`-Präfix bedeutet, der Token ist im Browser-Bundle sichtbar. Das ist ein bewusster Trade-off für den Tailscale-privaten Single-Operator-Betrieb. Bei produktivem Multi-User-Betrieb Token serverseitig halten (API-Route oder Middleware als Proxy) und `NEXT_PUBLIC_` entfernen.

---

## Entwicklung

```bash
npm install
npm run dev
```

App läuft auf http://localhost:3000.

```bash
npm test          # Jest-Tests
npm run build     # Produktions-Build
```

---

## Docker

```bash
docker build -t faas-matching-wepublish .
docker run -p 3000:3000 --env-file .env.local faas-matching-wepublish
```

Das `.dockerignore` schliesst `node_modules`, `.next`, `.env.local` und `.git` aus — der Token gelangt nicht ins Image.

---

## Datenmodell / Architektur

Die App liest drei Collections aus Directus:

- **`match_results`** — gefiltert auf `tier = deep`, je Medium. Enthält `score`, `begruendung`, `stiftung_id` (Int-Skalar, kein Relation-Objekt).
- **`stiftungen`** — `id`, `Stiftungsname`, `webseite`, `foerderbeitraege`, `foerdersummen_range`.
- **`stiftungs_dna`** — aktive DNA-Version je Stiftung; `stiftung_id` ist hier eine Relation (`{ id }`), nicht ein Skalar.

Der Join zwischen `match_results.stiftung_id` (Int) und `stiftungs_dna.stiftung_id.id` (Relation) passiert clientseitig. Die App schreibt nichts zurück.

---

## Tenant-Konfiguration

`config/tenant.ts` enthält Branding und Klienten-Liste (Medien). Das ist der einzige Unterschied zu einer zweiten Mandanten-Instanz. Für einen neuen Mandanten: neue Instanz aufsetzen, `config/tenant.ts` anpassen, eigene Env-Variablen setzen.

---

## Phase 2 / Offen

- **Kuratierung (Akzeptieren/Ablehnen):** braucht eine `match_curation`-Collection in Directus und Write-Zugriff. Ist bewusst aus dem MVP ausgeklammert.
- **GraphQL-Codegen:** `codegen.ts` ist vorhanden, Typen werden aktuell nicht generiert. `any`-getypte Antworten funktionieren, Codegen würde Typsicherheit ergänzen.
- **Alarm-Pfad für den FaaS-Backend:** kein aktiver Alarm bei Service-Störungen (Details: FaaS-Entwicklungsordner `CLAUDE.md`).

---

## Deploy bei wepublish

Docker-Image bauen und in die bestehende OpenShift/Helm-Infrastruktur deployen. Eigene Auth-Schicht (SSO, OIDC) ergänzen und Token serverseitig halten (siehe Hinweis oben).
