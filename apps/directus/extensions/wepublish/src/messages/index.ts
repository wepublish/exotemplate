import { defineEndpoint } from '@directus/extensions-sdk'
import { selectActiveMessages, type RawAnnouncement } from './messages'
import {
  ANNOUNCEMENTS_CACHE_KEY,
  getAnnouncementsCache
} from '../shared/cache/announcementsCache'

// Public messages feed for the client dashboard AND the external editor.
//
// GET /messages?medium=<medium_name>&locale=<de|fr|en>
//
// Deliberately UNAUTHENTICATED: no accountability check, and it reads via a
// system ItemsService so the editor (a separate app, no Directus session) can
// consume it. Only *published* announcements are read and only safe, resolved
// fields are returned (never drafts, never internal columns). `medium` scopes
// to general + that medium; omit it to get only general messages.
export default defineEndpoint((router, context) => {
  const { services } = context

  router.get('/', async (req: any, res: any, next: any) => {
    try {
      const medium =
        typeof req.query?.medium === 'string' && req.query.medium.trim() !== ''
          ? req.query.medium.trim()
          : null
      const locale =
        typeof req.query?.locale === 'string' ? req.query.locale : undefined

      const schema = await context.getSchema()
      if (!schema?.collections?.Announcements) {
        // Collection not loaded yet (schema:load pending) — return empty, not 500.
        return res.json({ data: [] })
      }

      const svc = new services.ItemsService('Announcements', { schema })
      // Cache the raw published rows (single-flight); one entry serves every
      // medium/locale — the shaping below runs per request.
      const raw = (await getAnnouncementsCache().getOrCompute(
        ANNOUNCEMENTS_CACHE_KEY,
        () =>
          svc.readByQuery({
            filter: { status: { _eq: 'published' } },
            limit: -1,
            fields: [
              'id',
              'status',
              'sort',
              'severity',
              'title',
              'body',
              'link_label',
              'link_url',
              'starts_at',
              'ends_at',
              'dismissible',
              'clients.clients_id.medium_name',
              'translations.locale',
              'translations.title',
              'translations.body',
              'translations.link_label'
            ]
          })
      )) as any[]

      // Flatten the M2M junction (`clients[].clients_id.medium_name`) into the
      // shape the pure selector expects.
      const rows: RawAnnouncement[] = raw.map((r) => ({
        ...r,
        clients: (r.clients ?? []).map((c: any) => ({
          medium_name: c?.clients_id?.medium_name ?? null
        }))
      }))

      return res.json({ data: selectActiveMessages(rows, { medium, locale }) })
    } catch (e) {
      return next(e)
    }
  })

  // Admin-only: drop the cache so edits made in the admin UI show immediately
  // (otherwise they appear on the next TTL expiry).
  router.delete('/cache', (req: any, res: any) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ errors: [{ message: 'Forbidden' }] })
    }
    getAnnouncementsCache().clear()
    return res.json({ data: { cleared: true } })
  })
})
