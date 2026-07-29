/**
 * /api/portal/foerderhistorie: Förderhistorie + Stiftungs-Ausschlüsse des
 * Session-Mediums (Design: docs/superpowers/specs/2026-07-29-foerderhistorie-
 * und-ausschluesse-design.md).
 *
 * GET → 200 { eintraege: FoerderhistorieZeile[] }  (nur aktive, neueste zuerst)
 *
 * POST { typ, stiftung_id?, stiftung_name, jahr?, betrag?, zweck?,
 *        ausgeschlossen?, ausschluss_grund? }
 *   → 200 { id }   Zeile angelegt; bei typ erhalten/abgelehnt zusätzlich ein
 *        medium_knowledge-Eintrag (Kategorie previous_application), damit die
 *        Historie in DNA und Wissens-Score fliesst. Schlägt NUR der
 *        Wissens-Eintrag fehl, bleibt die Zeile bestehen (knowledge_id null,
 *        Fehler im Server-Log): der strukturierte Datensatz ist die Wahrheit,
 *        die Wissens-Kopie ist Anreicherung.
 *   → 422 { error }  bei ungültiger Eingabe (parseFoerderhistorieEingabe)
 *
 * DELETE ?id=<nummer>
 *   → 200 { status: 'ok' }  Soft-Delete (aktiv=false); ein verknüpfter
 *        Wissens-Eintrag wird mitgelöscht (best effort, 404 toleriert)
 *   → 400 { error }  id fehlt/ungültig
 *   → 404 { error }  Zeile existiert nicht oder gehört einem anderen Medium
 *
 * Gemeinsam: 401/503 wie requirePortalSession, 502 bei Directus-Fehlern,
 * 405 bei anderer Methode. BEWUSST KEIN matching_freigeschaltet-Gate: das
 * Onboarding ist genau die Phase davor, in der dieses Wissen erfasst wird.
 * Das Medium kommt ausschliesslich aus der Portal-Session, nie aus dem Body.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  requirePortalSession,
  ladeFoerderhistorie,
  ladeFoerderhistorieEintrag,
  legeFoerderhistorieAn,
  patchFoerderhistorie,
  legeWissensEintragAn,
  loescheWissensEintrag,
} from '@/lib/portal-guard'
import {
  parseFoerderhistorieEingabe,
  bauKnowledgeEintrag,
  foerderhistorieTypLabel,
  formatBetragChf,
} from '@/lib/foerderhistorie'
import { schreibeMediumEvent } from '@/lib/medium-events'
import { tenant } from '../../../../config/tenant'

async function handleGet(res: NextApiResponse, mediumSlug: string) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const eintraege = await ladeFoerderhistorie(mediumSlug)
    return res.status(200).json({ eintraege })
  } catch (err: unknown) {
    console.error('portal/foerderhistorie GET: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, mediumSlug: string, email: string) {
  const ergebnis = parseFoerderhistorieEingabe(req.body, new Date().getFullYear())
  if (!ergebnis.ok) {
    return res.status(422).json({ error: ergebnis.fehler })
  }
  const e = ergebnis.eingabe

  try {
    let knowledgeId: number | null = null
    const knowledge = bauKnowledgeEintrag(e)
    if (knowledge) {
      try {
        const created = await legeWissensEintragAn({
          medium_id: mediumSlug,
          category: 'previous_application',
          title: knowledge.title,
          content: knowledge.content,
          source_url: null,
          file_id: null,
          auto_scraped: false,
        })
        knowledgeId = created.id
      } catch (err: unknown) {
        console.error('portal/foerderhistorie POST: Wissens-Eintrag fehlgeschlagen, Zeile entsteht ohne', err)
      }
    }

    const created = await legeFoerderhistorieAn({
      mandant: tenant.key,
      medium_id: mediumSlug,
      stiftung_id: e.stiftungId,
      stiftung_name: e.stiftungName,
      typ: e.typ,
      jahr: e.jahr,
      betrag: e.betrag,
      zweck: e.zweck,
      ausgeschlossen: e.ausgeschlossen,
      ausschluss_grund: e.ausschlussGrund,
      quelle: 'portal',
      erfasst_von: email,
      aktiv: true,
      knowledge_id: knowledgeId,
    })

    const detailTeile: string[] = []
    if (e.jahr) detailTeile.push(String(e.jahr))
    if (e.betrag !== null) detailTeile.push(formatBetragChf(e.betrag))
    if (e.ausgeschlossen) detailTeile.push('kommt künftig nicht mehr in Frage')
    void schreibeMediumEvent({
      medium_id: mediumSlug,
      typ: 'foerderhistorie_erfasst',
      titel: `Förderhistorie: ${e.stiftungName} (${foerderhistorieTypLabel(e.typ)})`,
      detail: detailTeile.length ? detailTeile.join(' · ') : undefined,
      actor: email,
    })

    return res.status(200).json({ id: created.id })
  } catch (err: unknown) {
    console.error('portal/foerderhistorie POST: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, mediumSlug: string) {
  const idRoh = req.query.id
  const id = typeof idRoh === 'string' ? parseInt(idRoh, 10) : NaN
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'id (gültige Nummer) erforderlich.' })
  }

  try {
    const eintrag = await ladeFoerderhistorieEintrag(id, mediumSlug)
    if (!eintrag) {
      return res.status(404).json({ error: 'Eintrag nicht gefunden.' })
    }
    await patchFoerderhistorie(id, { aktiv: false })
    if (eintrag.knowledgeId !== null) {
      try {
        await loescheWissensEintrag(eintrag.knowledgeId)
      } catch (err: unknown) {
        console.error('portal/foerderhistorie DELETE: Wissens-Eintrag nicht löschbar', err)
      }
    }
    return res.status(200).json({ status: 'ok' })
  } catch (err: unknown) {
    console.error('portal/foerderhistorie DELETE: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = requirePortalSession(req, res)
  if (!session) return

  if (req.method === 'GET') return handleGet(res, session.mediumSlug)
  if (req.method === 'POST') return handlePost(req, res, session.mediumSlug, session.email)
  if (req.method === 'DELETE') return handleDelete(req, res, session.mediumSlug)

  res.setHeader('Allow', 'GET, POST, DELETE')
  return res.status(405).json({ error: 'Method Not Allowed' })
}
