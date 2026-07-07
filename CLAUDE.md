# We.Publish ONE — Monorepo Entry Point

This repository is the **We.Publish ONE** platform: a billing, time-tracking, and onboarding system for media clients in the We.Publish network. It is a **monorepo** — both applications live here, side by side, under `apps/`. It is **not** an npm workspace: each app is independently versioned, installed, built, and deployed, and has its own lockfile. The root only carries shared pre-commit tooling and CI.

## Apps

Each app has its own `CLAUDE.md` with detailed instructions. Load the relevant one based on the task:

| Path                             | Purpose                                                                                                          | Stack                             | Detailed Instructions                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| [apps/directus/](apps/directus/) | Backend — Directus 11 headless CMS. Manages clients, billing periods, time entries, invoices. Custom extensions. | Directus 11, TypeScript, Postgres | [apps/directus/CLAUDE.md](apps/directus/CLAUDE.md) |
| [apps/front/](apps/front/)       | Frontend — billing & time-tracking dashboard for media clients.                                                  | Nuxt 4, Vue 3, Pinia, @nuxt/ui    | [apps/front/CLAUDE.md](apps/front/CLAUDE.md)       |

A third We.Publish project, [`infrastructure-configurator`](https://github.com/wepublish/infrastructure-configurator) (NestJS; onboards new media via GitHub PRs), is **operationally separate** and lives in its **own repository** — it is not part of this monorepo.

## How the pieces fit together

```
                ┌─────────────────────┐
                │      apps/front     │  Nuxt SPA, port 3001 (dev)
                │    (dashboard UI)   │
                └──────────┬──────────┘
                           │ Directus SDK + custom REST endpoints
                           ▼
                ┌─────────────────────┐
                │    apps/directus    │  Directus, port 8055
                │   (CMS + billing)   │──► Clockodo, Jira, Bexio
                └─────────────────────┘
```

## Deciding where to work

- **"Add a field / collection / endpoint" → backend** → [apps/directus/](apps/directus/)
- **"Change the dashboard / a page / UI behavior" → frontend** → [apps/front/](apps/front/)
- **"Add an integration with Clockodo / Jira / Bexio" → backend** (extensions) → [apps/directus/extensions/wepublish/](apps/directus/extensions/wepublish/)
- **A change spans frontend and backend** — start in `apps/directus` (data model first), then propagate types to `apps/front/types/DirectusTypes.ts`.

## Cross-cutting conventions

These apply across both apps unless the local CLAUDE.md says otherwise:

- **Formatter**: Prettier — no semicolons, single quotes, no trailing commas, 2-space indent.
- **No ESLint** — Prettier only, enforced via a single **root** Husky + lint-staged pre-commit hook that runs across the whole tree.
- **TypeScript strict mode** everywhere.
- **UI labels in German**, code/identifiers/comments in English.
- **Node 22.x**; package manager is `npm` in both apps.
- **Tests**: Write tests by default for new logic — skip only with a concrete reason (thin glue code, framework plumbing not meaningfully testable in isolation, one-off scripts, or the change is purely cosmetic). Each app's CLAUDE.md says what framework is set up; if none is configured for the area you're touching, ask the user before introducing one rather than silently leaving the code untested.
- **Keep CLAUDE.md files current**: After landing a change, update the relevant CLAUDE.md (this one and/or the app's) when the change affects something a future agent would rely on — new endpoint, collection, command, env var, architectural pattern, convention, or a fact that's now wrong (paths renamed, frameworks added/removed, integrations swapped). Skip the update for routine bug fixes, refactors that don't change shape, dependency bumps, copy/UI tweaks, and any change already obvious from reading the code. When in doubt: would the next agent be misled by the current text? If yes, fix it in the same change.

## Deployment

Docker images are published to GitHub Container Registry, built by the workflows in [.github/workflows/](.github/workflows/):

- **Staging** — a push to `main` rebuilds only the app whose `apps/<app>/**` changed (path-filtered):
  - backend → `ghcr.io/wepublish/one-backend:main` (+ `:main-<ts>-<sha>`)
  - frontend → `ghcr.io/wepublish/one-front:main` (+ `:main-<ts>-<sha>`)
- **Production** — a `v*` tag builds **both** production images together (lockstep release):
  - `ghcr.io/wepublish/one-backend:production` and `ghcr.io/wepublish/one-front:production`

CI structure: one reusable builder ([publish-docker-image.yml](.github/workflows/publish-docker-image.yml)) takes a build `context` (the app subfolder) + image `tags`; [build-backend-main.yml](.github/workflows/build-backend-main.yml) / [build-front-main.yml](.github/workflows/build-front-main.yml) call it with path filters; [build-production.yml](.github/workflows/build-production.yml) calls it twice on a `v*` tag. GitHub only reads workflows at the **repo root**, so both apps' pipelines live in the root `.github/workflows/`.

## Shared data model

The canonical schema lives in [apps/directus/extensions/wepublish/src/DirectusTypes.ts](apps/directus/extensions/wepublish/src/DirectusTypes.ts). The frontend keeps a **copy** at [apps/front/types/DirectusTypes.ts](apps/front/types/DirectusTypes.ts) — when changing collections in the backend, update both.

## Things to know before editing

- This is **not** an npm workspace — there is no dependency hoisting and no shared `node_modules` for the apps. Always `cd` into `apps/directus` or `apps/front` before running that app's commands. Never run `npm install` at the repo root expecting it to install app deps — the root `npm install` only installs the shared pre-commit tooling.
- The root `package.json` exists solely for Husky + lint-staged + Prettier. Don't add app dependencies to it.
- The pre-commit hook is installed at the git root (`.husky/`). The apps no longer have their own Husky setup.

## Initial setup

New contributor, fresh clone? Get both apps installed and verifiable in one go. Show progress as you work; only stop for genuine human decisions (missing GitHub access, Docker not running, a token to paste, a destructive choice).

### 1 · Preflight checks (run in parallel)

| Check            | Pass criterion             | If it fails                                                                                     |
| ---------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| `node --version` | starts with `v22.`         | Tell the user to install Node 22 (`nvm install 22 && nvm use 22`, or https://nodejs.org). Stop. |
| `npm --version`  | any version prints         | Reinstall Node 22 (npm ships with it). Stop.                                                    |
| `docker info`    | exits 0 (daemon reachable) | Tell the user to start Docker Desktop / the docker daemon. Stop.                                |

### 2 · Root tooling

From the repo root: `npm install` — installs Husky + lint-staged + Prettier and wires the pre-commit hook. Quick and safe.

### 3 · Backend setup (apps/directus)

From `apps/directus/`, in this order:

1. `npm run setup` — copies `.env.example` → `.env`, runs `npm install`, and seeds. If `.env` already exists it's left as-is.
2. Sanity-check `.env`:
   - **Do not** fill in third-party API keys (`CLOCKODO_*`, `JIRA_*`, `BEXIO_*`). The user obtains those from a teammate — see the README's "Get the missing secrets" section.
   - If `KEY` or `SECRET` are still placeholder strings, generate fresh random values (`openssl rand -hex 32` each) and write them in. Default placeholders make Directus refuse to boot in some setups.
3. `npm run db:start` — boots Postgres via Docker Compose. Wait for the container to be healthy before continuing.
4. Detect first-run vs. already-initialised: if the Postgres volume already has a populated `directus` schema, skip steps 5–6 and just confirm. Otherwise:
5. `npm run directus:init` — bootstraps Directus.
6. `npm run schema:load` — applies the version-controlled schema.
7. **Build the custom extensions bundle** (mandatory — Directus will not start without it):
   ```bash
   npm run build:extensions
   ```
   This builds each subfolder of `extensions/`, producing `extensions/wepublish/dist/{api.js,app.js}`, which Directus loads at startup. Skip it and `npm run dev` fails or boots without the custom endpoints (`/aggregatedHours`, `/networkContribution`, `/invoice-with-topup`, `/clientsOverview`, etc.) — the dashboard then 404s on every billing screen.

**Do not** start the long-running `npm run dev` for Directus during setup — that's the explicit "start the local dev environment" follow-up. Setup must terminate.

### 4 · Frontend setup (apps/front)

From `apps/front/`:

1. If `.env` doesn't exist, copy `.env.example` to `.env` (local Directus URLs only — no secrets).
2. `npm install` — also runs `nuxt prepare` via postinstall.
3. Verify: `npm run typecheck` passes (or at minimum `npm install` exits 0).

Do not start `npm run dev` during setup.

### 5 · Wrap up

Print a short, scannable summary:

- ✅ what was installed (both apps)
- ⚠️ which `.env` values still need filling in — name the variables (`CLOCKODO_USER`, `CLOCKODO_API_KEY`, `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `BEXIO_API_KEY`) and point at the README's "Get the missing secrets" section
- ▶️ how to start next: ask Claude "start the local dev environment", or open three terminals (extensions watcher → backend → frontend)
- 🔑 the local admin login: `admin@wepublish.ch` / `admin123` at http://localhost:8055

### Guardrails for setup

- **Never** commit any `.env` file anywhere.
- The `directus:init` step is not idempotent in all cases — detect existing state before running it again. When in doubt, ask before running anything destructive.
- If preflight fails midway, hand back to the user with a clear "do X, then ask me to resume setup". Don't silently work around missing Node / Docker.
- The user is likely a low-coder following the README. Default to explaining what's happening in plain language; prefer short, complete sentences over jargon.

### Common follow-up requests

- _"Start the backend"_ → **two** long-running processes, in this order:
  1. `cd apps/directus/extensions/wepublish && npm run dev` (watch-rebuilds the custom extensions). Wait until the first build completes.
  2. `cd apps/directus && npm run dev` (Postgres + Directus). Leave both streaming.

  Skipping the extensions watcher means Directus boots without the custom endpoints, and changes to extension source won't be picked up. Never start the Directus process alone unless you've just run `npm run build:extensions`.

- _"Start the frontend"_ → `cd apps/front && npm run dev` (long-running).
- _"Start everything"_ → all three above (extensions watcher → backend → frontend), in parallel background processes; report the URLs once up.
- _"Stop the local database"_ → `cd apps/directus && npm run db:reset` (or `docker compose down`).
- _"Reset my local DB"_ → `npm run db:reset` in `apps/directus/`. **Destructive** — confirm first, then re-run init + schema:load.
- _"What's the status of my local setup?"_ → check: `docker ps` (Postgres up?), `lsof -i :8055` / `:3001` (services up?), that `apps/directus` and `apps/front` are installed. Summarise.
