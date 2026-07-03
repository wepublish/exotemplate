import type { SentryData } from '~/utils/sentry'

interface SentryResponse {
  data: SentryData
}

const EMPTY: SentryData = { charts: [], tables: [] }

/**
 * Loader for the admin-only `/sentry/charts` endpoint — the registry of Sentry
 * performance panels: timeseries charts (DB span duration, slow HTTP requests,
 * PGPool queue time) and ranked tables (slowest DB queries by description).
 * Backed by a short server-side cache; the Sentry token lives only in Directus.
 *
 * The queries are scoped to the given client's `medium_name` (resolved on the
 * backend), so the panels reflect that client's Sentry data. `clientId` is a
 * ref so the data reloads when the selected client changes.
 */
export async function useSentryData(clientId: Ref<string | null>) {
  const { getCustomEndpoint } = useDirectus()
  const { $i18n } = useNuxtApp()

  const { data, pending, error, refresh } = await useAsyncData<SentryData>(
    'sentry-data',
    async () => {
      const id = unref(clientId)
      if (!id) return EMPTY
      try {
        const response = await getCustomEndpoint('sentry/charts', {
          clientId: id
        })
        return (response.data as SentryResponse).data ?? EMPTY
      } catch (err: any) {
        const firstError = err.response?.data?.errors?.[0]
        throw new Error(
          firstError?.message ||
            err?.message ||
            $i18n.t('common.unexpectedError')
        )
      }
    },
    { watch: [clientId] }
  )

  return { data, pending, error, refresh }
}
