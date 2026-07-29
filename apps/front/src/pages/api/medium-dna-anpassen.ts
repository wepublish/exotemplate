/**
 * /api/medium-dna-anpassen: Jolanda und Ramona ergänzen die DNA eines Mediums
 * im Cockpit (Wunsch Jolanda 29.07.2026: «ich finde noch gut, wenn ramona und
 * ich für die medien die dna ergänzen können»).
 *
 * Dieselbe Wirkung wie die Portal-Selbstbearbeitung (/api/portal/dna,
 * aktion 'anpassen'), nur mit dem Slug aus der Query statt aus einer
 * Medium-Session — und mit der Herkunft 'cockpit' in `version_id` und
 * `veredelt_by`, damit später ablesbar bleibt, wer die Fassung geschrieben hat.
 *
 * Bewusst NICHT unter /api/portal/*: dieser Namensraum liegt vor der
 * Cloudflare-Access-Bypass-Regel (siehe foerderhistorie.ts). Diese Route ist
 * Operator-only und muss hinter Access bleiben — ein Medium darf die DNA
 * anderer Medien nie anfassen.
 *
 * GET ?medium=<slug>
 *   → 200 { dna: { soundFeeling, tags, version, schaerfe } | null, vokabular }
 *        dna null = keine aktive DNA (kein Fehler; dann erst messen lassen)
 * POST { medium, sound_feeling, tags }
 *   → 200 { status: 'ok', version, versionId }
 *   → 409 { error }  keine aktive DNA, es gibt nichts anzupassen
 *   → 422 { error }  Eingabe unbrauchbar (Text zu kurz, unbekanntes Thema …)
 *
 *   → 400 { error }  medium fehlt
 *   → 403 { error }  Portal-Session ohne Access-Header (defense in depth)
 *   → 502 { error }  Directus nicht erreichbar
 *   → 405            bei anderer Methode
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  istPortalZugriffAufProxy,
  ladeAktiveDnaDetails,
  ladeDnaVorlage,
  schalteBearbeiteteDnaScharf,
} from '@/lib/portal-guard'
import { parseDnaBearbeitung, baueNeueDnaVersion } from '@/lib/portal-dna-bearbeiten'
import { alleVokabularTags, istBekannterSlug } from '@/lib/dna-mess-kern'
import { schreibeMediumEvent } from '@/lib/medium-events'

function leseSlug(roh: unknown): string {
  return typeof roh === 'string' ? roh.trim() : ''
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, medium: string) {
  try {
    const dna = await ladeAktiveDnaDetails(medium)
    const vokabular = alleVokabularTags()
    if (!dna) {
      return res.status(200).json({ dna: null, vokabular })
    }
    return res.status(200).json({
      dna: {
        soundFeeling: dna.soundFeeling ?? '',
        tags: (dna.tags ?? []).map((t) => ({
          tag_slug: t.tag_slug,
          gewicht: t.gewicht,
          begruendung: t.begruendung ?? '',
        })),
        version: dna.version ?? null,
        schaerfe: dna.schaerfe ?? null,
      },
      vokabular,
    })
  } catch (err: unknown) {
    console.error('medium-dna-anpassen GET: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, medium: string, operator: string) {
  const geprueft = parseDnaBearbeitung(req.body, istBekannterSlug)
  if (!geprueft.ok) {
    return res.status(422).json({ error: geprueft.fehler })
  }

  try {
    const vorlage = await ladeDnaVorlage(medium)
    if (!vorlage) {
      return res.status(409).json({ error: 'Keine aktive DNA vorhanden, es gibt nichts anzupassen.' })
    }

    const neu = baueNeueDnaVersion(vorlage, geprueft.eingabe, new Date(), 'cockpit')
    const { versionId } = await schalteBearbeiteteDnaScharf(neu, vorlage.id)

    // Roadmap-Ereignis (fire-and-forget): im Medien-Channel soll sichtbar sein,
    // dass die DNA sich geändert hat — auch wenn wir sie geändert haben.
    void schreibeMediumEvent({
      medium_id: medium,
      typ: 'dna_aktiv',
      titel: `Fundraising-DNA im Cockpit ergänzt (Version ${neu.version as number})`,
      detail: `${geprueft.eingabe.tags.length} Themen`,
      actor: operator || 'cockpit',
    })

    return res.status(200).json({ status: 'ok', version: neu.version, versionId })
  } catch (err: unknown) {
    console.error('medium-dna-anpassen POST: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const cfEmail = req.headers['cf-access-authenticated-user-email'] as string | undefined
  if (istPortalZugriffAufProxy(req.headers.cookie, cfEmail, process.env.PORTAL_SESSION_SECRET)) {
    return res.status(403).json({ error: 'Operator-Route, kein Portal-Zugriff.' })
  }

  const medium =
    req.method === 'GET'
      ? leseSlug(req.query.medium)
      : leseSlug((req.body as { medium?: unknown } | null)?.medium)
  if (!medium) {
    return res.status(400).json({ error: 'medium (Slug) erforderlich.' })
  }

  res.setHeader('Cache-Control', 'no-store')
  return req.method === 'GET'
    ? handleGet(req, res, medium)
    : handlePost(req, res, medium, (cfEmail ?? '').trim())
}
