/**
 * /api/medium-zuruecksetzen: Operator setzt ein Medium auf den Anfang zurück
 * («Voller Neustart»), damit es das Onboarding neu durchlaufen kann.
 *
 * POST { medium_slug }
 *   → DEAKTIVIERT alle medium_dna-Versionen (is_active=false, wiederherstellbar —
 *     W1.2 Lösch-Guard), löscht medium_knowledge-Uploads und match_results des
 *     Mediums und setzt in faas_medien Logo, DNA-Freigabe,
 *     Matching-Freischaltung und die arbeits_dna-Felder zurück. Portal-Zugänge
 *     bleiben bestehen (Login funktioniert weiter). Antwortet 200 mit einer
 *     Zusammenfassung, wie viel entfernt wurde.
 *   → 400 bei fehlendem medium_slug
 *   → 404 wenn das Medium nicht existiert
 *   → 502 bei Directus-Fehler
 *   → 403 bei Portal-Session (istPortalZugriffAufProxy: Operator-only)
 *   → 405 bei anderer Methode als POST
 *
 * Die Route ist gefahrlos wiederholbar: bei einem Teil-Fehler (502) einfach
 * erneut auslösen. Directus-Dateien (Logo-Asset, Upload-Dateien) werden NICHT
 * gelöscht, nur die Referenzen: verwaiste Files sind harmlos, echtes
 * File-Löschen bärge Risiko (evtl. geteilte Assets).
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { istPortalZugriffAufProxy, ladePortalMedium } from '@/lib/portal-guard'
import { tenant } from '../../../config/tenant'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const schreibHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}`,
})

/**
 * Löscht alle Einträge einer Collection mit medium_id == slug und gibt die
 * Anzahl zurück. Zweischrittig (IDs holen, dann per REST-DELETE mit
 * Schlüssel-Array), weil Directus filter-basiertes Löschen so erwartet.
 */
async function loescheNachMedium(collection: string, mediumSlug: string): Promise<number> {
  const filter = encodeURIComponent(JSON.stringify({ medium_id: { _eq: mediumSlug } }))
  const resIds = await fetch(`${base()}/items/${collection}?filter=${filter}&limit=-1&fields=id`, {
    headers: schreibHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!resIds.ok) throw new Error(`${collection} lesen fehlgeschlagen (${resIds.status})`)
  const ids = (((await resIds.json())?.data ?? []) as Array<{ id: unknown }>).map((r) => r.id)
  if (ids.length === 0) return 0
  const resDel = await fetch(`${base()}/items/${collection}`, {
    method: 'DELETE',
    headers: schreibHeaders(),
    body: JSON.stringify(ids),
    signal: AbortSignal.timeout(15_000),
  })
  if (!resDel.ok) throw new Error(`${collection} löschen fehlgeschlagen (${resDel.status})`)
  return ids.length
}

/**
 * W1.2 Lösch-Guard: Statt die teuer LLM-veredelte medium_dna HART zu löschen
 * (historische Ursache des We.Publish-DNA-Verlusts), werden alle Versionen nur
 * DEAKTIVIERT (is_active=false). Der Reset wirkt wie zuvor — das Medium hat
 * danach keine aktive DNA und durchläuft Onboarding neu —, aber die veredelte
 * Historie bleibt erhalten und ist wiederherstellbar. Gibt die Anzahl
 * deaktivierter Versionen zurück (0, wenn keine vorhanden).
 */
export async function deaktiviereDnaNachMedium(mediumSlug: string): Promise<number> {
  const filter = encodeURIComponent(JSON.stringify({ medium_id: { _eq: mediumSlug } }))
  const resIds = await fetch(`${base()}/items/medium_dna?filter=${filter}&limit=-1&fields=id`, {
    headers: schreibHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!resIds.ok) throw new Error(`medium_dna lesen fehlgeschlagen (${resIds.status})`)
  const ids = (((await resIds.json())?.data ?? []) as Array<{ id: unknown }>).map((r) => r.id)
  if (ids.length === 0) return 0
  const resPatch = await fetch(`${base()}/items/medium_dna`, {
    method: 'PATCH',
    headers: schreibHeaders(),
    body: JSON.stringify({ keys: ids, data: { is_active: false } }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!resPatch.ok) throw new Error(`medium_dna deaktivieren fehlgeschlagen (${resPatch.status})`)
  return ids.length
}

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

  // Existenz prüfen (ladePortalMedium wirft bei Netz-/Directus-Fehlern,
  // liefert null bei «nicht gefunden»).
  try {
    const medium = await ladePortalMedium(mediumSlug)
    if (!medium) {
      return res.status(404).json({ error: 'Medium nicht gefunden.' })
    }
  } catch (err: unknown) {
    console.error('medium-zuruecksetzen: faas_medien nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }

  const wer = cfEmailHeader ?? 'team'

  try {
    // medium_dna wird DEAKTIVIERT, nicht gelöscht (W1.2 Lösch-Guard —
    // wiederherstellbar). uploads + match_results werden gelöscht (recomputebar).
    const dna = await deaktiviereDnaNachMedium(mediumSlug)
    const uploads = await loescheNachMedium('medium_knowledge', mediumSlug)
    const matches = await loescheNachMedium('match_results', mediumSlug)

    const resPatch = await fetch(`${base()}/items/faas_medien`, {
      method: 'PATCH',
      headers: schreibHeaders(),
      body: JSON.stringify({
        query: { filter: { slug: { _eq: mediumSlug }, mandant: { _eq: tenant.key } } },
        data: {
          logo_url: null,
          logo_hochgeladen: false,
          dna_medium_freigabe: null,
          dna_medium_freigabe_von: null,
          matching_freigeschaltet: null,
          matching_freigeschaltet_von: null,
          arbeits_dna: null,
          arbeits_dna_stand: null,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!resPatch.ok) {
      const text = await resPatch.text().catch(() => '')
      return res.status(502).json({ error: `Zurücksetzen fehlgeschlagen (${resPatch.status}): ${text.slice(0, 200)}` })
    }

    console.log(`medium-zuruecksetzen: ${mediumSlug} von ${wer} (dna=${dna}, uploads=${uploads}, matches=${matches})`)
    return res.status(200).json({ status: 'ok', geloescht: { dna, uploads, matches } })
  } catch (err: unknown) {
    console.error('medium-zuruecksetzen: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
