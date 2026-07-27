import Link from 'next/link'
import { ExternalLink, Banknote, Loader2 } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useMutation, useApolloClient } from '@apollo/client/react'
import { toast } from 'sonner'
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MatchRationale } from './MatchRationale'
import {
  CREATE_APPLICATION,
  UPDATE_APPLICATION,
  // DELETE_APPLICATION ist bewusst nicht mehr in Verwendung: Wieder-Einblenden
  // setzt den Status auf identifiziert (UPDATE) statt zu löschen, damit
  // Bemerkungen und Prozesshistorie erhalten bleiben.
  STATUS_STATION,
} from '@/graphql/applications.mutations'
import { CREATE_LESSON } from '@/graphql/vorschlaege.mutations'
import {
  OUTBOX_FUER_APPLICATION,
  OUTBOX_VERWERFEN_BATCH,
  OUTBOX_VERWERFEN_EINZEL,
} from '@/graphql/pakete'
import type { MatchView, BetragsVorschlag } from '@/data/types'
import { tenant } from '../../config/tenant'
import { GesuchPromptButton } from '@/components/GesuchPromptButton'
import { FormularErfassung } from '@/components/FormularErfassung'
import { AusblendenDialog } from '@/components/AusblendenDialog'
import { NichtFoerderstiftungButton } from '@/components/NichtFoerderstiftungButton'
import { bauAusblendeNotiz, bauAusblendeLesson, type AusblendeGrund } from '@/lib/ausblenden'

// ─── Betrag-Recherche Typen ──────────────────────────────────────────────────

type BetragsStatus = 'idle' | 'läuft' | 'fehler'

const BETRAG_POLL_MS = 5_000

// ─── Betrag-Recherche Panel ───────────────────────────────────────────────────
//
// Zeigt nur noch den Knopf bzw. den Lauf-Status. Das ERGEBNIS lebt nicht mehr
// im Panel-State: es wird server-seitig in match_results.betrag_recherche
// persistiert und kommt über die Match-Liste (row.betragRecherche) bzw. den
// Seiten-State zurück — angezeigt als Badge auf der Namenszeile und als
// Begründungs-Block im aufgeklappten Bereich. Damit überlebt der Betrag
// Reload, Seitenwechsel und Listen-Updates durch den 30s-Poll.

interface BetragsRecherchePanelProps {
  stiftungId: string
  medium: string
  /** Sonder-Förderer-Collection (kirchen|foerderer|lotteriefonds|sponsoren) statt stiftungen */
  ziel?: string | null
  /** Bereits berechneter Betrag (persistiert oder Seiten-State) — steuert die Knopf-Beschriftung. */
  betrag?: BetragsVorschlag | null
  /** Meldet ein fertiges Ergebnis an die Seite. */
  onComputed?: (v: BetragsVorschlag) => void
}

export function BetragsRecherchePanel({ stiftungId, medium, ziel, betrag, onComputed }: BetragsRecherchePanelProps) {
  const [status, setStatus] = useState<BetragsStatus>('idle')
  const [fehler, setFehler] = useState<string | null>(null)
  const [laufSekunden, setLaufSekunden] = useState(0)

  // Polling-Refs
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sekundenIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const aktuellerJobIdRef = useRef<string | null>(null)

  // Aufräumen bei Unmount — nur Refs, keine reaktiven Deps nötig.
  useEffect(() => () => stopPolling(), [])

  function stopPolling() {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    if (sekundenIntervalRef.current !== null) {
      clearInterval(sekundenIntervalRef.current)
      sekundenIntervalRef.current = null
    }
  }

  async function recherchieren() {
    setStatus('läuft')
    setFehler(null)
    setLaufSekunden(0)
    stopPolling()

    // ── 1. Job anstossen (kehrt sofort mit job_id zurück) ──────────────────
    let jobId: string
    try {
      const res = await fetch('/api/calculate-amount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stiftung_id: stiftungId,
          medium_id: medium,
          ...(ziel ? { ziel } : {}),
        }),
      })
      const json = await res.json() as { job_id?: string; status?: string; error?: string }
      if (!res.ok || json.error) {
        const msg = json.error ?? `HTTP ${res.status}`
        setFehler(msg)
        setStatus('fehler')
        toast.error(`Betrag-Recherche fehlgeschlagen: ${msg}`)
        return
      }
      if (!json.job_id) {
        setFehler('Kein job_id erhalten')
        setStatus('fehler')
        return
      }
      jobId = json.job_id
      aktuellerJobIdRef.current = jobId
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setFehler(msg)
      setStatus('fehler')
      toast.error(`Betrag-Recherche konnte nicht gestartet werden: ${msg}`)
      return
    }

    // ── 2. Sekunden-Zähler ──────────────────────────────────────────────────
    sekundenIntervalRef.current = setInterval(() => {
      setLaufSekunden(s => s + 1)
    }, 1_000)

    // ── 3. Polling alle 5s ──────────────────────────────────────────────────
    async function poll() {
      const currentJobId = aktuellerJobIdRef.current
      if (!currentJobId) return

      try {
        const res = await fetch(`/api/calculate-amount?job_id=${encodeURIComponent(currentJobId)}`)

        if (res.status === 404) {
          stopPolling()
          setStatus('fehler')
          setFehler('Status nicht mehr verfügbar (Server neugestartet?) — erneut versuchen.')
          return
        }

        if (!res.ok) {
          // Transiente Netzwerk-Fehler: Polling fortsetzen
          return
        }

        const job = await res.json() as {
          status: 'running' | 'done' | 'error'
          result?: BetragsVorschlag
          error?: string
        }

        if (job.status === 'done') {
          stopPolling()
          setStatus('idle')
          if (job.result) {
            onComputed?.(job.result)
          }
        } else if (job.status === 'error') {
          stopPolling()
          setStatus('fehler')
          setFehler(job.error ?? 'Unbekannter Fehler im Hintergrundprozess')
          toast.error(`Betrag-Recherche fehlgeschlagen — bitte erneut versuchen`)
        }
        // status === 'running': weiterpollen
      } catch {
        // Netzwerk-Fehler beim Pollen: weiterpollen (transient)
      }
    }

    // Intervall ZUERST setzen, dann sofort pollen — sonst kann ein «done» im
    // ersten Poll stopPolling() ins Leere laufen lassen und das danach gesetzte
    // Intervall pollt für immer weiter.
    pollIntervalRef.current = setInterval(poll, BETRAG_POLL_MS)
    await poll()
  }

  return (
    <div className="mt-3">
      {(status === 'idle' || status === 'fehler') && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
            onClick={recherchieren}
          >
            <Banknote className="w-3.5 h-3.5 mr-1.5" />
            {betrag ? 'Betrag neu berechnen' : 'Betrag recherchieren'}
          </Button>
          {status === 'fehler' && fehler && (
            <p className="mt-1.5 text-[11px] text-red-500">{fehler}</p>
          )}
        </>
      )}

      {status === 'läuft' && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 flex-shrink-0" />
          <span>
            recherchiert … ({laufSekunden}s) — läuft auf dem Spark; unter dem DNA-Lauf kann es einige Minuten dauern
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Betrag-Anzeige (Badge auf der Namenszeile + Begründung im Detail) ────────

export function BetragBadge({ betrag }: { betrag: BetragsVorschlag }) {
  return (
    <Badge
      variant="outline"
      className={
        betrag.suggested_amount > 0
          ? 'bg-indigo-50 text-indigo-700 border-indigo-200 flex-shrink-0 text-xs font-semibold'
          : 'bg-slate-50 text-slate-500 border-slate-200 flex-shrink-0 text-[10px]'
      }
    >
      <Banknote className="w-3 h-3 mr-1" />
      {betrag.suggested_amount > 0
        ? `CHF ${betrag.suggested_amount.toLocaleString('de-CH')}`
        : 'kein Betrag'}
    </Badge>
  )
}

export function BetragBegruendung({ betrag }: { betrag: BetragsVorschlag }) {
  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <Banknote className="w-4 h-4 text-indigo-500 flex-shrink-0" />
        <span className="text-sm font-semibold text-indigo-800">
          {betrag.suggested_amount > 0
            ? `Empfohlener Antragsbetrag: CHF ${betrag.suggested_amount.toLocaleString('de-CH')}`
            : 'Kein konkreter Betrag empfehlbar'}
        </span>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">{betrag.reasoning}</p>
    </div>
  )
}

// ─── Typen ────────────────────────────────────────────────────────────────────

/** Minimaler Application-Snapshot, den die Seite per medium-Query lädt. */
export interface ApplicationSnap {
  id: string
  stiftung_id: string | null
  status: string | null
  /** Ausblende-Notiz (Format: «Ausgeblendet: {Name}. Grund: {Label}. {Freitext}») */
  bemerkung?: string | null
}

const konfChip: Record<string, string> = {
  web: 'bg-emerald-100 text-emerald-800',
  stammdaten: 'bg-amber-100 text-amber-800',
  unbekannt: 'bg-slate-100 text-slate-600',
}

const konfLabel: Record<string, string> = {
  web: 'Web',
  stammdaten: 'Stammdaten',
  unbekannt: '?',
}

// ─── Status-Badge für bestehende Anträge ──────────────────────────────────────
// Exportiert: auch die Kirchen-&-Förderer-Seite zeigt Funnel-Badges.

export const STATUS_FARBEN: Record<string, string> = {
  identifiziert: 'bg-blue-100 text-blue-700 border-blue-200',
  in_arbeit:     'bg-amber-100 text-amber-700 border-amber-200',
  eingereicht:   'bg-indigo-100 text-indigo-700 border-indigo-200',
  zugesagt:      'bg-green-100 text-green-700 border-green-200',
  abgelehnt:     'bg-red-100 text-red-700 border-red-200',
  archiviert:    'bg-slate-100 text-slate-600 border-slate-200',
  ausgeblendet:  'bg-slate-100 text-slate-400 border-slate-200',
}

export const STATUS_LABEL: Record<string, string> = {
  identifiziert: 'Identifiziert',
  in_arbeit:     'In Arbeit',
  eingereicht:   'Eingereicht',
  zugesagt:      'Zugesagt',
  abgelehnt:     'Abgelehnt',
  archiviert:    'Archiviert',
  ausgeblendet:  'Ausgeblendet',
}

// ─── Aktions-Bereich ──────────────────────────────────────────────────────────

interface AktionsBereichProps {
  row: MatchView
  medium: string
  application: ApplicationSnap | undefined
  onCreated: () => void
}

function AktionsBereich({ row, medium, application, onCreated }: AktionsBereichProps) {
  const apolloClient = useApolloClient()
  const [createApp, { loading: createLoading }] = useMutation(CREATE_APPLICATION)
  const [updateApp, { loading: updateLoading }] = useMutation(UPDATE_APPLICATION)
  const [verwerfenBatch] = useMutation(OUTBOX_VERWERFEN_BATCH)
  const [verwerfenEinzel] = useMutation(OUTBOX_VERWERFEN_EINZEL)
  const [createLesson] = useMutation(CREATE_LESSON)
  const [dialogOffen, setDialogOffen] = useState(false)
  // Nachträgliches Ausblenden: Dialog für bestehende Funnel-Anträge
  const [funnelDialogOffen, setFunnelDialogOffen] = useState(false)
  const [funnelBeschaeftigt, setFunnelBeschaeftigt] = useState(false)

  const beschaeftigt = createLoading || updateLoading

  /**
   * Blendet einen bestehenden Antrag (identifiziert/in_arbeit) nachträglich aus.
   * a) Application-Status auf ausgeblendet setzen (UPDATE, nicht DELETE —
   *    Prozesshistorie bleibt erhalten).
   * b) Zugehörige offene Outbox-Einträge (vorbereitet/entwurf) mitverwerfen.
   * c) Lern-Loop: Lesson schreiben.
   */
  async function blendeAntragAus(grund: AusblendeGrund, freitext: string) {
    if (!application) return
    setFunnelBeschaeftigt(true)
    try {
      // a) Application auf ausgeblendet setzen
      await updateApp({
        variables: {
          id: application.id,
          data: {
            status: 'ausgeblendet',
            station: STATUS_STATION['ausgeblendet'],
            bemerkung: bauAusblendeNotiz(row.name, grund.label, freitext),
            zuletzt_geaendert_quelle: 'matching-app',
          },
        },
      })

      // b) Offene Outbox-Einträge abfragen und mitverwerfen
      try {
        const { data: outboxData } = await apolloClient.query({
          query: OUTBOX_FUER_APPLICATION,
          variables: { appId: application.id },
          fetchPolicy: 'network-only',
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outboxIds: string[] = ((outboxData as any)?.agent_outbox ?? []).map(
          (o: { id: string }) => o.id
        )
        if (outboxIds.length > 0) {
          try {
            await verwerfenBatch({ variables: { ids: outboxIds } })
          } catch {
            // Batch fehlgeschlagen — Einzel-Fallback
            for (const id of outboxIds) {
              try {
                await verwerfenEinzel({ variables: { id } })
              } catch {
                // Einzelfehler protokollieren, aber nicht abbrechen
              }
            }
          }
        }
      } catch {
        // Outbox-Fehler sind nicht kritisch — Ausblenden trotzdem abschliessen
      }

      // c) Lern-Loop
      await createLesson({
        variables: {
          data: bauAusblendeLesson({
            mediumId: medium,
            stiftungId: row.stiftungId,
            stiftungName: row.name,
            grundKey: grund.key,
            grundLabel: grund.label,
            freitext,
          }),
        },
      })

      toast.success(`«${row.name}» ausgeblendet`)
      setFunnelDialogOffen(false)
      onCreated()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler beim Ausblenden: ${msg}`)
    } finally {
      setFunnelBeschaeftigt(false)
    }
  }

  async function handleIdentifizieren() {
    const stiftungIdInt = parseInt(row.stiftungId, 10)
    try {
      await createApp({
        variables: {
          data: {
            medium_id:                medium,
            stiftung_id:              isNaN(stiftungIdInt) ? undefined : stiftungIdInt,
            stiftung_name:            row.name,
            status:                   'identifiziert',
            station:                  STATUS_STATION['identifiziert'],
            mandant:                  tenant.key,
            verantwortung:            'offen',
            zuletzt_geaendert_quelle: 'matching-app',
          },
        },
      })
      toast.success(`«${row.name}» in Anträge übernommen`)
      onCreated()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    }
  }

  async function handleAusblenden(grund: AusblendeGrund, freitext: string) {
    const stiftungIdInt = parseInt(row.stiftungId, 10)
    const bemerkung = bauAusblendeNotiz(row.name, grund.label, freitext)
    try {
      await createApp({
        variables: {
          data: {
            medium_id:                medium,
            stiftung_id:              isNaN(stiftungIdInt) ? undefined : stiftungIdInt,
            stiftung_name:            row.name,
            status:                   'ausgeblendet',
            station:                  STATUS_STATION['ausgeblendet'],
            mandant:                  tenant.key,
            verantwortung:            'offen',
            zuletzt_geaendert_quelle: 'matching-app',
            bemerkung,
          },
        },
      })
      // Lern-Loop: Lesson schreiben
      await createLesson({
        variables: {
          data: bauAusblendeLesson({
            mediumId:    medium,
            stiftungId:  row.stiftungId,
            stiftungName: row.name,
            grundKey:    grund.key,
            grundLabel:  grund.label,
            freitext,
          }),
        },
      })
      toast.success(`«${row.name}» ausgeblendet`)
      setDialogOffen(false)
      onCreated()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    }
  }

  async function handleWiederEinblenden() {
    // Nur bei ausgeblendet aufrufen — Guard
    if (!application || application.status !== 'ausgeblendet') return
    try {
      // UPDATE statt DELETE: Prozesshistorie (Bemerkungen, Zeitstempel) bleibt erhalten.
      // DELETE_APPLICATION wird nicht mehr genutzt — Kommentar im Import-Block.
      await updateApp({
        variables: {
          id: application.id,
          data: {
            status: 'identifiziert',
            station: STATUS_STATION['identifiziert'],
            zuletzt_geaendert_quelle: 'matching-app',
          },
        },
      })
      toast.success(`«${row.name}» wieder eingeblendet`)
      onCreated()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    }
  }

  // Bereits im Funnel → Badge + Link zur Anträge-Seite
  if (application) {
    const s = application.status ?? 'identifiziert'
    const farbe = STATUS_FARBEN[s] ?? STATUS_FARBEN.identifiziert
    const label = STATUS_LABEL[s] ?? s

    return (
      <>
        <div className="flex flex-col gap-1.5 pt-2 mt-2 border-t border-slate-100">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="outline" className={`text-[11px] ${farbe}`}>
              Im Funnel: {label}
            </Badge>
            {s !== 'ausgeblendet' && (
              <Link
                href="/applications"
                className="text-xs text-indigo-600 hover:underline"
              >
                → Anträge
              </Link>
            )}
            {/* Nachträglich ausblenden: nur bei identifiziert/in_arbeit */}
            {(s === 'identifiziert' || s === 'in_arbeit') && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 text-slate-500 border-slate-200 hover:bg-slate-50"
                disabled={funnelBeschaeftigt}
                onClick={() => setFunnelDialogOffen(true)}
              >
                Ausblenden
              </Button>
            )}
            {s === 'ausgeblendet' && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 text-slate-600 border-slate-200 hover:bg-slate-50"
                disabled={updateLoading}
                onClick={handleWiederEinblenden}
              >
                Wieder einblenden
              </Button>
            )}
            <NichtFoerderstiftungButton
              stiftungId={row.stiftungId}
              stiftungName={row.name}
              onDone={onCreated}
            />
          </div>
          {s === 'ausgeblendet' && application.bemerkung && (
            <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
              {application.bemerkung}
            </p>
          )}
        </div>

        {/* Dialog für nachträgliches Ausblenden aus dem Funnel */}
        <AusblendenDialog
          offen={funnelDialogOffen}
          stiftungName={row.name}
          beschaeftigt={funnelBeschaeftigt}
          onAbbrechen={() => setFunnelDialogOffen(false)}
          onBestaetigen={blendeAntragAus}
        />
      </>
    )
  }

  // Noch nicht im Funnel → Annehmen / Ausblenden
  return (
    <>
      <div className="flex items-center gap-2 pt-2 mt-2 border-t border-slate-100">
        <Button
          size="sm"
          variant="default"
          className="bg-green-600 hover:bg-green-700 text-white text-xs h-8"
          disabled={beschaeftigt}
          onClick={handleIdentifizieren}
        >
          In Anträge übernehmen
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-slate-600 border-slate-200 hover:bg-slate-50 text-xs h-8"
          disabled={beschaeftigt}
          onClick={() => setDialogOffen(true)}
        >
          Ausblenden
        </Button>
        <NichtFoerderstiftungButton
          stiftungId={row.stiftungId}
          stiftungName={row.name}
          onDone={onCreated}
        />
      </div>

      <AusblendenDialog
        offen={dialogOffen}
        stiftungName={row.name}
        beschaeftigt={beschaeftigt}
        onAbbrechen={() => setDialogOffen(false)}
        onBestaetigen={handleAusblenden}
      />
    </>
  )
}

// ─── MatchRow ─────────────────────────────────────────────────────────────────

export function MatchRow({
  row,
  rank,
  medium = '',
  projektId,
  application,
  onApplicationCreated,
  betrag,
  onBetragComputed,
}: {
  row: MatchView
  rank: number
  /** Aktuelles Medium (leer = kein Aktions-Bereich, z.B. Präsentationsansicht) */
  medium?: string
  /** Aktives Projekt (gesetzt = Gesuch-Prompt projekt-aware) */
  projektId?: number | null
  application?: ApplicationSnap
  onApplicationCreated?: () => void
  /** Bereits berechneter Betrag (Seiten-State) */
  betrag?: BetragsVorschlag | null
  /** Meldet einen neu berechneten Betrag an die Seite */
  onBetragComputed?: (v: BetragsVorschlag) => void
}) {
  const top = [...row.tags].sort((a, b) => b.gewicht - a.gewicht)[0]

  return (
    <AccordionItem
      value={row.id}
      className="bg-white rounded-xl border-[1.5px] border-slate-900 px-0 overflow-hidden"
    >
      <AccordionTrigger className="hover:no-underline px-4 py-4 data-[state=open]:border-b border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors">
        <div className="flex flex-1 justify-between items-start text-left pr-4 gap-2">
          <div className="min-w-0 flex-1">
            {/* Zeile 1: Nr · Konfidenz · Score */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-xs font-semibold text-slate-400">#{rank}</span>
              <Badge
                variant="outline"
                className={`font-mono text-[10px] border-none ${konfChip[row.konfidenz] ?? konfChip.unbekannt}`}
              >
                {konfLabel[row.konfidenz] ?? '?'}
              </Badge>
              <span className="font-mono text-xs font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-sm">
                Score {row.score}%
              </span>
            </div>
            {/* Zeile 2: Stiftungsname + recherchierter Betrag auf derselben Linie */}
            <div className="flex items-center gap-2 mt-1 min-w-0">
              <span className="text-lg font-bold text-slate-900 leading-tight truncate">
                {row.name}
              </span>
              {betrag && <BetragBadge betrag={betrag} />}
            </div>
            {/* Zeile 3: Stärkster Grund */}
            {top?.begruendung && (
              <p className="text-xs text-slate-500 mt-0.5 truncate">{top.begruendung}</p>
            )}
          </div>

          {/* Rechts: Betrag + Link.
              `betrag` ist Freitext aus foerdersummen_range bzw. foerderbeitraege und
              reicht von "CHF 5'000" bis zu ganzen Absaetzen (Kanton Bern: 224 Zeichen).
              Ohne Breitengrenze sprengte der Block die Karte: er war flex-shrink-0,
              nahm also die ganze Zeile, quetschte den Stiftungsnamen auf null und lief
              rechts aus der Karte (Befund 2026-07-27, 21 von 532 sichtbaren Stiftungen
              betroffen, drei davon schwer). Darum: schrumpfbar, gedeckelt, gekuerzt,
              vollstaendiger Text im title und im aufgeklappten Detail. */}
          <div
            className="flex items-center gap-2 min-w-0 max-w-[45%] shrink"
            onClick={e => e.stopPropagation()}
          >
            {row.betrag && (
              <Badge
                variant="outline"
                title={row.betrag}
                className="bg-green-50 text-green-700 border-green-200 hidden sm:inline-flex text-[10px] max-w-[15rem] min-w-0 overflow-hidden"
              >
                <span className="truncate">{row.betrag}</span>
              </Badge>
            )}
            {row.website && (
              <a
                href={row.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-indigo-600 p-1 inline-block shrink-0"
                onClick={e => e.stopPropagation()}
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      </AccordionTrigger>

      {/* Betrag-Recherche + Gesuch-Prompt: immer sichtbar (nicht erst beim Aufklappen) */}
      {medium && (
        <div className="px-4 pb-3 flex flex-wrap items-start gap-2" onClick={e => e.stopPropagation()}>
          <BetragsRecherchePanel
            stiftungId={row.stiftungId}
            medium={medium}
            betrag={betrag}
            onComputed={onBetragComputed}
          />
          <div className="mt-3 flex items-center gap-2">
            <GesuchPromptButton medium={medium} stiftungId={row.stiftungId} stiftungName={row.name} projektId={projektId} />
            <FormularErfassung stiftungId={row.stiftungId} stiftungName={row.name} />
          </div>
        </div>
      )}

      <AccordionContent className="pt-0 pb-0 px-0">
        <div className="px-4 pt-4 pb-4 space-y-4">
          {betrag && <BetragBegruendung betrag={betrag} />}

          {/* Belegte Foerdersummen im Volltext. Oben in der Kopfzeile ist der Wert
              gekuerzt, weil er Freitext ist und bis zu ganze Absaetze enthaelt;
              hier steht er vollstaendig und umbruchfaehig. */}
          {row.betrag && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-green-800 mb-0.5">Belegte Fördersummen</p>
              <p className="text-xs text-green-900 leading-relaxed whitespace-pre-line break-words">
                {row.betrag}
              </p>
            </div>
          )}

          <MatchRationale row={row} />

          {/* Aktions-Bereich: nur in der normalen (nicht Präsentations-) Ansicht */}
          {medium && (
            <AktionsBereich
              row={row}
              medium={medium}
              application={application}
              onCreated={onApplicationCreated ?? (() => {})}
            />
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}
