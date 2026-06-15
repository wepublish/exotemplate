import { defineHook } from '@directus/extensions-sdk'
import { resolveMailSubject, resolveMailUrl } from './mailDefaults'

// Normalizes Directus' invite / password-reset mails so they're deliverable and
// point at the frontend, on every path (incl. the Directus admin UI, whose
// controller forwards neither a subject nor an invite_url):
//   - subject → branded German (Scaleway rejects the English "You've been invited")
//   - link    → absolute, allow-listed frontend URL (not the relative /admin one)
// MailService runs every outgoing mail through the `email.send` filter, so this
// is the single interception point.
export default defineHook(({ filter }, { env }) => {
  filter('email.send', (payload: any) => {
    // IMPORTANT: the returned value IS the mail that gets sent — returning
    // undefined makes MailService skip the send. Always return payload.
    if (payload && typeof payload === 'object') {
      const name = payload.template?.name
      payload.subject = resolveMailSubject(name, payload.subject)
      if (payload.template?.data && typeof payload.template.data === 'object') {
        payload.template.data.url = resolveMailUrl(
          name,
          payload.template.data.url,
          env
        )
      }
    }
    return payload
  })
})
