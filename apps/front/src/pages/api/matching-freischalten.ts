/**
 * /api/matching-freischalten: Operator schaltet das Matching für ein Medium frei.
 *
 * POST { medium_slug }
 *   → setzt faas_medien.matching_freigeschaltet = jetzt + matching_freigeschaltet_von
 *     (CF-Access-E-Mail, Fallback 'team'), stösst danach best effort den
 *     Erst-Match an (triggerErstMatch, dna-pipeline.ts, dasselbe Muster wie
 *     nach einer DNA-Aktivierung) und antwortet 200 { status: 'ok' }.
 *   → 400 { error }  bei fehlendem medium_slug
 *   → 404 { error }  wenn das Medium nicht existiert
 *   → 422 { error }  wenn dna_medium_freigabe noch nicht gesetzt ist. Das
 *     serverseitige Gate spiegelt die UI-Bedingung (Knopf nur bei freigegebener
 *     DNA), damit auch ein direkter API-Aufruf nicht vorzeitig freischaltet.
 *   → 502 { error }  wenn der Directus-Zugriff fehlschlägt
 *   → 403 { error }  bei Portal-Session ohne Cloudflare-Access (Defense-in-
 *     depth, istPortalZugriffAufProxy: diese Route ist Operator-only)
 *   → 405             bei anderer Methode als POST
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { istPortalZugriffAufProxy, ladePortalMedium } from '@/lib/portal-guard'
import { triggerErstMatch } from '@/lib/dna-pipeline'
import { schreibeMediumEvent } from '@/lib/medium-events'
import { tenant } from '../../../config/tenant'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const schreibHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}`,
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cfEmailHeader = req.headers['cf-access-authenticated-user-email'] as string | undefined
  if (istPortalZugriffAufProxy(req.headers.cookie, cfEmailHeader, process.env.PORTAL_SESSION_SECRET)) {
    return res.status(403).json({ error: 'Operator-Route, kein Portal-Zugriff.' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const mediumSlug = typeof req.body?.medium_slug === 'string' ? req.body.medium_slug.trim() : ''
  if (!mediumSlug) {
    return res.status(400).json({ error: 'medium_slug erforderlich.' })
  }

  // Serverseitiges Gate: erst freischalten, wenn das Medium seine DNA
  // freigegeben hat (dna_medium_freigabe gesetzt). ladePortalMedium wirft bei
  // Netz-/Directus-Fehlern (null heisst dort nur «nicht gefunden»).
  try {
    const medium = await ladePortalMedium(mediumSlug)
    if (!medium) {
      return res.status(404).json({ error: 'Medium nicht gefunden.' })
    }
    if (!medium.dnaFreigabe) {
      return res.status(422).json({ error: 'DNA ist vom Medium noch nicht freigegeben' })
    }
  } catch (err: unknown) {
    console.error('matching-freischalten: faas_medien nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }

  const wer = cfEmailHeader ?? 'team'
  const jetzt = new Date().toISOString()

  try {
    const resPatch = await fetch(`${base()}/items/faas_medien`, {
      method: 'PATCH',
      headers: schreibHeaders(),
      body: JSON.stringify({
        query: { filter: { slug: { _eq: mediumSlug }, mandant: { _eq: tenant.key } } },
        data: { matching_freigeschaltet: jetzt, matching_freigeschaltet_von: wer },
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!resPatch.ok) {
      const text = await resPatch.text().catch(() => '')
      return res.status(502).json({ error: `Freischaltung fehlgeschlagen (${resPatch.status}): ${text.slice(0, 200)}` })
    }
  } catch (err: unknown) {
    console.error('matching-freischalten: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }

  await triggerErstMatch(mediumSlug)

  // Roadmap-Ereignis (fire-and-forget): die Slack-Roadmap im Medien-Channel
  // meldet dem Medium, dass seine gesichtete Trefferliste jetzt online ist.
  void schreibeMediumEvent({
    medium_id: mediumSlug,
    typ: 'matching_freigegeben',
    titel: 'Matching freigegeben, Trefferliste ist im Portal sichtbar',
    actor: wer,
  })

  return res.status(200).json({ status: 'ok' })
}
