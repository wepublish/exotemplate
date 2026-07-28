/**
 * DnaGenerieren.tsx — Der EIN-KNOPF für die Medien-DNA.
 *
 * Ein Klick → der Server sammelt automatisch alle Quellen (We.Publish-Artikel +
 * Newsletter, datensuppe-Ordner, Web-Crawl), verdichtet sie, misst die v3-DNA und
 * schaltet sie sofort aktiv. Ersetzt die getrennten Schritte Arbeits-DNA / finale
 * v3-DNA. Wiederholbar bei neuen Daten.
 *
 * Async (Cloudflare-100s-Limit): POST → job_id, dann Polling alle 5s.
 */

import { useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import DnaPdf from '@/components/DnaPdf'
import type { GenerateDnaResult } from '@/lib/generate-dna-jobs'

const POLL_INTERVAL_MS = 5_000

interface JobStatus {
  id: string
  status: 'running' | 'done' | 'error'
  phase: string
  result?: GenerateDnaResult
  error?: string
}

interface DnaGenerierenProps {
  slug: string
  name: string
  website: string | null
  /** Wird nach erfolgreichem Lauf aufgerufen (z.B. Parent-refetch der DNA-Liste). */
  onFertig?: () => void
}

/** Mappt die rohe Phase auf einen menschenlesbaren Schritt. */
function phaseLabel(phase: string): string {
  if (phase.startsWith('verdichten')) return `Quellen verdichten (${phase.replace('verdichten ', '')})`
  switch (phase) {
    case 'sammeln':
      return 'Quellen einsammeln (We.Publish, Datensuppe, Web-Crawl)'
    case 'profil':
      return 'Profil erstellen'
    case 'messen':
      return 'DNA messen'
    case 'aktivieren':
      return 'Aktiv schalten'
    default:
      return 'Läuft'
  }
}

export default function DnaGenerieren({ slug, name, website, onFertig }: DnaGenerierenProps) {
  const [status, setStatus] = useState<'idle' | 'läuft' | 'fertig' | 'fehler'>('idle')
  const [phase, setPhase] = useState<string>('')
  const [result, setResult] = useState<GenerateDnaResult | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [sekunden, setSekunden] = useState(0)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sekRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const jobIdRef = useRef<string | null>(null)

  function stopPolling() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (sekRef.current !== null) {
      clearInterval(sekRef.current)
      sekRef.current = null
    }
  }

  useEffect(() => {
    return () => stopPolling()
  }, [])

  async function handleGenerieren() {
    setStatus('läuft')
    setResult(null)
    setFehler(null)
    setPhase('sammeln')
    setSekunden(0)
    stopPolling()

    let jobId: string
    try {
      const res = await fetch('/api/medium-knowledge/generate-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medium_id: slug }),
      })
      const json = (await res.json()) as { job_id?: string; error?: string }
      if (!res.ok || json.error || !json.job_id) {
        setFehler(json.error ?? `HTTP ${res.status}`)
        setStatus('fehler')
        toast.error(`DNA-Generierung fehlgeschlagen: ${json.error ?? res.status}`)
        return
      }
      jobId = json.job_id
      jobIdRef.current = jobId
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setFehler(msg)
      setStatus('fehler')
      toast.error(`DNA-Generierung konnte nicht gestartet werden: ${msg}`)
      return
    }

    sekRef.current = setInterval(() => setSekunden(s => s + 1), 1_000)

    async function poll() {
      const id = jobIdRef.current
      if (!id) return
      try {
        // cb gegen Cloudflare-Edge-Cache: Job-Polling darf nie eine gecachte
        // Zwischenphase serviert bekommen (Muster wie auf den Portal-Seiten).
        const res = await fetch(`/api/medium-knowledge/generate-dna?job_id=${encodeURIComponent(id)}&cb=${Date.now()}`, { cache: 'no-store' })
        if (res.status === 404) {
          stopPolling()
          setStatus('fehler')
          setFehler('Status nicht mehr verfügbar (Server neugestartet?). Medium neu laden — die DNA ist evtl. trotzdem gemessen.')
          return
        }
        if (!res.ok) return
        const job = (await res.json()) as JobStatus
        setPhase(job.phase)
        if (job.status === 'done') {
          stopPolling()
          setStatus('fertig')
          if (job.result) {
            setResult(job.result)
            for (const w of job.result.warnungen) toast.warning(w)
            toast.success(`DNA für «${name}» generiert (Schärfe ${job.result.schaerfe_prozent}%) und aktiv geschaltet`)
          }
          onFertig?.()
        } else if (job.status === 'error') {
          stopPolling()
          setStatus('fehler')
          setFehler(job.error ?? 'Unbekannter Fehler im Hintergrundprozess')
          toast.error(`DNA-Generierung fehlgeschlagen: ${job.error ?? 'Unbekannter Fehler'}`)
        }
      } catch {
        // transient — weiterpollen
      }
    }

    await poll()
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS)
  }

  const minuten = Math.floor(sekunden / 60)
  const sekRest = sekunden % 60
  const zeitText = minuten > 0 ? `${minuten}:${String(sekRest).padStart(2, '0')} min` : `${sekunden}s`

  return (
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">DNA generieren</div>
          <div className="text-xs text-slate-500">
            Sammelt automatisch We.Publish-Artikel, Datensuppe und Web-Crawl → eine aktive DNA.
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => { void handleGenerieren() }}
          disabled={status === 'läuft'}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs shrink-0"
        >
          {status === 'läuft' ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              {phaseLabel(phase)} … ({zeitText})
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              {status === 'fertig' ? 'Neu generieren' : 'DNA generieren'}
            </>
          )}
        </Button>
      </div>

      {status === 'läuft' && (
        <div className="px-4 pb-3 text-xs text-indigo-700">
          Das dauert einige Minuten (Crawl + Verdichtung + Messung). Du kannst die Seite offen lassen.
        </div>
      )}

      {status === 'fehler' && fehler && (
        <div className="mx-4 mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{fehler}</span>
        </div>
      )}

      {status === 'fertig' && result && (
        <div className="border-t border-indigo-100 bg-white/70 px-4 py-3 space-y-3">
          {/* Kopfzeile Ergebnis */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              Version {result.version} aktiv · Schärfe {result.schaerfe_prozent}% · {result.tag_count} Tags
              {result.hatte_crawl && <span className="text-[10px] text-emerald-600 font-medium">· mit Web-Crawl</span>}
            </div>
            <DnaPdf mediumName={name} website={website} slug={slug} result={result} />
          </div>

          {/* Quellen-Statistik (immer vorhanden bei einem frisch abgeschlossenen
              Erzeugungslauf; in GenerateDnaResult nur optional getippt, weil die
              Portal-DNA-Seite denselben Typ auch für rekonstruierte, ältere
              Ergebnisse ohne Quellen-Schnappschuss nutzt, siehe portal-dna.ts). */}
          {result.quellen && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                <div className="text-slate-400">We.Publish</div>
                <div className="font-medium text-slate-700">
                  {result.quellen.wepublish_api_vorhanden
                    ? `${result.quellen.wepublish_artikel_neu} Artikel · ${result.quellen.wepublish_newsletter_neu} NL`
                    : 'kein Schlüssel'}
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                <div className="text-slate-400">Datensuppe</div>
                <div className="font-medium text-slate-700">
                  {result.quellen.datensuppe_ordner_gefunden
                    ? `${result.quellen.datensuppe_dateien_neu} neue Dateien`
                    : 'nicht gefunden'}
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                <div className="text-slate-400">Web-Crawl</div>
                <div className="font-medium text-slate-700">{result.quellen.web_crawl_ok ? 'erfolgreich' : '–'}</div>
              </div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                <div className="text-slate-400">Korpus</div>
                <div className="font-medium text-slate-700">{result.quellen.korpus_eintraege_gesamt} Einträge</div>
              </div>
            </div>
          )}

          {/* Warnungen */}
          {result.warnungen.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 space-y-1">
              {result.warnungen.map((w, i) => (
                <div key={i} className="text-[11px] text-amber-800 flex gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Sound-Feeling */}
          {result.sound_feeling && (
            <p className="text-xs text-slate-600 italic leading-relaxed">{result.sound_feeling}</p>
          )}
        </div>
      )}
    </div>
  )
}
