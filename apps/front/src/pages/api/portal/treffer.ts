/**
 * /api/portal/treffer: kuratierte Stiftungs-Treffer des Session-Mediums (Task 8).
 *
 * GET → 200 { treffer: PortalTreffer[] }
 *   Gate: nur, solange `matching_freigeschaltet` gesetzt ist. Vorher gibt es
 *   für dieses Medium noch keine geprüften Treffer.
 *   → 403 { grund: 'noch_nicht_freigeschaltet' }  Matching noch nicht frei
 *   → 404 { error }  Medium der Session existiert nicht (mehr)
 *   → 502 { error }  Directus nicht erreichbar
 *   → 401 { error }  ohne gültige Portal-Session
 *   → 503 { error }  wenn PORTAL_SESSION_SECRET fehlt
 *   → 405            bei anderer Methode
 *
 * Das Medium kommt ausschliesslich aus der Portal-Session
 * (`session.mediumSlug`), nie aus Query oder Body.
 *
 * Datenbeschaffung in zwei Schritten (siehe portal-treffer.ts, Modul-
 * Kommentar): (1) match_results (Gate wie MATCHES in graphql/queries.ts:
 * medium-Ebene, dna_quality_tier/score-Gate aus config/tenant) + applications
 * des Mediums in EINEM GraphQL-Request; (2) stiftungen-Stammdaten für die in
 * (1) gefundenen stiftung_id in einem zweiten Request (dieselbe
 * Zwei-Schritt-Form wie der Client mit MATCHES/STIFTUNGEN, hier serverseitig
 * mit rohem fetch statt Apollo). `score_breakdown` wird NUR gelesen, um
 * daraus die Überschneidungs-Tags zu extrahieren (extrahiereUeberschneidungsTags).
 * Der rohe Breakdown selbst verlässt die Route nie.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession, ladePortalMedium } from '@/lib/portal-guard'
import {
  kuratiereTreffer,
  extrahiereUeberschneidungsTags,
  PORTAL_TREFFER_LIMIT_DEFAULT,
  type PortalTrefferMatch,
  type PortalTrefferStiftung,
  type PortalTrefferApplication,
} from '@/lib/portal-treffer'
import { tenant, MATCH_TIERS, MATCH_MIN_SCORE } from '../../../../config/tenant'

const directusBase = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })

// Ein Request holt Matches + Applications zusammen (beide nur nach medium_id
// gefiltert, keine gegenseitige Abhängigkeit). Die Stiftungs-Stammdaten
// brauchen die stiftung_id aus den Matches und folgen darum in einem
// zweiten Request (holeStiftungen).
const QUERY_BASIS = `
  query PortalTrefferBasis($medium: String!, $mandant: String!) {
    match_results(
      filter: {
        medium_id: { _eq: $medium }
        projekt_id: { _null: true }
        dna_quality_tier: { _in: ${JSON.stringify(MATCH_TIERS)} }
        score: { _gte: ${MATCH_MIN_SCORE} }
      }
      sort: ["-score"]
      limit: 500
    ) {
      stiftung_id
      score
      begruendung
      score_breakdown
    }
    applications(filter: { medium_id: { _eq: $medium }, mandant: { _eq: $mandant } }, limit: -1) {
      stiftung_id
      status
      portal
    }
  }
`

const QUERY_STIFTUNGEN = `
  query PortalTrefferStiftungen($ids: [GraphQLStringOrFloat]!) {
    stiftungen(filter: { id: { _in: $ids } }, limit: -1) {
      id
      Stiftungsname
      webseite
      sitz
    }
  }
`

type RohMatchZeile = { stiftung_id?: unknown; score?: unknown; begruendung?: unknown; score_breakdown?: unknown }
type RohApplicationZeile = { stiftung_id?: unknown; status?: unknown; portal?: unknown }
type RohStiftungZeile = { id?: unknown; Stiftungsname?: unknown; webseite?: unknown; sitz?: unknown }

async function directusGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${directusBase()}/graphql`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  })
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (!res.ok || json.errors?.length) {
    throw new Error(`Directus-GraphQL-Fehler: ${json.errors?.[0]?.message ?? res.status}`)
  }
  if (!json.data) throw new Error('Directus-GraphQL: keine Daten in der Antwort')
  return json.data
}

function baueMatch(row: RohMatchZeile): PortalTrefferMatch {
  return {
    stiftungId: String(row.stiftung_id ?? ''),
    score: Number(row.score ?? 0),
    begruendung: typeof row.begruendung === 'string' ? row.begruendung : null,
    topTags: extrahiereUeberschneidungsTags(row.score_breakdown),
  }
}

function baueApplication(row: RohApplicationZeile): PortalTrefferApplication {
  const portalRoh = row.portal
  return {
    stiftungId: String(row.stiftung_id ?? ''),
    status: typeof row.status === 'string' ? row.status : null,
    portal:
      portalRoh && typeof portalRoh === 'object'
        ? {
            angefordert_am: (portalRoh as Record<string, unknown>).angefordert_am as string | null | undefined,
            freigegeben_am: (portalRoh as Record<string, unknown>).freigegeben_am as string | null | undefined,
            abgeschickt_am: (portalRoh as Record<string, unknown>).abgeschickt_am as string | null | undefined,
          }
        : null,
  }
}

function baueStiftung(row: RohStiftungZeile): PortalTrefferStiftung {
  return {
    id: String(row.id ?? ''),
    name: typeof row.Stiftungsname === 'string' ? row.Stiftungsname : '',
    sitz: typeof row.sitz === 'string' && row.sitz.trim() ? row.sitz : null,
    website: typeof row.webseite === 'string' && row.webseite.trim() ? row.webseite : null,
  }
}

function holeLimit(): number {
  const n = Number(process.env.PORTAL_TREFFER_LIMIT)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : PORTAL_TREFFER_LIMIT_DEFAULT
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  try {
    const medium = await ladePortalMedium(session.mediumSlug)
    if (!medium) {
      return res.status(404).json({ error: 'Medium nicht gefunden.' })
    }
    if (!medium.matchingFreigeschaltet) {
      return res.status(403).json({ grund: 'noch_nicht_freigeschaltet' })
    }

    const basis = await directusGraphql<{ match_results: RohMatchZeile[]; applications: RohApplicationZeile[] }>(QUERY_BASIS, {
      medium: session.mediumSlug,
      mandant: tenant.key,
    })

    const matches = (basis.match_results ?? []).map(baueMatch)
    const applications = (basis.applications ?? []).map(baueApplication)

    const ids = Array.from(new Set(matches.map((m) => m.stiftungId).filter((id) => id)))
    const stiftungen: PortalTrefferStiftung[] =
      ids.length === 0
        ? []
        : (
            await directusGraphql<{ stiftungen: RohStiftungZeile[] }>(QUERY_STIFTUNGEN, { ids })
          ).stiftungen.map(baueStiftung)

    const treffer = kuratiereTreffer(matches, stiftungen, applications, holeLimit())

    return res.status(200).json({ treffer })
  } catch (err: unknown) {
    console.error('portal/treffer GET: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
