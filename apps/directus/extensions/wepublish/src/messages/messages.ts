// Pure logic for the dashboard/editor messages feature. Kept free of Directus
// so it's unit-testable; the endpoint wires the ItemsService into these.

export type Severity = 'info' | 'warning' | 'critical'

export interface AnnouncementTranslation {
  locale: string
  title: string | null
  body: string | null
  link_label: string | null
}

/** An announcement row as fetched (with `client.medium_name` + `translations`). */
export interface RawAnnouncement {
  id: number
  status: string
  sort: number | null
  severity: string
  title: string
  body: string | null
  link_label: string | null
  link_url: string | null
  starts_at: string | null
  ends_at: string | null
  dismissible: boolean
  // Target media (by `medium_name`). Empty/null = general (all media).
  clients: { medium_name: string | null }[] | null
  translations: AnnouncementTranslation[] | null
}

/** The public, locale-resolved message shape returned by the endpoint. */
export interface ResolvedMessage {
  id: number
  severity: Severity
  title: string
  body: string | null
  link_label: string | null
  link_url: string | null
  dismissible: boolean
  starts_at: string | null
  ends_at: string | null
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2
}

const normalizeSeverity = (value: string): Severity =>
  value === 'critical' || value === 'warning' ? value : 'info'

/** Published and within its optional [starts_at, ends_at] window at `nowMs`. */
export function isActiveAnnouncement(
  a: RawAnnouncement,
  nowMs: number
): boolean {
  if (a.status !== 'published') return false
  if (a.starts_at && Date.parse(a.starts_at) > nowMs) return false
  if (a.ends_at && Date.parse(a.ends_at) < nowMs) return false
  return true
}

/**
 * Resolve the display text for a reader locale: a matching-locale translation
 * wins per field, but any empty translation field falls back to the base — so
 * partial translations are safe and "base only" always works.
 */
export function resolveAnnouncement(
  a: RawAnnouncement,
  locale: string | undefined
): { title: string; body: string | null; link_label: string | null } {
  const tr = (a.translations ?? []).find((t) => t.locale === locale)
  const pick = (
    t: string | null | undefined,
    fallback: string | null
  ): string | null => (t && t.trim() !== '' ? t : fallback)
  return {
    title: pick(tr?.title, a.title) ?? a.title,
    body: pick(tr?.body, a.body),
    link_label: pick(tr?.link_label, a.link_label)
  }
}

/**
 * Active messages for a medium (general + that medium), resolved to the reader
 * locale and sorted critical → warning → info (then by sort/id). Omit `medium`
 * to get only the general messages.
 */
export function selectActiveMessages(
  list: RawAnnouncement[],
  opts: { medium?: string | null; locale?: string; now?: number }
): ResolvedMessage[] {
  const nowMs = opts.now ?? Date.now()
  return list
    .filter((a) => isActiveAnnouncement(a, nowMs))
    .filter((a) => {
      const media = (a.clients ?? [])
        .map((c) => c.medium_name)
        .filter((m): m is string => !!m)
      if (media.length === 0) return true // general = all media
      return !!opts.medium && media.includes(opts.medium)
    })
    .sort((a, b) => {
      const s =
        SEVERITY_ORDER[normalizeSeverity(a.severity)] -
        SEVERITY_ORDER[normalizeSeverity(b.severity)]
      if (s !== 0) return s
      return (a.sort ?? a.id) - (b.sort ?? b.id)
    })
    .map((a) => {
      const r = resolveAnnouncement(a, opts.locale)
      return {
        id: a.id,
        severity: normalizeSeverity(a.severity),
        title: r.title,
        body: r.body,
        link_label: r.link_label,
        link_url: a.link_url,
        dismissible: a.dismissible,
        starts_at: a.starts_at,
        ends_at: a.ends_at
      }
    })
}
