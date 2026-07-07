import { createItem, deleteItem, readItems, updateItem } from '@directus/sdk'
import type {
  Announcement,
  AnnouncementClient,
  AnnouncementSeverity,
  AnnouncementTranslation
} from '~~/types/DirectusTypes'

/** Editable base fields of an announcement (translations/media handled separately). */
export interface AnnouncementInput {
  status: 'published' | 'draft' | 'archived'
  severity: AnnouncementSeverity
  title: string
  body: string | null
  link_label: string | null
  link_url: string | null
  starts_at: string | null
  ends_at: string | null
  dismissible: boolean
}

/** An editable per-locale override row (no id until persisted). */
export interface TranslationDraft {
  id?: number
  locale: string
  title: string
  body: string
  link_label: string
}

/**
 * Admin CRUD for the `Announcements` collection (and its optional per-locale
 * `Announcements_translations` children). Admin-only via `admin_access`; all
 * writes go through the Directus SDK. Mirrors `useResourcePlanningAdmin`.
 */
export function useAnnouncementsAdmin() {
  const { directus, deleteCustomEndpoint } = useDirectus()

  /** Drop the public endpoint's cache so edits appear immediately. */
  async function invalidateCache(): Promise<void> {
    try {
      await deleteCustomEndpoint('messages/cache')
    } catch {
      /* best-effort; the cache expires on its own TTL anyway */
    }
  }

  async function list(): Promise<Announcement[]> {
    return directus.request<Announcement[]>(
      readItems('Announcements', {
        fields: [
          '*',
          'clients.id',
          'clients.clients_id.id',
          'clients.clients_id.name',
          'clients.clients_id.medium_name',
          'translations.*'
        ] as never,
        sort: ['sort', '-date_created'],
        limit: -1
      })
    )
  }

  async function create(input: AnnouncementInput): Promise<Announcement> {
    return directus.request<Announcement>(
      createItem('Announcements', input as Partial<Announcement>)
    )
  }

  async function update(id: number, input: AnnouncementInput): Promise<void> {
    await directus.request(
      updateItem('Announcements', id, input as Partial<Announcement>)
    )
  }

  async function remove(id: number): Promise<void> {
    await directus.request(deleteItem('Announcements', id))
  }

  /**
   * Reconcile the per-locale translation children against the edited drafts:
   * create new locales, update changed ones, delete removed/blanked ones. A
   * draft with no title is treated as removed.
   */
  async function saveTranslations(
    announcementId: number,
    original: AnnouncementTranslation[],
    drafts: TranslationDraft[]
  ): Promise<void> {
    const clean = drafts
      .map((d) => ({
        id: d.id,
        locale: d.locale,
        title: d.title.trim(),
        body: d.body.trim(),
        link_label: d.link_label.trim()
      }))
      .filter((d) => d.locale && d.title)

    const keptIds = new Set<number>()
    for (const d of clean) {
      const payload = {
        locale: d.locale,
        title: d.title,
        body: d.body || null,
        link_label: d.link_label || null
      }
      if (d.id == null) {
        await directus.request(
          createItem('Announcements_translations', {
            ...payload,
            announcement: announcementId
          } as Partial<AnnouncementTranslation>)
        )
      } else {
        keptIds.add(d.id)
        await directus.request(
          updateItem(
            'Announcements_translations',
            d.id,
            payload as Partial<AnnouncementTranslation>
          )
        )
      }
    }

    for (const o of original) {
      if (!keptIds.has(o.id)) {
        await directus.request(deleteItem('Announcements_translations', o.id))
      }
    }
  }

  /**
   * Reconcile the target-media M2M against the chosen client ids: add missing
   * junction rows, delete removed ones. An empty `clientIds` means the message
   * is general (all media) — every junction row is removed.
   */
  async function setClients(
    announcementId: number,
    original: AnnouncementClient[],
    clientIds: string[]
  ): Promise<void> {
    const desired = new Set(clientIds)
    const existing = new Map<string, number>() // clientId → junction row id
    for (const row of original) {
      const cid =
        typeof row.clients_id === 'object' ? row.clients_id?.id : row.clients_id
      if (cid) existing.set(cid, row.id)
    }

    for (const cid of desired) {
      if (!existing.has(cid)) {
        await directus.request(
          createItem('Announcements_clients', {
            announcements_id: announcementId,
            clients_id: cid
          } as Partial<AnnouncementClient>)
        )
      }
    }
    for (const [cid, rowId] of existing) {
      if (!desired.has(cid)) {
        await directus.request(deleteItem('Announcements_clients', rowId))
      }
    }
  }

  return {
    list,
    create,
    update,
    remove,
    saveTranslations,
    setClients,
    invalidateCache
  }
}
