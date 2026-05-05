import type { EntryGroupComputed } from '~~/types/ClockodoTypes'

export interface AggregatedHoursCacheMeta {
  hit: boolean
  cachedAt: number
  expiresAt: number
  ttlMs: number
}

interface AggregatedHoursResponse {
  data: EntryGroupComputed
  cache: AggregatedHoursCacheMeta
}

/**
 * Shared loader for the `aggregatedHours` Directus endpoint. The dashboard
 * tiles and all detail pages use the same `clientPeriodId-<id>` key so Nuxt
 * deduplicates the request and the server-side TTL cache stays effective.
 *
 * The loader returns the full `{ data, cache }` envelope so the cache
 * metadata is part of the `useAsyncData` payload — important when the user
 * navigates away and back, since Nuxt skips the loader on cache hit. Side-
 * effecting `cacheInfo` from inside the loader would lose the badge on
 * back-navigation; deriving it from the cached payload keeps it visible.
 */
export async function useAggregatedHours(
  clientPeriodId: Ref<number | undefined>
) {
  const { getCustomEndpoint } = useDirectus()

  const dataLoaderKey = computed<string>(
    () => `clientPeriodId-${clientPeriodId.value}`
  )

  const {
    data: payload,
    pending,
    error,
    refresh
  } = await useAsyncData<AggregatedHoursResponse | undefined>(
    dataLoaderKey,
    async () => {
      if (!clientPeriodId.value) return undefined

      try {
        const response = await getCustomEndpoint('aggregatedHours', {
          clientPeriodId: clientPeriodId.value
        })
        return response.data as AggregatedHoursResponse
      } catch (err: any) {
        const firstError = err.response?.data?.errors?.[0]
        throw new Error(
          firstError?.message || err?.message || 'Unbekannter Fehler'
        )
      }
    }
  )

  const data = computed<EntryGroupComputed | undefined>(
    () => payload.value?.data
  )
  const cacheInfo = computed<AggregatedHoursCacheMeta | null>(
    () => payload.value?.cache ?? null
  )

  return { data, pending, error, refresh, cacheInfo }
}
