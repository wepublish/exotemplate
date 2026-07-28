import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useQuery, useMutation } from '@apollo/client/react'
import { ExternalLink, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MediumLogo } from '@/components/MediumLogo'
import {
  FAAS_ROADMAP_BY_MEDIUM,
  UPDATE_FAAS_ROADMAP,
} from '@/graphql/roadmap'
import type { BerechneteStation, StationStatus, StationWer, GespeicherteStation } from '@/lib/roadmap'
import { tenant } from '../../config/tenant'

// ─── Anzeige-Konfiguration ────────────────────────────────────────────────────

const MEDIUM_LABELS: Record<string, string> = {
  wepublish: 'We.Publish',
  cueltuer: 'Cueltuer',
  neue_wege: 'Neue Wege',
  ganzgraz: 'Ganz Graz',
  'ee-news': 'EE-News',
  bajour: 'Bajour',
}

const STATUS_META: Record<StationStatus, { label: string; klasse: string }> = {
  offen: { label: 'Offen', klasse: 'bg-slate-100 text-slate-500 border-slate-200' },
  euer_auftrag: { label: 'Euer Auftrag', klasse: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  in_arbeit: { label: 'In Arbeit', klasse: 'bg-amber-100 text-amber-700 border-amber-200' },
  erledigt: { label: 'Erledigt', klasse: 'bg-green-100 text-green-700 border-green-200' },
}

const WER_META: Record<StationWer, { label: string; klasse: string }> = {
  medium: { label: 'Medium', klasse: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  wepublish: { label: 'We.Publish', klasse: 'bg-slate-50 text-slate-600 border-slate-200' },
  gemeinsam: { label: 'Gemeinsam', klasse: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

// ─── Typen der API-Antwort ──────────────────────────────────────────────────────

interface RoadmapAntwort {
  medium: string
  stationen: BerechneteStation[]
  antraege: { id: string; status: string; stiftung_name: string | null; stiftung_id: string | null; drive_link: string | null }[]
  slack: { channel: string | null; canvas_id: string | null }
}

// ─── Hauptseite ──────────────────────────────────────────────────────────────

export default function RoadmapPage() {
  const medien = tenant.clients
  const [medium, setMedium] = useState<string>(medien[0])

  const [daten, setDaten] = useState<RoadmapAntwort | null>(null)
  const [laden, setLaden] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  // Roadmap-Zeile (id + roh gespeicherte Stationen) fuer den read-modify-write.
  const { data: rowData, refetch: refetchRow } = useQuery(FAAS_ROADMAP_BY_MEDIUM, {
    variables: { medium, mandant: tenant.key },
    fetchPolicy: 'cache-and-network',
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roadmapRow = (rowData as any)?.faas_roadmap?.[0] ?? null

  const [updateRoadmap, { loading: speichern }] = useMutation(UPDATE_FAAS_ROADMAP)

  const ladeRoadmap = useCallback(async (slug: string) => {
    setLaden(true)
    setFehler(null)
    try {
      // cb gegen Cloudflare-Edge-Cache (Muster wie auf den Portal-Seiten).
      const res = await fetch(`/api/roadmap?medium=${encodeURIComponent(slug)}&cb=${Date.now()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error ?? `Fehler ${res.status}`)
      }
      setDaten(json as RoadmapAntwort)
    } catch (err: unknown) {
      setFehler(err instanceof Error ? err.message : String(err))
      setDaten(null)
    } finally {
      setLaden(false)
    }
  }, [])

  useEffect(() => {
    ladeRoadmap(medium)
  }, [medium, ladeRoadmap])

  /**
   * Schreibt einen Teil einer Station ins gespeicherte stationen-Array zurueck
   * (read-modify-write des ganzen Arrays). Erzeugt fehlende Stationen.
   */
  async function speichereStation(nr: number, patch: Partial<GespeicherteStation>) {
    if (!roadmapRow?.id) {
      toast.error('Keine Roadmap-Zeile fuer dieses Medium gefunden')
      return
    }
    const rohStationen: GespeicherteStation[] = Array.isArray(roadmapRow.stationen)
      ? roadmapRow.stationen
      : []
    // Auf 1..8 normalisieren, fehlende ergaenzen.
    const basis: GespeicherteStation[] = Array.from({ length: 8 }, (_, i) => {
      const n = i + 1
      const vorhanden = rohStationen.find((s) => s?.nr === n)
      return {
        nr: n,
        freigegeben: vorhanden?.freigegeben ?? null,
        dokument_link: vorhanden?.dokument_link ?? null,
        notiz: vorhanden?.notiz ?? null,
      }
    })
    const neu = basis.map((s) => (s.nr === nr ? { ...s, ...patch } : s))

    try {
      await updateRoadmap({
        variables: {
          id: roadmapRow.id,
          data: { stationen: neu, aktualisiert_quelle: 'matching-app' },
        },
      })
      toast.success('Gespeichert')
      await refetchRow()
      await ladeRoadmap(medium)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    }
  }

  const mediumName = MEDIUM_LABELS[medium] ?? medium

  return (
    <div>
      {/* Kopf */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
            <span className="text-slate-300">{'// '}</span>
            Roadmap
          </p>
          <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
            8-Stationen-Roadmap
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Wo steht <span className="font-medium text-slate-700">{mediumName}</span> im
            Fundraising-Prozess? Status leitet sich aus DNA, Matching und Antraegen ab.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Select value={medium} onValueChange={setMedium}>
            <SelectTrigger>
              <SelectValue placeholder="Medium" />
            </SelectTrigger>
            <SelectContent>
              {medien.map((m) => (
                <SelectItem key={m} value={m}>
                  {MEDIUM_LABELS[m] ?? m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Medien-Kopfzeile */}
      <div className="mb-4 flex items-center gap-3">
        <MediumLogo slug={medium} name={mediumName} size={36} />
        <div className="font-semibold text-slate-800">{mediumName}</div>
        {daten?.slack?.channel && (
          <Badge variant="outline" className="font-mono text-[10px] text-slate-500">
            Slack {daten.slack.channel}
          </Badge>
        )}
      </div>

      {fehler && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
          {fehler}
        </div>
      )}

      {laden && !daten && (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl border border-slate-200 bg-white animate-pulse" />
          ))}
        </div>
      )}

      {/* Stationen */}
      {daten && (
        <div className="space-y-3">
          {daten.stationen.map((st) => (
            <StationKarte
              key={st.nr}
              station={st}
              speichern={speichern}
              onFreigabeToggle={(v) => speichereStation(st.nr, { freigegeben: v })}
              onDokumentSpeichern={(v) => speichereStation(st.nr, { dokument_link: v || null })}
              onNotizSpeichern={(v) => speichereStation(st.nr, { notiz: v || null })}
            />
          ))}
        </div>
      )}

      {/* Anträge — nur solche mit erstelltem Gesuch (Link ins Drive-Dossier) */}
      {daten && daten.antraege.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400" />
            Anträge mit Gesuch ({daten.antraege.length})
          </h2>
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {daten.antraege.map((a) => {
              const name = a.stiftung_name ?? `Stiftung ${a.stiftung_id ?? '—'}`
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  {a.drive_link ? (
                    <a
                      href={a.drive_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 truncate"
                      title="Gesuch im Drive-Dossier öffnen"
                    >
                      <span className="truncate">{name}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="text-slate-700 truncate">{name}</span>
                  )}
                  <Badge variant="outline" className="text-[10px] text-slate-500 shrink-0">
                    {a.status || '—'}
                  </Badge>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">
            Aufgeführt sind nur Anträge, deren Gesuch erstellt und im Drive-Dossier verlinkt ist.
          </p>
          <Link
            href="/applications"
            className="inline-flex items-center gap-1 mt-2 text-xs text-indigo-600 hover:text-indigo-800"
          >
            Zum Anträge-Board
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      )}
    </div>
  )
}

// ─── Stations-Karte ────────────────────────────────────────────────────────────

function StationKarte({
  station,
  speichern,
  onFreigabeToggle,
  onDokumentSpeichern,
  onNotizSpeichern,
}: {
  station: BerechneteStation
  speichern: boolean
  onFreigabeToggle: (v: boolean) => void
  onDokumentSpeichern: (v: string) => void
  onNotizSpeichern: (v: string) => void
}) {
  // We.Publish-Stationen (2/4/6/8 sind wer != medium) sind abgeleitet → read-only.
  const istMedium = station.wer === 'medium'
  const statusMeta = STATUS_META[station.status]
  const werMeta = WER_META[station.wer]

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-600 font-mono text-xs font-bold flex items-center justify-center">
            {station.nr}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 leading-snug">{station.titel}</p>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <Badge variant="outline" className={`text-[10px] ${werMeta.klasse}`}>
                {werMeta.label}
              </Badge>
              <Badge variant="outline" className={`text-[10px] ${statusMeta.klasse}`}>
                {statusMeta.label}
              </Badge>
            </div>
          </div>
        </div>

        {/* Freigabe-Umschalter nur fuer Medium-Stationen */}
        {istMedium && (
          <Button
            size="sm"
            variant={station.freigegeben ? 'default' : 'outline'}
            className="shrink-0 text-xs h-8"
            disabled={speichern}
            onClick={() => onFreigabeToggle(!station.freigegeben)}
          >
            {station.freigegeben ? 'Freigegeben ✓' : 'Freigeben'}
          </Button>
        )}
      </div>

      {/* Editierfelder fuer Medium-Stationen; We.Publish-Stationen read-only */}
      {istMedium ? (
        <div className="mt-3 flex flex-col gap-2 pl-10">
          <DokumentFeld initial={station.dokument_link} disabled={speichern} onSpeichern={onDokumentSpeichern} />
          <NotizFeld initial={station.notiz} disabled={speichern} onSpeichern={onNotizSpeichern} />
        </div>
      ) : (
        (station.dokument_link || station.notiz) && (
          <div className="mt-3 pl-10 flex flex-col gap-1 text-xs text-slate-500">
            {station.dokument_link && (
              <a
                href={station.dokument_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
              >
                Dokument
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {station.notiz && <p>{station.notiz}</p>}
          </div>
        )
      )}
    </div>
  )
}

// ─── Dokument-Link-Feld ──────────────────────────────────────────────────────

function DokumentFeld({
  initial,
  disabled,
  onSpeichern,
}: {
  initial: string | null
  disabled: boolean
  onSpeichern: (v: string) => void
}) {
  const [wert, setWert] = useState(initial ?? '')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setWert(initial ?? '')
    setDirty(false)
  }, [initial])

  return (
    <div className="flex items-center gap-2">
      <input
        type="url"
        value={wert}
        onChange={(e) => { setWert(e.target.value); setDirty(true) }}
        placeholder="Dokument-Link (URL) ..."
        className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {wert && !dirty && (
        <a
          href={wert}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-indigo-600 hover:text-indigo-800"
          title="Dokument öffnen"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
      {dirty && (
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-8 px-2 shrink-0"
          disabled={disabled}
          onClick={() => { onSpeichern(wert); setDirty(false) }}
        >
          OK
        </Button>
      )}
    </div>
  )
}

// ─── Notiz-Feld ────────────────────────────────────────────────────────────────

function NotizFeld({
  initial,
  disabled,
  onSpeichern,
}: {
  initial: string | null
  disabled: boolean
  onSpeichern: (v: string) => void
}) {
  const [wert, setWert] = useState(initial ?? '')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setWert(initial ?? '')
    setDirty(false)
  }, [initial])

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        value={wert}
        onChange={(e) => { setWert(e.target.value); setDirty(true) }}
        placeholder="Notiz ..."
        className="text-xs min-h-[44px] resize-none"
      />
      {dirty && (
        <Button
          size="sm"
          variant="outline"
          className="self-end text-xs h-7"
          disabled={disabled}
          onClick={() => { onSpeichern(wert); setDirty(false) }}
        >
          Speichern
        </Button>
      )}
    </div>
  )
}
