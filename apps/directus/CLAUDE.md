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

| Collection               | Purpose                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Clients`                | Media organisations. Holds Clockodo, Jira, Bexio IDs/configs. `billing_mode` (`prepaid` default / `monthly`) drives both the weekly Slack report layout and the dashboard's "Verfügbare Arbeitsstunden" wording. |
| `Periods`                | Billing periods with from/to dates.                                                                                                                                                                              |
| `Clients_Periods`        | Junction table: links clients to periods. Has `bexioInvoiceId`.                                                                                                                                                  |
| `TopUps`                 | Budget/payment entries for a client-period.                                                                                                                                                                      |
| `ManualWorkEntries`      | Manually logged billable hours.                                                                                                                                                                                  |
| `PeerArticles`           | Articles pulled from peer We.Publish media APIs.                                                                                                                                                                 |
| `Clients_directus_users` | Access control: which users can see which clients.                                                                                                                                                               |
| `Settings`               | Singleton with global settings (currently `slack_time_tracking_channel_id` for the daily capture-reminder). Administrator-only; no explicit permission entries are needed since admin_access covers it.          |
| `CaptureIgnoredUsers`    | Per-row list of Clockodo `users_id` values that should be ignored by the Übersicht Zeiterfassung — no Slack reminder, dimmed + pinned-to-bottom in the UI. Managed from the frontend via standard Directus CRUD. |

All collections follow Directus conventions: `status` (published/draft/archived), `sort`, `date_created`, `date_updated`, `user_created`, `user_updated`.

### Custom Extensions

Extensions are bundled under `extensions/wepublish/` and built with `npm run build:extensions`.

**Always extend the existing `wepublish` bundle — do not create a new top-level extension.** All custom endpoints, hooks, operations, and shared helpers go inside `extensions/wepublish/src/`. Add a new sub-folder there (e.g. `extensions/wepublish/src/<feature>/`) and wire it into the bundle's entry point. This keeps a single build, a single deploy artifact, and one place to share helpers like the cache layer. Only spin up a separate extension package if the user explicitly asks for it.

**`aggregatedHours` endpoint** ([extensions/wepublish/src/aggregatedHours/index.ts](extensions/wepublish/src/aggregatedHours/index.ts)):

- `GET /aggregatedHours?clientPeriodId=<id>`
- Validates user permissions (must have access to the requested client).
- Fetches billable hours from Clockodo API.
- Decorates with Jira issue estimates.
- Calculates billability (direct vs. partial client responsibility).
- Returns `{ data: EntryGroupComputed, cache: { hit, cachedAt, expiresAt, ttlMs } }` — the wrapper exposes cache metadata so the dashboard can show users where the data came from.
- `DELETE /aggregatedHours/cache?clientPeriodId=<id>` — invalidates the single cached entry for that period. Authorization rides on the same `ItemsService.readOne` accountability check, so only users who can read the period can clear its cache.

**Caching layer** ([extensions/wepublish/src/shared/cache/](extensions/wepublish/src/shared/cache/)):

The Jira and Clockodo round-trips inside `aggregatedHours` are slow and rate-limited (429s under load). The endpoint result is cached in process memory per `(clientId, clientPeriodId)` pair.

- [`ttlCache.ts`](extensions/wepublish/src/shared/cache/ttlCache.ts) — generic TTL cache with single-flight deduplication. A thundering herd of dashboard loads collapses into one upstream call. Failures aren't cached — the inflight slot frees on rejection so the next caller retries.
- [`billingCache.ts`](extensions/wepublish/src/shared/cache/billingCache.ts) — billing-specific singleton. **TTL is configured in code via `BILLING_CACHE_TTL_MS`** (currently 1 hour) — no env var, no per-deployment override. Tune by editing the constant. `loadBillingResultWithMeta()` is the helper that probes for a cache hit, runs `getOrCompute`, and re-reads the entry to attach metadata to the response.
- Single-process, in-memory only. If we ever scale horizontally, swap `TtlCache`'s storage for Redis and keep the same surface.
- Tests: [`ttlCache.test.ts`](extensions/wepublish/src/shared/cache/ttlCache.test.ts), [`billingCache.test.ts`](extensions/wepublish/src/shared/cache/billingCache.test.ts) — cover TTL boundaries, single-flight, retry-after-failure, per-key isolation, and cache-meta hit/miss reporting.

**`networkContribution` endpoint** ([extensions/wepublish/src/networkContribution/index.ts](extensions/wepublish/src/networkContribution/index.ts)):

- `GET /networkContribution?clientPeriodId=<id>`
- Same authorization gate as `aggregatedHours` (ItemsService.readOne on the period).
- Returns network-wide work delivered during the period's date range — used by the dashboard's "Netzwerk-Beitrag" card to show clients the value they receive beyond direct billing. Two parallel Clockodo queries: we.share entries grouped by `services_id` (bucketed into Akquisition / Engineering / Hosting / Weiteres via the maps in [`shared/networkContribution/constants.ts`](extensions/wepublish/src/shared/networkContribution/constants.ts)), plus all customers grouped by `customers_id` summed for non-excluded clients.
- Cached per `clientPeriodId` only (not per client) since the figures are network-wide. Cache singleton lives in [`shared/cache/networkContributionCache.ts`](extensions/wepublish/src/shared/cache/networkContributionCache.ts), 1-hour TTL.
- Pinned IDs (we.share customer, excluded customers, service buckets) are hardcoded in `constants.ts` to mirror the `JIRA_ISSUE_GROUP_ID` precedent — Clockodo is shared across environments. Lift them to env vars only if we ever fan out per-environment workspaces.
- `DELETE /networkContribution/cache?clientPeriodId=<id>` — same invalidate-then-refetch pattern as `aggregatedHours`.

**`invoice-with-topup` endpoint** ([extensions/wepublish/src/invoice-with-topup/index.ts](extensions/wepublish/src/invoice-with-topup/index.ts)):

- `POST /invoice-with-topup`
- Creates an invoice in Bexio and stores `bexioInvoiceId` on the TopUp record.

**`peering-articles` operation** ([extensions/wepublish/src/peering-articles/api.ts](extensions/wepublish/src/peering-articles/api.ts)):

- Scheduled operation that queries peer We.Publish media GraphQL APIs.
- Upserts fetched articles into the `PeerArticles` collection.

**`time-tracking` endpoint** ([extensions/wepublish/src/time-tracking/index.ts](extensions/wepublish/src/time-tracking/index.ts)):

Serves the "Übersicht Zeiterfassung" admin page.

- `GET /time-tracking/missing-hours?from=YYYY-MM-DD&to=YYYY-MM-DD` — per-employee day-by-day capture status across the requested range. Defaults to the last 7 days ending yesterday when params are omitted. Each row carries `ignored` + `ignoredRecordId` for the front-end's bell toggle.
- Admin-only: gates on `accountability.admin === true` (in addition to `accountability.user`). Non-admins get a 403 even if they're authenticated.
- Pure logic lives in [`shared/capture-overview/missingHours.ts`](extensions/wepublish/src/shared/capture-overview/missingHours.ts) — fully unit-tested. The endpoint just wires Clockodo wrappers + caches + the `CaptureIgnoredUsers` join into that function and adds the `{ data, range, cache }` envelope.
- `DELETE /time-tracking/missing-hours/cache?from=…&to=…` — invalidates the user-daily-hours cache entry for that exact range so the dashboard's refresh button can force-pull Clockodo. The users / absences / target-hours / non-business-days caches are left alone — they change rarely enough that an extra hour of staleness is fine.

**`daily-capture-reminder` operation** ([extensions/wepublish/src/daily-capture-reminder/api.ts](extensions/wepublish/src/daily-capture-reminder/api.ts)):

- Reads `Settings.slack_time_tracking_channel_id`, computes the reference date (yesterday, or the previous Friday on Monday/weekend runs), figures out who didn't capture, and posts a friendly German reminder to Slack. Skips the post entirely when nobody is missing — no daily "all clear" spam. Ignored users (`CaptureIgnoredUsers`) are filtered out _before_ the missing check; their absence from the reminder is silent.
- Designed to be wired to a Directus Flow with a `0 45 8 * * *` schedule (08:45 daily). The Flow itself is set up in the admin UI; the operation is the registered handler.
- Slack tone is intentionally friendly + lightly funny (`shared/capture-overview/composeReminderMessage.ts`), with a date-deterministic opener rotation so the message varies day-to-day but is reproducible in tests. Resolves Slack user IDs via `users.lookupByEmail` when possible for personal mentions, falls back to plain names otherwise.

**Clockodo wrappers** ([extensions/wepublish/src/shared/clockodo/](extensions/wepublish/src/shared/clockodo/)):

The original `shared/billing/clockodo.ts` is the entry-groups-by-customer client. The newer `shared/clockodo/` directory holds the time-tracking-side wrappers — users, absences, per-user daily hours, target hours, and non-business days — plus a shared `headers.ts` helper that all of them share. Each Clockodo wrapper is paired with a cache singleton under `shared/cache/`:

- `clockodoUsersCache.ts` — TTL 1 h, key `'all'`
- `clockodoAbsencesCache.ts` — TTL 1 h, key per year
- `clockodoUserDailyHoursCache.ts` — TTL 15 min, key `${fromIso}:${toIso}`
- `clockodoTargetHoursCache.ts` — TTL 1 h, key `'all'`
- `clockodoNonBusinessDaysCache.ts` — TTL 1 h, key per year

The shorter TTL on daily hours matters: that's the data the dashboard wants to feel current. If someone catches up on capturing after being flagged, they should see themselves go green within the quarter hour.

**Clockodo gotchas**:

1. **Target hours**: `/v2/users` does **not** expose `weekly_target_hours` — that field doesn't exist there. The per-user weekly target lives on `/api/targethours/` (Clockodo's older v1 surface), as date-bounded rows with per-weekday columns (`monday`..`sunday`) for weekly contracts and a `monthly_target` + workday flags for monthly contracts. [`shared/capture-overview/missingHours.ts`](extensions/wepublish/src/shared/capture-overview/missingHours.ts) reads per-day expectations from the row whose `[date_since, date_until]` window covers the date in question, so part-time contracts with day-specific hours (e.g. M=8, T=8, W=0, Th=8, F=0) compute correctly — a 0-hour weekday becomes status `off`, not `missing`. Users without an active target-hours row that intersects the requested range are excluded entirely (freelancers, system accounts).
2. **Public holidays**: live on `/api/nonbusinessdays/` (v1 surface again), keyed per year. Each row has a `nonbusinessgroups_id`; each user has one too (from `/v2/users`). A user on a workday that's a full-day holiday in their group gets status `holiday` (no expectation). Half-day holidays (`half_day === 1`) halve the day's expected hours and keep the row in the captured/partial/missing flow so a no-show morning still surfaces.
3. **`entrygroups` response shape**: uses **snake_case** (`sub_groups`, not `subGroups`) and reports work as **seconds** in `duration` — there is no `hours` field. Mixing those up silently returns 0 for every (user, day) pair. The wrapper at [`shared/clockodo/userDailyHours.ts`](extensions/wepublish/src/shared/clockodo/userDailyHours.ts) has a regression test.
4. **`time_until` is exclusive at midnight**: passing `to=2026-05-27` formatted as `2026-05-27T00:00:00Z` excludes everything logged on the 27th. The userDailyHours wrapper advances `time_until` by one calendar day so the requested last day is fully included.

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

Schema is version-controlled via **directus-sync**. `schema/snapshot/` is the databases serialized form.

**Workflow for any schema change** (whether edited in the Directus admin UI or anywhere else):

1. `npm run schema:load` — apply the change to the running DB. This must happen before dumping; the dump reflects whatever is currently in the DB.
2. `npm run schema:dump` — re-export from the live DB so `schema/snapshot/` exactly matches what's actually deployed (including DB-assigned IDs, ordering, and other auto-populated fields).
3. Review the resulting diff in `schema/snapshot/` and commit it together with the code change that depends on it.

On deployment, `entrypoint.sh` automatically runs `schema:load` and `database:migrate`, so what's in `schema/snapshot/` is what production will get.

Never edit files in `schema/snapshot/` manually — always go through `schema:load` then `schema:dump` so the snapshot is grounded in real DB state.

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

**Vitest is configured for the custom extensions bundle** (`extensions/wepublish/`). Run from that directory:

```bash
npm run test          # one-shot
npm run test:watch    # watch mode
```

Existing suites cover the cache layer ([ttlCache.test.ts](extensions/wepublish/src/shared/cache/ttlCache.test.ts), [billingCache.test.ts](extensions/wepublish/src/shared/cache/billingCache.test.ts)), billing aggregation ([aggregateHours.test.ts](extensions/wepublish/src/shared/billing/aggregateHours.test.ts)), notification thresholds and message composition, and weekly-report progress logic.

**Write tests by default** for new logic in the extensions bundle — domain rules, computations, parsers, anything pure or with mockable boundaries. Co-locate `*.test.ts` next to the file under test, matching the existing pattern. Skip tests only with a concrete reason: thin glue to Directus services that's not meaningfully testable in isolation, one-off scripts, or trivial passthroughs.

The Directus app layer itself (schema, migrations, hooks wired into the framework) has no unit-test setup — those are validated by running the system. Don't invent a test framework for them without asking.

## Deployment

- **Staging**: Auto-deploys on push to `main`. Docker image tagged `main-{timestamp}`.
- **Production**: Auto-deploys on Git tags matching `v*` (e.g. `v1.2.0`).
- Docker image: `node:22.22.0-trixie-slim`, exposes port 8055.
- On container start, `entrypoint.sh` runs migrations and schema sync before starting Directus.
- Images are pushed to GitHub Container Registry (`ghcr.io/wepublish/inside-backend`) and an OpenShift registry.

## Important Notes

- All schema changes **must** go through `schema:load` → `schema:dump` (in that order). The dump must come from a real DB to capture auto-populated values correctly.
- The `extensions/wepublish/` bundle is the single Directus extension bundle; **always extend it rather than creating a new extension package**. All custom endpoints, hooks, operations, and shared helpers live there.
- GeoJSON types are defined in `DirectusTypes.ts` to support PostGIS fields.
- `EXTENSIONS_AUTO_RELOAD=true` is set in dev for hot-reloading extensions.
- **Keep this CLAUDE.md current**: when a change adds/removes an endpoint, collection, command, env var, integration, or convention — or invalidates something written here — update this file in the same change. Skip the update for routine bug fixes, refactors that don't change shape, dep bumps, and anything obvious from reading the code.
