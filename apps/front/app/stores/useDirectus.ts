import { authentication, createDirectus, rest } from '@directus/sdk'
import { defineStore } from 'pinia'
import type { Schema } from '~~/types/DirectusTypes'

export const useDirectus = defineStore('useDirectus', () => {
  const config = useRuntimeConfig()

  const API_URL = (): string => {
    if (import.meta.server) {
      const directusServerApiUrl = config.public.directusServerApiUrl
      if (!directusServerApiUrl) {
        console.error('Env variable missing: NUXT_DIRECTUS_SERVER_API_URL')
      }
      return directusServerApiUrl
    }

    const directusClientApiUrl = config.public.directusClientApiUrl

    if (!directusClientApiUrl) {
      console.error('Env variable missing: NUXT_DIRECTUS_SERVER_API_URL')
    }

    return directusClientApiUrl
  }

  const directus = createDirectus<Schema>(API_URL())
    .with(authentication())
    .with(rest())

  return directus
})
