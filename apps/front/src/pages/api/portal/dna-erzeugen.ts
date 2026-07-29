/**
 * /api/portal/dna-erzeugen: Ein-Knopf-DNA-Erzeugung für das Session-Medium
 * anstossen (Task 7) + Fortschritt pollen.
 *
 * POST { rueckmeldung?: string } → Logo-Gate ZUERST (Fix-Runde 1, Important):
 *   ohne hochgeladenes Logo (faas_medien.logo_hochgeladen, siehe
 *   /api/portal/logo, Pflicht-Erststep) kein Erzeugungslauf, auch nicht bei
 *   direktem POST unter Umgehung des Client-Guards in dna.tsx. Eine optionale
 *   `rueckmeldung` («DNA ist mir zu fern», Wunsch 29.07.2026) wird vor dem
 *   Start als medium_knowledge-Eintrag mit dem Titel-Präfix
 *   DNA_RUECKMELDUNG_TITEL_PREFIX gespeichert und von der Verdichtung als
 *   eigener Prompt-Abschnitt berücksichtigt (dna-pipeline.ts). Erst dann
 *   startet (oder findet den bereits laufenden) Job über
 *   `starteGenerateDnaJob` (siehe /api/medium-knowledge/generate-dna, Step 1
 *   der Task-7-Extraktion), dieselbe Pipeline (sammeln, verdichten, messen,
 *   aktivieren), nur dass das Medium AUSSCHLIESSLICH aus der Portal-Session
 *   kommt, nie aus dem Body.
 *   → 202 { job_id, status: 'running' }  frisch gestartet
 *   → 200 { job_id, status: 'running', hinweis? }  war bereits am Laufen
 *     (Dedup; hinweis nur, wenn eine Rückmeldung mitkam, die dieser Lauf
 *     nicht mehr sieht)
 *   → 400 { error }  wenn starteGenerateDnaJob einen Fehler meldet
 *   → 403 { error }  Logo-Gate: noch kein echtes Logo hochgeladen
 *   → 404 { error }  Medium der Session existiert nicht (mehr)
 *   → 502 { error }  Directus nicht erreichbar (Logo-Gate-Lookup oder
 *     Rückmeldung nicht speicherbar — dann startet bewusst KEIN Lauf)
 *
 * GET ?job_id=<id> → 200 Job-Status (id, medium_id, status, phase, startedAt,
 *   result?, error?), derselbe Job-Status-Leser wie die Operator-Route.
 *   → 400 { error }  ohne job_id
 *   → 404 { error }  wenn der Job unbekannt ist ODER zu einem ANDEREN Medium
 *     gehört (kein Cross-Medium-Einblick in fremde Job-Ergebnisse, ein Medium
 *     darf nie den DNA-Erzeugungsstand eines anderen Mediums sehen, selbst
 *     wenn es dessen job_id erraten würde)
 *
 *   → 401 { error }  ohne gültige Portal-Session
 *   → 503 { error }  wenn PORTAL_SESSION_SECRET fehlt
 *   → 405            bei anderer Methode
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession, ladePortalMedium, legeWissensEintragAn } from '@/lib/portal-guard'
import { starteGenerateDnaJob } from '@/pages/api/medium-knowledge/generate-dna'
import { getGenerateJob } from '@/lib/generate-dna-jobs'
import { DNA_RUECKMELDUNG_TITEL_PREFIX } from '@/lib/dna-pipeline'
import { PORTAL_TEXTE } from '@/lib/portal-texte'

const RUECKMELDUNG_MAX_ZEICHEN = 1000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = requirePortalSession(req, res)
  if (!session) return

  if (req.method === 'POST') {
    // Logo-Gate (Fix-Runde 1, Important): serverseitig, unabhängig vom
    // Client-Guard in dna.tsx (der nur den Auto-Start beim Seitenaufruf
    // verhindert, einen direkten POST aber nicht abhält).
    let medium
    try {
      medium = await ladePortalMedium(session.mediumSlug)
    } catch (err: unknown) {
      console.error('dna-erzeugen: Directus nicht erreichbar', err)
      return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
    }
    if (!medium) {
      return res.status(404).json({ error: 'Medium nicht gefunden.' })
    }
    if (!medium.logoHochgeladen) {
      return res.status(403).json({ error: PORTAL_TEXTE['dna.logo_fehlt'] })
    }

    // Optionale Rückmeldung zur letzten DNA-Fassung (Wunsch 29.07.2026):
    // VOR dem Job-Start als Wissens-Eintrag speichern, damit der frische Lauf
    // sie beim Korpus-Reload sicher sieht. Der Titel-Präfix ist der Vertrag
    // mit der Pipeline (istDnaRueckmeldung in dna-pipeline.ts): solche
    // Einträge landen als eigener Abschnitt im Reduce-Prompt, nicht in den
    // Berichterstattungs-Batches. Scheitert das Speichern, wird KEIN Lauf
    // gestartet — eine Neu-Erzeugung ohne die Rückmeldung wäre genau die
    // Fassung, die das Medium gerade abgelehnt hat.
    const rueckmeldungRoh = (req.body as { rueckmeldung?: unknown } | null)?.rueckmeldung
    const rueckmeldung = typeof rueckmeldungRoh === 'string' ? rueckmeldungRoh.trim().slice(0, RUECKMELDUNG_MAX_ZEICHEN) : ''
    if (rueckmeldung) {
      try {
        await legeWissensEintragAn({
          medium_id: session.mediumSlug,
          category: 'general_info',
          title: `${DNA_RUECKMELDUNG_TITEL_PREFIX} (${new Date().toISOString().slice(0, 10)})`,
          content: rueckmeldung,
          source_url: null,
          file_id: null,
          auto_scraped: false,
        })
      } catch (err: unknown) {
        console.error('dna-erzeugen: Rückmeldung nicht speicherbar, Lauf nicht gestartet', err)
        return res.status(502).json({ error: 'Rückmeldung momentan nicht speicherbar' })
      }
    }

    const gestartet = await starteGenerateDnaJob(session.mediumSlug)
    if ('fehler' in gestartet) {
      return res.status(400).json({ error: gestartet.fehler })
    }
    // Lief bereits ein Job, hat DIESER Lauf die Rückmeldung noch nicht
    // gesehen — sie ist gespeichert und fliesst in den nächsten ein.
    const hinweis =
      gestartet.running && rueckmeldung
        ? 'Es läuft bereits eine Erzeugung; eure Rückmeldung ist gespeichert und fliesst in den nächsten Lauf ein.'
        : undefined
    return res
      .status(gestartet.running ? 200 : 202)
      .json({ job_id: gestartet.jobId, status: 'running', ...(hinweis ? { hinweis } : {}) })
  }

  if (req.method === 'GET') {
    const { job_id } = req.query
    if (!job_id || typeof job_id !== 'string') {
      return res.status(400).json({ error: 'job_id (string) als Query-Parameter erforderlich' })
    }
    const job = await getGenerateJob(job_id)
    if (!job || job.medium_id !== session.mediumSlug) {
      return res.status(404).json({ error: 'Job nicht gefunden' })
    }
    return res.status(200).json({
      id: job.id,
      medium_id: job.medium_id,
      status: job.status,
      phase: job.phase,
      startedAt: job.startedAt,
      ...(job.result !== undefined ? { result: job.result } : {}),
      ...(job.error !== undefined ? { error: job.error } : {}),
    })
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'Method Not Allowed' })
}
