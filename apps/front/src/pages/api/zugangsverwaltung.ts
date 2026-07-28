/**
 * /api/zugangsverwaltung: Operator-Verwaltung der Portal-Zugänge (Task 4).
 *
 * Bewusst NICHT unter /api/portal/*: dieser Namensraum gehört exklusiv den
 * Medium-Session-Routen (login-anfordern, einloesen, logout, me), weil die
 * Cloudflare-Access-Bypass-Regel als Präfix-Regel auf /api/portal gesetzt
 * ist. Diese Route ist Operator-only und muss hinter Cloudflare Access
 * bleiben. Ein Name unter dem Präfix würde versehentlich öffentlich.
 *
 * GET
 *   → 200 { medien: PortalSteuerungMedium[], zugaenge: PortalSteuerungZugang[] }
 *     (beide auf den Mandanten gefiltert; medien nur aktive)
 *   → 502 { error }  wenn Directus nicht erreichbar ist
 *
 * POST { aktion: 'anlegen', email, medium_slug }
 *   → legt einen Zugang an (E-Mail lowercase+trim, status 'eingeladen') und
 *     erzeugt sofort den ersten Einladungs-Link (erzeugeZugangsLink, wie
 *     login-anfordern.ts) → 200 { link }. Existiert für (email, medium_slug,
 *     mandant) bereits ein Zugang, wird KEIN zweiter angelegt, sondern für
 *     den bestehenden ein neuer Link erzeugt → 200 { link, bestehend: true }.
 * POST { aktion: 'link', id }
 *   → erzeugt einen NEUEN Link für einen bestehenden Zugang (macht den
 *     vorherigen ungültig) → 200 { link }
 * POST { aktion: 'sperren' | 'entsperren', id }
 *   → setzt status auf 'gesperrt' bzw. 'aktiv' → 200 { status: 'ok' }
 *
 * Alle POST-Aktionen: 400 { error } bei fehlenden Feldern, 503 wenn
 * PORTAL_SESSION_SECRET fehlt (erzeugeZugangsLink braucht das Secret), 502
 * bei Directus-Fehlern.
 *
 * Sicherheit (Defense-in-depth): eine gültige Portal-Session (Medium) ohne
 * Cloudflare-Access-Header wird mit 403 abgewiesen. Diese Route ist
 * Operator-only, ein Medium darf sie nie erreichen (istPortalZugriffAufProxy,
 * dasselbe Muster wie beim rohen /api/directus-Proxy).
 *
 * 405 bei anderer Methode als GET/POST.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  holeSecretOderAntworte503,
  istPortalZugriffAufProxy,
  erzeugeZugangsLink,
  legeZugangAnMitLink,
  patchePortalZugang,
} from '@/lib/portal-guard'
import { loginTokenTtlSekunden } from '@/lib/portal-session'
import { schreibeMediumEvent } from '@/lib/medium-events'
import { tenant } from '../../../config/tenant'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })

// ─── Typen der Antwort ────────────────────────────────────────────────────────

type PortalSteuerungMedium = {
  slug: string
  name: string
  dnaAktiv: boolean
  dnaFreigabe: string | null
  dnaFreigabeVon: string | null
  freigeschaltet: string | null
  freigeschaltetVon: string | null
  /** faas_medien.slack_channel — fuellt {slack} in den Mail-Vorlagen. */
  slackKanal: string | null
}

type PortalSteuerungZugang = {
  id: string
  email: string
  mediumSlug: string
  status: string
  letzterLink: string | null
  letzterLinkTs: string | null
  letzterLogin: string | null
  eingeladenAm: string | null
  /** Ansprechperson beim Medium; fuellt {name}, leer heisst Rueckfall auf die Redaktion. */
  kontaktName: string | null
}

type MediumRow = {
  id: string | number
  slug: string
  name?: string | null
  dna_medium_freigabe?: string | null
  dna_medium_freigabe_von?: string | null
  matching_freigeschaltet?: string | null
  matching_freigeschaltet_von?: string | null
  slack_channel?: string | null
}

type ZugangRow = {
  id: string
  email: string
  medium_slug: string
  status: string
  letzter_link?: string | null
  letzter_link_ts?: string | null
  letzter_login?: string | null
  eingeladen_am?: string | null
  kontakt_name?: string | null
}

// ─── Directus-Lesezugriffe (GET) ─────────────────────────────────────────────

async function ladeMedienUebersicht(): Promise<PortalSteuerungMedium[]> {
  const filterMedien = encodeURIComponent(JSON.stringify({ mandant: { _eq: tenant.key }, is_active: { _eq: true } }))
  const felderMedien = 'id,slug,name,dna_medium_freigabe,dna_medium_freigabe_von,matching_freigeschaltet,matching_freigeschaltet_von,slack_channel'
  const resMedien = await fetch(`${base()}/items/faas_medien?filter=${filterMedien}&sort=name&limit=-1&fields=${felderMedien}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!resMedien.ok) throw new Error(`faas_medien: Directus antwortete ${resMedien.status}`)
  const medienJson = (await resMedien.json()) as { data?: MediumRow[] }
  const medien = medienJson.data ?? []

  const filterDna = encodeURIComponent(JSON.stringify({ is_active: { _eq: true } }))
  const resDna = await fetch(`${base()}/items/medium_dna?filter=${filterDna}&limit=-1&fields=medium_id`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!resDna.ok) throw new Error(`medium_dna: Directus antwortete ${resDna.status}`)
  const dnaJson = (await resDna.json()) as { data?: Array<{ medium_id: string }> }
  const dnaSlugs = new Set((dnaJson.data ?? []).map((r) => r.medium_id))

  return medien.map((m) => ({
    slug: m.slug,
    name: m.name ?? m.slug,
    dnaAktiv: dnaSlugs.has(m.slug),
    dnaFreigabe: m.dna_medium_freigabe ?? null,
    dnaFreigabeVon: m.dna_medium_freigabe_von ?? null,
    freigeschaltet: m.matching_freigeschaltet ?? null,
    freigeschaltetVon: m.matching_freigeschaltet_von ?? null,
    slackKanal: m.slack_channel ?? null,
  }))
}

async function ladeZugaenge(): Promise<PortalSteuerungZugang[]> {
  const filter = encodeURIComponent(JSON.stringify({ mandant: { _eq: tenant.key } }))
  const felder = 'id,email,medium_slug,status,letzter_link,letzter_link_ts,letzter_login,eingeladen_am,kontakt_name'
  const res = await fetch(`${base()}/items/portal_zugaenge?filter=${filter}&limit=-1&sort=-eingeladen_am&fields=${felder}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`portal_zugaenge: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: ZugangRow[] }
  return (json.data ?? []).map((z) => ({
    id: z.id,
    email: z.email,
    mediumSlug: z.medium_slug,
    status: z.status,
    letzterLink: z.letzter_link ?? null,
    letzterLinkTs: z.letzter_link_ts ?? null,
    letzterLogin: z.letzter_login ?? null,
    eingeladenAm: z.eingeladen_am ?? null,
    kontaktName: z.kontakt_name ?? null,
  }))
}

async function handleGet(res: NextApiResponse) {
  try {
    const [medien, zugaenge] = await Promise.all([ladeMedienUebersicht(), ladeZugaenge()])
    // loginTtlStunden geht mit: die Mail-Vorlagen nennen die Gueltigkeit des
    // Anmeldelinks, und die kennt nur der Server (PORTAL_LOGIN_TTL_STUNDEN).
    return res.status(200).json({ medien, zugaenge, loginTtlStunden: Math.round(loginTokenTtlSekunden() / 3600) })
  } catch (err: unknown) {
    console.error('zugangsverwaltung GET: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}

// ─── Schreibaktionen (POST) ───────────────────────────────────────────────────

async function aktionAnlegen(req: NextApiRequest, res: NextApiResponse, secret: string, wer: string) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const mediumSlug = typeof req.body?.medium_slug === 'string' ? req.body.medium_slug.trim() : ''
  if (!email || !mediumSlug) {
    return res.status(400).json({ error: 'email und medium_slug erforderlich.' })
  }

  try {
    // Dedup-Logik lebt in legeZugangAnMitLink (portal-guard), geteilt mit
    // /api/medium-aufnehmen: bestehender Zugang bekommt nur einen neuen Link.
    const { link, bestehend } = await legeZugangAnMitLink(email, mediumSlug, tenant.key, wer, secret)
    if (bestehend) {
      return res.status(200).json({ link, bestehend: true })
    }

    // Roadmap-Ereignis (fire-and-forget): nur beim ECHTEN Neu-Anlegen, ein
    // neuer Link für einen bestehenden Zugang ist kein Meilenstein.
    void schreibeMediumEvent({
      medium_id: mediumSlug,
      typ: 'zugang_erstellt',
      titel: 'Portal-Zugang angelegt',
      detail: email,
      actor: wer,
    })

    return res.status(200).json({ link })
  } catch (err: unknown) {
    console.error('zugangsverwaltung anlegen: fehlgeschlagen', err)
    return res.status(502).json({ error: 'Anlegen fehlgeschlagen.' })
  }
}

async function aktionNeuerLink(req: NextApiRequest, res: NextApiResponse, secret: string) {
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : ''
  if (!id) return res.status(400).json({ error: 'id erforderlich.' })

  try {
    const resFind = await fetch(`${base()}/items/portal_zugaenge/${id}?fields=id,email,medium_slug`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
    if (resFind.status === 404) return res.status(404).json({ error: 'Zugang nicht gefunden.' })
    if (!resFind.ok) return res.status(502).json({ error: `Directus antwortete ${resFind.status}` })
    const found = (await resFind.json()) as { data?: { id: string; email: string; medium_slug: string } }
    const zugang = found.data
    if (!zugang) return res.status(404).json({ error: 'Zugang nicht gefunden.' })

    const link = await erzeugeZugangsLink(zugang.id, zugang.email, zugang.medium_slug, secret)
    return res.status(200).json({ link })
  } catch (err: unknown) {
    console.error('zugangsverwaltung link: fehlgeschlagen', err)
    return res.status(502).json({ error: 'Link konnte nicht erzeugt werden.' })
  }
}

async function aktionSperrenEntsperren(req: NextApiRequest, res: NextApiResponse, aktion: 'sperren' | 'entsperren') {
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : ''
  if (!id) return res.status(400).json({ error: 'id erforderlich.' })

  try {
    await patchePortalZugang(id, { status: aktion === 'sperren' ? 'gesperrt' : 'aktiv' })
    return res.status(200).json({ status: 'ok' })
  } catch (err: unknown) {
    console.error(`zugangsverwaltung ${aktion}: fehlgeschlagen`, err)
    return res.status(502).json({ error: 'Statusänderung fehlgeschlagen.' })
  }
}

/**
 * Merkt die Ansprechperson am Zugang, damit die Anrede beim naechsten Mal
 * schon steht. Ohne diesen Wert faellt die Anrede auf «Liebe Redaktion von X»
 * zurueck — ein roher Platzhalter {name} kann nicht mehr rausgehen (Befund
 * Michael Scheurer, 28.07.2026: genau das war passiert).
 */
async function aktionKontakt(req: NextApiRequest, res: NextApiResponse) {
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : ''
  if (!id) return res.status(400).json({ error: 'id erforderlich.' })
  const roh = typeof req.body?.kontakt_name === 'string' ? req.body.kontakt_name.trim() : ''
  // Leer heisst bewusst «wieder vergessen»; 120 Zeichen sind fuer einen Namen
  // reichlich und halten die Spalte in Grenzen.
  const name = roh.slice(0, 120)

  try {
    await patchePortalZugang(id, { kontakt_name: name || null })
    return res.status(200).json({ status: 'ok', kontakt_name: name || null })
  } catch (err: unknown) {
    console.error('zugangsverwaltung kontakt: fehlgeschlagen', err)
    return res.status(502).json({ error: 'Speichern der Ansprechperson fehlgeschlagen.' })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, wer: string) {
  const secret = holeSecretOderAntworte503(res)
  if (!secret) return

  const aktion = typeof req.body?.aktion === 'string' ? req.body.aktion : ''
  switch (aktion) {
    case 'anlegen':
      return aktionAnlegen(req, res, secret, wer)
    case 'link':
      return aktionNeuerLink(req, res, secret)
    case 'kontakt':
      return aktionKontakt(req, res)
    case 'sperren':
    case 'entsperren':
      return aktionSperrenEntsperren(req, res, aktion)
    default:
      return res.status(400).json({ error: `Unbekannte aktion: ${aktion || '(leer)'}` })
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cfEmailHeader = req.headers['cf-access-authenticated-user-email'] as string | undefined
  if (istPortalZugriffAufProxy(req.headers.cookie, cfEmailHeader, process.env.PORTAL_SESSION_SECRET)) {
    return res.status(403).json({ error: 'Operator-Route, kein Portal-Zugriff.' })
  }

  if (req.method === 'GET') return handleGet(res)
  if (req.method === 'POST') return handlePost(req, res, cfEmailHeader ?? 'team')

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'Method Not Allowed' })
}
