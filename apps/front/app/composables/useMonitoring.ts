import type { Ref } from 'vue'
import type { ClientMonitoring, OverviewMonitoring } from '~/utils/monitoring'

interface CacheMeta {
  hit: boolean
  cachedAt: number
  expiresAt: number
  ttlMs: number
}

interface ClientMonitoringResponse {
  data: ClientMonitoring
  cache: CacheMeta | null
}

interface OverviewMonitoringResponse {
  data: OverviewMonitoring
}

/**
 * Loader for the per-customer `/monitoring/client` endpoint — the live health
 * (status + latency) of the medium mapped to the selected client. Backed by a
 * short server-side cache; the identifier is resolved server-side, so a client
 * only ever gets their own medium.
 */
export async function useClientMonitoring(
  clientPeriodId: Ref<number | undefined>
) {
  const { getCustomEndpoint } = useDirectus()
  const { $i18n } = useNuxtApp()

  const { data, pending, error, refresh } = await useAsyncData<
    ClientMonitoring | undefined
  >(
    'client-monitoring',
    async () => {
      if (!clientPeriodId.value) return undefined
      try {
        const response = await getCustomEndpoint('monitoring/client', {
          clientPeriodId: clientPeriodId.value
        })
        return (response.data as ClientMonitoringResponse).data
      } catch (err: any) {
        const firstError = err.response?.data?.errors?.[0]
        throw new Error(
          firstError?.message ||
            err?.message ||
            $i18n.t('common.unexpectedError')
        )
      }
    },
    { watch: [clientPeriodId] }
  )

  return { data, pending, error, refresh }
}

/**
 * Loader for the admin-only `/monitoring/overview` endpoint — live health of
 * every medium the infrastructure-configurator knows about.
 */
export async function useMonitoringOverview() {
  const { getCustomEndpoint } = useDirectus()
  const { $i18n } = useNuxtApp()

  const { data, pending, error, refresh } = await useAsyncData<
    OverviewMonitoring | undefined
  >('monitoring-overview', async () => {
    try {
      const response = await getCustomEndpoint('monitoring/overview', {})
      return (response.data as OverviewMonitoringResponse).data
    } catch (err: any) {
      const firstError = err.response?.data?.errors?.[0]
      throw new Error(
        firstError?.message || err?.message || $i18n.t('common.unexpectedError')
      )
    }
  })

  const media = computed(() => data.value?.media ?? [])
  const checkedAt = computed<string | null>(() => data.value?.checkedAt ?? null)

  return { media, checkedAt, pending, error, refresh }
}
