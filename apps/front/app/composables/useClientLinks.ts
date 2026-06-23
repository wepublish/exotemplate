import { createItem, deleteItem, readItems, updateItem } from '@directus/sdk'
import type { Client, ClientLink } from '~~/types/DirectusTypes'
import { diffClientLinks, type ClientLinkDraft } from '~/utils/clientLinks'

/**
 * Reads/writes a client's dashboard links. The editor/website overrides live on
 * the `Clients` row; the custom links are structured rows in the dedicated
 * `ClientLinks` collection (M2O → `Clients`). All writes go through the Directus
 * SDK, governed by the Client policy (clients may CRUD links for clients they
 * belong to; admins via admin_access). Mirrors the override edits into the
 * in-memory client list via `userStore.patchClient` — same pattern as
 * `useJiraWarnings`.
 */
export function useClientLinks() {
  const { directus } = useDirectus()
  const userStore = useUserStore()

  async function listForClient(clientId: string): Promise<ClientLink[]> {
    if (!clientId) return []
    return directus.request<ClientLink[]>(
      readItems('ClientLinks', {
        filter: { client: { _eq: clientId }, status: { _eq: 'published' } },
        sort: ['sort', 'id'],
        limit: -1
      })
    )
  }

  async function saveOverrides(
    clientId: string,
    overrides: { editorUrl: string | null; websiteUrl: string | null }
  ): Promise<void> {
    const editor_url = overrides.editorUrl?.trim() || null
    const website_url = overrides.websiteUrl?.trim() || null
    await directus.request(
      updateItem('Clients', clientId, {
        editor_url,
        website_url
      } as Partial<Client>)
    )
    userStore.patchClient(clientId, { editor_url, website_url })
  }

  /**
   * Reconcile the edited custom-link drafts against the persisted rows: create
   * new ones, update changed ones, delete removed/blanked ones. Returns the
   * fresh list so the caller can re-seed its local state.
   */
  async function persistCustomLinks(
    clientId: string,
    original: ClientLink[],
    drafts: ClientLinkDraft[]
  ): Promise<ClientLink[]> {
    const { toCreate, toUpdate, toDelete } = diffClientLinks(original, drafts)

    for (const link of toCreate) {
      await directus.request(
        createItem('ClientLinks', {
          ...link,
          client: clientId
        } as Partial<ClientLink>)
      )
    }
    for (const { id, ...rest } of toUpdate) {
      await directus.request(
        updateItem('ClientLinks', id, rest as Partial<ClientLink>)
      )
    }
    for (const id of toDelete) {
      await directus.request(deleteItem('ClientLinks', id))
    }

    return listForClient(clientId)
  }

  return { listForClient, saveOverrides, persistCustomLinks }
}
