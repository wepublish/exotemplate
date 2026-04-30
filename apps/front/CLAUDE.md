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
│   └── [clientPeriodId]/create-bexio-invoice.vue
├── stores/              # Pinia stores (useDirectus.ts, useUserStore.ts)
└── app.vue              # Root component
types/                   # Shared TypeScript interfaces (DirectusTypes.ts, ClockodoTypes.ts)
server/                  # Nuxt server routes (currently empty)
```

### Key Patterns

- **Composition API only** — no Options API. All components use `<script setup lang="ts">`.
- **Pinia stores** for global state: `useDirectus` (API client), `useUserStore` (auth + current user).
- **Composables** encapsulate domain logic: `useFinanceCalculations`, `useHours`, `useClientPeriods`, `useTopUps`.
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
  - `POST /invoice-with-topup` — create a Bexio invoice.
- **Bexio SDK** (`bexio`) is used client-side for invoice management on the `/[clientPeriodId]/create-bexio-invoice` page.

### Environment Variables

```env
NUXT_PUBLIC_DIRECTUS_CLIENT_API_URL=http://0.0.0.0:8055
NUXT_PUBLIC_DIRECTUS_SERVER_API_URL=http://0.0.0.0:8055
```

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

No test framework is currently configured. There are no `.test.ts` or `.spec.ts` files.

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
