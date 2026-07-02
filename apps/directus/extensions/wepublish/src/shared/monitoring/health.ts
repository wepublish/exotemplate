/**
 * Pure helpers that normalize the infrastructure-configurator's health payloads
 * into stable, typed shapes for the dashboard. The configurator performs a
 * live liveness probe per medium/environment and returns latency, so there is
 * no historical uptime here — just the current status + response time.
 *
 * Kept free of any Directus / HTTP concerns so it is trivially unit-testable.
 */

export type HealthStatus = 'healthy' | 'unhealthy' | 'unreachable' | 'unknown'

const KNOWN_STATUSES: readonly HealthStatus[] = [
  'healthy',
  'unhealthy',
  'unreachable',
  'unknown'
]

// Worst-wins ordering for aggregating an overall badge across environments.
const SEVERITY: Record<HealthStatus, number> = {
  healthy: 0,
  unknown: 1,
  unhealthy: 2,
  unreachable: 3
}

export interface EnvironmentHealth {
  status: HealthStatus
  /** Probe latency in milliseconds; null when the probe didn't run. */
  responseTimeMs: number | null
  /** Failure detail from the probe (HTTP error, timeout, …); null when healthy. */
  message: string | null
}

export interface MediumEnvironments {
  production: EnvironmentHealth | null
  staging: EnvironmentHealth | null
}

export type ClientMonitoringState = 'ok' | 'notConfigured' | 'notMonitored'

export interface ClientMonitoring {
  state: ClientMonitoringState
  mediumName: string | null
  environments: MediumEnvironments | null
  overall: HealthStatus | null
  checkedAt: string | null
}

export interface MediumMonitoring {
  mediumName: string
  environments: MediumEnvironments
  overall: HealthStatus
}

export interface OverviewMonitoring {
  media: MediumMonitoring[]
  checkedAt: string | null
}

export function normalizeEnvironmentHealth(raw: any): EnvironmentHealth {
  const status: HealthStatus = KNOWN_STATUSES.includes(raw?.status)
    ? raw.status
    : 'unknown'
  const rt = raw?.response_time_ms
  const responseTimeMs =
    typeof rt === 'number' && Number.isFinite(rt) ? rt : null
  const message = typeof raw?.message === 'string' ? raw.message : null
  return { status, responseTimeMs, message }
}

export function normalizeEnvironments(rawHealth: any): MediumEnvironments {
  return {
    production:
      rawHealth?.production != null
        ? normalizeEnvironmentHealth(rawHealth.production)
        : null,
    staging:
      rawHealth?.staging != null
        ? normalizeEnvironmentHealth(rawHealth.staging)
        : null
  }
}

export function overallStatus(envs: MediumEnvironments): HealthStatus {
  const present = [envs.production, envs.staging].filter(
    (e): e is EnvironmentHealth => e != null
  )
  if (present.length === 0) return 'unknown'
  return present.reduce<HealthStatus>(
    (worst, e) => (SEVERITY[e.status] > SEVERITY[worst] ? e.status : worst),
    'healthy'
  )
}

/**
 * Shapes one client's monitoring for the dashboard card.
 * - no identifier on the client → `notConfigured`
 * - identifier set but the configurator has no data for it → `notMonitored`
 * - otherwise → `ok` with per-environment latency + an overall badge
 */
export function buildClientMonitoring(input: {
  mediumName: string | null | undefined
  raw: any | null
}): ClientMonitoring {
  const mediumName = input.mediumName ?? null
  if (!mediumName) {
    return {
      state: 'notConfigured',
      mediumName: null,
      environments: null,
      overall: null,
      checkedAt: null
    }
  }
  if (input.raw == null) {
    return {
      state: 'notMonitored',
      mediumName,
      environments: null,
      overall: null,
      checkedAt: null
    }
  }
  const environments = normalizeEnvironments(input.raw.health)
  return {
    state: 'ok',
    mediumName,
    environments,
    overall: overallStatus(environments),
    checkedAt:
      typeof input.raw.checked_at === 'string' ? input.raw.checked_at : null
  }
}

/** Shapes the all-media response for the admin overview grid. */
export function buildOverviewMonitoring(raw: any): OverviewMonitoring {
  const health = raw?.health
  if (!health || typeof health !== 'object') {
    return { media: [], checkedAt: null }
  }
  const media: MediumMonitoring[] = Object.keys(health)
    .sort()
    .map((mediumName) => {
      const environments = normalizeEnvironments(health[mediumName])
      return { mediumName, environments, overall: overallStatus(environments) }
    })
  return {
    media,
    checkedAt: typeof raw.checked_at === 'string' ? raw.checked_at : null
  }
}
