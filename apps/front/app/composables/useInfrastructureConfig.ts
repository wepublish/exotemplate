import type {
  InfraConfigResponse,
  InfraMediumConfig
} from '~/utils/infraConfig'

/**
 * Loads the infrastructure-configurator's media configuration via the existing
 * admin-only Directus proxy (`/client-onboarding/infra-configuration`), which
 * returns `{ media, fetched_at }` for every medium at once. Admin-only — the
 * proxy 403s for non-admins.
 */
export async function useInfrastructureConfig() {
  const { getCustomEndpoint } = useDirectus()
  const { $i18n } = useNuxtApp()

  const { data, pending, error, refresh } = await useAsyncData<
    InfraConfigResponse | undefined
  >('infrastructure-config', async () => {
    try {
      const response = await getCustomEndpoint(
        'client-onboarding/infra-configuration',
        {}
      )
      return response.data as InfraConfigResponse
    } catch (err: any) {
      const firstError = err.response?.data?.errors?.[0]
      throw new Error(
        firstError?.message || err?.message || $i18n.t('common.unexpectedError')
      )
    }
  })

  const media = computed<Record<string, InfraMediumConfig>>(
    () => data.value?.media ?? {}
  )
  const mediumNames = computed<string[]>(() => Object.keys(media.value).sort())
  const fetchedAt = computed<string | null>(
    () => data.value?.fetched_at ?? null
  )

  return { media, mediumNames, fetchedAt, pending, error, refresh }
}
