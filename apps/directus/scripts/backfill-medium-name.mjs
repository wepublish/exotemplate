// One-time backfill: auto-generates a best-effort `medium_name` (Terraform
// identifier) for existing clients that predate the field. New clients get it
// from onboarding; this fills the historical rows.
//
// The generated value is a slug of the client name and is very likely NOT the
// real infrastructure-configurator identifier — it's a starting point an admin
// then corrects in Directus. Only rows with an empty medium_name are touched,
// so the script is idempotent and never overwrites a curated value.
//
// Reads DIRECTUS_URL + DIRECTUS_TOKEN from .env (falling back to
// DIRECTUS_ADMIN_EMAIL / DIRECTUS_ADMIN_PASSWORD login), the same variables
// directus-sync uses.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Mirror of shared/monitoring/mediumName.ts (kept inline — this .mjs script
// can't import the TS bundle). Terraform identifier: ^[a-z][a-z0-9_]*$
function slugifyMediumName(name) {
  const base = (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (base === '') return ''
  return /^[a-z]/.test(base) ? base : `m${base}`
}

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
      if (env[key] !== undefined) continue
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

  const clients = await api(
    '/items/Clients?fields=id,name,medium_name&limit=-1'
  )
  const missing = clients.filter(
    (c) => !c.medium_name || String(c.medium_name).trim() === ''
  )

  if (missing.length === 0) {
    console.log('• All clients already have a medium_name — nothing to do.')
    return
  }

  let filled = 0
  let skipped = 0
  for (const client of missing) {
    const slug = slugifyMediumName(client.name)
    if (!slug) {
      console.warn(
        `⚠ Could not derive a medium_name for "${client.name}" (${client.id}) — skipped, set it manually.`
      )
      skipped++
      continue
    }
    await api(`/items/Clients/${client.id}`, {
      method: 'PATCH',
      body: { medium_name: slug }
    })
    console.log(`✓ ${client.name} → medium_name "${slug}"`)
    filled++
  }

  console.log(
    `\nDone. ${filled} filled, ${skipped} skipped. Review generated values in Directus — a slug rarely matches the real Terraform identifier.`
  )
}

main().catch((err) => {
  console.error(`\nBackfill failed: ${err.message}`)
  process.exit(1)
})
