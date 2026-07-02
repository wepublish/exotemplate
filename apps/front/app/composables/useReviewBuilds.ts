import type { Ref } from 'vue'

export interface DbSync {
  project: string
  synced_at: string
  triggered_by: string
  run_url: string
  run_id: number
}

export interface ReviewInstance {
  editor_url: string
  website_url: string
  link_to_pr: string
  name_of_pr: string
  branch_name: string
  review_slot: number
  pr_number: number
  pr_state: string
  updated_at: string
  last_db_sync: DbSync | null
}

export type ReviewInstancesByMedium = Record<string, ReviewInstance[]>

interface OverviewResponse {
  data: { instances: ReviewInstancesByMedium; fetchedAt: string | null }
}

interface ClientResponse {
  data: {
    medium: string | null
    instances: ReviewInstance[]
    fetchedAt: string | null
  }
}

/**
 * Admin-only: all active review builds grouped by medium (via
 * `/monitoring/review-builds`). Lazy — never blocks rendering.
 */
export async function useReviewBuildsOverview() {
  const { getCustomEndpoint } = useDirectus()
  const { $i18n } = useNuxtApp()

  const { data, pending, error, refresh } = await useAsyncData(
    'review-builds-overview',
    async () => {
      try {
        const response = await getCustomEndpoint('monitoring/review-builds', {})
        return (response.data as OverviewResponse).data
      } catch (err: any) {
        const firstError = err.response?.data?.errors?.[0]
        throw new Error(
          firstError?.message ||
            err?.message ||
            $i18n.t('common.unexpectedError')
        )
      }
    },
    { lazy: true }
  )

  const instances = computed<ReviewInstancesByMedium>(
    () => data.value?.instances ?? {}
  )
  const media = computed<string[]>(() => Object.keys(instances.value).sort())
  const fetchedAt = computed<string | null>(() => data.value?.fetchedAt ?? null)

  return { instances, media, fetchedAt, pending, error, refresh }
}

/**
 * Per-customer: the active review builds for the selected client's medium (via
 * `/monitoring/review-builds/client`). Lazy + best-effort.
 */
export async function useClientReviewBuilds(
  clientPeriodId: Ref<number | undefined>
) {
  const { getCustomEndpoint } = useDirectus()

  const { data, pending } = await useAsyncData<ReviewInstance[]>(
    'client-review-builds',
    async () => {
      if (!clientPeriodId.value) return []
      try {
        const response = await getCustomEndpoint(
          'monitoring/review-builds/client',
          { clientPeriodId: clientPeriodId.value }
        )
        return (response.data as ClientResponse).data.instances ?? []
      } catch {
        return []
      }
    },
    { lazy: true, watch: [clientPeriodId], default: () => [] }
  )

  const instances = computed<ReviewInstance[]>(() => data.value ?? [])
  return { instances, pending }
}
