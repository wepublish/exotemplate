import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import DnaPdf from '@/components/DnaPdf'
import { usePortalMe } from '@/components/portal/PortalLayout'
import { SchrittInfo } from '@/components/portal/SchrittInfo'
import { PORTAL_TEXTE } from '@/lib/portal-texte'
import { DNA_JOB_STUFEN, DNA_JOB_STUFE_LABEL, stufeAusPhase } from '@/lib/portal-dna'
import type { GenerateDnaResult } from '@/lib/generate-dna-jobs'

/**
 * /portal/dna: DNA erstellen lassen, prüfen, freigeben (Task 7).
 *
 * Ohne aktive medium_dna stösst die Seite selbst den Ein-Knopf-Erzeugungslauf
 * an (POST /api/portal/dna-erzeugen, idempotent: läuft schon einer für dieses
 * Medium, liefert der Aufruf dessen job_id statt einen zweiten zu starten) und
 * pollt den Fortschritt. Ist die DNA aktiv, zeigt die Seite Sound-Feeling,
 * Tag-Chips und Schärfe-Balken, den Freigeben-Knopf (mit Bestätigungsdialog)
 * und den PDF-Export über die bestehende DnaPdf-Komponente.
 *
 * KEIN eigenes <PortalLayout>-Wrapping (siehe src/pages/portal/index.tsx):
 * _app.tsx legt den Rahmen für alle /portal/*-Seiten bereits um.
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

type PortalDnaTag = { slug: string; label: string }
type PortalDnaAnsicht = { soundFeeling: string; tags: PortalDnaTag[]; schaerfe: number; aktivSeit: string }
type PortalDnaAntwort = {
  dna: PortalDnaAnsicht | null
  freigegeben: boolean
  freigegebenAm: string | null
  pdfDaten: GenerateDnaResult | null
}
type JobStatusAntwort = { status: 'running' | 'done' | 'error'; phase: string; error?: string }

type LadeStatus = 'laden' | 'bereit' | 'fehler'
type JobZustand = 'inaktiv' | 'laeuft' | 'fehlgeschlagen'

const POLL_MS = 4000

function formatDatum(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

// ─── Fortschritts-Stepper ─────────────────────────────────────────────────────

function FortschrittsStepper({ aktuellePhase }: { aktuellePhase: string }) {
  const aktuelleStufe = stufeAusPhase(aktuellePhase)
  const index = DNA_JOB_STUFEN.indexOf(aktuelleStufe)
  return (
    <div className="flex items-center">
      {DNA_JOB_STUFEN.map((stufe, i) => (
        <div key={stufe} className="flex flex-1 items-center">
          <div className="flex flex-col items-center gap-1">
            <div
              className={[
                'h-2.5 w-2.5 shrink-0 rounded-full',
                i < index ? 'bg-indigo-500' : i === index ? 'bg-indigo-400 animate-pulse' : 'bg-slate-200',
              ].join(' ')}
            />
            <span className={`whitespace-nowrap text-[10px] ${i <= index ? 'text-indigo-700' : 'text-slate-400'}`}>
              {DNA_JOB_STUFE_LABEL[stufe]}
            </span>
          </div>
          {i < DNA_JOB_STUFEN.length - 1 && <div className={`mx-1 h-px flex-1 ${i < index ? 'bg-indigo-300' : 'bg-slate-100'}`} />}
        </div>
      ))}
    </div>
  )
}

// ─── Hauptseite ───────────────────────────────────────────────────────────────

export default function PortalDnaSeite() {
  const me = usePortalMe()

  const [daten, setDaten] = useState<PortalDnaAntwort | null>(null)
  const [status, setStatus] = useState<LadeStatus>('laden')

  const [jobZustand, setJobZustand] = useState<JobZustand>('inaktiv')
  const [jobPhase, setJobPhase] = useState('sammeln')
  const [jobFehler, setJobFehler] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [freigebenOffen, setFreigebenOffen] = useState(false)
  const [freigebenLaedt, setFreigebenLaedt] = useState(false)
  const [rueckmeldung, setRueckmeldung] = useState('')

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const ladeDna = useCallback(async (): Promise<PortalDnaAntwort | null> => {
    try {
      const res = await fetch('/api/portal/dna')
      if (!res.ok) throw new Error(`dna: Status ${res.status}`)
      const json = (await res.json()) as PortalDnaAntwort
      setDaten(json)
      setStatus('bereit')
      return json
    } catch (err) {
      console.error('DNA: /api/portal/dna nicht erreichbar', err)
      setStatus('fehler')
      return null
    }
  }, [])

  const pollJob = useCallback(
    (id: string) => {
      fetch(`/api/portal/dna-erzeugen?job_id=${encodeURIComponent(id)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`dna-erzeugen: Status ${res.status}`)
          const job = (await res.json()) as JobStatusAntwort
          setJobPhase(job.phase)
          if (job.status === 'done') {
            stopPoll()
            setJobZustand('inaktiv')
            void ladeDna()
          } else if (job.status === 'error') {
            stopPoll()
            setJobZustand('fehlgeschlagen')
            setJobFehler(job.error ?? null)
          }
        })
        .catch((err: unknown) => {
          console.error('DNA: /api/portal/dna-erzeugen (Poll) nicht erreichbar', err)
        })
    },
    [ladeDna, stopPoll],
  )

  const starteErzeugung = useCallback(
    (mitRueckmeldung?: string) => {
      setJobZustand('laeuft')
      setJobFehler(null)
      setJobPhase('sammeln')
      fetch('/api/portal/dna-erzeugen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mitRueckmeldung ? { rueckmeldung: mitRueckmeldung } : {}),
      })
        .then(async (res) => {
          const json = (await res.json()) as { job_id?: string; error?: string; hinweis?: string }
          if (!res.ok || !json.job_id) throw new Error(json.error ?? `Status ${res.status}`)
          if (json.hinweis) toast.info(json.hinweis)
          if (mitRueckmeldung) setRueckmeldung('')
          stopPoll()
          pollRef.current = setInterval(() => pollJob(json.job_id as string), POLL_MS)
          pollJob(json.job_id)
        })
        .catch((err: unknown) => {
          setJobZustand('fehlgeschlagen')
          setJobFehler(err instanceof Error ? err.message : String(err))
        })
    },
    [pollJob, stopPoll],
  )

  useEffect(() => {
    let abgebrochen = false
    void (async () => {
      const json = await ladeDna()
      // Logo-Gate: ohne hochgeladenes Logo (siehe /api/portal/logo,
      // Pflicht-Erststep) wird KEIN Erzeugungslauf angestossen, auch nicht
      // bei direktem Aufruf von /portal/dna. Der Render zeigt stattdessen
      // den Hinweis unten (logoFehlt), nie diesen Lade-/Job-Zustand.
      if (!abgebrochen && json && !json.dna && me?.hatLogo) {
        starteErzeugung()
      }
    })()
    return () => {
      abgebrochen = true
      stopPoll()
    }
    // Bewusst nur beim Mount: ladeDna/starteErzeugung/stopPoll sind stabile
    // Callbacks, ein erneuter Lauf soll nur durch Poll-Ende oder «Erneut
    // versuchen» ausgelöst werden, nicht durch Re-Renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleFreigeben() {
    setFreigebenLaedt(true)
    try {
      const res = await fetch('/api/portal/dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aktion: 'freigeben' }),
      })
      const json = (await res.json()) as { status?: string; freigegebenAm?: string; error?: string }
      if (!res.ok || json.error) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success('Danke, eure DNA ist freigegeben.')
      setFreigebenOffen(false)
      setDaten((prev) => (prev ? { ...prev, freigegeben: true, freigegebenAm: json.freigegebenAm ?? new Date().toISOString() } : prev))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setFreigebenLaedt(false)
    }
  }

  const dna = daten?.dna ?? null
  // Logo-Gate: solange kein Logo hochgeladen ist, zeigt die Seite NUR den
  // Hinweis unten (kein Lade-/Job-/DNA-Inhalt), egal was /api/portal/dna
  // sonst liefert. Verhindert, dass ein direkter Aufruf von /portal/dna den
  // Logo-Pflicht-Erststep überspringt (siehe useEffect oben).
  const logoFehlt = !!me && !me.hatLogo

  return (
    <div className="space-y-6">
      <div>
        {/* Kurzes Seiten-Label, kein Fliesstext-Satz: analog STATION_LABEL bewusst nicht in PORTAL_TEXTE. */}
        <h1 className="text-xl font-bold text-slate-900">2. DNA</h1>
      </div>

      <SchrittInfo schritt="2" titel={PORTAL_TEXTE['schritt2.titel']}>
        <p>{PORTAL_TEXTE['schritt2.text']}</p>
        <p>{PORTAL_TEXTE['schritt2.wozu']}</p>
      </SchrittInfo>

      {logoFehlt && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm text-amber-900">{PORTAL_TEXTE['dna.logo_fehlt']}</p>
          <Link href="/portal/onboarding">
            <Button size="sm">Zum Logo-Upload</Button>
          </Link>
        </div>
      )}

      {!logoFehlt && status === 'laden' && <p className="text-sm text-slate-400">Wird geladen …</p>}
      {!logoFehlt && status === 'fehler' && <p className="text-sm text-slate-500">{PORTAL_TEXTE['fehler.daten_nicht_verfuegbar']}</p>}

      {!logoFehlt && status === 'bereit' && !dna && jobZustand === 'laeuft' && (
        <div className="space-y-5 rounded-xl border border-indigo-200 bg-indigo-50 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
            <Loader2 className="h-4 w-4 animate-spin" />
            {PORTAL_TEXTE['dna.wird_erstellt']}
          </div>
          <FortschrittsStepper aktuellePhase={jobPhase} />
        </div>
      )}

      {!logoFehlt && status === 'bereit' && !dna && jobZustand === 'fehlgeschlagen' && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm text-amber-900">
            {PORTAL_TEXTE['dna.fehlgeschlagen']}
            {jobFehler ? ` (${jobFehler})` : ''}
          </p>
          <Button size="sm" onClick={() => starteErzeugung()}>
            Erneut versuchen
          </Button>
        </div>
      )}

      {!logoFehlt && dna && (
        <div className="space-y-5">
          {/* Eine Neu-Erzeugung über einer bestehenden DNA (z.B. nach einer
              Rückmeldung) zeigt ihren Fortschritt hier, die alte DNA bleibt
              solange sichtbar. */}
          {jobZustand === 'laeuft' && (
            <div className="space-y-5 rounded-xl border border-indigo-200 bg-indigo-50 p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
                <Loader2 className="h-4 w-4 animate-spin" />
                {PORTAL_TEXTE['dna.wird_erstellt']}
              </div>
              <FortschrittsStepper aktuellePhase={jobPhase} />
            </div>
          )}
          {jobZustand === 'fehlgeschlagen' && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-6">
              <p className="text-sm text-amber-900">
                {PORTAL_TEXTE['dna.fehlgeschlagen']}
                {jobFehler ? ` (${jobFehler})` : ''}
              </p>
            </div>
          )}

          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-base italic leading-relaxed text-slate-800">«{dna.soundFeeling}»</p>

            {dna.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {dna.tags.map((t) => (
                  <Badge key={t.slug} variant="outline" className="border-indigo-200 bg-indigo-50 text-[11px] text-indigo-700">
                    {t.label}
                  </Badge>
                ))}
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-500">Schärfe</span>
                <span className="font-semibold text-indigo-600">{dna.schaerfe}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-indigo-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, dna.schaerfe))}%` }}
                />
              </div>
            </div>

            <p className="text-xs text-slate-400">Aktiv seit {formatDatum(dna.aktivSeit)}</p>
          </div>

          {daten?.freigegeben ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
              <p className="text-sm text-indigo-900">{PORTAL_TEXTE['dna.warten_auf_freischaltung']}</p>
            </div>
          ) : (
            <>
              <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
                <p className="text-sm text-indigo-900">{PORTAL_TEXTE['dna.freigabe_hinweis']}</p>
                <Button onClick={() => setFreigebenOffen(true)} disabled={jobZustand === 'laeuft'}>
                  {PORTAL_TEXTE['dna.freigeben_knopf']}
                </Button>
              </div>

              {/* Rückmeldung zur Neu-Erzeugung (Wunsch 29.07.2026): wenn die
                  DNA nicht trifft, beschreibt das Medium hier, was fehlt, und
                  stösst damit direkt einen neuen Lauf an. */}
              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{PORTAL_TEXTE['dna.rueckmeldung_titel']}</h2>
                  <p className="mt-1 text-sm text-slate-500">{PORTAL_TEXTE['dna.rueckmeldung_hinweis']}</p>
                </div>
                <Textarea
                  value={rueckmeldung}
                  onChange={(e) => setRueckmeldung(e.target.value)}
                  className="min-h-[80px]"
                  maxLength={1000}
                  disabled={jobZustand === 'laeuft'}
                />
                <Button
                  variant="outline"
                  onClick={() => starteErzeugung(rueckmeldung.trim())}
                  disabled={jobZustand === 'laeuft' || rueckmeldung.trim().length < 5}
                >
                  {jobZustand === 'laeuft' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  {PORTAL_TEXTE['dna.rueckmeldung_knopf']}
                </Button>
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {daten?.pdfDaten && me && <DnaPdf mediumName={me.medium.name} website={null} slug={me.medium.slug} result={daten.pdfDaten} />}
            <Link href="/portal/onboarding">
              <Button variant="outline" size="sm">
                {PORTAL_TEXTE['dna.neu_erstellen_knopf']}
              </Button>
            </Link>
          </div>
        </div>
      )}

      <Dialog open={freigebenOffen} onOpenChange={setFreigebenOffen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{PORTAL_TEXTE['dna.freigeben_knopf']}</DialogTitle>
            <DialogDescription>{PORTAL_TEXTE['dna.freigeben_bestaetigung']}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFreigebenOffen(false)} disabled={freigebenLaedt}>
              Abbrechen
            </Button>
            <Button onClick={() => void handleFreigeben()} disabled={freigebenLaedt}>
              {freigebenLaedt ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {PORTAL_TEXTE['dna.freigeben_knopf']}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
