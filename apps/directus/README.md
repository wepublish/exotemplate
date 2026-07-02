# Inside We.Publish Backend

Backend serving We.Publish Inside Front-End. The Project is based on Directus headless cms.

## Get started

- Initialize repository run: `npm run setup`
- Start local postgres database run: `npm run db:start`
- Initialize directus run: `npm run directus:init`
- Start directus run: `npm run directus:start`
- Log-in into Directus, create api-token for an Admin User and add it in the `.env` file at `DIRECTUS_TOKEN` variable
- `npm run schema:load`
- `npm run schema:seed`

## Dev Credentials:

URL: http://localhost:8055  
Username: admin@wepublish.ch
Password: admin

## Seeding

Seed data is managed with [directus-sync](https://tractr.github.io/directus-sync/) and lives as JSON files in `schema/seed/`. Each file declares a collection and a list of rows keyed by a stable `_sync_id`; directus-sync resolves relations between rows by that id and upserts everything against a **running** Directus instance.

- `npm run schema:seed` — seed the data (idempotent, safe to re-run)
- `npm run schema:seed:diff` — preview pending changes

What gets seeded:

- `NotificationThresholds.json` — notification threshold configuration.
- `OneTestDemoClient.json` — a ready-to-use **demo client** so the dashboard has something to show locally:
  - a `One Test` client (Jira `ONETEST`, Clockodo `4938992`, Slack `C0AUCDV2J6B`, Bexio contact `37`, onboarding step `8`)
  - the admin user as an allowed user
  - a `1. Halbjahr 2026` billing period (`2026-01-01` → `2026-06-30`)
  - the client↔period link
  - a 10'000 CHF top-up using the schema defaults (hourly rate `120`, WeP percentage `20`)
  - a manual work entry deducting `5.75` hours from that period

### Referencing the admin user

The admin user is created by `directus bootstrap` with a non-deterministic UUID, so it has no directus-sync id-map entry and can't be referenced from a seed file out of the box. `npm run schema:seed` therefore first runs `npm run seed:prepare` ([scripts/seed-prepare.mjs](scripts/seed-prepare.mjs)), which looks up the admin via `/users/me` and registers it in the id-map under the stable sync id `admin-user`. The `Clients_directus_users` seed then grants access with a plain `"directus_users_id": "admin-user"` reference.

`seed:prepare` reads `DIRECTUS_URL` + `DIRECTUS_TOKEN` from `.env` (falling back to `DIRECTUS_ADMIN_EMAIL` / `DIRECTUS_ADMIN_PASSWORD`) — the same variables directus-sync uses. "The admin user" is whoever those credentials resolve to.

> Adding more seed data that links to the admin (or any other bootstrapped record): reference it by its sync id in the seed JSON and make sure a matching id-map entry exists (extend `seed-prepare.mjs` if needed).

## Save made changes

To synchronize settings and schema among environments we use [directus-sync](https://tractr.github.io/directus-sync/)

- Store new schema run: `npm run schema:dump`
- Push changes to git.

## Deployment

This project is deployed automatically via CI/CD:

- **Staging**  
  Every push to the `main` branch is automatically deployed to **staging**.

- **Production**  
   Every Git tag matching `v*` (e.g. `v1.2.0`) is automatically deployed to **production**.
  elias@Thinpad-p1:~/gitroot/wepublish/one$ git push --set-upstream origin main
  To github.com:wepublish/one.git
  ! [rejected] main -> main (non-fast-forward)
  error: failed to push some refs to 'github.com:wepublish/one.git'
  hint: Updates were rejected because the tip of your current branch is behind
  hint: its remote counterpart. If you want to integrate the remote changes,
  hint: use 'git pull' before pushing again.
  hint: See the 'Note about fast-forwards' in 'git push --help' for details.
