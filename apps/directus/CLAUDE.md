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

| Collection               | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Clients`                | Media organisations. Holds Clockodo, Jira, Bexio IDs/configs. `billing_mode` (`prepaid` default / `monthly`) drives both the weekly Slack report layout and the dashboard's "Verfügbare Arbeitsstunden" wording. `language` (`de` default / `fr` / `en`) drives the language of this project's **client-facing** Slack messages. Client users can set `language` (and the notification toggles) themselves — these fields are in the client policy's read+update permission lists. The dashboard quick-links tile adds two more client-editable fields: `editor_url` / `website_url` (overrides for the derived editor/website links; empty = derive from `apiUrl`), both in the client policy's `Clients` update allowlist. Custom dashboard links are **not** a field here — they live in the dedicated `ClientLinks` collection (O2M `links`). |
| `Periods`                | Billing periods with from/to dates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Clients_Periods`        | Junction table: links clients to periods. Has `bexioInvoiceId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `TopUps`                 | Budget/payment entries for a client-period. **Hour-counting**: every `TopUp` is summed into the client's available hours.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Invoices`               | Order-backed invoices (currently the recurring **hosting** type; `type` field discriminates future kinds). A **separate** collection from `TopUps` and **deliberately excluded from the available-hours calculation** — `aggregatedHours` only ever fetches `topUps`, never `invoices` (guard test in `aggregateHours.test.ts`). Carries `bexioOrderId` (the recurring Auftrag) + `bexioInvoiceId` (the first invoice), `unitPrice`/`quantity`/`billedUnits`, `periodicity`, `amount`. Client-readable, scoped like `TopUps`. (We.Share % lives only on `TopUps`, not here.)                                                                                                                                                                                                                                                                      |
| `ManualWorkEntries`      | Manually logged billable hours.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PeerArticles`           | Articles pulled from peer We.Publish media APIs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Clients_directus_users` | Access control: which users can see which clients.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Settings`               | Singleton with global settings: `slack_time_tracking_channel_id` (daily capture-reminder channel, admin-only) and `slack_we_share_channel_id` (network-wide #we-share channel linked from every client's dashboard quick-links tile). The Client policy has a **read** permission on `Settings` scoped to `id` + `slack_we_share_channel_id` so client-role users can resolve the #we-share link; everything else stays admin-only via admin_access.                                                                                                                                                                                                                                                                                                                                                                                              |
| `CaptureIgnoredUsers`    | Per-row list of Clockodo `users_id` values that should be ignored by the Übersicht Zeiterfassung — no Slack reminder, dimmed + pinned-to-bottom in the UI. Managed from the frontend via standard Directus CRUD.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `BillingSnapshots`       | System-managed: one row per `Clients_Periods` carrying the most recent budget sums (`totalUsedHours`, `totalTopUps`, `totalUsedPercentage`, …) plus `computedAt` / `lastError` / `lastErrorAt`. Feeds the `/overview` admin page without hitting Clockodo + Jira on every load. Written by the `billing-snapshot-refresh` operation and as a side-effect of `/aggregatedHours` cache misses.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Contracts`              | Client contracts, versioned per client (M2O `client` → `Clients`, `version` integer). Each row is an uploaded **PDF** (`file` → `directus_files`) with a `signed` boolean + `signed_at`. The **latest** non-archived `version` is the one "in effect". PDFs live in the dedicated `contracts` `directus_folders` folder. Clients read their own contract rows (scoped by `client.allowedUsers`) and download the files via Directus' native `/assets/:id` (Client policy `directus_files` read is scoped to `folder.name = "contracts"`). Uploads go through `POST /contracts`.                                                                                                                                                                                                                                                                   |
| `ClientLinks`            | Custom dashboard quick-access links per client (M2O `client` → `Clients`; O2M back-reference `Clients.links`). Structured rows (`label`, `url`, `description`, `sort`, `status`) — replaced an earlier `Clients.custom_links` JSON field. Client-policy **CRUD** scoped by `client.allowedUsers == $CURRENT_USER`, so the client team and admins add/edit/remove their own links; surfaced on the dashboard quick-links tile (`one-front`).                                                                                                                                                                                                                                                                                                                                                                                                       |

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

**`clientsOverview` endpoint** ([extensions/wepublish/src/clientsOverview/index.ts](extensions/wepublish/src/clientsOverview/index.ts)):

- `GET /clientsOverview` — admin-only (`accountability.admin === true`). Returns one entry per currently-active `Clients_Periods` with the persisted `BillingSnapshots` sums + freshness metadata. Reads from Postgres only, no upstream Clockodo / Jira calls — this is what makes the frontend's `/overview` tile grid load in O(milliseconds) even with dozens of clients. Tiles without a snapshot row yet are returned with `pending: true` and trigger a fire-and-forget background fill.
- `POST /clientsOverview/refresh?clientPeriodId=<id>` — admin-only; invalidates the in-memory `billingCache` entry, recomputes via `computeClientPeriodBilling`, and upserts the `BillingSnapshots` row. Powers the per-tile refresh button on the frontend.

**`billing-snapshot-refresh` operation** ([extensions/wepublish/src/billing-snapshot-refresh/api.ts](extensions/wepublish/src/billing-snapshot-refresh/api.ts)):

- Scheduled keeper of the `BillingSnapshots` table. Walks every published `Clients` row, finds the currently-active `Clients_Periods` via the shared [`findCurrentClientPeriod`](extensions/wepublish/src/shared/clientPeriods.ts) helper, computes billing, and upserts a snapshot. Runs with bounded concurrency (3 workers by default, see [`shared/concurrency.ts`](extensions/wepublish/src/shared/concurrency.ts)) to stay under Clockodo's rate limit; per-client failures are swallowed into the snapshot row's `lastError` so one bad client never breaks the rest of the batch.
- Designed to be wired into a Directus Flow on a `0 */30 * * * *` schedule (every 30 min). The Flow itself is created in the admin UI; only the operation is registered as code.
- The shared snapshot helpers in [`shared/billing/snapshot.ts`](extensions/wepublish/src/shared/billing/snapshot.ts) are also called from `/aggregatedHours` (on cache miss) and `/clientsOverview/refresh`, so anything that recomputes billing automatically keeps the snapshot warm.

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

**`recurring-invoice` endpoint** ([extensions/wepublish/src/recurring-invoice/index.ts](extensions/wepublish/src/recurring-invoice/index.ts)):

- `POST /recurring-invoice` — **admin-only**. The third billing type ("hosting"). Creates a **recurring** Bexio order (`kb_order`), attaches a yearly `repetition`, derives a first invoice billing only the remaining months (manual `billedUnits`, e.g. 7 of 12), and stores the result in the `Invoices` collection (NOT `TopUps`). Returns `{ bexioOrder, bexioInvoice, invoiceId }`. The order/invoice payloads are built by the shared Bexio adapter below.

**`bexio-invoice-status` endpoint** ([extensions/wepublish/src/bexio-invoice-status/index.ts](extensions/wepublish/src/bexio-invoice-status/index.ts)):

- `GET /bexio-invoice-status?ids=1,2,3&orderIds=4,5` — per invoice id returns the live Bexio status (`draft|pending|paid|partial|canceled|unpaid|unknown`), the public `networkLink` (Bexio `network.bexio.com` URL — login-free, shown to client-role users), and the **`dueDate`** ("zahlbar bis" / `is_valid_to`, shown in the Top-Ups date column); per order id returns the order's public `networkLink`. Powers the Top-Ups page status badges and the customer-facing invoice/order links. Cached per id (~10 min, [`shared/cache/bexioInvoiceStatusCache.ts`](extensions/wepublish/src/shared/cache/bexioInvoiceStatusCache.ts) for invoices, [`bexioOrderLinkCache.ts`](extensions/wepublish/src/shared/cache/bexioOrderLinkCache.ts) for orders); a single failing id resolves to `unknown`/`null` rather than failing the batch. `networkLink` is null unless a document has been shared via the Bexio network — so for the reliable login-free view, two PDF-proxy routes exist: `GET /bexio-invoice-status/invoice/:id/pdf` and `/order/:id/pdf` fetch the document PDF with our Bexio token (`GET /2.0/kb_(invoice|order)/{id}/pdf`, which returns base64 JSON) and return `{ name, mime, base64 }`. The frontend opens that as a blob, so a client views the actual invoice without a Bexio login.

**Shared Bexio adapter** ([extensions/wepublish/src/shared/bexio/](extensions/wepublish/src/shared/bexio/)):

The `bexio` npm SDK cannot express recurring orders, order `repetition`, "create invoice from order", or an invoice-status fetch. This thin `fetch`-based adapter (`client.ts`, base `https://api.bexio.com`, Bearer auth — mirrors the SDK's own `BaseCrud.request`) covers those gaps:

- `orders.ts` — `createOrder` / `createOrderRepetition` / `createInvoiceFromOrder` plus the **pure, unit-tested** payload builders `buildHostingOrderPayload`, `buildOrderRepetitionPayload`, `buildOrderInvoicePayload`.
- `invoiceStatus.ts` — `getInvoiceStatus` + pure `mapBexioInvoiceStatus` (maps `kb_item_status_id`).
- `constants.ts` — the shared Bexio org IDs (`BEXIO_USER_ID`/`BEXIO_MWST_ID`/`BEXIO_UNIT_ID`/`BEXIO_ACCOUNT_ID`) previously inlined in `invoice-with-topup`.

> **Live-verification note**: the exact `repetition` and order→invoice payload shapes come from Bexio docs/community clients, not a live call (no Bexio creds in dev). They're isolated in the builders above so adjusting after a real Bexio test is a one-spot change. Contingency if the order→invoice partial-amount override misbehaves: create the order for the full quantity (Bexio drives future yearly invoices) and create the first invoice via the SDK `invoices.create()` for `billedUnits × unitPrice (+VAT)`.

**`contracts` endpoint** ([extensions/wepublish/src/contracts/index.ts](extensions/wepublish/src/contracts/index.ts)):

Upload + versioning for the `Contracts` collection. **No generation, no Google** — a contract is just an uploaded PDF. One custom route:

- `POST /contracts` — body `{ clientId, fileBase64, fileName?, signed?, notes? }`. Validates a `%PDF-` payload, uploads it into the `contracts` folder, and creates the next per-client `version` (the one now "in effect"). `signed` defaults to **true** (the common case is uploading the already-signed contract); pass `signed: false` for a draft awaiting signature. Access is checked under the caller's accountability (`ItemsService('Clients').readOne` — admins via `admin_access`, client users via `allowedUsers`), so **both an admin and the client can upload** for that client. The file write + row create then run as **system** so client users need no file-create / item-create permission.

Listing and downloading use the **native SDK + `/assets/:id`**, not custom routes: clients read their own `Contracts` rows (Client-policy read scoped by `client.allowedUsers`) and the file bytes via Directus' native asset endpoint (Client-policy `directus_files` read scoped to `folder.name = "contracts"`). Pure helpers (`nextContractVersion`, `buildContractFileName`, `currentContract`, `currentContractNeedsSignature`) live in [`contracts/helpers.ts`](extensions/wepublish/src/contracts/helpers.ts); `currentContractNeedsSignature` is reused by `/clientsOverview` to set `contractWarning` per tile (true only when a contract exists **and** its latest version is unsigned).

**`team` endpoint** ([extensions/wepublish/src/team/index.ts](extensions/wepublish/src/team/index.ts)):

A single custom route, `POST /team/invite`, that provisions client access from the frontend so clients never need the Directus admin app. Used by the self-service "Team" page and the onboarding wizard in one-front. Pure decisions (authorize / invite-vs-grant / which junction rows are missing) live in [`team/inviteLogic.ts`](extensions/wepublish/src/team/inviteLogic.ts) and are unit-tested ([`inviteLogic.test.ts`](extensions/wepublish/src/team/inviteLogic.test.ts)).

`POST /team/invite` — body `{ email, firstName?, lastName?, clientIds: string[], inviteUrl?, sendInvite?, returnInviteUrl? }`. Looks the user up by email (case-insensitive, via `UsersService.getUserByEmail`):

- **new email** → `UsersService.inviteUser(email, <Client role>, inviteUrl, subject)` (status `invited` + Directus' native invite mail). `sendInvite: false` creates the user **without** mailing.
- **existing `invited`** → re-sends the invite (or, with `sendInvite:false`, just relinks).
- **existing `active`** → grants access only + a plain "you now have access" notice (Directus' `inviteUser` is a silent no-op for active users).
- Always ensures the `Clients_directus_users` junction rows exist (idempotent). Returns `{ status, userId, grantedClientIds, acceptInviteUrl? }`.
- **`returnInviteUrl: true`** (admin-only, invited users only) returns `acceptInviteUrl` — the tokenized `/auth/accept-invite?token=…` link generated via `UsersService.inviteUrl` from an **allow-listed** base (`USER_INVITE_URL_ALLOW_LIST`). The onboarding wizard embeds this link in its welcome mail instead of sending a separate invite. It's admin-gated because handing the token to a non-admin inviter would let them activate the invitee's account themselves.

**Why only one route?** Listing members and revoking access are **not** custom endpoints — the frontend does them directly with the `@directus/sdk` against `Clients_directus_users`, governed by the **Client policy's row-level permissions** (see below). Only `invite` needs server-side elevation: it must look an email up across _all_ users (clients can't read users they don't already share a client with), force the Client role, and link users after authorizing the caller — none of which the permission system can safely express on its own.

**Authorization model**: requires `accountability.user`. Admins may target any client; non-admins are authorized per requested client by reading `Clients_directus_users` filtered on their **JWT-verified** user id (never trusting request-body identity). Privileged writes then run with a **system** service (`new services.UsersService({ schema })` / `ItemsService(col, { schema })`, no accountability ⇒ unrestricted). New users are always forced to the **Client** role; existing users are never re-roled. URLs are only ever used from the allow-lists, never trusted blindly. Requires a working email transport to deliver mail.

**Client-policy permissions for native team management** (in [schema/collections/permissions.json](schema/collections/permissions.json), applied via `npm run schema:load` = `directus-sync push`):

- `Clients_directus_users` **read** filter widened to `Clients_id.allowedUsers.directus_users_id = $CURRENT_USER` (see all members of clients you belong to, not just your own row).
- `Clients_directus_users` **delete** added with the same filter (revoke a member's access to a client you belong to).
- `directus_users` **read** widened to `id = $CURRENT_USER` **or** a user who shares one of your clients, and `status` added to readable fields (so the member list can show name/email/status).
  These are the only client permission changes; everything else still flows through `/team/invite`.

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

**Slack message localization** ([extensions/wepublish/src/shared/i18n/](extensions/wepublish/src/shared/i18n/)):

**Client-facing** Slack messages are localized to the project's `Clients.language` (German default, French, English). The shared module holds:

- [`locale.ts`](extensions/wepublish/src/shared/i18n/locale.ts) — `SlackLocale`, `resolveClientLocale(client.language)` (prefix match, German fallback), and `createSlackFormatters(locale)` (Swiss `Intl` tags: de→`de-CH`, fr→`fr-CH`, en→`en-GB`).
- [`weeklyReportCopy.ts`](extensions/wepublish/src/shared/i18n/weeklyReportCopy.ts) and [`notificationsCopy.ts`](extensions/wepublish/src/shared/i18n/notificationsCopy.ts) — per-locale message catalogs (`Record<SlackLocale, …>`). German is the source of truth; keep all three locales in sync.

The composers take a `locale` param (default `'de'`): `composeWeeklyReportMessage(input, clientPeriodId, locale)`, `composeWarningMessage(input, locale)`, `composeHaltRequestedMessage`/`composeHaltResolvedMessage(input, locale)`. Callers resolve the locale from the client and pass it: [`weekly-report/api.ts`](extensions/wepublish/src/weekly-report/api.ts), [`jira-threshold-notifier/api.ts`](extensions/wepublish/src/jira-threshold-notifier/api.ts) (both fetch `language` in the `Clients` query), and [`jira-halt-notifier/index.ts`](extensions/wepublish/src/jira-halt-notifier/index.ts).

**Internal/staff messages stay German** and do NOT take a locale: the over-budget **finance escalation** (`composeGermanOverBudgetEscalationMessage`, → controlling channel), the **assignee halt DM** (`composeGermanHaltRequestedDmMessage`, → the We.Publish employee), and the **daily capture reminder**. When adding a new Slack message, decide whether it is client-facing (localize via `shared/i18n/`) or internal (keep German).

**Clockodo wrappers** ([extensions/wepublish/src/shared/clockodo/](extensions/wepublish/src/shared/clockodo/)):

The original `shared/billing/clockodo.ts` is the entry-groups-by-customer client. The newer `shared/clockodo/` directory holds the time-tracking-side wrappers — users, absences, per-user daily hours, target hours, and non-business days — plus a shared `headers.ts` helper that all of them share. Each Clockodo wrapper is paired with a cache singleton under `shared/cache/`:

- `clockodoUsersCache.ts` — TTL 1 h, key `'all'`
- `clockodoAbsencesCache.ts` — TTL 1 h, key per year
- `clockodoUserDailyHoursCache.ts` — TTL 15 min, key `${fromIso}:${toIso}`
- `clockodoTargetHoursCache.ts` — TTL 1 h, key `'all'`
- `clockodoNonBusinessDaysCache.ts` — TTL 1 h, key per year

The shorter TTL on daily hours matters: that's the data the dashboard wants to feel current. If someone catches up on capturing after being flagged, they should see themselves go green within the quarter hour.

**Clockodo API versions** (Clockodo removed legacy endpoint versions starting 2026-05-01 — old versions return **HTTP 410 Gone**, so pin each call to the version below; see <https://docs.clockodo.com/> for the current spec):

| Resource          | Endpoint in use                                 | Notes                                                                                             |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| absences          | `GET /api/v4/absences`                          | year via `filter[year]=…`; rows under `data`. (was `/api/v2/absences?year=`, returned `absences`) |
| users             | `GET /api/v3/users`                             | paginated — `{ paging, data }`; pass `items_per_page=1000`. (was `/api/v2/users`)                 |
| non-business days | `GET /api/v2/nonbusinessDays`                   | rows under `data`; fields renamed (see gotcha 2). (was `/api/nonbusinessdays`)                    |
| customers         | `GET /api/v3/customers[/{id}]`                  | paginated; single resource under `data`. (was `/api/v2/customers`) — onboarding only              |
| entry groups      | `GET /api/v2/entrygroups`                       | **not** deprecated — still current                                                                |
| target hours      | `GET /api/targethours/`                         | **not** deprecated — unversioned, still current                                                   |
| add-on sync       | `PUT /api/v2/addOns/billService/customers/sync` | not part of the versioned resource API — stays on v2                                              |

The `shared/clockodo/` wrappers normalise each new payload back into stable internal interfaces, so `missingHours.ts` and its tests never see the API field renames.

**Clockodo gotchas**:

1. **Target hours**: `/api/v3/users` does **not** expose `weekly_target_hours` — that field doesn't exist there. The per-user weekly target lives on `/api/targethours/` (Clockodo's unversioned surface), as date-bounded rows with per-weekday columns (`monday`..`sunday`) for weekly contracts and a `monthly_target` + workday flags for monthly contracts. [`shared/capture-overview/missingHours.ts`](extensions/wepublish/src/shared/capture-overview/missingHours.ts) reads per-day expectations from the row whose `[date_since, date_until]` window covers the date in question, so part-time contracts with day-specific hours (e.g. M=8, T=8, W=0, Th=8, F=0) compute correctly — a 0-hour weekday becomes status `off`, not `missing`. Users without an active target-hours row that intersects the requested range are excluded entirely (freelancers, system accounts).
2. **Public holidays**: live on `/api/v2/nonbusinessDays`, keyed per year. v2 renamed fields vs. the old v1 surface — `evaluated_date` (was `date`), `half_day` is now a **boolean** (was 0/1), and `nonbusiness_group_id` (was `nonbusinessgroups_id`); the wrapper maps them back to the legacy names. Each user's group comes from `/api/v3/users` (`nonbusiness_groups_id`, falling back to the deprecated `nonbusinessgroups_id`). A user on a workday that's a full-day holiday in their group gets status `holiday` (no expectation). Half-day holidays (normalised to `half_day === 1`) halve the day's expected hours and keep the row in the captured/partial/missing flow so a no-show morning still surfaces.
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

**Model data as structured columns and dedicated collections, never JSON blobs.** A list of structured records (anything with more than one property, or that users add/edit/remove individually) gets its **own collection** with a M2O relation to its parent — mirror the `Contracts` / `ClientLinks` per-client child pattern (M2O `client` → `Clients`, with Client-policy CRUD scoped by `client.allowedUsers == $CURRENT_USER`) — so the data is queryable, permission-scoped per field/row, and migration-friendly. A `json` column is acceptable only for a genuinely opaque/freeform blob with no per-element querying or permissions (e.g. `onboarding_manual_checklist`, a list of plain string ids). When in doubt, make a collection.

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

# Frontend URLs the password-reset / invite mails may link to (Directus only
# honours URLs on these allow-lists). Both point at one-front's /auth/* pages.
PASSWORD_RESET_URL_ALLOW_LIST=http://localhost:3000/auth/set-new-password
USER_INVITE_URL_ALLOW_LIST=http://localhost:3000/auth/accept-invite

# Storage (dev: local, prod: S3)
STORAGE_LOCAL_ROOT=./uploads
```

## Frontend Integration

The frontend ([one-front](../front/)) connects to this backend at port 8055:

- Uses the **Directus SDK** for all standard collection CRUD and authentication.
- Calls custom endpoints `/aggregatedHours`, `/invoice-with-topup`, `/recurring-invoice`, `/bexio-invoice-status`, and `/team`.
- CORS is enabled; `PASSWORD_RESET_URL_ALLOW_LIST` / `USER_INVITE_URL_ALLOW_LIST` point at one-front's `/auth/*` pages.

## Authentication

- Standard Directus JWT-based auth (access token 15m, refresh token 7d).
- **Two roles**: `Administrator` (admin/app access) and `Client` (`app_access: false` — no Directus admin app, but can authenticate against the API, which is all one-front needs). Onboarded media users and self-service teammates are always **Client** role.
- Row-level access (Client role): a Client-role user sees a client only if a `Clients_directus_users` junction row links them — enforced by the Client policy's `allowedUsers == $CURRENT_USER` read filter on `Clients`. **Administrators are not junction-scoped**: `admin_access: true` bypasses the row filter, so any Administrator-role user automatically sees/manages every client without being added to any `allowedUsers`. The frontend relies on exactly this (it lists clients via `readItems('Clients')` and lets permissions scope the result), so to give a new person access to all clients, give them a user with the **Administrator** role — no junction wiring needed. The frontend never writes users/junctions directly for other people — it goes through the `/team` endpoint, which authorizes the caller then performs the privileged writes with a system service.
- Password recovery and invites use Directus' native flows: `/auth/password/request` + `/auth/password/reset` (forgot password), `/users/invite` + `/users/invite/accept` (onboarding & teammate invites), `updateMe` (logged-in change). No custom token logic.
- Admin credentials for local dev: `admin@wepublish.ch` / `admin123` (see README).

### Email templates

Custom **We.Publish-branded, German** templates override Directus' built-ins: [`templates/user-invitation.liquid`](templates/user-invitation.liquid) (invite/activation mail; `{{ url }}` → frontend `/auth/accept-invite`) and [`templates/password-reset.liquid`](templates/password-reset.liquid) (`{{ url }}` → `/auth/set-new-password`). Directus resolves a template by name from `EMAIL_TEMPLATES_PATH` (default `./templates`) **before** the built-in set, so a file named `<template>.liquid` here wins. Available Liquid vars: `url`, `email`, and project settings `projectName` / `projectColor` / `projectLogo` / `projectUrl`. These are **standalone** (no `{% layout "base" %}`) so they don't inherit the built-in base's English signature/footer; the green accent (`#00a155`) matches the frontend brand and a text wordmark is shown when `projectLogo` is unset. Read fresh on every send — no API restart needed to change copy.

- **Gotcha**: Liquid parses `{% %}` / `{{ }}` **even inside HTML comments**. Never write a literal `{%…%}` tag in a comment (e.g. documenting "no layout tag") — it's executed and errors. Validate a template after editing: render it with `liquidjs` (root = `templates` + the built-in dir, `extname: '.liquid'`) passing sample `url`/`email`.
- The `/team` endpoint's "access granted" notice to existing active users is sent as inline HTML via `MailService` (not a template) — see `team/index.ts`.

**Mail defaults override** ([`mail-defaults` hook](extensions/wepublish/src/mail-defaults/index.ts)): Directus hardcodes the invite/reset **subject** (`"You've been invited"` / `"Password Reset Request"`) and, when no `invite_url` is supplied, the **link** (`PUBLIC_URL + /admin/accept-invite` — relative & pointing at the Directus admin app). The `/users/invite` + `/auth/password/request` controllers forward **neither** a subject nor (from the admin UI) an `invite_url`, so they can't be fixed per-request. Two consequences: Scaleway rejects the English subject `"You've been invited"` outright (`550 5.0.0 Spam detected` — proven by A/B: same body+link passes with a German subject, fails with the English one); and admin-UI invite links are broken (`/admin/accept-invite?token=…`). The hook listens on the `email.send` **filter** (which `MailService` runs before every send) and, by template name (`user-invitation` / `password-reset`), rewrites the **subject** to the branded German one and the **link** to the allow-listed **frontend** URL (`USER_INVITE_URL_ALLOW_LIST` / `PASSWORD_RESET_URL_ALLOW_LIST`, first entry), preserving the token. Already-allow-listed links (e.g. from the `/team` endpoint) are left untouched. Pure logic + unit tests in [`mailDefaults.ts`](extensions/wepublish/src/mail-defaults/mailDefaults.ts) / `mailDefaults.test.ts`. This fixes **all** invite/reset paths incl. the admin UI. Caveats: returning `undefined` from an `email.send` filter cancels the send (always return the payload); and the allow-list env vars must list the real frontend URL **first** per environment.

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
- **Timezone**: the image sets `ENV TZ=Europe/Zurich` (see [Dockerfile](Dockerfile)). Scheduled Directus Flows fire in the process's local timezone — Directus passes no timezone to the `cron` library ([`scheduleSynchronizedJob`](node_modules/@directus/api/dist/utils/schedule.js)), and flow `options` only carry `cron` (no per-flow timezone knob). Without `TZ` the container defaults to UTC, so a `0 7` cron ran at 09:00 CEST; `Europe/Zurich` makes crons fire at Swiss wall-clock time year-round (DST-aware). The extension date logic is deliberately UTC-first (`getUTC*` / `Date.UTC` / `toISOString` / `getTime()` ms math) and billing date fields (`Periods.from`/`to`, `ManualWorkEntries.date`) are Directus `date` (date-only), so they're unaffected by the process timezone. Keep new scheduled/date code UTC-explicit; the only timezone-naive (`dateTime`) field is `PeerArticles.source_publishedAt`. If overriding `TZ` per environment, set it as a real process env var (Dockerfile `ENV` or the OpenShift deployment), **not** in the dotenv `.env` — Node fixes its timezone at process start, before Directus loads dotenv.

## Important Notes

- All schema changes **must** go through `schema:load` → `schema:dump` (in that order). The dump must come from a real DB to capture auto-populated values correctly.
- The `extensions/wepublish/` bundle is the single Directus extension bundle; **always extend it rather than creating a new extension package**. All custom endpoints, hooks, operations, and shared helpers live there.
- GeoJSON types are defined in `DirectusTypes.ts` to support PostGIS fields.
- `EXTENSIONS_AUTO_RELOAD=true` is set in dev for hot-reloading extensions.
- **Keep this CLAUDE.md current**: when a change adds/removes an endpoint, collection, command, env var, integration, or convention — or invalidates something written here — update this file in the same change. Skip the update for routine bug fixes, refactors that don't change shape, dep bumps, and anything obvious from reading the code.
