import {
  authentication,
  createDirectus,
  rest,
  type AuthenticationData,
  type AuthenticationStorage
} from '@directus/sdk'
import { defineStore } from 'pinia'
import type { Schema } from '~~/types/DirectusTypes'
import axios from 'axios'

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
    .with(authentication('json', { storage: authLocalStorage() }))
    .with(rest())

  async function getCustomEndpoint(
    uri: string,
    query: { [key: string]: string | number }
  ) {
    await addAuthorizationHeaderToAxios()

    if (query) {
      const serializedQuery = Object.entries(query)
        .map(([key, value]) => `${key}=${value}`)
        .join('&')
      uri = `${uri}?${serializedQuery}`
    }

    return await axios.get(`${API_URL()}/${uri}`)
  }

  async function addAuthorizationHeaderToAxios() {
    const access_token = await directus.getToken()
    if (access_token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`
    }
  }

  return {
    directus,
    getCustomEndpoint
  }
})

export const LOCAL_STORAGE_KEY = 'directus_storage'

const authLocalStorage = (mainKey: string = LOCAL_STORAGE_KEY) =>
  ({
    // implementation of get, here return json parsed data from localStorage at mainKey (or null if not found)
    get: async () => {
      if (typeof window === 'undefined') return null
      const data = window.localStorage.getItem(mainKey)
      if (data) {
        return JSON.parse(data)
      }
      return null
    },
    // implementation of set, here set the value at mainKey in localStorage, or remove it if value is null
    set: async (value: AuthenticationData | null) => {
      if (typeof window === 'undefined') return null
      if (!value) {
        return window.localStorage.removeItem(mainKey)
      }
      return window.localStorage.setItem(mainKey, JSON.stringify(value))
    }
  }) as AuthenticationStorage
