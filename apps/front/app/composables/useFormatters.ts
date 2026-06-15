import { useI18n } from 'vue-i18n'

/**
 * Maps an app locale code to the BCP-47 tag used for `Intl` formatting. The
 * app deliberately formats with Swiss conventions (e.g. `de-CH` renders
 * "1.5 h", while generic `de` would render "1,5 h"), so number/date output
 * stays consistent with what the dashboard has always shown.
 */
const INTL_LOCALE: Record<string, string> = {
  de: 'de-CH',
  fr: 'fr-CH',
  en: 'en-GB'
}

export function intlLocaleFor(code: string): string {
  return INTL_LOCALE[code] ?? 'de-CH'
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Locale-aware formatting helpers. All functions read the current i18n locale
 * reactively, so values re-format live when the user switches language. This
 * is the single source for number/date formatting — vue-i18n's `$n`/`$d` are
 * intentionally not used (they key Intl by the locale code, dropping the
 * Swiss tag mapping above).
 */
export function useFormatters() {
  const { locale } = useI18n()
  const intlLocale = computed(() => intlLocaleFor(locale.value))

  function formatNumber(
    value: number | null | undefined,
    options: Intl.NumberFormatOptions = {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }
  ): string {
    const n = Number(value)
    if (!Number.isFinite(n)) return '–'
    return new Intl.NumberFormat(intlLocale.value, options).format(n)
  }

  function formatHours(value: number | null | undefined): string {
    const n = Number(value)
    if (!Number.isFinite(n)) return '–'
    return `${formatNumber(n)} h`
  }

  function formatPercent(value: number | null | undefined): string {
    const n = Number(value)
    if (!Number.isFinite(n)) return '–'
    return `${new Intl.NumberFormat(intlLocale.value, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(n)} %`
  }

  function formatDate(
    value: string | number | Date | null | undefined,
    options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
  ): string {
    const date = toDate(value)
    if (!date) return ''
    return new Intl.DateTimeFormat(intlLocale.value, options).format(date)
  }

  function formatDateTime(
    value: string | number | Date | null | undefined,
    options: Intl.DateTimeFormatOptions = {
      dateStyle: 'medium',
      timeStyle: 'short'
    }
  ): string {
    return formatDate(value, options)
  }

  return {
    intlLocale,
    formatNumber,
    formatHours,
    formatPercent,
    formatDate,
    formatDateTime
  }
}
