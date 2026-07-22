import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@apollo/client/react'
import { CheckCircle2, AlertTriangle, ExternalLink, Globe, Copy, Check, FlaskConical, Loader2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { MediumCard, type MediumListItem } from '@/components/MediumCard'
import { MediumLogo } from '@/components/MediumLogo'
import { ProjekteBlock } from '@/components/ProjekteBlock'
import { KontaktEmailEditor } from '@/components/KontaktEmailEditor'
import DnaGenerieren from '@/components/DnaGenerieren'
import { MEDIEN_LIST, MEDIUM_DETAIL_QUERIES } from '@/graphql/medien'
import { mediumAlias } from '@/graphql/dashboard'
import { DASHBOARD_KPIS } from '@/graphql/dashboard'

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

/**
 * Konfidenz-Label aus quellen.datenbasis — defensiv, da Alt-DNAs
 * das Feld als String, Array oder null haben können.
 * NICHT gerendert werden: datensuppe_pfad, datensuppe_inventar,
 * web_recherche_urls — nur die Konfidenz-Zusammenfassung.
 */
function mediumKonfidenz(quellen: unknown): string {
  if (!quellen || typeof quellen !== 'object') return 'unbekannt'
  const q = quellen as Record<string, unknown>
  const db = q.datenbasis
  const val =
    typeof db === 'string'
      ? db
      : Array.isArray(db)
      ? String(db[0] ?? '')
      : ''
  if (val.toLowerCase().includes('web') || val.toLowerCase().includes('crawl'))
    return 'Webseite + Stammdaten'
  if (val.toLowerCase().includes('stamm')) return 'Nur Stammdaten'
  return val || 'unbekannt'
}

/**
 * Öffentliche Webseiten-URL aus quellen — falls vorhanden.
 * Interne Felder (datensuppe_pfad etc.) werden NICHT zurückgegeben.
 */
function mediumWebsite(quellen: unknown): string | null {
  if (!quellen || typeof quellen !== 'object') return null
  const q = quellen as Record<string, unknown>
  const url = q.webseite_url
  return typeof url === 'string' && url.startsWith('http') ? url : null
}

/**
 * Baut den Clipboard-Text für «DNA als Prompt kopieren».
 * Enthält: medium_name, sound_feeling, Tag-Liste (slug, gewicht, begruendung).
 * KEINE internen Pfade, KEINE evidenz-Felder.
 */
function buildDnaPromptText(
  mediumName: string,
  soundFeeling: string | null | undefined,
  tags: unknown
): string {
  const lines: string[] = [`Medium: ${mediumName}`]

  if (soundFeeling) {
    lines.push(`\nCharakter:\n${soundFeeling}`)
  }

  if (Array.isArray(tags) && tags.length > 0) {
    lines.push('\nThematische Tags (Slug · Gewicht · Begründung):')
    const sortedTags = [...(tags as { tag_slug: string; gewicht: number; begruendung: string }[])]
      .sort((a, b) => b.gewicht - a.gewicht)
    for (const t of sortedTags) {
      lines.push(`  ${t.tag_slug} (${t.gewicht}): ${t.begruendung ?? ''}`)
    }
  }

  return lines.join('\n')
}

// ─── Typen für die Mess-UI ────────────────────────────────────────────────────

interface NeueVersion {
  id: number
  version: number
  schaerfe_prozent: number
  tag_count: number
  sound_feeling: string
  tags: { tag_slug: string; gewicht: number; begruendung: string }[]
  hatte_crawl: boolean
  warnung?: string
}

/** Antwortformat des GET-Polling-Endpoints. */
interface JobStatusPayload {
  id: string
  medium_id: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  result?: NeueVersion
  error?: string
}

const POLL_INTERVAL_MS = 5_000

// ─── Medium-Detail-Dialog ─────────────────────────────────────────────────────

interface MediumDetailDialogProps {
  mediumId: string | null
  onClose: () => void
}

function MediumDetailDialog({ mediumId, onClose }: MediumDetailDialogProps) {
  const [kopiert, setKopiert] = useState(false)

  // Mess-UI: asynchroner Job-Status
  const [messung, setMessung] = useState<'idle' | 'läuft' | 'fertig' | 'fehler'>('idle')
  const [neueVersion, setNeueVersion] = useState<NeueVersion | null>(null)
  const [messungsFehler, setMessungsFehler] = useState<string | null>(null)
  const [laufSekunden, setLaufSekunden] = useState(0)

  // Polling-Refs — damit clearInterval beim Unmount/Fertig/Dialog-Schluss greift
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const laufSekundenIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const aktuellerJobId = useRef<string | null>(null)

  // Aktivierungs-Status
  const [aktivierung, setAktivierung] = useState<'idle' | 'läuft' | 'fertig' | 'fehler'>('idle')

  // Polling stoppen wenn Dialog geschlossen wird (mediumId === null)
  // oder bei Komponenten-Unmount.
  useEffect(() => {
    if (!mediumId) {
      stopPolling()
    }
    return () => {
      stopPolling()
    }
  // stopPolling ist eine Funktion, die nur refs verwendet — keine Deps nötig
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediumId])

  /** Stoppt alle laufenden Polling- und Sekunden-Intervalle. */
  function stopPolling() {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    if (laufSekundenIntervalRef.current !== null) {
      clearInterval(laufSekundenIntervalRef.current)
      laufSekundenIntervalRef.current = null
    }
  }

  // Wähle die vorkompilierte inline-Query für dieses Medium.
  // Wenn mediumId nicht in MEDIUM_DETAIL_QUERIES ist (sollte nie passieren),
  // skip die Query und zeige Leer-Zustand.
  const query = mediumId ? MEDIUM_DETAIL_QUERIES[mediumId] : null

  const { data, loading, error, refetch } = useQuery(query ?? MEDIEN_LIST, {
    skip: !mediumId || !query,
    fetchPolicy: 'cache-first',
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const typedData = data as any
  const dna = typedData?.medium_dna?.[0]
  const matchCount: number | null =
    typedData?.match_results_aggregated?.[0]?.count?.id ?? null

  // Konfidenz und Website — defensiv aus quellen extrahiert
  const konf = mediumKonfidenz(dna?.quellen)
  const isWeb = konf.toLowerCase().includes('web')
  const website = mediumWebsite(dna?.quellen)

  // Tags defensiv sortiert
  const tags: { tag_slug: string; gewicht: number; begruendung: string }[] =
    Array.isArray(dna?.tags)
      ? [...(dna.tags as { tag_slug: string; gewicht: number; begruendung: string }[])].sort(
          (a, b) => b.gewicht - a.gewicht
        )
      : []

  // foerderpraxis: bei Medien leer ({}) — nur rendern, wenn tatsächlich Felder vorhanden
  const fp = dna?.foerderpraxis && typeof dna.foerderpraxis === 'object'
    ? (dna.foerderpraxis as Record<string, unknown>)
    : {}
  const hasFoerderpraxis = Boolean(
    fp.durchschnitt || fp.min_betrag || fp.max_betrag || fp.geo_scope || fp.einreichmodalitaet
  )

  async function handleKopieren() {
    if (!dna) return
    const text = buildDnaPromptText(dna.medium_name, dna.sound_feeling, dna.tags)
    try {
      await navigator.clipboard.writeText(text)
      setKopiert(true)
      setTimeout(() => setKopiert(false), 2000)
    } catch {
      // Clipboard-Fehler (z.B. kein HTTPS) — kein Absturz
    }
  }

  async function handleMessen() {
    if (!mediumId) return

    setMessung('läuft')
    setNeueVersion(null)
    setMessungsFehler(null)
    setLaufSekunden(0)
    stopPolling()

    // ── 1. Job anstossen (kehrt sofort mit job_id zurück) ──────────────────
    let jobId: string
    try {
      const res = await fetch('/api/measure-medium-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medium_id: mediumId }),
      })
      const json = await res.json() as { job_id?: string; status?: string; error?: string }
      if (!res.ok || json.error) {
        setMessungsFehler(json.error ?? `HTTP ${res.status}`)
        setMessung('fehler')
        toast.error(`Messung fehlgeschlagen: ${json.error ?? res.status}`)
        return
      }
      if (!json.job_id) {
        setMessungsFehler('Kein job_id erhalten')
        setMessung('fehler')
        return
      }
      jobId = json.job_id
      aktuellerJobId.current = jobId
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setMessungsFehler(msg)
      setMessung('fehler')
      toast.error(`Messung konnte nicht gestartet werden: ${msg}`)
      return
    }

    // ── 2. Sekunden-Zähler ──────────────────────────────────────────────────
    laufSekundenIntervalRef.current = setInterval(() => {
      setLaufSekunden(s => s + 1)
    }, 1_000)

    // ── 3. Polling alle 5s ──────────────────────────────────────────────────
    async function poll() {
      // Job-ID kann sich durch einen neuen Messen-Klick geändert haben
      const currentJobId = aktuellerJobId.current
      if (!currentJobId) return

      try {
        const res = await fetch(`/api/measure-medium-dna?job_id=${encodeURIComponent(currentJobId)}`)

        if (res.status === 404) {
          // Job nach Container-Neustart verloren
          stopPolling()
          setMessung('fehler')
          setMessungsFehler(
            'Status nicht mehr verfügbar (Server neugestartet?) — Medium neu laden und neue Versionen prüfen.'
          )
          return
        }

        if (!res.ok) {
          // Transiente Netzwerk-Fehler: Polling fortsetzen, nicht abbrechen
          return
        }

        const job = await res.json() as JobStatusPayload

        if (job.status === 'done') {
          stopPolling()
          setMessung('fertig')
          if (job.result) {
            setNeueVersion(job.result)
            if (job.result.warnung) toast.warning(job.result.warnung)
          }
        } else if (job.status === 'error') {
          stopPolling()
          setMessung('fehler')
          setMessungsFehler(job.error ?? 'Unbekannter Fehler im Hintergrundprozess')
          toast.error(`Messung fehlgeschlagen: ${job.error ?? 'Unbekannter Fehler'}`)
        }
        // status === 'running': weiterpollen
      } catch {
        // Netzwerk-Fehler beim Pollen: weiterpollen (transient)
      }
    }

    // Ersten Poll sofort, dann alle 5s
    await poll()
    pollIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS)
  }

  async function handleAktivieren() {
    if (!neueVersion) return
    setAktivierung('läuft')
    try {
      const res = await fetch('/api/activate-medium-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: neueVersion.id }),
      })
      const json = await res.json() as { ok?: boolean; aktiv?: number; error?: string }
      if (!res.ok || json.error) {
        setAktivierung('fehler')
        toast.error(`Aktivierung fehlgeschlagen: ${json.error ?? res.status}`)
        return
      }
      setAktivierung('fertig')
      toast.success(`Version v${neueVersion.version} ist jetzt aktiv.`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAktivierung('fehler')
      toast.error(`Aktivierung fehlgeschlagen: ${msg}`)
    }
  }

  return (
    <Dialog open={!!mediumId} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {/* DialogTitle immer rendern — auch im Lade-/Leerzustand (Barrierefreiheit). */}
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center gap-3">
              {dna && (
                <MediumLogo slug={dna.medium_id} name={dna.medium_name} size={32} />
              )}
              <span>
                {dna ? dna.medium_name : loading ? 'Wird geladen…' : 'Medium'}
              </span>
            </div>
          </DialogTitle>
          {dna && (
            <DialogDescription asChild>
              <div className="flex flex-wrap gap-2 mt-1 items-center">
                <span className="font-mono text-[10px] text-slate-400">
                  {dna.medium_id}
                </span>
                {matchCount !== null && (
                  <span className="text-xs text-violet-600 font-medium">
                    {matchCount.toLocaleString('de-CH')} Matches
                  </span>
                )}
              </div>
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Lade-Skeleton */}
        {loading && (
          <div className="space-y-3 py-2">
            <div className="h-4 bg-slate-100 rounded animate-pulse w-full" />
            <div className="h-4 bg-slate-100 rounded animate-pulse w-5/6" />
            <div className="h-4 bg-slate-100 rounded animate-pulse w-2/3" />
          </div>
        )}

        {/* Fehler-/Leer-Zustand */}
        {!loading && !dna && (
          <p className="text-sm text-slate-500 py-4">
            {error
              ? 'Die DNA-Daten konnten nicht geladen werden.'
              : 'Keine DNA-Daten gefunden.'}
          </p>
        )}

        {dna && (
          <div className="space-y-4 text-sm">
            {/* DNA-Block: Konfidenz-Banner (emerald = web, amber = stammdaten/unbekannt) */}
            <div className="rounded-xl border border-violet-100 bg-white overflow-hidden shadow-sm">
              {isWeb ? (
                <div className="bg-emerald-50 px-4 py-2 border-b border-emerald-100 flex items-center gap-2 text-emerald-700 text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  {konf} · Schärfe {dna.schaerfe_prozent ?? '?'}%
                </div>
              ) : (
                <div className="bg-amber-50 px-4 py-2 border-b border-amber-100 flex items-center gap-2 text-amber-700 text-xs font-medium">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {konf} · Schärfe {dna.schaerfe_prozent ?? '?'}%
                </div>
              )}

              <div className="p-4 space-y-4">
                {/* Antragsteller-Typ */}
                {dna.antragsteller_typ && (
                  <div className="flex gap-2 items-center">
                    <span className="text-xs text-slate-500">Typ:</span>
                    <Badge variant="outline" className="text-[10px] text-slate-600">
                      {dna.antragsteller_typ}
                    </Badge>
                  </div>
                )}

                {/* Sound-Feeling */}
                {dna.sound_feeling && (
                  <p className="text-sm text-slate-800 leading-relaxed italic">
                    «{dna.sound_feeling}»
                  </p>
                )}

                {/* Top-Tags — gewicht als Relevanzindikator, begruendung als Tooltip */}
                {tags.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Thematische Tags
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map(t => (
                        <Badge
                          key={t.tag_slug}
                          variant="outline"
                          className={[
                            'text-[10px] cursor-default',
                            t.gewicht === 3
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              : 'text-slate-600',
                          ].join(' ')}
                          title={t.begruendung}
                        >
                          {t.tag_slug} ({t.gewicht})
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Förderpraxis — nur wenn nicht leer (bei Medien fast immer leer) */}
                {hasFoerderpraxis && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Förderpraxis
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-4 text-xs">
                      {Boolean(fp.durchschnitt || fp.min_betrag || fp.max_betrag) && (
                        <div className="flex">
                          <span className="w-24 text-slate-500">Fördersumme:</span>
                          <span className="font-medium text-slate-800">
                            {typeof fp.durchschnitt === 'number'
                              ? `Ø CHF ${fp.durchschnitt.toLocaleString('de-CH')}`
                              : fp.durchschnitt
                              ? `Ø CHF ${String(fp.durchschnitt)}`
                              : `${fp.min_betrag ?? 0} – ${fp.max_betrag ?? '?'} CHF`}
                          </span>
                        </div>
                      )}
                      {Array.isArray(fp.geo_scope) && fp.geo_scope.length > 0 && (
                        <div className="flex">
                          <span className="w-24 text-slate-500">Geo-Scope:</span>
                          <span className="font-medium text-slate-800">
                            {(fp.geo_scope as string[]).join(', ')}
                          </span>
                        </div>
                      )}
                      {Boolean(fp.einreichmodalitaet) && (
                        <div className="flex col-span-1 md:col-span-2">
                          <span className="w-24 text-slate-500">Einreichungen:</span>
                          <span className="font-medium text-slate-800">
                            {String(fp.einreichmodalitaet)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Website-Link (öffentlich) */}
                {website && (
                  <div>
                    <a
                      href={website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:underline w-fit"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      Website
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                {/* Metadaten-Footer */}
                <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                  DNA v{dna.version ?? '?'} · Vokabular v{dna.vocabulary_version_at_creation ?? '?'}
                </div>
              </div>
            </div>

            {/* Button «DNA als Prompt kopieren» */}
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleKopieren}
                className="gap-2 text-xs"
              >
                {kopiert ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    Kopiert!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    DNA als Prompt kopieren
                  </>
                )}
              </Button>
            </div>

            {/* ─── Ein-Knopf-DNA (empfohlen) ────────────────────────────── */}
            {mediumId && (
              <div className="border-t border-slate-100 pt-4">
                <DnaGenerieren
                  slug={mediumId}
                  name={dna?.medium_name ?? mediumId}
                  website={website}
                  onFertig={() => { void refetch() }}
                />
              </div>
            )}

            {/* ─── DNA-Schnell-Messung (ohne neue Quellen) ──────────────── */}
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-700">Nur neu messen (ohne neue Quellen)</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Schnelle Re-Messung aus den bereits vorhandenen Daten · bestehende DNA bleibt aktiv bis Freigabe
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleMessen}
                  disabled={messung === 'läuft'}
                  className="gap-2 text-xs shrink-0"
                >
                  {messung === 'läuft' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      misst … ({laufSekunden}s)
                    </>
                  ) : (
                    <>
                      <FlaskConical className="w-3.5 h-3.5" />
                      DNA neu messen (v3)
                    </>
                  )}
                </Button>
              </div>

              {/* Hinweistext während laufender Messung */}
              {messung === 'läuft' && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[10px] text-slate-500">
                  Die Messung läuft auf dem Spark und kann einige Minuten dauern (besonders während des DNA-Laufs). Du kannst den Dialog offen lassen; das Ergebnis erscheint hier.
                </div>
              )}

              {/* Fehler-Anzeige */}
              {messung === 'fehler' && messungsFehler && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  <span className="font-medium">Fehler:</span> {messungsFehler}
                </div>
              )}

              {/* Neue Version (noch nicht aktiv) */}
              {messung === 'fertig' && neueVersion && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 overflow-hidden">
                  {/* Header */}
                  <div className="bg-indigo-100 px-4 py-2 border-b border-indigo-200 flex items-center justify-between">
                    <span className="text-xs font-semibold text-indigo-800">
                      Neue Version v{neueVersion.version} · nicht aktiv
                    </span>
                    <div className="flex items-center gap-2 text-[10px] text-indigo-600 font-medium">
                      <span>Schärfe {neueVersion.schaerfe_prozent}%</span>
                      <span>·</span>
                      <span>{neueVersion.tag_count} Tags</span>
                      {neueVersion.hatte_crawl && (
                        <>
                          <span>·</span>
                          <span className="text-emerald-600">mit Web-Crawl</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    {/* Warnung falls weniger als 10 Tags */}
                    {neueVersion.warnung && (
                      <div className="flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        {neueVersion.warnung}
                      </div>
                    )}

                    {/* Sound-Feeling */}
                    {neueVersion.sound_feeling && (
                      <p className="text-xs text-slate-700 leading-relaxed italic">
                        «{neueVersion.sound_feeling}»
                      </p>
                    )}

                    {/* Top-Tags */}
                    {neueVersion.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {[...neueVersion.tags]
                          .sort((a, b) => b.gewicht - a.gewicht)
                          .map(t => (
                            <Badge
                              key={t.tag_slug}
                              variant="outline"
                              className={[
                                'text-[10px] cursor-default',
                                t.gewicht === 3
                                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                  : 'text-slate-600',
                              ].join(' ')}
                              title={t.begruendung}
                            >
                              {t.tag_slug} ({t.gewicht})
                            </Badge>
                          ))}
                      </div>
                    )}

                    {/* Aktivierungs-Button */}
                    <div className="flex items-center justify-between pt-1 border-t border-indigo-100">
                      <p className="text-[10px] text-indigo-500">
                        Die aktuelle DNA bleibt aktiv bis du diese Version freigibst.
                      </p>
                      {aktivierung === 'fertig' ? (
                        <div className="flex items-center gap-1 text-xs text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Aktiv
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          onClick={handleAktivieren}
                          disabled={aktivierung === 'läuft'}
                          className="gap-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white shrink-0"
                        >
                          {aktivierung === 'läuft' ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Schalte um…
                            </>
                          ) : (
                            <>
                              <Zap className="w-3.5 h-3.5" />
                              Diese Version aktiv schalten
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* ─── Ende DNA-Mess-Sektion ────────────────────────────────── */}
          </div>
        )}
        {mediumId && (
          <div className="mt-4 space-y-4">
            <KontaktEmailEditor mediumSlug={mediumId} />
            <ProjekteBlock mediumSlug={mediumId} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Hauptseite ───────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [selectedMediumId, setSelectedMediumId] = useState<string | null>(null)

  // Listen-Query: alle aktiven medium_dna, sortiert nach Schärfe (Live-Sync 30s)
  const { data: listDataRaw, loading: listLoading } = useQuery(MEDIEN_LIST, {
    fetchPolicy: 'cache-and-network',
    pollInterval: 30000,
  })

  // Match-Zahlen aus dem Dashboard-KPI-Query (schon im Cache, da
  // Dashboard denselben Query verwendet — kein N+1 zusätzlicher Request)
  const { data: kpiDataRaw } = useQuery(DASHBOARD_KPIS, {
    fetchPolicy: 'cache-and-network',
    pollInterval: 30000,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listData = listDataRaw as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kpiData = kpiDataRaw as any

  const medien: MediumListItem[] = listData?.medium_dna ?? []

  /** Extrahiert Deep-Match-Count für ein Medium aus dem KPI-Query-Ergebnis. */
  function getMatchCount(mediumId: string): number | null {
    if (!kpiData) return null
    const alias = mediumAlias(mediumId)
    const arr = kpiData[alias]
    if (!Array.isArray(arr) || arr.length === 0) return null
    const first = arr[0] as Record<string, unknown>
    const count = first?.count as Record<string, unknown> | undefined
    return typeof count?.id === 'number' ? count.id : null
  }

  return (
    <div>
      {/* Abschnitt-Header */}
      <div className="mb-6">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Medien-DNA
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Aktive DNA-Profile aller Medien · Schärfe und Matches live aus Directus
        </p>
      </div>

      {/* Lade-Skeletons */}
      {listLoading && medien.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-xl bg-slate-100 animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-100 rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-slate-100 rounded animate-pulse w-1/2" />
                  <div className="h-3 bg-slate-100 rounded animate-pulse w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Card-Grid */}
      {medien.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {medien.map(m => (
            <MediumCard
              key={m.id}
              medium={m}
              deepMatchCount={getMatchCount(m.medium_id)}
              onClick={() => setSelectedMediumId(m.medium_id)}
            />
          ))}
        </div>
      )}

      {/* Leer-Zustand */}
      {!listLoading && medien.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="text-sm">Keine Medien-DNAs gefunden.</p>
        </div>
      )}

      {/* Detail-Dialog */}
      <MediumDetailDialog
        mediumId={selectedMediumId}
        onClose={() => setSelectedMediumId(null)}
      />
    </div>
  )
}
