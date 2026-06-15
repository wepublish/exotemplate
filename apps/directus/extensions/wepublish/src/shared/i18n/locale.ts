/**
 * Locale handling for client-facing Slack messages. The language is driven by
 * the project (`Clients.language`); internal/staff messages (finance
 * over-budget escalation, the assignee halt DM, the daily capture reminder)
 * stay German and do not use this module.
 */
export type SlackLocale = 'de' | 'fr' | 'en'

export const SLACK_LOCALES: SlackLocale[] = ['de', 'fr', 'en']

/** App locale → BCP-47 tag used for Intl formatting (Swiss conventions). */
const INTL_LOCALE: Record<SlackLocale, string> = {
  de: 'de-CH',
  fr: 'fr-CH',
  en: 'en-GB'
}

/**
 * Map a `Clients.language` value to a supported Slack locale. Tolerates bare
 * codes (`de`), legacy tags (`de-DE`), casing, and null/unknown — falling back
 * to German, which is the platform default.
 */
export function resolveClientLocale(
  language: string | null | undefined
): SlackLocale {
  const value = (language ?? '').toLowerCase()
  if (value.startsWith('fr')) return 'fr'
  if (value.startsWith('en')) return 'en'
  return 'de'
}

export interface SlackFormatters {
  formatHours(hours: number): string
  formatPercent(percent: number): string
  formatDate(iso: string): string
  formatTimestamp(iso: string): string
}

/** Build locale-aware number/date formatters for a Slack message. */
export function createSlackFormatters(locale: SlackLocale): SlackFormatters {
  const tag = INTL_LOCALE[locale]
  const hours = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })
  const percent = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })
  const date = new Intl.DateTimeFormat(tag, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
  const timestamp = new Intl.DateTimeFormat(tag, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  function safeDate(iso: string, fmt: Intl.DateTimeFormat): string {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : fmt.format(d)
  }

  return {
    formatHours: (h) => `${hours.format(h)} h`,
    formatPercent: (p) => `${percent.format(p)} %`,
    formatDate: (iso) => safeDate(iso, date),
    formatTimestamp: (iso) => safeDate(iso, timestamp)
  }
}
