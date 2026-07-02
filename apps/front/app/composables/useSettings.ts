import { readSingleton, updateSingleton } from '@directus/sdk'
import type { Settings } from '~~/types/DirectusTypes'

/**
 * Reads/writes the global `Settings` singleton. Currently scoped to the
 * `slack_we_share_channel_id` used by the dashboard quick-links tile. The value
 * is shared app-wide via `useState` so the dashboard only fetches it once.
 *
 * Reads are permitted for both admins and client-role users (the Client policy
 * grants read on `Settings.slack_we_share_channel_id`); writes are admin-only
 * and gated in the UI.
 */
export function useSettings() {
  const { directus } = useDirectus()
  const weShareChannelId = useState<string | null>(
    'settings:weShareChannelId',
    () => null
  )
  const loaded = useState<boolean>('settings:loaded', () => false)

  async function loadSettings(force = false): Promise<void> {
    if (loaded.value && !force) return
    try {
      const settings = (await directus.request(
        readSingleton('Settings', { fields: ['slack_we_share_channel_id'] })
      )) as Pick<Settings, 'slack_we_share_channel_id'>
      weShareChannelId.value = settings?.slack_we_share_channel_id ?? null
      loaded.value = true
    } catch {
      // If Settings isn't readable (e.g. the new client read permission hasn't
      // been applied yet), just hide the #we-share link rather than erroring.
      weShareChannelId.value = null
    }
  }

  async function updateWeShareChannelId(value: string | null): Promise<void> {
    const trimmed = value?.trim() || null
    await directus.request(
      updateSingleton('Settings', {
        slack_we_share_channel_id: trimmed
      } as Partial<Settings>)
    )
    weShareChannelId.value = trimmed
    loaded.value = true
  }

  return { weShareChannelId, loadSettings, updateWeShareChannelId }
}
