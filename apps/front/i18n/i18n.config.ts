// vue-i18n runtime config consumed by @nuxtjs/i18n.
//
// Number/date formatting is intentionally NOT configured here: vue-i18n keys
// its Intl formatters by the locale *code* (`de`/`fr`/`en`), which would drop
// the Swiss conventions the app relies on (e.g. `de-CH` renders "1.5 h",
// generic `de` renders "1,5 h"). Formatting therefore goes through
// `app/composables/useFormatters.ts`, which maps each code to the right BCP-47
// tag (de→de-CH, fr→fr-CH, en→en-GB). Keep message catalogs in i18n/locales/.
export default defineI18nConfig(() => ({
  legacy: false,
  fallbackLocale: 'de'
}))
