/**
 * env-check.ts: minimale Start-Diagnose für fehlende Pflicht-Umgebungsvariablen.
 *
 * Zweck: beim Hetzner-Deploy (oder jedem anderen Environment) früh sichtbar
 * machen, wenn eine der vier Pflicht-Envs fehlt oder leer ist - statt dass die
 * App erst später mit kryptischen 503/401-Fehlern auffällt. Reine Diagnose,
 * kein Gate: die App startet trotzdem, es wird nur einmalig gewarnt.
 */

/** Pflicht-Envs, ohne die Directus-Zugriff bzw. das Portal nicht funktionieren. */
export const PFLICHT_ENVS = [
  'DIRECTUS_URL',
  'DIRECTUS_TOKEN',
  'PORTAL_SESSION_SECRET',
  'PORTAL_BASE_URL',
] as const

/**
 * Gibt die Namen der fehlenden bzw. leeren Pflicht-Envs zurück (Reihenfolge
 * wie `PFLICHT_ENVS`). Ein leerer String zählt als fehlend. Vollständig
 * gesetzt ergibt eine leere Liste.
 */
export function fehlendePflichtEnvs(env: Record<string, string | undefined>): string[] {
  return PFLICHT_ENVS.filter((name) => !env[name])
}

let schonGewarnt = false

/**
 * Loggt beim ersten Aufruf eine einzige `console.warn`-Zeile mit den fehlenden
 * Pflicht-Envs (falls welche fehlen); bei vollständiger Konfiguration bleibt
 * sie still. Jeder weitere Aufruf - egal mit welchem Ergebnis - ist danach
 * dauerhaft still (Einmal-Flag, kein Log-Spam bei jedem API-Aufruf).
 */
export function warneEinmalig(env: Record<string, string | undefined> = process.env): void {
  if (schonGewarnt) return
  schonGewarnt = true
  const fehlend = fehlendePflichtEnvs(env)
  if (fehlend.length === 0) return
  console.warn(
    `[env-check] Fehlende Pflicht-Umgebungsvariablen: ${fehlend.join(', ')} - siehe deploy/hetzner/.env.example`
  )
}

/** Nur für Tests: setzt das Einmal-Flag zurück. */
export function __resetWarnungFuerTests(): void {
  schonGewarnt = false
}
