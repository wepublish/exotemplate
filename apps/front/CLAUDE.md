# one-front — AI Agent Instructions

## Project Overview

This is the **We.Publish ONE** frontend — a billing and time-tracking management dashboard for media clients. It integrates with Directus (headless CMS/backend), Clockodo (time tracking), Bexio (accounting/invoicing), and Jira (issue estimation).

## Technology Stack

| Layer            | Technology                                       |
| ---------------- | ------------------------------------------------ |
| Framework        | Nuxt 4 (^4.2.1) with Vue 3                       |
| Language         | TypeScript (strict)                              |
| UI Components    | @nuxt/ui (Tailwind CSS-based)                    |
| State Management | Pinia (@pinia/nuxt)                              |
| Backend SDK      | @directus/sdk (^20.2.0)                          |
| HTTP Client      | axios                                            |
| Validation       | zod                                              |
| Date Utilities   | date-fns                                         |
| Icons            | @iconify-json/lucide, @iconify-json/simple-icons |
| Package Manager  | pnpm (10.23.0)                                   |

## Architecture

### Folder Structure

```
app/
├── assets/css/          # Tailwind base styles and theme overrides
├── components/          # Vue SFCs, organized by domain (auth/, dashboard/)
├── composables/         # Reusable composition functions (use* prefix)
├── layouts/             # App-wide layout shells (default.vue handles auth check)
├── pages/               # File-based routes (Nuxt auto-routing)
│   ├── index.vue
│   ├── auth/login.vue
│   ├── overview/index.vue       # admin-only: Projektübersicht (tile grid; budget bars per active client period)
│   ├── time-tracking/index.vue  # admin-only: Übersicht Zeiterfassung (per-user capture status + ignore toggle)
│   └── [clientPeriodId]/
│       ├── create-bexio-invoice.vue
│       ├── top-ups.vue          # detail page: Zahlungen / Top-Ups
│       ├── available-hours.vue  # detail page: Verfügbare Arbeitsstunden
│       ├── work-log.vue         # detail page: Arbeitsprotokoll (deep-linkable via ?issue=)
│       └── manual-corrections.vue # detail page: Manuelle Korrekturen
├── stores/              # Pinia stores (useDirectus.ts, useUserStore.ts)
└── app.vue              # Root component
types/                   # Shared TypeScript interfaces (DirectusTypes.ts, ClockodoTypes.ts)
server/                  # Nuxt server routes (currently empty)
```

### Key Patterns

- **Composition API only** — no Options API. All components use `<script setup lang="ts">`.
- **Pinia stores** for global state: `useDirectus` (API client), `useUserStore` (auth + current user).
- **Composables** encapsulate domain logic: `useFinanceCalculations`, `useHours`, `useClientPeriods`, `useTopUps`, `useAggregatedHours` (shared `aggregatedHours` loader — same `clientPeriodId-<id>` key reused by Dashboard.vue and every detail page so Nuxt deduplicates the request and the server cache stays warm).
- **File-based routing** via Nuxt pages directory.
- **Dual API URL pattern**: `DIRECTUS_SERVER_API_URL` is used during SSR, `DIRECTUS_CLIENT_API_URL` in the browser. Both are exposed via Nuxt's `runtimeConfig`.
- Route `/` is not prerendered (dynamic dashboard content).

## Code Style & Conventions

- **Formatter**: Prettier — no semicolons, single quotes, no trailing commas, 2-space indent.
- **Pre-commit**: Husky + lint-staged runs Prettier on all staged files.
- **No ESLint** — Prettier is the only linting tool.
- **Naming**:
  - Files/components: kebab-case filenames, PascalCase component names.
  - Composables: `use*` prefix (e.g. `useClientPeriods`).
  - Stores: `use*Store` or `use*` (e.g. `useUserStore`, `useDirectus`).
  - TypeScript interfaces: PascalCase (e.g. `ClientPeriod`, `CustomDirectusUser`).
- UI labels are in **German**; code is in **English**.

### Styling rules — Tailwind only, no typography plugin

- **`@tailwindcss/typography` is NOT installed** — `prose`, `prose-sm`, `prose-lg`, etc. are no-ops here. Using them silently strips heading sizes and list bullets (h3 renders as plain inline text, `<ul>` loses its discs). Always style rich-text blocks with explicit utilities instead:
  - Headings: `text-lg font-semibold` (h3) / `text-xl font-semibold` (h2), plus a small top spacing like `pt-2`.
  - Paragraphs/sections: wrap related copy in `<section class="space-y-3 leading-relaxed">` (or `space-y-4`) for vertical rhythm — don't rely on default browser margins.
  - Lists: `<ul class="list-disc ps-6 space-y-2">` (use `ps-`/`pe-` logical properties, not `pl-`/`pr-`, so RTL still works).
  - Strong/em: HTML defaults are fine; no extra utilities needed.
- Before reaching for any class, verify the plugin that defines it is actually configured. If you find yourself wanting `prose` for a docs/info page, **don't add the dependency unprompted** — style with explicit utilities and ask the user before introducing typography plugins.

## Key Commands

```bash
pnpm install        # Install dependencies (also runs nuxt prepare)
pnpm dev            # Dev server at http://localhost:3000
pnpm build          # Production build
pnpm preview        # Preview production build locally
pnpm typecheck      # Run vue-tsc type checking
pnpm lint           # Format all files with Prettier
```

## Backend Integration

The frontend talks to **one-directus** (Directus instance, default port 8055):

- **Directus SDK** (`@directus/sdk`) handles all CMS data (collections, auth).
- **Custom endpoints** exposed by Directus extensions:
  - `GET /aggregatedHours?clientPeriodId=X` — billing summary with Clockodo hours and Jira estimates.
  - `GET /networkContribution?clientPeriodId=X` — network-wide work (we.share buckets + other media organisations) delivered during the period, surfaced in the dashboard's "Netzwerk-Beitrag" card via [`components/dashboard/NetworkContribution.vue`](app/components/dashboard/NetworkContribution.vue).
  - `GET /time-tracking/missing-hours?from=…&to=…` — admin-only; per-employee day-by-day capture status, plus an `ignored` flag per user. Consumed by [`composables/useTimeTracking.ts`](app/composables/useTimeTracking.ts) and rendered by [`components/time-tracking/MissingHoursList.vue`](app/components/time-tracking/MissingHoursList.vue) on the [`/time-tracking`](app/pages/time-tracking/index.vue) page (Übersicht Zeiterfassung). Ignored users are toggled via standard Directus CRUD on the `CaptureIgnoredUsers` collection (SDK `createItem`/`deleteItem`); ignored rows are dimmed and pinned to the bottom of the list.
  - `GET /clientsOverview` — admin-only; reads pre-computed billing sums from the `BillingSnapshots` table for every currently-active client period and returns them in one shot. Consumed by [`composables/useClientsOverview.ts`](app/composables/useClientsOverview.ts) and rendered by [`components/overview/ClientTile.vue`](app/components/overview/ClientTile.vue) on the [`/overview`](app/pages/overview/index.vue) page (Projektübersicht). The tiles reuse `useWeeklyReportProgress.compute()` for the two progress bars, so the colours/headlines match `/[clientPeriodId]/available-hours` and the weekly Slack report. Per-tile force-refresh uses `POST /clientsOverview/refresh?clientPeriodId=…`.
  - `POST /invoice-with-topup` — create a Bexio invoice.
- **Bexio SDK** (`bexio`) is used client-side for invoice management on the `/[clientPeriodId]/create-bexio-invoice` page.

### Admin nav entries

The sidebar in [`layouts/default.vue`](app/layouts/default.vue) renders admin-only entries by checking `userStore.amIAdministrator()` inline (no middleware). Today there are three: **Projektübersicht** (`/overview`), **Onboarding** (`/onboarding`) and **Übersicht Zeiterfassung** (`/time-tracking`). Pages themselves repeat the check and render an access-denied card for non-admins — keeps direct URL hits from bypassing the hidden nav.

### Environment Variables

```env
NUXT_PUBLIC_DIRECTUS_CLIENT_API_URL=http://0.0.0.0:8055
NUXT_PUBLIC_DIRECTUS_SERVER_API_URL=http://0.0.0.0:8055
```

### Aggregated hours caching

The `aggregatedHours` endpoint returns `{ data, cache: { hit, cachedAt, expiresAt, ttlMs } }`. The dashboard surfaces this via [`components/dashboard/CacheStatus.vue`](app/components/dashboard/CacheStatus.vue), which:

- Shows a `Live-Daten` (green) or `Aus Cache (vor X Min.)` (neutral) badge next to the project/period selectors.
- Ticks a 30-second client-only `setInterval` so the displayed age stays accurate without user interaction.
- Owns the refresh action: `DELETE /aggregatedHours/cache?clientPeriodId=…` to invalidate the single matching server-side entry, then calls the `refresh` prop (the parent's `useAsyncData` refresh function).
- Includes a hover-popover info icon explaining the caching system to end-users.

When changing the response shape on the backend, the matching `CacheMeta` interface lives in `composables/useAggregatedHours.ts` (as `AggregatedHoursCacheMeta`) and `components/dashboard/CacheStatus.vue` (as `CacheMeta`); keep them in sync.

### Dashboard layout

[`Dashboard.vue`](app/components/dashboard/Dashboard.vue) is a router/dispatch surface, not a content surface:

- **Project/period selector + `CacheStatus`** — full width, top.
- **`NetworkContribution`** — full width, expandable/collapsible (collapsed by default). Header + intro + "Dein Beitrag an We.Publish" progress bar are always visible; the breakdown tiles only render when expanded. **No detail page** — all of its content lives on the dashboard.
- **Four [`SummaryCard`](app/components/dashboard/SummaryCard.vue) tiles** — half width each, clickable, showing only title + total hours (top right). Each links to a dedicated detail page under `/[clientPeriodId]/<slug>`:
  - `top-ups` — table of computed top-ups + admin-only Bexio button
  - `available-hours` — calculation breakdown, budget-vs-time progress, status alert, admin-only Bexio button
  - `work-log` — full Arbeitsprotokoll table with halt/silence actions (`?issue=` deep-link supported)
  - `manual-corrections` — Manuelle Korrekturen table

When adding a new dashboard tile, follow this same pattern: the dashboard shows title + number only, all detail content goes on a route under `/[clientPeriodId]/`. Detail pages call `useAggregatedHours()` so the server-side cache is shared.

## Authentication Flow

1. User submits email/password on `/auth/login`.
2. Directus SDK authenticates; JWT stored in `localStorage`.
3. `useUserStore` calls `readMe()` to fetch the current user and their client access.
4. `default.vue` layout enforces redirect to login if unauthenticated.

## Data Types

Key TypeScript interfaces live in [types/DirectusTypes.ts](types/DirectusTypes.ts):

- `Clients`, `Periods`, `ClientPeriods`, `ManualWorkEntries`, `TopUps`, `directus_users`
- Clockodo API response shapes are in [types/ClockodoTypes.ts](types/ClockodoTypes.ts).

## Testing

No test framework is currently configured here, and no `.test.ts` / `.spec.ts` files exist yet.

**The default is still to write tests.** Before adding non-trivial logic — composables, Pinia stores, pure helpers, finance/date calculations — ask the user whether to set up Vitest (with `@nuxt/test-utils` for component-level coverage if needed) rather than silently shipping the code untested. Skip the question only for thin presentational components, simple template wiring, or pure styling changes.

When the framework is in place, co-locate `*.test.ts` next to the file under test.

## Deployment

- **Staging**: Auto-deploys on push to `main`.
- **Production**: Auto-deploys on Git tags matching `v*` (e.g. `v1.2.0`).
- Docker multi-stage build: Node 22 build stage → Node 22 runtime on port 3000.

## Important Notes

- Do **not** use Options API — stick to Composition API with `<script setup>`.
- Do **not** add ESLint; the project intentionally uses Prettier only.
- The `pnpm-workspace.yaml` is present but the frontend is a single-package workspace.
- `shamefully-hoist=true` is set in `.npmrc` for compatibility.
- Nuxt devtools are enabled in development.
- **Keep this CLAUDE.md current**: when a change adds/removes a page, store, composable, env var, integration, or convention — or invalidates something written here — update this file in the same change. Skip the update for routine bug fixes, refactors that don't change shape, dep bumps, copy/UI tweaks, and anything obvious from reading the code.
