// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  runtimeConfig: {
    clockodoApiEmail: process.env.CLOCKODO_API_EMAIL,
    clockodoApiKey: process.env.CLOCKODO_API_KEY,
    jiraEmail: process.env.NUXT_JIRA_API_EMAIL,
    jiraApiKey: process.env.NUXT_JIRA_API_KEY
  },

  css: ['~/assets/css/main.css'],

  routeRules: {
    '/': { prerender: true }
  },

  compatibilityDate: '2025-01-15',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
