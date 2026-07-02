import { createItem, deleteItem, readItems, updateItem } from '@directus/sdk'
import type { ClientLink } from '~~/types/DirectusTypes'
import { diffClientLinks, type ClientLinkDraft } from '~/utils/clientLinks'

/**
 * Reads/writes a client's custom dashboard quick-links (the `ClientLinks`
 * collection, M2O → `Clients`). Editor/website links come from the infra config,
 * not a per-client override. All writes go through the Directus SDK, governed by
 * the Client policy (clients may CRUD links for clients they belong to; admins
 * via admin_access).
 */
export function useClientLinks() {
  const { directus } = useDirectus()

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

  return { listForClient, persistCustomLinks }
}
