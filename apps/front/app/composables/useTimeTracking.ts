export type CaptureDayStatus =
  | 'captured'
  | 'partial'
  | 'missing'
  | 'absent'
  | 'weekend'
  | 'off'
  | 'holiday'

export interface CaptureUserDay {
  date: string
  status: CaptureDayStatus
  expectedHours: number
  capturedHours: number
  absenceType?: number
  holidayName?: string
}

export interface CaptureUserRow {
  id: number
  name: string
  email: string
  weeklyTargetHours: number
  expectedDays: number
  capturedDays: number
  days: CaptureUserDay[]
  ignored: boolean
  ignoredRecordId: string | null
  ignoredReason: string | null
}

export interface CaptureCacheMeta {
  hit: boolean
  cachedAt: number
  expiresAt: number
  ttlMs: number
}

interface TimeTrackingResponse {
  data: CaptureUserRow[]
  range: { from: string; to: string }
  cache: CaptureCacheMeta
}

/**
 * Loader for the `/time-tracking/missing-hours` Directus endpoint — the
 * "Übersicht Zeiterfassung" page's single source of truth. Call once per
 * (from, to) pair and let `useAsyncData`'s key-based dedup handle multiple
 * consumers.
 *
 * `invalidate` is exposed separately from `refresh` because the server holds
 * its own 15-minute TTL cache: a plain `refresh()` would hit the same cached
 * payload, while `invalidate()` first clears the server entry and then
 * re-fetches.
 */
export async function useTimeTracking(from: Ref<string>, to: Ref<string>) {
  const { getCustomEndpoint, deleteCustomEndpoint } = useDirectus()
  const { $i18n } = useNuxtApp()

  const dataLoaderKey = computed<string>(
    () => `time-tracking-missing-hours-${from.value}-${to.value}`
  )

  const {
    data: payload,
    pending,
    error,
    refresh
  } = await useAsyncData<TimeTrackingResponse | undefined>(
    dataLoaderKey,
    async () => {
      try {
        const response = await getCustomEndpoint(
          'time-tracking/missing-hours',
          { from: from.value, to: to.value }
        )
        return response.data as TimeTrackingResponse
      } catch (err: any) {
        const firstError = err.response?.data?.errors?.[0]
        throw new Error(
          firstError?.message ||
            err?.message ||
            $i18n.t('common.unexpectedError')
        )
      }
    }
  )

  const data = computed<CaptureUserRow[]>(() => payload.value?.data ?? [])
  const cacheInfo = computed<CaptureCacheMeta | null>(
    () => payload.value?.cache ?? null
  )
  const range = computed<{ from: string; to: string } | null>(
    () => payload.value?.range ?? null
  )

  async function invalidate(): Promise<void> {
    await deleteCustomEndpoint(
      `time-tracking/missing-hours/cache?from=${from.value}&to=${to.value}`
    )
    await refresh()
  }

  return { data, pending, error, refresh, cacheInfo, range, invalidate }
}
