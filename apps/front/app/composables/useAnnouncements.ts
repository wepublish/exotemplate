import type { Ref } from 'vue'
import type { AnnouncementSeverity } from '~~/types/DirectusTypes'

/** A public, locale-resolved message as returned by `GET /messages`. */
export interface DashboardMessage {
  id: number
  severity: AnnouncementSeverity
  title: string
  body: string | null
  link_label: string | null
  link_url: string | null
  dismissible: boolean
  starts_at: string | null
  ends_at: string | null
}

/**
 * Public messages for the client dashboard: general announcements plus any
 * scoped to the selected client's medium, resolved to the user's language.
 * Uses the same unauthenticated `/messages` endpoint the editor consumes.
 * Lazy + best-effort — never blocks rendering.
 */
export function useAnnouncements(medium: Ref<string | null | undefined>) {
  const { getCustomEndpoint } = useDirectus()
  const { locale } = useI18n()

  const { data, pending, refresh } = useAsyncData<DashboardMessage[]>(
    'dashboard-messages',
    async () => {
      const query: Record<string, string> = { locale: locale.value }
      if (medium.value) query.medium = medium.value
      try {
        const res = await getCustomEndpoint('messages', query)
        return (res.data as { data: DashboardMessage[] }).data ?? []
      } catch {
        return []
      }
    },
    { lazy: true, watch: [medium, locale], default: () => [] }
  )

  const messages = computed<DashboardMessage[]>(() => data.value ?? [])
  return { messages, pending, refresh }
}
