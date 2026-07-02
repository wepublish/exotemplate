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
    const clientUrl = config.public.directusClientApiUrl

    // On the server we prefer the (often cluster-internal) server URL, but it
    // must never be empty: `createDirectus('')` throws "Invalid URL" and 500s
    // every SSR request. If it's unset, fall back to the public client URL so
    // the app still boots (authenticated data loads client-side anyway).
    if (import.meta.server) {
      const serverUrl = config.public.directusServerApiUrl
      if (serverUrl) return serverUrl
      console.error(
        'Env variable missing: NUXT_PUBLIC_DIRECTUS_SERVER_API_URL — falling back to client URL for SSR'
      )
      return clientUrl
    }

    if (!clientUrl) {
      console.error('Env variable missing: NUXT_PUBLIC_DIRECTUS_CLIENT_API_URL')
    }

    return clientUrl
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

  async function postCustomEndpoint(
    uri: string,
    body: Record<string, unknown>
  ) {
    await addAuthorizationHeaderToAxios()

    return await axios.post(`${API_URL()}/${uri}`, body)
  }

  async function deleteCustomEndpoint(uri: string) {
    await addAuthorizationHeaderToAxios()

    return await axios.delete(`${API_URL()}/${uri}`)
  }

  async function addAuthorizationHeaderToAxios() {
    const access_token = await directus.getToken()
    if (access_token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`
    }
  }

  return {
    directus,
    getCustomEndpoint,
    postCustomEndpoint,
    deleteCustomEndpoint,
    API_URL
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
