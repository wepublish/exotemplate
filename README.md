# We.Publish ONE — Monorepo

**We.Publish ONE** is the billing, time-tracking, and onboarding platform for We.Publish media clients. This repository is a **monorepo** holding both applications side by side:

| Path                             | App                         | Stack                             | Port |
| -------------------------------- | --------------------------- | --------------------------------- | ---- |
| [apps/directus/](apps/directus/) | Backend — Directus 11 CMS   | Directus 11, TypeScript, Postgres | 8055 |
| [apps/front/](apps/front/)       | Frontend — client dashboard | Nuxt 4, Vue 3, Pinia, @nuxt/ui    | 3000 |

The two apps are **built and deployed independently** (see [Deployment](#deployment)); this is a monorepo, not an npm workspace. Each app has its own `package.json`, dependencies, and build — you install and run them separately. The root only carries shared pre-commit tooling (Prettier via Husky + lint-staged) and CI.

> **No deep coding knowledge required.** If you can install a few tools and copy-paste a sentence into a chat box, you can get this running.

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
git clone https://github.com/wepublish/one
cd one
```

---

## 3 · Let Claude set it up

Open the `one` folder in **Claude Code** and paste:

> **Please run the "Initial setup" from CLAUDE.md.**

Claude will install both apps, start a local Postgres in Docker, bootstrap Directus, load the schema, and build the custom extensions. It only stops to ask when it genuinely needs you (Docker not running, missing secrets, etc.). When done it prints which secrets you still need to fill in (step 4).

To do it by hand instead:

```bash
# Backend
cd apps/directus && npm run setup      # copies .env.example → .env, installs, seeds
npm run build:extensions               # mandatory — Directus won't start without it

# Frontend
cd ../front && npm install             # also runs `nuxt prepare`
```

---

## 4 · Get the missing secrets from the team

The backend talks to three external services. Their API keys are **not** in any repo. Ask a teammate or check the team password vault, and paste them into `apps/directus/.env`:

| Variable                                    | What it's for             |
| ------------------------------------------- | ------------------------- |
| `CLOCKODO_USER`, `CLOCKODO_API_KEY`         | Time tracking (Clockodo)  |
| `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Issue estimates from Jira |
| `BEXIO_API_KEY`                             | Invoicing (Bexio)         |

Without these the backend still starts, but billing-related dashboard screens will error when they load real data.

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

> Always start the **extensions watcher first** and wait until it prints a successful build. Only then start the backend in Terminal 2 — otherwise Directus boots without the custom endpoints (`/aggregatedHours`, `/invoice-with-topup`, etc.) and the dashboard's billing screens return 404s.

Then open:

- **Frontend (dashboard):** http://localhost:3000
- **Backend (Directus admin):** http://localhost:8055 — login `admin@wepublish.ch` / `admin123`

---

## Repository layout

```
one/
├── README.md              ← this file
├── CLAUDE.md              ← instructions Claude follows
├── package.json           ← root tooling only (husky + lint-staged + prettier)
├── .github/workflows/     ← CI: path-filtered image builds
└── apps/
    ├── directus/          ← Directus 11 backend  (was wepublish/inside-backend)
    └── front/             ← Nuxt 4 frontend      (was wepublish/inside)
```

---

## Deployment

Images are published to GitHub Container Registry:

- **Staging** — a push to `main` rebuilds only the app whose `apps/<app>/**` changed:
  `ghcr.io/wepublish/one-backend:main` and `ghcr.io/wepublish/one-front:main`.
- **Production** — a `v*` tag builds **both** production images together:
  `ghcr.io/wepublish/one-backend:production` and `ghcr.io/wepublish/one-front:production`.

---

## Handy prompts

- _"Start the backend / frontend / everything."_
- _"Stop the local database."_
- _"What's the status of my local setup right now?"_
- _"Reset my local database from scratch."_ _(destructive — Claude confirms first)_

Deeper guidance lives in [CLAUDE.md](CLAUDE.md), [apps/directus/CLAUDE.md](apps/directus/CLAUDE.md), and [apps/front/CLAUDE.md](apps/front/CLAUDE.md).

---

## Troubleshooting

| Symptom                                        | Likely cause / fix                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `gh: not found`                                | GitHub CLI isn't installed — https://cli.github.com.                                                |
| `Repository not found` when cloning            | You're not in the `wepublish` GitHub org yet, **or** you skipped `gh auth login`.                   |
| `Cannot connect to the Docker daemon`          | Docker Desktop isn't running. Start it and retry.                                                   |
| `Port 8055/3000/5432 already in use`           | Something else is on that port. Stop it, or ask Claude to find what's using it.                     |
| Backend starts but billing pages fail          | You're missing the Clockodo / Jira / Bexio keys — see step 4.                                       |
| Directus boots without custom endpoints (404s) | You didn't run `npm run build:extensions`, or started Directus before the extensions watcher built. |

---

## Related project

[`infrastructure-configurator`](https://github.com/wepublish/infrastructure-configurator) — automates onboarding new media clients via GitHub PRs. It is **operationally separate** and lives in its **own repository**, not in this monorepo.
