import type { BillingMode } from '~~/types/DirectusTypes'

export interface OverviewSums {
  totalUsedHours: number
  totalTopUps: number
  totalUsedPercentage: number
  totalAvailableHours: number
  totalManualWorkHours: number
  billableHours: number
}

export interface OverviewEntry {
  clientPeriodId: number
  client: {
    id: string
    name: string
    billing_mode: BillingMode
  }
  period: {
    id: string
    from: string
    to: string
    name: string | null
  }
  sums: OverviewSums | null
  computedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  pending: boolean
}

export interface ClientsOverviewResponse {
  data: OverviewEntry[]
  generatedAt: string
  schemaMissing?: boolean
}

/**
 * Loader for the `/clientsOverview` Directus endpoint. Powers the
 * "Projektübersicht" admin page. Reads only persisted snapshot data on the
 * backend, so this stays cheap even with dozens of media organisations.
 */
export async function useClientsOverview() {
  const { getCustomEndpoint, postCustomEndpoint } = useDirectus()

  const { data, pending, error, refresh } = await useAsyncData<
    ClientsOverviewResponse | undefined
  >('clients-overview', async () => {
    try {
      const response = await getCustomEndpoint('clientsOverview', {})
      return response.data as ClientsOverviewResponse
    } catch (err: any) {
      const firstError = err.response?.data?.errors?.[0]
      throw new Error(
        firstError?.message || err?.message || 'Unbekannter Fehler'
      )
    }
  })

  const entries = computed<OverviewEntry[]>(() => data.value?.data ?? [])
  const generatedAt = computed<string | null>(
    () => data.value?.generatedAt ?? null
  )
  const schemaMissing = computed<boolean>(() => !!data.value?.schemaMissing)

  /**
   * Force a single tile to recompute. The backend invalidates the in-memory
   * billing cache key first, recomputes via Clockodo + Jira, and upserts the
   * snapshot. After it returns we refresh the whole overview so the new
   * `computedAt` lands in the UI.
   */
  async function refreshOne(clientPeriodId: number): Promise<void> {
    await postCustomEndpoint(
      `clientsOverview/refresh?clientPeriodId=${clientPeriodId}`,
      {}
    )
    await refresh()
  }

  return {
    entries,
    generatedAt,
    schemaMissing,
    pending,
    error,
    refresh,
    refreshOne
  }
}
