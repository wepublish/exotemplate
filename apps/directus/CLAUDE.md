# one-directus — AI Agent Instructions

## Project Overview

This is the **We.Publish ONE** backend — a Directus 11 headless CMS instance customized for billing and client management in the We.Publish media network. It manages clients, billing periods, time entries, and invoices. It integrates with Clockodo (time tracking), Jira (issue estimation), and Bexio (invoicing).

## Technology Stack

| Layer           | Technology                                       |
| --------------- | ------------------------------------------------ |
| CMS Platform    | Directus 11.13.4                                 |
| Language        | TypeScript (strict)                              |
| Database        | PostgreSQL 14.x with PostGIS 3.3                 |
| Schema Sync     | directus-sync (^3.4.1) + directus-extension-sync |
| Invoicing       | bexio (^3.5.0)                                   |
| Package Manager | npm                                              |
| Node.js         | <22.0.0                                          |

## Architecture

### Folder Structure

```
extensions/wepublish/src/        # Custom Directus extensions bundle
├── DirectusTypes.ts              # TypeScript interfaces for all collections
├── aggregatedHours/              # REST endpoint: billing data aggregation
│   └── index.ts                  # Fetches Clockodo + Jira data, computes billability
├── invoice-with-topup/           # REST endpoint: Bexio invoice creation
│   └── index.ts
└── peering-articles/             # Operation: fetches articles from peer We.Publish APIs
    └── api.ts                    # GraphQL queries to peer media organisations

schema/snapshot/                  # directus-sync managed schema (version-controlled)
├── collections/                  # Collection definitions
├── fields/                       # Field definitions per collection
├── relations/                    # Relationship definitions
└── specs/

migrations/                       # Database migrations (Directus Knex migrations)
docker/
├── entrypoint.sh                 # Container startup: runs migrations + schema sync
└── ca.crt                        # SSL certificate for DB
templates/                        # Email templates
uploads/                          # Local file storage (dev)
```

### Data Model

All TypeScript interfaces are defined in [extensions/wepublish/src/DirectusTypes.ts](extensions/wepublish/src/DirectusTypes.ts):

| Collection               | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `Clients`                | Media organisations. Holds Clockodo, Jira, Bexio IDs/configs.   |
| `Periods`                | Billing periods with from/to dates.                             |
| `Clients_Periods`        | Junction table: links clients to periods. Has `bexioInvoiceId`. |
| `TopUps`                 | Budget/payment entries for a client-period.                     |
| `ManualWorkEntries`      | Manually logged billable hours.                                 |
| `PeerArticles`           | Articles pulled from peer We.Publish media APIs.                |
| `Clients_directus_users` | Access control: which users can see which clients.              |

All collections follow Directus conventions: `status` (published/draft/archived), `sort`, `date_created`, `date_updated`, `user_created`, `user_updated`.

### Custom Extensions

Extensions are bundled under `extensions/wepublish/` and built with `npm run build:extensions`.

**`aggregatedHours` endpoint** ([extensions/wepublish/src/aggregatedHours/index.ts](extensions/wepublish/src/aggregatedHours/index.ts)):

- `GET /aggregatedHours?clientPeriodId=<id>`
- Validates user permissions (must have access to the requested client).
- Fetches billable hours from Clockodo API.
- Decorates with Jira issue estimates.
- Calculates billability (direct vs. partial client responsibility).
- Returns aggregated sums and percentages.

**`invoice-with-topup` endpoint** ([extensions/wepublish/src/invoice-with-topup/index.ts](extensions/wepublish/src/invoice-with-topup/index.ts)):

- `POST /invoice-with-topup`
- Creates an invoice in Bexio and stores `bexioInvoiceId` on the TopUp record.

**`peering-articles` operation** ([extensions/wepublish/src/peering-articles/api.ts](extensions/wepublish/src/peering-articles/api.ts)):

- Scheduled operation that queries peer We.Publish media GraphQL APIs.
- Upserts fetched articles into the `PeerArticles` collection.

## Code Style & Conventions

- **Formatter**: Prettier — no semicolons, single quotes, no trailing commas, 2-space indent.
- **Pre-commit**: Husky + lint-staged runs Prettier on all staged files.
- **TypeScript**: Strict mode — `strict: true`, `noImplicitAny`, `noUnusedLocals`, `strictNullChecks`.
- **No ESLint** — Prettier only.
- Format on save is enabled via `.vscode/settings.json`.

## Key Commands

```bash
npm run setup              # Copy .env.example → .env and install dependencies
npm run db:start           # Start PostgreSQL via Docker Compose
npm run db:reset           # Reset database (destructive)
npm run directus:init      # Bootstrap Directus (first-time setup)
npm run directus:start     # Start Directus server (http://localhost:8055)
npm run dev                # Start DB + Directus together
npm run build:extensions   # Build the custom extension bundle
npm run schema:dump        # Export current schema to schema/snapshot/
npm run schema:load        # Apply schema from snapshot to DB
npm run database:migrate   # Run pending database migrations
npm run lint               # Format code with Prettier
```

## Schema Management

Schema is version-controlled via **directus-sync**. After any schema change in the Directus admin:

1. Run `npm run schema:dump` to export the updated schema.
2. Commit the changed files in `schema/snapshot/`.
3. On deployment, `entrypoint.sh` automatically runs `schema:load` and `database:migrate`.

Never edit files in `schema/snapshot/` manually — always export from a running Directus instance.

## Environment Variables

See [.env.example](.env.example) for all variables. Key ones:

```env
# Database
DB_HOST, DB_PORT, DB_DATABASE, DB_USER, DB_PASSWORD

# Directus security
KEY=<random-secret>
SECRET=<random-secret>

# Third-party API credentials
CLOCKODO_USER, CLOCKODO_API_KEY
JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN
BEXIO_API_KEY

# Auth token TTL
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d

# Storage (dev: local, prod: S3)
STORAGE_LOCAL_ROOT=./uploads
```

## Frontend Integration

The frontend ([one-front](../one-front/)) connects to this backend at port 8055:

- Uses the **Directus SDK** for all standard collection CRUD and authentication.
- Calls custom endpoints `/aggregatedHours` and `/invoice-with-topup`.
- CORS is enabled; `PASSWORD_RESET_URL_ALLOW_LIST` includes `http://localhost:3000/auth/*`.

## Authentication

- Standard Directus JWT-based auth (access token 15m, refresh token 7d).
- Role-based: users are linked to specific clients via `Clients_directus_users`.
- Admin credentials for local dev: `admin@seccom.ch` / `admin` (see README).

## Testing

No formal test framework is configured.

## Deployment

- **Staging**: Auto-deploys on push to `main`. Docker image tagged `main-{timestamp}`.
- **Production**: Auto-deploys on Git tags matching `v*` (e.g. `v1.2.0`).
- Docker image: `node:22.22.0-trixie-slim`, exposes port 8055.
- On container start, `entrypoint.sh` runs migrations and schema sync before starting Directus.
- Images are pushed to GitHub Container Registry (`ghcr.io/wepublish/inside-backend`) and an OpenShift registry.

## Important Notes

- All schema changes **must** go through `schema:dump` — never hand-edit the snapshot files.
- The `extensions/wepublish/` bundle is a single Directus extension bundle; all custom endpoints and operations live there.
- GeoJSON types are defined in `DirectusTypes.ts` to support PostGIS fields.
- `EXTENSIONS_AUTO_RELOAD=true` is set in dev for hot-reloading extensions.
