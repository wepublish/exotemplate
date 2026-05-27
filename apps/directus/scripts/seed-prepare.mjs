// Prepares the directus-sync seed run by registering the admin user in
// directus-sync's id-map (the `directus_sync_id_map` table managed by
// directus-extension-sync).
//
// Why this exists: the seed files in `schema/seed/` reference relations by a
// stable `_sync_id`, which directus-sync resolves to a local id via that map.
// Records created by the seed get their map entries automatically, but the
// admin user is created by `directus bootstrap` with a non-deterministic UUID
// and has no map entry. By inserting one here (sync_id "admin-user" -> the
// admin's UUID, under the `users` table, the directus-sync naming for
// `directus_users`), the `Clients_directus_users` seed can grant the admin
// access with a plain `"directus_users_id": "admin-user"` reference.
//
// Idempotent: the map row is created once and kept in sync on re-runs.
// Reads DIRECTUS_URL + DIRECTUS_TOKEN from .env (falling back to
// DIRECTUS_ADMIN_EMAIL / DIRECTUS_ADMIN_PASSWORD login), the same variables
// directus-sync uses. "The admin user" is whoever those credentials resolve to
// via /users/me.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// directus-sync stores the map under the table name with the `directus_`
// prefix stripped, so `directus_users` becomes `users`.
const USERS_TABLE = 'users'
const ADMIN_SYNC_ID = 'admin-user'

function loadEnv() {
  const env = { ...process.env }
  try {
    const raw = readFileSync(resolve(ROOT, '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      if (env[key] !== undefined) continue // real process.env wins over .env
      env[key] = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
    }
  } catch {
    // no .env file — rely on process.env / defaults
  }
  return env
}

const env = loadEnv()
const DIRECTUS_URL = (env.DIRECTUS_URL || 'http://localhost:8055').replace(
  /\/$/,
  ''
)

let authHeader

async function authenticate() {
  if (env.DIRECTUS_TOKEN) {
    authHeader = `Bearer ${env.DIRECTUS_TOKEN}`
    return
  }
  if (env.DIRECTUS_ADMIN_EMAIL && env.DIRECTUS_ADMIN_PASSWORD) {
    const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: env.DIRECTUS_ADMIN_EMAIL,
        password: env.DIRECTUS_ADMIN_PASSWORD
      })
    })
    if (!res.ok) {
      throw new Error(`Login failed (${res.status}): ${await res.text()}`)
    }
    authHeader = `Bearer ${(await res.json()).data.access_token}`
    return
  }
  throw new Error(
    'No credentials found. Set DIRECTUS_TOKEN (or DIRECTUS_ADMIN_EMAIL + DIRECTUS_ADMIN_PASSWORD) in .env.'
  )
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    method,
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  }
  return text ? JSON.parse(text).data : null
}

async function main() {
  await authenticate()
  const me = await api('/users/me?fields=id,email')

  const params = new URLSearchParams({
    filter: JSON.stringify({
      _and: [
        { table: { _eq: USERS_TABLE } },
        { sync_id: { _eq: ADMIN_SYNC_ID } }
      ]
    }),
    fields: 'id,local_id',
    limit: '1'
  })
  const [existing] = await api(`/items/directus_sync_id_map?${params}`)

  if (!existing) {
    await api('/items/directus_sync_id_map', {
      method: 'POST',
      body: { table: USERS_TABLE, sync_id: ADMIN_SYNC_ID, local_id: me.id }
    })
    console.log(
      `✓ Registered admin (${me.email}) as sync id "${ADMIN_SYNC_ID}"`
    )
  } else if (existing.local_id !== me.id) {
    await api(`/items/directus_sync_id_map/${existing.id}`, {
      method: 'PATCH',
      body: { local_id: me.id }
    })
    console.log(`✓ Updated sync id "${ADMIN_SYNC_ID}" → admin (${me.email})`)
  } else {
    console.log(
      `• Admin (${me.email}) already registered as "${ADMIN_SYNC_ID}"`
    )
  }
}

main().catch((err) => {
  console.error(`\nSeed preparation failed: ${err.message}`)
  process.exit(1)
})
