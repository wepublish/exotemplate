/**
 * /api/portal/wissen: Unterlagen-Stand des eingeloggten Mediums (Task 6).
 *
 * GET  → 200 { eintraege: [{id,title,category,quelle,datum}], zaehler, score,
 *        fragebogen: { felder, gespeichertAm } | null }
 *   → 401 { error }  ohne gültige Portal-Session
 *   → 502 { error }  wenn Directus nicht erreichbar ist
 *
 * POST { fragebogen: { selbstbeschrieb, fokus, nogos } }
 *   → 200 { id, title, aktualisiert }  der EINE Fragebogen-Eintrag des
 *        Mediums (category general_info, title 'Fragebogen <YYYY-MM-DD>',
 *        auto_scraped false). Existiert schon einer, wird er überschrieben
 *        (aktualisiert: true) statt ein zweiter angelegt — das Medium
 *        bearbeitet seine Antworten (Wunsch 29.07.2026).
 *   → 422 { error }  wenn fragebogen fehlt oder alle drei Felder leer sind
 *   → 502 { error }  wenn Directus nicht erreichbar ist
 *
 *   → 503 { error }  wenn PORTAL_SESSION_SECRET fehlt
 *   → 405            bei anderen Methoden
 *
 * Das Medium kommt in BEIDEN Richtungen ausschliesslich aus der Portal-
 * Session (`session.mediumSlug`), nie aus Query oder Body. Die Ableitung
 * (Zähler, Score, Quellen-Kennzeichnung, Fragebogen-Text) ist rein und
 * getestet in src/lib/portal-status.ts.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  requirePortalSession,
  ladeWissenFuerMedium,
  legeWissensEintragAn,
  ladeFragebogenEintrag,
  patcheWissensEintrag,
  type PortalWissenEintrag,
} from '@/lib/portal-guard'
import {
  berechneWissensScore,
  bestimmeWissensQuelle,
  baueFragebogenEintrag,
  parseFragebogenEintrag,
  type WissensZaehler,
  type FragebogenFelder,
} from '@/lib/portal-status'

/** Nur diese vier Kategorien fliessen in Zähler + Score (siehe portal-status.ts). */
function baueZaehler(eintraege: PortalWissenEintrag[]): WissensZaehler {
  const zaehler: WissensZaehler = { published_article: 0, newsletter: 0, previous_application: 0, general_info: 0 }
  for (const e of eintraege) {
    if (e.category === 'published_article' || e.category === 'newsletter' || e.category === 'previous_application' || e.category === 'general_info') {
      zaehler[e.category]++
    }
  }
  return zaehler
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, mediumSlug: string) {
  // Nie cachen: die Unterlagen-Liste ist sitzungsspezifisch und ändert sich
  // nach jedem Upload. Ohne diesen Header liefert Browser/CDN die alte,
  // leere Fassung, und frische Uploads erscheinen scheinbar nicht.
  res.setHeader('Cache-Control', 'no-store')
  try {
    const [eintraege, fragebogenRoh] = await Promise.all([
      ladeWissenFuerMedium(mediumSlug),
      ladeFragebogenEintrag(mediumSlug),
    ])
    const zaehler = baueZaehler(eintraege)
    return res.status(200).json({
      eintraege: eintraege.map((e) => ({
        id: e.id,
        title: e.title,
        category: e.category,
        quelle: bestimmeWissensQuelle(e.autoScraped),
        datum: e.dateCreated,
      })),
      zaehler,
      score: berechneWissensScore(zaehler),
      // Gespeicherte Fragebogen-Antworten für die Vorbefüllung (Wunsch
      // 29.07.2026): null, solange nichts erfasst ist.
      fragebogen: fragebogenRoh
        ? { felder: parseFragebogenEintrag(fragebogenRoh.content), gespeichertAm: fragebogenRoh.dateUpdated }
        : null,
    })
  } catch (err: unknown) {
    console.error('portal/wissen GET: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}

function leseFragebogenFelder(body: unknown): FragebogenFelder | null {
  const fragebogen = (body as { fragebogen?: unknown } | null)?.fragebogen
  if (!fragebogen || typeof fragebogen !== 'object') return null
  const f = fragebogen as Record<string, unknown>
  return {
    selbstbeschrieb: typeof f.selbstbeschrieb === 'string' ? f.selbstbeschrieb : '',
    fokus: typeof f.fokus === 'string' ? f.fokus : '',
    nogos: typeof f.nogos === 'string' ? f.nogos : '',
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, mediumSlug: string) {
  const felder = leseFragebogenFelder(req.body)
  if (!felder) {
    return res.status(422).json({ error: 'fragebogen (Objekt mit selbstbeschrieb/fokus/nogos) erforderlich.' })
  }

  const eintrag = baueFragebogenEintrag(felder, new Date())
  if (!eintrag) {
    return res.status(422).json({ error: 'Bitte füllt mindestens ein Feld aus.' })
  }

  try {
    // Upsert statt Append (Wunsch 29.07.2026): ein Medium hat EINEN
    // Fragebogen, den es später bearbeitet. Vorher entstand bei jedem
    // Absenden ein weiterer Eintrag, und alle landeten gemeinsam im
    // DNA-Korpus — widersprüchliche Antworten inklusive.
    const bestehend = await ladeFragebogenEintrag(mediumSlug)
    if (bestehend) {
      await patcheWissensEintrag(bestehend.id, { title: eintrag.title, content: eintrag.content })
      return res.status(200).json({ id: bestehend.id, title: eintrag.title, aktualisiert: true })
    }
    const created = await legeWissensEintragAn({
      medium_id: mediumSlug,
      category: 'general_info',
      title: eintrag.title,
      content: eintrag.content,
      source_url: null,
      file_id: null,
      auto_scraped: false,
    })
    return res.status(200).json({ id: created.id, title: eintrag.title, aktualisiert: false })
  } catch (err: unknown) {
    console.error('portal/wissen POST: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = requirePortalSession(req, res)
  if (!session) return

  if (req.method === 'GET') return handleGet(req, res, session.mediumSlug)
  if (req.method === 'POST') return handlePost(req, res, session.mediumSlug)

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'Method Not Allowed' })
}
