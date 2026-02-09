// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@pinia/nuxt'],

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

  routeRules: {
    '/': { prerender: false }
  },

  compatibilityDate: '2025-01-15'
})
