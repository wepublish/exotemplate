// https://nuxt.com/docs/api/configuration/nuxt-config

// Namespaces of the i18n message catalog. Each maps to
// `i18n/locales/<locale>/<namespace>.json`. Add a namespace here when a new
// fragment is introduced.
const I18N_NAMESPACES = [
  'common',
  'nav',
  'auth',
  'settings',
  'thresholds',
  'dashboard',
  'workLog',
  'timeTracking',
  'overview',
  'networkContribution',
  'billing',
  'onboarding',
  'contracts',
  'monitoring',
  'infrastructure',
  'reviewBuilds',
  'resourcePlanning',
  'deployments',
  'sentry',
  'messages',
  'resourcePlanning'
] as const

const LOCALE_FILES = (locale: string): string[] =>
  I18N_NAMESPACES.map((ns) => `${locale}/${ns}.json`)

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@pinia/nuxt', '@nuxtjs/i18n'],

  // Local dev server runs on 3001 (3000 is used elsewhere).
  devServer: { port: 3001 },

  // Branded favicon: SVG for modern browsers, .ico as the legacy fallback
  // (both live in public/ and share the green "1" mark).
  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }
      ]
    }
  },

  // The selected client/billing period lives in the URL **path** on every app
  // route as a `/:clientPeriodId/…` prefix — the same "always in the URL"
  // pattern a locale prefix uses, so the selection is never lost when moving
  // between pages (including admin ↔ client pages) and is shareable/reloadable.
  //
  // Rather than nesting every page under `pages/[clientPeriodId]/`, we keep the
  // files organized by feature and prefix their routes here (the Nuxt-idiomatic
  // `pages:extend` approach, which preserves `definePageMeta`). `/` stays a bare
  // redirect-to-default page and `/auth/*` is exempt (no selection before login).
  // The single source of truth is `route.params.clientPeriodId` (see
  // app/stores/useClientSelection.ts); the selector navigates by swapping it.
  hooks: {
    'pages:extend'(pages) {
      for (const page of pages) {
        if (!page.path || page.path === '/' || page.path.startsWith('/auth')) {
          continue
        }
        page.path = `/:clientPeriodId${page.path}`
      }
    }
  },

  devtools: {
    enabled: true
  },

  runtimeConfig: {
    public: {
      directusClientApiUrl: process.env.DIRECTUS_CLIENT_API_URL,
      directusServerApiUrl: process.env.DIRECTUS_SERVER_API_URL
    }
  },

  css: ['~/assets/css/main.css'],

  // Language is a per-user preference persisted on the Directus user, not a
  // routing concern — so no URL prefixes. The active locale is applied from
  // the logged-in user (see app/composables/useAppLocale.ts) and mirrored to
  // localStorage for an instant restore on reload. German is the default.
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'de',
    // Catalogs are split per namespace under i18n/locales/<locale>/ and deep
    // merged. Keep this list in sync when adding a namespace fragment.
    locales: [
      {
        code: 'de',
        language: 'de-CH',
        name: 'Deutsch',
        files: LOCALE_FILES('de')
      },
      {
        code: 'fr',
        language: 'fr-CH',
        name: 'Français',
        files: LOCALE_FILES('fr')
      },
      {
        code: 'en',
        language: 'en-GB',
        name: 'English',
        files: LOCALE_FILES('en')
      }
    ],
    vueI18n: 'i18n.config.ts',
    detectBrowserLanguage: false,
    // A handful of info-page messages carry inline <em>/<strong> markup and are
    // rendered with v-html. The content is hardcoded translation copy (never
    // user input), so relaxing strictMessage is safe; escapeHtml stays false so
    // the tags reach v-html intact.
    compilation: {
      strictMessage: false,
      escapeHtml: false
    }
  },

  routeRules: {
    '/': { prerender: false }
  },

  compatibilityDate: '2025-01-15'
})
