import type { Ref } from 'vue'

export interface MediaUrls {
  editor: string | null
  website: string | null
  api: string | null
  mediaServer: string | null
}

export interface ClientMediaUrls {
  mediumName: string | null
  production: MediaUrls | null
  staging: MediaUrls | null
}

interface MediaUrlsResponse {
  data: ClientMediaUrls
}

/**
 * Authoritative service URLs (editor / website / …) for the selected client's
 * medium, read from the infrastructure-configurator via `/monitoring/urls`.
 * Used to make the dashboard quick-links more reliable than deriving them from
 * the stored apiUrl (e.g. custom website domains), and to surface staging URLs.
 *
 * Lazy + best-effort: never blocks rendering and swallows errors — the
 * dashboard falls back to its derived links when this is unavailable.
 */
export async function useClientMediaUrls(
  clientPeriodId: Ref<number | undefined>
) {
  const { getCustomEndpoint } = useDirectus()

  const { data } = await useAsyncData<ClientMediaUrls | undefined>(
    'client-media-urls',
    async () => {
      if (!clientPeriodId.value) return undefined
      try {
        const response = await getCustomEndpoint('monitoring/urls', {
          clientPeriodId: clientPeriodId.value
        })
        return (response.data as MediaUrlsResponse).data
      } catch {
        return undefined
      }
    },
    { lazy: true, watch: [clientPeriodId] }
  )

  const production = computed<MediaUrls | null>(
    () => data.value?.production ?? null
  )
  const staging = computed<MediaUrls | null>(() => data.value?.staging ?? null)

  return { production, staging }
}
