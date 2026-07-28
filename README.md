# We.Publish FaaS — Fundraising Platform

**We.Publish FaaS** ("Fundraising as a Service") is the research-and-generation platform for the We.Publish foundation's fundraising work. It helps a fundraising operator **find money for media**: it researches Swiss funding foundations and calls, matches them to each media outlet by a computed "DNA" score, and then helps **generate the grant applications** ("Gesuche") that go out to those funders — plus a self-service portal where the media outlets drive their own onboarding.

This repository is a **monorepo** holding the applications side by side:

| Path                             | App                                     | Stack                             | Port |
| -------------------------------- | --------------------------------------- | --------------------------------- | ---- |
| [apps/directus/](apps/directus/) | Backend — data store (foundations, media, DNA, matches, grants) | Directus 11, TypeScript, Postgres | 8055 |
| [apps/front/](apps/front/)       | Frontend — operator dashboard + media self-service portal | Next.js 15, React 19, MUI, Apollo | 3000 |
| [pipeline/](pipeline/)           | Research/matching/automation pipeline on the GPU host ("Spark") | Python 3, cron + systemd | — |

The two apps are **built and deployed independently** (see [Deployment](#deployment)); this is a monorepo, not an npm workspace. Each app has its own `package.json`, dependencies, and build — you install and run them separately. The root only carries shared pre-commit tooling (Prettier via Husky + lint-staged) and CI.

> **No deep coding knowledge required.** If you can install a few tools and copy-paste a sentence into a chat box, you can get this running.

---

## What the platform does

- **Research & discovery** — background jobs scout new funding calls and foundations and write them into the data store; the operator reviews them as agent proposals.
- **DNA & matching** — each medium and each foundation gets a "DNA" profile; a matching engine scores every medium × foundation pair and surfaces the best-fit funders per medium, with a written rationale.
- **Grant generation** — from a match, the app drafts a tailored grant application (via a self-hosted LLM, or a copy-paste prompt for a stronger model), which the operator reviews, approves, and sends.
- **Onboarding & media portal** — a magic-link self-service portal where each media outlet uploads its material, has its DNA generated, sees its matches, and follows its grants.
- **Funder sub-databases** — dedicated views for the foundation database, church/special funders, lottery funds, and open funding calls ("Ausschreibungen").

The heavy research and matching computation runs as a **Python pipeline** (see [`pipeline/`](pipeline/) — its [README](pipeline/README.md) and [`MANIFEST.tsv`](pipeline/MANIFEST.tsv) record what runs where, on which schedule) on a separate GPU host alongside a local LLM; the frontend is the operator/portal UI on top of the same data. The pipeline produces and maintains the DNA and match data the app reads, and runs the background automations the app's API routes trigger. Run [`scripts/verify-spark.sh`](scripts/verify-spark.sh) to confirm the GPU host is executing exactly the committed version.

Branding and the tenant's media list live in [`apps/front/config/tenant.ts`](apps/front/config/tenant.ts) — the one file that differs between tenant instances.

---

## 1 · What you need to install first

Install these once on your machine. If you already have them, skip ahead.

| Tool            | What it's for                                     | Install                                                       |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| **Node.js 22**  | Runs the backend and the frontend                 | https://nodejs.org (LTS) or, if you use nvm: `nvm install 22` |
| **Docker**      | Runs the local Postgres database                  | https://www.docker.com/products/docker-desktop                |
| **Git**         | Downloads the source code                         | Usually already there; otherwise https://git-scm.com          |
| **GitHub CLI**  | Easiest way to log in to GitHub from the terminal | https://cli.github.com — then run `gh auth login`             |
| **Claude Code** | The AI assistant that helps with setup            | https://claude.com/claude-code                                |

You also need to be a member of the **`wepublish` GitHub organisation** — this repository is private. If you don't have access yet, email **michael@wepublish.ch** for an invite.

---

## 2 · Clone the repo

```bash
gh auth login            # GitHub.com → HTTPS → authenticate Git (one-time)
git clone https://github.com/wepublish/faas
cd faas
```

---

## 3 · Let Claude set it up

Open the `faas` folder in **Claude Code** and paste:

> **Please run the "Initial setup" from CLAUDE.md.**

Claude will install both apps, start a local Postgres in Docker, bootstrap Directus, load the schema, and build the custom extensions. It only stops to ask when it genuinely needs you (Docker not running, a token to paste, etc.). When done it prints what you still need to fill in (step 4).

To do it by hand instead:

```bash
# Backend
cd apps/directus && npm run setup      # copies .env.example → .env, installs, seeds
npm run build:extensions               # mandatory — Directus won't start without it

# Frontend
cd ../front && npm install             # installs deps (Next.js)
cp .env.local.example .env.local       # then fill in the values from step 4
```

---

## 4 · Configure the frontend's connections

The frontend reads its configuration from `apps/front/.env.local` (copy it from `.env.local.example`). None of these are committed to the repo.

**Required for the app to start:**

| Variable               | What it's for                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `DIRECTUS_URL`         | Base URL of the Directus data store — `http://localhost:8055` locally, or the shared instance     |
| `DIRECTUS_TOKEN`       | Bearer token for Directus (server-side only — never exposed to the browser). Create it in the Directus admin: log in, add a static token to an admin user, paste it here |
| `PORTAL_SESSION_SECRET`| Signs the media portal's magic-link sessions. Without it, every `/api/portal/*` route returns 503 |
| `PORTAL_BASE_URL`      | Base URL used in login links (leave empty for a relative link when portal and app share an origin) |

**Optional — external research/generation services** (these live on the FaaS "Spark" host; leave at defaults or blank for a UI-only local run):

| Variable                                     | What it's for                                        |
| -------------------------------------------- | ---------------------------------------------------- |
| `LLM_URL`, `LLM_MODEL`                        | Self-hosted vLLM endpoint used to draft grant texts and DNA |
| `LLM_URL_FALLBACK`, `LLM_MODEL_FALLBACK`      | Fallback LLM endpoint/model                           |
| `FIRECRAWL_URL`                               | Firecrawl scraper used to enrich DNA from the web    |
| `HERMES_API_URL`, `HERMES_API_KEY`            | FaaS "Hermes" adapter (agent chat, briefings, outbox)|
| `FAAS_AGENT_ENABLED`                          | Toggles the in-app agent chat (default `false`)      |
| `PORTAL_TREFFER_LIMIT`                        | Max matches shown in the portal (default 20)         |
| `DATENSUPPE_BASE`                             | Filesystem path to the per-medium document tree      |

Without the optional services the dashboard, matching lists, and portal still work against Directus; only the on-demand generation/enrichment features that call those services will error.

---

## 5 · Start the app

Ask Claude _"Please start the local dev environment"_, or run it by hand in **three** terminals (the backend needs two — the custom extensions are a separate package compiled in watch mode, otherwise Directus refuses to start):

```bash
# Terminal 1 — backend extensions (watch & rebuild)
cd apps/directus/extensions/wepublish && npm run dev

# Terminal 2 — backend (Postgres + Directus)
cd apps/directus && npm run dev

# Terminal 3 — frontend
cd apps/front && npm run dev
```

> Always start the **extensions watcher first** and wait until it prints a successful build. Only then start the backend in Terminal 2 — otherwise Directus boots without its custom endpoints.

Then open:

- **Frontend (dashboard):** http://localhost:3000
- **Backend (Directus admin):** http://localhost:8055 — login `admin@wepublish.ch` / `admin123`

---

## Repository layout

```
faas/
├── README.md              ← this file
├── CLAUDE.md              ← instructions Claude follows
├── package.json           ← root tooling only (husky + lint-staged + prettier)
├── .github/workflows/     ← CI: path-filtered image builds
├── apps/
│   ├── directus/          ← Directus 11 backend — the fundraising data store
│   └── front/             ← Next.js 15 frontend (operator dashboard + media portal)
│       ├── src/           ← pages, API routes, GraphQL queries, libs
│       └── config/        ← tenant.ts (branding + media list)
├── pipeline/              ← Python research/matching/automation pipeline (GPU host)
│   ├── spark/             ← every script that runs on the GPU host
│   ├── systemd/           ← unit files of the long-running services
│   ├── tests/             ← engine + watchdog tests
│   └── MANIFEST.tsv       ← authoritative: deploy path, schedule and purpose per file
└── scripts/
    ├── save.sh            ← commit + push
    ├── deploy-front.sh    ← build the front image on the Mac, ship it to the VPS
    ├── ship.sh            ← save + deploy in one step
    └── verify-spark.sh    ← does the GPU host run exactly the committed pipeline?
```

---

## Deployment

Images are published to GitHub Container Registry:

- **Staging** — a push to `main` rebuilds only the app whose `apps/<app>/**` changed:
  `ghcr.io/wepublish/faas-backend:main` and `ghcr.io/wepublish/faas-front:main`.
- **Production** — a `v*` tag builds **both** production images together:
  `ghcr.io/wepublish/faas-backend:production` and `ghcr.io/wepublish/faas-front:production`.

---

## Handy prompts

- _"Start the backend / frontend / everything."_
- _"Stop the local database."_
- _"What's the status of my local setup right now?"_
- _"Reset my local database from scratch."_ _(destructive — Claude confirms first)_

Deeper guidance lives in [CLAUDE.md](CLAUDE.md), [apps/directus/README.md](apps/directus/README.md), and [apps/front/README.md](apps/front/README.md).

---

## Troubleshooting

| Symptom                                        | Likely cause / fix                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `gh: not found`                                | GitHub CLI isn't installed — https://cli.github.com.                                                |
| `Repository not found` when cloning            | You're not in the `wepublish` GitHub org yet, **or** you skipped `gh auth login`.                   |
| `Cannot connect to the Docker daemon`          | Docker Desktop isn't running. Start it and retry.                                                   |
| `Port 8055/3000/5432 already in use`           | Something else is on that port. Stop it, or ask Claude to find what's using it.                     |
| Frontend loads but data is empty / errors      | `DIRECTUS_URL` / `DIRECTUS_TOKEN` in `apps/front/.env.local` are missing or wrong — see step 4.     |
| Every `/api/portal/*` returns 503              | `PORTAL_SESSION_SECRET` isn't set in `apps/front/.env.local`.                                        |
| Generation / DNA / scrape features error       | The optional LLM / Firecrawl / Hermes services aren't reachable — see the optional table in step 4. |
| Directus boots without custom endpoints        | You didn't run `npm run build:extensions`, or started Directus before the extensions watcher built. |
