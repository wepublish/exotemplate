/**
 * Types + pure helpers for the infrastructure-configurator's per-medium config
 * (proxied via Directus `/client-onboarding/infra-configuration`). Each medium
 * has a `production` and optional `staging` environment with the same shape.
 *
 * The parsing here (image tag → readable build date + git sha) is the only real
 * logic, so it's unit-tested; the rest is display in the components.
 */

export interface InfraResources {
  requests?: { memory?: string; cpu?: string }
  limits?: { memory?: string; cpu?: string }
}

export interface InfraComponent {
  image: string
  resources?: InfraResources
}

export interface InfraProviderRef {
  id?: string
  type?: string
}

export interface InfraEnvironmentConfig {
  urls?: {
    api?: string
    editor?: string
    website?: string
    media_server?: string
  }
  components?: Record<string, InfraComponent>
  config?: {
    mailProvider?: InfraProviderRef
    paymentProviders?: InfraProviderRef[]
    challenge?: InfraProviderRef
    trackingPixelProviders?: InfraProviderRef[]
    aiProvider?: InfraProviderRef
    mediaServer?: { type?: string; quality?: number }
  }
  helm_chart_version?: string
}

export interface InfraMediumConfig {
  production?: InfraEnvironmentConfig
  staging?: InfraEnvironmentConfig
}

export interface InfraConfigResponse {
  media: Record<string, InfraMediumConfig>
  fetched_at?: string
}

export type InfraEnvironmentKey = 'production' | 'staging'

export interface ParsedImageTag {
  /** Raw tag (everything after the last colon). */
  raw: string
  /** Leading channel segment, e.g. "production" / "master". */
  channel: string
  /** Build/release time derived from the tag, or null if not encoded. */
  releasedAt: Date | null
  /** Full git sha if the tag carries one, else null. */
  sha: string | null
}

/** Everything after the last `:` — the image tag. */
export function imageTagOf(image: string): string {
  const idx = (image ?? '').lastIndexOf(':')
  return idx === -1 ? (image ?? '') : image.slice(idx + 1)
}

export function shortSha(sha: string | null): string | null {
  return sha ? sha.slice(0, 7) : null
}

/**
 * Best-effort browsable link for a GHCR image → its GitHub org container-package
 * page (`https://github.com/orgs/<owner>/packages/container/package/<name>`).
 * Returns null for non-ghcr.io images (nothing to link to).
 */
export function ghcrPackageUrl(image: string): string | null {
  const repo = (image ?? '').split(':')[0] ?? '' // strip tag
  const parts = repo.split('/')
  if (parts[0] !== 'ghcr.io' || parts.length < 3) return null
  const owner = parts[1]
  const name = parts.slice(2).join('/')
  if (!owner || !name) return null
  return `https://github.com/orgs/${owner}/packages/container/package/${name}`
}

function parseCalendarStamp(seg: string): Date | null {
  // YYYYMMDDHHMM
  const y = Number(seg.slice(0, 4))
  const mo = Number(seg.slice(4, 6))
  const d = Number(seg.slice(6, 8))
  const h = Number(seg.slice(8, 10))
  const mi = Number(seg.slice(10, 12))
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  return new Date(Date.UTC(y, mo - 1, d, h, mi))
}

/**
 * Parses a we.publish image tag into a readable build. Handles both shapes seen
 * in the config:
 *  - `production-bajour-202606111703` / `production-202606111703`
 *    → a 12-digit YYYYMMDDHHMM calendar stamp
 *  - `master-1782982054-<40-hex-sha>`
 *    → a 10-digit unix epoch (seconds) plus a git sha
 */
export function parseImageTag(tag: string): ParsedImageTag {
  const raw = tag ?? ''
  const segments = raw.split('-')
  let releasedAt: Date | null = null
  let sha: string | null = null

  for (const seg of segments) {
    if (sha === null && /^[0-9a-f]{40}$/.test(seg)) {
      sha = seg
      continue
    }
    if (releasedAt === null && /^\d{12}$/.test(seg)) {
      releasedAt = parseCalendarStamp(seg)
      continue
    }
    if (releasedAt === null && /^\d{10}$/.test(seg)) {
      releasedAt = new Date(Number(seg) * 1000)
    }
  }

  return {
    raw,
    channel: segments[0] ?? raw,
    releasedAt,
    sha
  }
}

/** Ordered component keys for stable display (falls back to alpha for extras). */
export const INFRA_COMPONENT_ORDER = [
  'api',
  'editor',
  'website',
  'media',
  'migration'
] as const

export function orderedComponentKeys(
  components: Record<string, InfraComponent> | undefined
): string[] {
  const keys = Object.keys(components ?? {})
  const rank = (k: string) => {
    const i = (INFRA_COMPONENT_ORDER as readonly string[]).indexOf(k)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}
