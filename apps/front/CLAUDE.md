# one-front — AI Agent Instructions

## Project Overview

This is the **We.Publish ONE** frontend — a billing and time-tracking management dashboard for media clients. It integrates with Directus (headless CMS/backend), Clockodo (time tracking), Bexio (accounting/invoicing), and Jira (issue estimation).

## Technology Stack

| Layer            | Technology                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Framework        | Nuxt 4 (^4.2.1) with Vue 3                                                                         |
| Language         | TypeScript (strict)                                                                                |
| UI Components    | @nuxt/ui (Tailwind CSS-based)                                                                      |
| State Management | Pinia (@pinia/nuxt)                                                                                |
| Backend SDK      | @directus/sdk (^20.2.0)                                                                            |
| HTTP Client      | axios                                                                                              |
| Validation       | zod                                                                                                |
| Date Utilities   | date-fns                                                                                           |
| Icons            | @iconify-json/lucide only — Nuxt UI's default set; referenced as `lucide:<name>` (bundled locally) |
| Package Manager  | npm (Node 22.x; npm 10.x)                                                                          |

## Architecture

### Folder Structure

```
app/
├── assets/css/          # Tailwind base styles and theme overrides
├── components/          # Vue SFCs, organized by domain (auth/, dashboard/)
├── composables/         # Reusable composition functions (use* prefix)
├── layouts/             # App-wide layout shells (default.vue handles auth check)
├── pages/               # File-based routes. A `pages:extend` hook prefixes
│   │                    # every route below with `/:clientPeriodId` (except
│   │                    # `/` and `/auth/*`) — see Global client/period selection.
│   ├── index.vue                   # `/` → redirects to /{default}/dashboard
│   ├── dashboard.vue               # `/:clientPeriodId/dashboard` → renders <Dashboard/>
│   ├── auth/login.vue              # `/auth/login` (NOT prefixed)
│   ├── auth/forgot-password.vue    # request a password-reset email (logged out)
│   ├── auth/set-new-password.vue   # set new password from reset link (?token=)
│   ├── auth/accept-invite.vue      # activate account from invite link (?token=)
│   ├── team/index.vue              # self-service: invite teammates / list/remove members — scoped to the period's client
│   ├── settings/index.vue          # "Mein Konto" + per-client settings grouped into topical tiles, 2-col on desktop
│   ├── settings/contracts/[clientId].vue  # contract timeline for a client
│   ├── overview/index.vue          # admin-only: Projektübersicht (tile grid; budget bars per active client period)
│   ├── time-tracking/index.vue     # admin-only: Übersicht Zeiterfassung (per-user capture status + ignore toggle)
│   ├── onboarding/index.vue, [clientId].vue  # admin-only onboarding wizard
│   ├── top-ups.vue                 # detail: Zahlungen / Top-Ups (Rechnungen)
│   ├── available-hours.vue         # detail: Verfügbare Arbeitsstunden
│   ├── work-log.vue                # detail: Arbeitsprotokoll (deep-linkable via ?issue=)
│   ├── manual-corrections.vue      # detail: Manuelle Korrekturen
│   └── create-bexio-invoice.vue    # detail: Bexio invoice creation
├── stores/              # Pinia stores (useDirectus.ts, useUserStore.ts, useClientSelection.ts)
└── app.vue              # Root component
types/                   # Shared TypeScript interfaces (DirectusTypes.ts, ClockodoTypes.ts)
server/                  # Nuxt server routes (currently empty)
```

### Key Patterns

- **Composition API only** — no Options API. All components use `<script setup lang="ts">`.
- **Pinia stores** for global state: `useDirectus` (API client), `useUserStore` (auth + current user + `patchClient` for optimistic per-client edits), `useClientSelection` (app-wide selected client + billing period — see [Global client/period selection](#global-clientperiod-selection)).
- **Composables** encapsulate domain logic: `useFinanceCalculations`, `useHours`, `useClientPeriods`, `useTopUps`, `useAggregatedHours` (shared `aggregatedHours` loader — same `clientPeriodId-<id>` key reused by Dashboard.vue and every detail page so Nuxt deduplicates the request and the server cache stays warm), `useAccount` (logged-in password change — verifies the current password via a throwaway client, then `updateMe`), `useTeam` (invites/grants via the backend `POST /team/invite`; lists members & removes access **directly** with the SDK against `Clients_directus_users`, scoped by Client-policy permissions), `useClientPeriodLink` (builds links that carry the `/:clientPeriodId` path prefix — like i18n's `localePath`; see [Global client/period selection](#global-clientperiod-selection)), `useSettings` (reads/writes the global `Settings` singleton — currently `slack_we_share_channel_id`; value shared app-wide via `useState`, admin-only write), `useClientLinks` (`listForClient` reads the `ClientLinks` collection rows for a client; `persistCustomLinks` reconciles edited link drafts against the rows via create/update/delete using the pure `diffClientLinks`. The editor/website links come from the infrastructure config — there is **no** per-client override).
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
- UI labels are **localized** (German default, French, English) via i18n message keys — never hardcode user-facing copy; see the [Internationalization](#internationalization-i18n) section. Code/identifiers/comments stay in **English**.

### Styling rules — Tailwind only, no typography plugin

- **`@tailwindcss/typography` is NOT installed** — `prose`, `prose-sm`, `prose-lg`, etc. are no-ops here. Using them silently strips heading sizes and list bullets (h3 renders as plain inline text, `<ul>` loses its discs). Always style rich-text blocks with explicit utilities instead:
  - Headings: `text-lg font-semibold` (h3) / `text-xl font-semibold` (h2), plus a small top spacing like `pt-2`.
  - Paragraphs/sections: wrap related copy in `<section class="space-y-3 leading-relaxed">` (or `space-y-4`) for vertical rhythm — don't rely on default browser margins.
  - Lists: `<ul class="list-disc ps-6 space-y-2">` (use `ps-`/`pe-` logical properties, not `pl-`/`pr-`, so RTL still works).
  - Strong/em: HTML defaults are fine; no extra utilities needed.
- Before reaching for any class, verify the plugin that defines it is actually configured. If you find yourself wanting `prose` for a docs/info page, **don't add the dependency unprompted** — style with explicit utilities and ask the user before introducing typography plugins.

### Icons — Lucide only (Nuxt UI's default set), and the name must exist

Icons render via `@nuxt/icon`. **We use a single collection: `@iconify-json/lucide`** — the set Nuxt UI ships with by default, so its built-in component icons (dropdown chevrons, modal close, checkboxes) and our own icons come from the same library. Do **not** reintroduce other Iconify collections (`material-symbols`, `simple-icons`, etc.); the app was deliberately consolidated onto Lucide so every icon is bundled/served locally and nothing is fetched from the Iconify API at runtime.

**Reference every icon as `lucide:<name>`** (the unambiguous Iconify `collection:name` form) — e.g. `icon="lucide:circle-check"`, `:name="lucide:refresh-cw"`. This is the project convention; don't mix in the `i-lucide-<name>` class form.

Two gotchas:

1. **Lucide renamed many icons** (v1 → current): `check-circle` → `circle-check`, `alert-triangle` → `triangle-alert`, `more-horizontal` → `ellipsis`, `home` → `house`, etc. (older aliases often still resolve, but prefer the current name).
2. **Lucide has almost no brand icons.** It _does_ ship `slack` and `github`, but **not** `jira` (we use `lucide:square-kanban` as the stand-in). If you need a brand logo Lucide lacks, pick the closest generic glyph rather than adding `simple-icons` back — ask first if none fits.

**Validate the exact name before using it** (a missing name renders a silent blank, no error):

```bash
node -e 'const d=require("@iconify-json/lucide/icons.json");const v=new Set([...Object.keys(d.icons),...Object.keys(d.aliases||{})]);console.log(v.has("circle-check"),v.has("check-circle"))'
```

To sweep the whole app and confirm every referenced icon exists:
`grep -rhoE "lucide:[a-z0-9-]+" app/ | sort -u | sed 's/lucide://'` and check each against the set above.

## Key Commands

```bash
npm install         # Install dependencies (also runs nuxt prepare)
npm run dev         # Dev server at http://localhost:3001 (set via nuxt.config devServer.port)
npm run build       # Production build
npm run preview     # Preview production build locally
npm run typecheck   # Run vue-tsc type checking
npm run lint        # Format all files with Prettier
```

## Backend Integration

The frontend talks to **one-directus** (Directus instance, default port 8055):

- **Directus SDK** (`@directus/sdk`) handles all CMS data (collections, auth).
- **Custom endpoints** exposed by Directus extensions:
  - `GET /aggregatedHours?clientPeriodId=X` — billing summary with Clockodo hours and Jira estimates.
  - `GET /networkContribution?clientPeriodId=X` — network-wide work (we.share buckets + other media organisations) delivered during the period, surfaced in the dashboard's "Netzwerk-Beitrag" card via [`components/dashboard/NetworkContribution.vue`](app/components/dashboard/NetworkContribution.vue).
  - `GET /time-tracking/missing-hours?from=…&to=…` — admin-only; per-employee day-by-day capture status, plus an `ignored` flag per user. Consumed by [`composables/useTimeTracking.ts`](app/composables/useTimeTracking.ts) and rendered by [`components/time-tracking/MissingHoursList.vue`](app/components/time-tracking/MissingHoursList.vue) on the [`/time-tracking`](app/pages/time-tracking/index.vue) page (Übersicht Zeiterfassung). Ignored users are toggled via standard Directus CRUD on the `CaptureIgnoredUsers` collection (SDK `createItem`/`deleteItem`); ignored rows are dimmed and pinned to the bottom of the list.
  - `GET /clientsOverview` — admin-only; reads pre-computed billing sums from the `BillingSnapshots` table for every currently-active client period and returns them in one shot. Consumed by [`composables/useClientsOverview.ts`](app/composables/useClientsOverview.ts) and rendered by [`components/overview/ClientTile.vue`](app/components/overview/ClientTile.vue) on the [`/overview`](app/pages/overview/index.vue) page (Projektübersicht). The tiles reuse `useWeeklyReportProgress.compute()` for the two progress bars, so the colours/headlines match `/[clientPeriodId]/available-hours` and the weekly Slack report. Per-tile force-refresh uses `POST /clientsOverview/refresh?clientPeriodId=…`.
  - `POST /invoice-with-topup` — create a Bexio invoice (post-/pre-paid, hour-counting → `TopUps`).
  - `POST /recurring-invoice` — admin-only; the **Hosting** invoice type (third tab on `create-bexio-invoice`). Creates a recurring Bexio order (Auftrag) + yearly repetition + a first invoice over the remaining months, stored in the separate `Invoices` collection (does **not** count toward hours). Wrapped by [`composables/useInvoices.ts`](app/composables/useInvoices.ts) (`createHostingInvoice` / `loadInvoices`). Pure hosting math (`getHostingInvoiceTotals` / `getHostingOrderAnnualTotal`) lives in [`composables/useFinanceCalculations.ts`](app/composables/useFinanceCalculations.ts), kept separate from the hour-based functions and unit-tested.
  - `GET /bexio-invoice-status?ids=…&orderIds=…` — live Bexio status + public `networkLink` per invoice id, and public `networkLink` per order id, cached server-side. Wrapped by [`composables/useBexioInvoiceStatus.ts`](app/composables/useBexioInvoiceStatus.ts) (`fetchBexioLinks` + `statusBadge`). On the Top-Ups page: status badges for both regular top-ups and the hosting tile; and the invoice/order links are **role-aware** — admins get the office.bexio.com link (needs a Bexio login); client-role users get the login-free public `networkLink` when present, otherwise a button that opens the document **PDF** proxied through the backend (`openInvoicePdf`/`openOrderPdf` → `GET /bexio-invoice-status/(invoice|order)/:id/pdf`, opened as a blob). `network_link` only exists once a document is shared via the Bexio network, so the PDF is the reliable fallback for issued invoices.
  - `POST /contracts` — upload a (new version of a) contract **PDF** for a client `{ clientId, fileBase64, fileName?, signed?, notes? }`. No generation/Google — a contract is just an uploaded PDF, versioned (latest = in effect). Both admins and the client's own users may upload (server access-checks the client). Wrapped by [`composables/useContracts.ts`](app/composables/useContracts.ts) (`uploadContract`); listing uses the SDK and **downloading uses Directus' native `/assets/:id`** (fetched as an authenticated blob — a plain `<a>` can't send the bearer token; Client policy grants read on `directus_files` in the "contracts" folder). Pure status helpers (`currentValidContract`, `contractNeedsSignature`) live in [`composables/contractStatus.ts`](app/composables/contractStatus.ts).
  - `POST /team/invite` — the only custom team route: invite a teammate / grant access to an existing user. Authorizes the caller against their own client access and forces new users to the Client role, so clients self-serve without Directus admin access. `returnInviteUrl:true` (admin-only) returns the tokenized activation link for the onboarding wizard to embed in its welcome mail. Consumed by [`composables/useTeam.ts`](app/composables/useTeam.ts) on the [`/team`](app/pages/team/index.vue) page and by the onboarding `DirectusStep`/`EmailStep`. **Member listing and access removal are NOT custom endpoints** — `useTeam` does them with the SDK (`readItems`/`deleteItem` on `Clients_directus_users`), governed by the Client policy's row-level read/delete permissions.
- **Auth flows** use the `@directus/sdk` auth commands directly (no custom endpoint): `passwordRequest`/`passwordReset` (forgot password), `acceptUserInvite` (invite activation), `updateMe` (logged-in password change via `useAccount`). The reset/invite links point at the `/auth/*` pages and must be on the backend's `PASSWORD_RESET_URL_ALLOW_LIST` / `USER_INVITE_URL_ALLOW_LIST`.
- **Bexio SDK** (`bexio`) is used client-side for invoice management on the `/[clientPeriodId]/create-bexio-invoice` page.

### Nav entries

The sidebar in [`layouts/default.vue`](app/layouts/default.vue) has a general group (all logged-in users: **Dashboard**, **Rechnungen**, **Team**, **Einstellungen**) and an admin-only group rendered when `userStore.amIAdministrator()` is true (**Projektübersicht**, **Übersicht Zeiterfassung**, **Onboarding**). Every nav `to` is built with `useClientPeriodLink()` so it carries the current `/:clientPeriodId` prefix — including the admin entries, so the selection isn't lost hopping admin ↔ client pages. Admin pages repeat the `amIAdministrator()` check and render an access-denied card for non-admins.

**Rechnungen** (`nav.invoices`) reuses the per-period **Zahlungen / Top-Ups** page: `link('/top-ups')` → `/{clientPeriodId}/top-ups`.

`layouts/default.vue` also gates the login form: every `/auth/*` route renders its own content (so forgot/reset-password and accept-invite are reachable while logged out); any other route falls back to the login form when unauthenticated.

### Global client/period selection

The selected client + billing period live in the **URL path** as a `/:clientPeriodId` prefix on **every** app route — the "always in the URL" model a locale prefix uses. This means the selection is never lost on navigation (including admin ↔ client pages), and every page is shareable/reloadable. There is **no query param and no writable selection state** — to change the selection you navigate.

- **The prefix** is applied by a `pages:extend` hook in [nuxt.config.ts](nuxt.config.ts) that rewrites every scanned route to `/:clientPeriodId<path>`, except `/` (a redirect-to-default page) and `/auth/*`. Files stay organized by feature; only their routes are prefixed (Nuxt-idiomatic, preserves `definePageMeta`). The dashboard is `pages/dashboard.vue` → `/:clientPeriodId/dashboard`.
- **Source of truth = the route param.** [`useClientSelection`](app/stores/useClientSelection.ts) _derives_ everything from `route.params.clientPeriodId`: `selectedClientPeriodId`, `selectedClient`, `selectedClientId`, `clientPeriods`, `selectedPeriod` (all read-only getters — consume with `storeToRefs`). Plus helpers `newestPeriodIdForClient` and `defaultClientPeriodId` (last-used from `localStorage` if still valid, else newest period of the first client).
- **Building links**: use [`useClientPeriodLink()`](app/composables/useClientPeriodLink.ts) — `link('/team')` → `/{clientPeriodId}/team` (falls back to `/` when there's no period in the path). It's the `localePath` of this app; use it for every internal link to a client-scoped page.
- **The selector** ([`ClientPeriodSelector`](app/components/ClientPeriodSelector.vue), sidebar + mobile row) navigates by swapping the leading path segment, so it works the same on every page. It shows wherever `route.params.clientPeriodId` exists (i.e. all app routes), so the nav never jumps.
- **Redirects**: `pages/index.vue` (`/`) redirects to `/{default}/dashboard` once `clients` load; the layout redirects a stale/unknown period in the path to the default too.
- **Backend coupling**: the Slack/mail links point at these exact URLs — the weekly-report Slack link is `/{clientPeriodId}/dashboard` and the work-log halt/warning links are `/{clientPeriodId}/work-log?issue=…` (`one-directus`: `shared/weekly-report/composeMessage.ts`, `shared/notifications/composeMessage.ts`). **Changing the route scheme means updating those builders.** Mail (onboarding/invite) only links to `/auth/*` and the root, so it's scheme-independent.

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

- **Header row** — the selected client name + period (read from `useClientSelection`; the _selector_ itself lives in the sidebar, see [Global client/period selection](#global-clientperiod-selection)) on the left, `CacheStatus` on the right. Full width, top.
- **[`QuickLinks`](app/components/dashboard/QuickLinks.vue)** — full width, rendered just above `NetworkContribution`. A grid of external-link cards, each with a short description (dedicated Slack channel, network-wide #we-share, editor, Jira, website, We.Publish docs, plus the client's custom links), opening in a new tab. The resolved set is computed by the **pure** [`buildDashboardLinks`](app/utils/clientLinks.ts) helper (built-ins whose target can't be resolved are hidden; docs is always shown; custom links appended, sorted). URLs come from [`utils/externalLinks.ts`](app/utils/externalLinks.ts) (`composeEditorUrl`/`composeWebsiteUrl` derive from `Client.apiUrl` — infra config wins when present, no per-client override; `WEPUBLISH_DOCS_URL`) and [`utils/slack.ts`](app/utils/slack.ts). The #we-share channel id is read from the global `Settings` singleton via [`useSettings`](app/composables/useSettings.ts); the custom links are loaded from the **`ClientLinks`** collection via [`useClientLinks`](app/composables/useClientLinks.ts) `listForClient`. No detail page. The custom links are managed on the **settings** page ([`SettingsLinksCard`](app/components/settings/LinksCard.vue) → `useClientLinks` `persistCustomLinks`); the #we-share channel id is set there too in an admin-only "Globale Einstellungen" card (`useSettings.updateWeShareChannelId`).
- **`NetworkContribution`** — full width, expandable/collapsible (collapsed by default). Header + intro + "Dein Beitrag an We.Publish" progress bar are always visible; the breakdown tiles only render when expanded. **No detail page** — all of its content lives on the dashboard.
- **Four [`SummaryCard`](app/components/dashboard/SummaryCard.vue) tiles** — half width each, clickable, showing title + total hours (top right). The card exposes a default slot for optional in-card content that shares the clickable surface (status alerts, and the budget/time progress bars on the available-hours tile). Each links to a dedicated detail page under `/[clientPeriodId]/<slug>`:
  - `top-ups` — table of computed top-ups (with live Bexio status badge) + a separate **Hosting / Wiederkehrende Rechnungen** tile listing order-backed `Invoices` (hosting; not counted toward hours) + admin-only Bexio button. The create page (`create-bexio-invoice`) has three tabs: Post-Paid, Pre-Paid, and **Hosting** (recurring order → first partial invoice).
  - `available-hours` — status alert + the **"Budget verbraucht" / "Zeit vergangen" progress bars** ([`BillingBudgetProgressBars`](app/components/billing/BudgetProgressBars.vue), shared with the detail page); detail page adds the calculation breakdown, budget-vs-time table, and admin-only Bexio button. The progress bars only render for prepaid clients (`!isMonthlyBilling`).
  - `work-log` — full Arbeitsprotokoll table with halt/silence actions (`?issue=` deep-link supported)
  - `manual-corrections` — Manuelle Korrekturen table

When adding a new dashboard tile, default to this pattern: the tile shows title + number (plus at most an at-a-glance alert/summary), and the full detail content goes on a route under `/[clientPeriodId]/`. The available-hours tile is the one deliberate exception — it also surfaces the budget/time bars inline because they're the headline signal — and it does so by **reusing** the same component the detail page renders rather than duplicating markup. Detail pages call `useAggregatedHours()` so the server-side cache is shared.

### Contracts

Per-client contracts are versioned uploaded **PDFs** (latest = in effect) at [`pages/settings/contracts/[clientId].vue`](app/pages/settings/contracts/[clientId].vue) — a timeline of versions with download + an upload action. Any user with access to the client (incl. an admin uploading the client's signed copy) can upload a new version; a `signed` checkbox marks it as signed. Reached from a "Vertrag" row on the [`/settings`](app/pages/settings/index.vue) page. Uploading also runs as a dedicated **onboarding step** ([`components/onboarding/steps/ContractStep.vue`](app/components/onboarding/steps/ContractStep.vue)) — the stepper is now 10 steps (`deriveStepStatuses` in [`composables/useOnboardingProgress.ts`](app/composables/useOnboardingProgress.ts) is length-10; contract = index 6, **invoicing = index 7**, manual tasks = 8, email = 9). The **invoicing** step ([`steps/InvoicingStep.vue`](app/components/onboarding/steps/InvoicingStep.vue)) replaced the old manual invoice checklist item; it lives after Vertrag. It resolves a **billing period** inline: the onboarder selects one of the client's existing `Clients_Periods` or **adds** one by linking a shared `Periods` definition (via `useUseClientPeriods().fetchPeriodDefinitions` / `createClientPeriod` in [`composables/useClientPeriods.ts`](app/composables/useClientPeriods.ts)). It then shows the two invoice types (hosting + onboarding), each with its own **"Rechnung erstellen"** button that deep-links to `/{selectedPeriodId}/create-bexio-invoice?tab={hosting|prePaid}` (new tab — also selects the client in the top-left selector, selection being URL-derived). Completion is **auto-detected** (no manual checkbox): hosting = an `Invoices` row of type `hosting` for the period; onboarding = the period has ≥1 `TopUp` (onboarding is billed via the amount-based Pre-Paid flow). Detection re-runs on period change and on `window` focus, so creating an invoice in the spawned tab and returning marks the row done. The create page honours `?tab=` to preselect a tab. A contract whose **current version is not signed** surfaces as a warning banner on [`Dashboard.vue`](app/components/dashboard/Dashboard.vue) and a warning icon on each [`overview/ClientTile.vue`](app/components/overview/ClientTile.vue) (fed by `contractWarning` on the `/clientsOverview` payload). Clients with **no** contract at all are not warned.

## Authentication Flow

1. User submits email/password on `/auth/login`.
2. Directus SDK authenticates; JWT stored in `localStorage`.
3. `useUserStore` calls `readMe()` for the current user (id, role, language) and, **separately**, `readItems('Clients', …)` for the visible client list (`userStore.clients`). The client list is scoped **entirely by Directus permissions**, not by an explicit `allowedUsers` lookup: a Client-role user sees the clients they're linked to (the Client policy's `allowedUsers == $CURRENT_USER` row filter), while an **Administrator sees every client** because `admin_access` bypasses that filter. This is deliberate — it means a new admin user does **not** need to be added to each client's `allowedUsers`. Don't reintroduce junction-based (`accessToClients`) filtering for the client list.
4. `default.vue` layout enforces redirect to login if unauthenticated (except `/auth/*`).

**Password recovery & invites** (all Directus-native, no custom token logic):

- **Forgot password** (logged out): `/auth/forgot-password` → `passwordRequest(email, …/auth/set-new-password)`; the emailed link lands on `/auth/set-new-password?token=` → `passwordReset(token, pw)`. The forgot-password page always shows a neutral confirmation (no account enumeration).
- **Change password** (logged in): "Mein Konto" card in `/settings` → `useAccount.changePassword`, which re-auths with the current password (throwaway client, no token side-effects) before `updateMe`.
- **Invites**: client users are created (status `invited`) via the backend `/team/invite`; the user activates via `/auth/accept-invite?token=` → `acceptUserInvite(token, pw)`. The self-service `/team` page sends Directus' invite email. **Onboarding** creates a **single** primary user in step 1 (`sendInvite:false`, no mail) and, in the final "E-Mail" step, **embeds the activation link directly in the welcome-mail text** (fetched via `returnInviteUrl:true`) — no separate invite email. The welcome mail also tells the client they can invite further teammates themselves on the Team page.

## Data Types

Key TypeScript interfaces live in [types/DirectusTypes.ts](types/DirectusTypes.ts):

- `Clients`, `Periods`, `ClientPeriods`, `ManualWorkEntries`, `TopUps`, `Invoice` (order-backed / hosting — separate from `TopUps`, never counted toward hours), `Contract`, `directus_users`
- Clockodo API response shapes are in [types/ClockodoTypes.ts](types/ClockodoTypes.ts).

## Testing

**Vitest + `@nuxt/test-utils` are configured.** Run from this directory:

```bash
npm test           # one-shot (vitest run)
npm run test:watch # watch mode
```

Config is [vitest.config.ts](vitest.config.ts) (default environment `node`; opt a spec into the Nuxt runtime with `// @vitest-environment nuxt`). Specs live in [test/](test/). Current suites: [test/i18n-parity.test.ts](test/i18n-parity.test.ts) (every locale defines the same keys, no empty values, matching plural-form counts) and [test/useAppLocale.test.ts](test/useAppLocale.test.ts) (locale resolution + fallback).

**Write tests by default** for new logic — composables, Pinia stores, pure helpers, finance/date calculations. Co-locate `*.test.ts` (or put cross-cutting suites in `test/`). Skip only for thin presentational components, simple template wiring, or pure styling changes.

## Internationalization (i18n)

The dashboard is localized with **`@nuxtjs/i18n`** (vue-i18n). Locales: **German (default), French, English**.

- **Config**: [nuxt.config.ts](nuxt.config.ts) `i18n` block — `strategy: 'no_prefix'` (language is a per-user preference, not a route concern), `defaultLocale: 'de'`, `compilation.strictMessage: false` (a few info-page messages carry inline `<em>`/`<strong>` rendered via `v-html`). Runtime config: [i18n.config.ts](i18n.config.ts).
- **Catalogs**: [i18n/locales/&lt;locale&gt;/&lt;namespace&gt;.json](i18n/locales/) — split per namespace (`common`, `nav`, `auth`, `settings`, `thresholds`, `dashboard`, `workLog`, `timeTracking`, `overview`, `networkContribution`, `billing`, `onboarding`, `contracts`) and deep-merged. **German is the source of truth**; keep the three locales structurally identical (the parity test enforces this). Add a namespace by listing it in `I18N_NAMESPACES` in [nuxt.config.ts](nuxt.config.ts) and adding `de/fr/en` fragment files. Escape literal `@` in message values as `{'@'}` (vue-i18n treats `@` as linked-message syntax).
- **Usage**: `const { t } = useI18n()` in `<script setup>`; `{{ t('ns.key') }}` in templates. In Pinia stores / plain composables use `useNuxtApp().$i18n.t(...)`. Pluralization: `t('ns.key', { count: n }, n)` with `"singular | plural"` messages.
- **Formatting**: [composables/useFormatters.ts](app/composables/useFormatters.ts) is the single source for number/date/hours/percent formatting (do NOT use inline `Intl`/`toLocale*` or vue-i18n `$n`/`$d`). It maps the active locale to a Swiss BCP-47 tag (de→`de-CH`, fr→`fr-CH`, en→`en-GB`) so output stays Swiss-formatted.
- **Per-user language**: stored on the built-in **`directus_users.language`** field. [composables/useAppLocale.ts](app/composables/useAppLocale.ts) (named to avoid colliding with `@nuxt/ui`'s `useLocale`) resolves the stored value, applies it, and persists changes via `updateMe`. The [LanguageSwitcher.vue](app/components/LanguageSwitcher.vue) in [layouts/default.vue](app/layouts/default.vue) lets users change it; [plugins/i18n-locale.client.ts](app/plugins/i18n-locale.client.ts) applies it on load (localStorage mirror for instant restore, then the authoritative user value after auth).
- **Per-project language**: the `/settings` page also exposes a **project** language selector (`Clients.language`) that drives the language of that project's client-facing Slack messages in the backend. The onboarding stepper sets it (and the new user's `directus_users.language`) for a freshly created client in step 1 ([DirectusStep.vue](app/components/onboarding/steps/DirectusStep.vue)).
- **Rendering a non-active locale** (e.g. the onboarding welcome email in the new client's language, which can differ from the admin's UI language): catalogs are lazy-loaded per locale, so call `$i18n.loadLocaleMessages(targetLocale)` first, then `$i18n.t(key, named, { locale: targetLocale })`. See [components/onboarding/steps/EmailStep.vue](app/components/onboarding/steps/EmailStep.vue) — its copy lives in the `onboarding.steps.email.welcome.*` catalog keys; [utils/onboardingWelcomeEmail.ts](app/utils/onboardingWelcomeEmail.ts) is a pure assembler (a translate fn + params in, body string out — no copy). Do **not** import locale JSON directly: the i18n build plugin precompiles those files into message ASTs, so a raw import yields compiled objects, not strings.

## Deployment

- **Staging**: Auto-deploys on push to `main`.
- **Production**: Auto-deploys on Git tags matching `v*` (e.g. `v1.2.0`).
- Docker multi-stage build: Node 22 build stage → Node 22 runtime on port 3000.

## Important Notes

- Do **not** use Options API — stick to Composition API with `<script setup>`.
- Do **not** add ESLint; the project intentionally uses Prettier only.
- **Structured data, not JSON blobs**: when a feature needs to store a list of structured records (label + url + …, individually added/edited/removed), model it as a dedicated Directus collection with a relation and CRUD it via the SDK — not a JSON column. The dashboard custom links use the `ClientLinks` collection ([`useClientLinks`](app/composables/useClientLinks.ts)); see the workspace + `one-directus` CLAUDE.md for the rule.
- **Package manager is npm** (matching the rest of the workspace). The single lockfile is `package-lock.json`; the Docker build runs `npm ci`. Do **not** reintroduce pnpm (`pnpm-lock.yaml` / `pnpm-workspace.yaml` / `shamefully-hoist`) — a mixed npm/pnpm state broke Nitro's dependency trace and shipped a server bundle missing `vue/server-renderer` (every SSR page 500'd).
- Nuxt devtools are enabled in development.
- **Keep this CLAUDE.md current**: when a change adds/removes a page, store, composable, env var, integration, or convention — or invalidates something written here — update this file in the same change. Skip the update for routine bug fixes, refactors that don't change shape, dep bumps, copy/UI tweaks, and anything obvious from reading the code.
