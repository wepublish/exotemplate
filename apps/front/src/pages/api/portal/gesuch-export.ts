/**
 * /api/portal/gesuch-export: liefert das Gesuch als Word-Dokument (.docx),
 * im Layout/Hausschrift des Mediums (Task 12).
 *
 * GET ?id=<application_id>
 *   → 200  docx-Datei-Stream (Content-Type
 *     application/vnd.openxmlformats-officedocument.wordprocessingml.document,
 *     Content-Disposition: attachment; filename="gesuch_<stiftung_slug>.docx")
 *   → 400 { error }  id (Query-Parameter) fehlt
 *   → 404 { error }  Application nicht gefunden oder gehört nicht diesem Medium
 *   → 409 { error }  Gesuchstext ist (noch) nicht verfügbar: Status ist nicht
 *        mindestens 'bereit' ODER `portal.gesuch_text` ist leer. Das
 *        serverseitige Gate spiegelt exakt die Sichtbarkeitsregel aus
 *        /api/portal/gesuche (GESUCH_STATUS_AB_BEREIT): der Gesuchtext darf
 *        nie vor der Operator-Freigabe exportierbar sein.
 *   → 502 { error }  Directus/Netz-Fehler
 *   → 401 { error } / 503 { error }  wie requirePortalSession
 *   → 405            bei anderer Methode
 *
 * Das Medium kommt ausschliesslich aus der Portal-Session
 * (`session.mediumSlug`), nie aus Query oder Body; `ladeApplicationFuerPortal`
 * verweigert (liefert null → 404) jede Application, die einem anderen Medium
 * gehört.
 *
 * Medienname + Logo werden separat aus `faas_medien` geladen (kein Feld davon
 * in `ladeApplicationFuerPortal`): der Name über `ladePortalMedium`
 * (portal-guard.ts), das Logo best effort direkt als Directus-Asset
 * (`faas_medien.logo_url` ist eine Datei-id, siehe medium-logo.ts) - ein
 * fehlendes oder nicht ladbares Logo lässt den Export nicht scheitern, das
 * Dokument entsteht dann einfach ohne Logo im Kopf (baueGesuchDocx
 * degradiert dafür bereits selbst, siehe gesuch-docx.ts).
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession, ladeApplicationFuerPortal, ladePortalMedium } from '@/lib/portal-guard'
import { gesuchPortalStatus, GESUCH_STATUS_AB_BEREIT } from '@/lib/portal-status'
import { baueGesuchDocx } from '@/lib/gesuch-docx'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })

/** Slug aus dem Stiftungsnamen (ASCII snake_case), fürs Dateiname-Muster `gesuch_<stiftung_slug>.docx`. */
function stiftungSlugFuerDateiname(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[äàâ]/g, 'a')
    .replace(/[öô]/g, 'o')
    .replace(/[üû]/g, 'u')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'stiftung'
}

/** Lädt `faas_medien.logo_url` (Directus-Datei-id) per Slug. null ohne Treffer oder bei Fehler (best effort). */
async function ladeLogoDateiId(mediumSlug: string): Promise<string | null> {
  try {
    const filter = encodeURIComponent(JSON.stringify({ slug: { _eq: mediumSlug } }))
    const res = await fetch(`${base()}/items/faas_medien?filter=${filter}&limit=1&fields=logo_url`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: Array<{ logo_url?: string | null }> }
    return json.data?.[0]?.logo_url ?? null
  } catch (err: unknown) {
    console.error('gesuch-export: logo_url nicht ladbar (best effort)', err)
    return null
  }
}

/** Lädt das Logo-Asset als Buffer. undefined ohne hinterlegtes Logo oder bei Fehler (best effort, kein Abbruch des Exports). */
async function ladeLogoBuffer(mediumSlug: string): Promise<Buffer | undefined> {
  const dateiId = await ladeLogoDateiId(mediumSlug)
  if (!dateiId) return undefined
  try {
    const res = await fetch(`${base()}/assets/${encodeURIComponent(dateiId)}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return undefined
    return Buffer.from(await res.arrayBuffer())
  } catch (err: unknown) {
    console.error('gesuch-export: Logo-Asset nicht ladbar (best effort)', err)
    return undefined
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : ''
  if (!id) {
    return res.status(400).json({ error: 'id (Query-Parameter) erforderlich.' })
  }

  try {
    const app = await ladeApplicationFuerPortal(id, session.mediumSlug)
    if (!app) {
      return res.status(404).json({ error: 'Antrag nicht gefunden.' })
    }

    const status = gesuchPortalStatus({ status: app.status, portal: app.portal })
    const text = app.portal.gesuch_text ?? ''
    if (!GESUCH_STATUS_AB_BEREIT.has(status) || !text.trim()) {
      return res.status(409).json({ error: 'Der Gesuchstext ist noch nicht verfügbar.' })
    }

    const medium = await ladePortalMedium(session.mediumSlug)
    const mediumName = medium?.name || session.mediumSlug
    const logo = await ladeLogoBuffer(session.mediumSlug)
    const stiftungName = app.stiftungName || 'Stiftung'

    const buffer = await baueGesuchDocx({
      mediumSlug: session.mediumSlug,
      mediumName,
      stiftungName,
      text,
      logo,
    })

    const dateiname = `gesuch_${stiftungSlugFuerDateiname(stiftungName)}.docx`

    res
      .status(200)
      .setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .setHeader('Content-Disposition', `attachment; filename="${dateiname}"`)
      .setHeader('Content-Length', String(buffer.length))
      .send(buffer)
  } catch (err: unknown) {
    console.error('portal/gesuch-export GET: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
