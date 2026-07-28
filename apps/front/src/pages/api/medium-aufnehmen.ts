/**
 * /api/medium-aufnehmen: Operator nimmt ein neues Medium auf — das Hallo und
 * der Magic-Link kommen in EINEM Schritt (Entscheid Jolanda 28.07.2026:
 * «zuerst muss das neue medium ja ein hallo bekommen, aber eigentlich auch
 * gleich den magic-link»).
 *
 * POST { name, website?, email? }
 *   → 200 { slug }                          Medium angelegt, keine E-Mail übergeben
 *   → 200 { slug, link, zugangBestehend }   Medium angelegt + Portal-Zugang mit
 *        Einladungs-Link (E-Mail lowercase+trim; bestehender Zugang bekommt
 *        nur einen neuen Link, zugangBestehend: true). Die Willkommensmail
 *        selbst verschickt die Bedienerin aus dem eigenen Postfach
 *        (MAIL_EINLADUNG + MailEntwurfButton, kein SMTP — Entscheid 28.07.2026).
 *   → 400 { error }  name fehlt oder ergibt keinen gültigen Slug
 *   → 409 { bereits_vorhanden: true, slug }  Medium mit diesem Slug existiert
 *        schon für den Mandanten (der Slug ist in Directus NICHT unique; ohne
 *        diesen serverseitigen Check entstünde eine zweite Zeile, auf die
 *        Engine, Portal und Wächter gleichzeitig schreiben würden)
 *   → 502 { error }  Directus nicht erreichbar
 *   → 503 { error }  PORTAL_SESSION_SECRET fehlt UND eine E-Mail wurde
 *        übergeben (der Einladungs-Link braucht das Secret)
 *   → 403 bei Portal-Session ohne Cloudflare-Access (Operator-only)
 *   → 405 bei anderer Methode
 *
 * Schreibt die Roadmap-Ereignisse `medium_aufgenommen` und (bei E-Mail)
 * `zugang_erstellt` (fire-and-forget, medium_events).
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { holeSecretOderAntworte503, istPortalZugriffAufProxy, legeZugangAnMitLink } from '@/lib/portal-guard'
import { schreibeMediumEvent } from '@/lib/medium-events'
import { slugify } from '@/graphql/projekte'
import { tenant } from '../../../config/tenant'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })
const schreibHeaders = () => ({ ...authHeaders(), 'Content-Type': 'application/json' })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cfEmailHeader = req.headers['cf-access-authenticated-user-email'] as string | undefined
  if (istPortalZugriffAufProxy(req.headers.cookie, cfEmailHeader, process.env.PORTAL_SESSION_SECRET)) {
    return res.status(403).json({ error: 'Operator-Route, kein Portal-Zugriff.' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const body = req.body as { name?: unknown; website?: unknown; email?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const website = typeof body?.website === 'string' ? body.website.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const slug = slugify(name)
  if (!name || !slug) {
    return res.status(400).json({ error: 'name erforderlich.' })
  }

  // Das Secret nur einfordern, wenn es gebraucht wird (Einladungs-Link).
  let secret = ''
  if (email) {
    const geholt = holeSecretOderAntworte503(res)
    if (!geholt) return
    secret = geholt
  }

  const wer = cfEmailHeader ?? 'team'

  try {
    // Duplikat-Schutz (serverseitig, ergänzend zum Client-Check in
    // onboarding.tsx): der Slug ist in Directus nicht unique.
    const filterBestehend = encodeURIComponent(
      JSON.stringify({ _and: [{ slug: { _eq: slug } }, { mandant: { _eq: tenant.key } }] }),
    )
    const resBestehend = await fetch(`${base()}/items/faas_medien?filter=${filterBestehend}&limit=1&fields=id,slug`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
    if (!resBestehend.ok) {
      return res.status(502).json({ error: `Directus antwortete ${resBestehend.status}` })
    }
    const bestehendJson = (await resBestehend.json()) as { data?: Array<{ id: string | number }> }
    if (bestehendJson.data?.[0]) {
      return res.status(409).json({ bereits_vorhanden: true, slug })
    }

    // We.Publish-API nach dem Standard-Muster vorbelegen (editierbar in den
    // Onboarding-Feldern; Abweichungen wie «cultur» korrigiert man dort).
    const resCreate = await fetch(`${base()}/items/faas_medien`, {
      method: 'POST',
      headers: schreibHeaders(),
      body: JSON.stringify({
        name,
        slug,
        mandant: tenant.key,
        is_active: true,
        website: website || null,
        wepublish_api_url: `https://api-${slug}.wepublish.cloud/v1`,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!resCreate.ok) {
      const text = await resCreate.text().catch(() => '')
      return res.status(502).json({ error: `Medium konnte nicht angelegt werden (${resCreate.status}): ${text.slice(0, 200)}` })
    }

    // Roadmap-Ereignis (fire-and-forget).
    void schreibeMediumEvent({
      medium_id: slug,
      typ: 'medium_aufgenommen',
      titel: `Medium aufgenommen: ${name}`,
      actor: wer,
    })

    if (!email) {
      return res.status(200).json({ slug })
    }

    const { link, bestehend } = await legeZugangAnMitLink(email, slug, tenant.key, wer, secret)
    if (!bestehend) {
      void schreibeMediumEvent({
        medium_id: slug,
        typ: 'zugang_erstellt',
        titel: 'Portal-Zugang angelegt',
        detail: email,
        actor: wer,
      })
    }

    return res.status(200).json({ slug, link, zugangBestehend: bestehend })
  } catch (err: unknown) {
    console.error('medium-aufnehmen POST: fehlgeschlagen', err)
    return res.status(502).json({ error: 'Aufnehmen fehlgeschlagen.' })
  }
}
