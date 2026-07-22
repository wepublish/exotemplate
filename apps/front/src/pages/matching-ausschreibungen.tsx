import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@apollo/client/react'
import { Search, ExternalLink, CheckCircle2, XCircle, Radar } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AUSSCHREIBUNGEN_ALL } from '@/graphql/ausschreibungen'
import {
  AUSSCHREIBUNGEN_SCOUT,
  UPDATE_AUSSCHREIBUNG_STATUS,
  DELETE_AUSSCHREIBUNG,
  SCOUT_STATUS,
} from '@/graphql/ausschreibungen.mutations'
import {
  formatDeadline,
  relativeDeadline,
  sortByDeadline,
  istAbgelaufen,
} from '@/graphql/ausschreibungen.helpers'

// ─── Typen ────────────────────────────────────────────────────────────────────

interface Ausschreibung {
  id: string
  titel: string | null
  kategorie: string | null
  status: string | null
  deadline: string | null
  url: string | null
}

// ─── Deadline-Badge ───────────────────────────────────────────────────────────

function DeadlineBadge({ deadline }: { deadline: string | null }) {
  const formatted = formatDeadline(deadline)
  const rel = relativeDeadline(deadline)

  if (!formatted) {
    return <span className="text-xs text-slate-400">—</span>
  }

  const relClass =
    rel?.variant === 'red'
      ? 'text-red-600 font-semibold'
      : rel?.variant === 'amber'
      ? 'text-amber-600 font-semibold'
      : rel?.variant === 'gray'
      ? 'text-slate-400'
      : 'text-slate-600'

  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-700">{formatted}</span>
      {rel && (
        <span className={`text-[10px] ${relClass}`}>{rel.text}</span>
      )}
    </span>
  )
}

// ─── Kategorie-Badge ──────────────────────────────────────────────────────────

function KategorieBadge({ kategorie }: { kategorie: string | null }) {
  if (!kategorie) return null
  return (
    <Badge
      variant="outline"
      className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200"
    >
      {kategorie}
    </Badge>
  )
}

// ─── Status-Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  const lower = status.toLowerCase()
  const cls =
    lower === 'published'
      ? 'bg-green-100 text-green-700 border-green-200'
      : lower === 'auf dem radar'
      ? 'bg-blue-100 text-blue-700 border-blue-200'
      : lower === 'archiviert'
      ? 'bg-slate-100 text-slate-500 border-slate-200'
      : 'bg-amber-100 text-amber-700 border-amber-200'

  return (
    <Badge variant="outline" className={`text-[10px] ${cls}`}>
      {status}
    </Badge>
  )
}

// ─── Scout-Abschnitt ──────────────────────────────────────────────────────────

function ScoutAbschnitt() {
  const { data: scoutRaw, loading: scoutLoading, refetch: scoutRefetch } =
    useQuery(AUSSCHREIBUNGEN_SCOUT, { fetchPolicy: 'cache-and-network' })

  const [updateStatus] = useMutation(UPDATE_AUSSCHREIBUNG_STATUS)
  const [deleteAusschreibung] = useMutation(DELETE_AUSSCHREIBUNG)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoutItems: Ausschreibung[] = (scoutRaw as any)?.ausschreibungen ?? []

  async function handleUebernehmen(id: string, titel: string) {
    try {
      await updateStatus({ variables: { id, status: 'published' } })
      toast.success(`«${titel.slice(0, 60)}» übernommen`)
      scoutRefetch()
    } catch (err) {
      console.error(err)
      toast.error('Fehler beim Übernehmen')
    }
  }

  async function handleVerwerfen(id: string, titel: string) {
    try {
      await deleteAusschreibung({ variables: { id } })
      toast.success(`«${titel.slice(0, 60)}» verworfen`)
      scoutRefetch()
    } catch (err) {
      console.error(err)
      toast.error('Fehler beim Verwerfen')
    }
  }

  if (scoutLoading && scoutItems.length === 0) {
    return (
      <div className="mb-8 bg-amber-50 border border-amber-200 rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-amber-100 rounded w-48" />
      </div>
    )
  }

  if (scoutItems.length === 0) return null

  return (
    <div className="mb-8">
      {/* Scout-Banner-Header */}
      <div className="flex items-center gap-2 mb-3">
        <Radar className="w-4 h-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-amber-700">
          Neu vom Scout
        </h2>
        <Badge
          variant="outline"
          className="text-[10px] bg-amber-100 text-amber-700 border-amber-300 ml-1"
        >
          {scoutItems.length}
        </Badge>
        <span className="text-xs text-slate-400 ml-2">
          — Einträge prüfen und übernehmen oder verwerfen
        </span>
      </div>

      {/* Scout-Karten */}
      <div className="flex flex-col gap-2">
        {scoutItems.map(item => (
          <div
            key={item.id}
            className="bg-white border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-4 shadow-sm"
          >
            {/* Inhalt */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-sm font-medium text-slate-800 leading-snug">
                  {item.titel ?? '—'}
                </span>
                {item.kategorie && (
                  <KategorieBadge kategorie={item.kategorie} />
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                {item.deadline && (
                  <DeadlineBadge deadline={item.deadline} />
                )}
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-indigo-600 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Zur Ausschreibung
                  </a>
                )}
              </div>
            </div>

            {/* Aktionen */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 text-xs border-green-300 text-green-700 hover:bg-green-50"
                onClick={() => handleUebernehmen(item.id, item.titel ?? '')}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                Übernehmen
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 text-xs border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => handleVerwerfen(item.id, item.titel ?? '')}
              >
                <XCircle className="w-3.5 h-3.5 mr-1" />
                Verwerfen
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Hauptseite ───────────────────────────────────────────────────────────────

export default function MatchingAusschreibungenPage() {
  const [suche, setSuche] = useState('')
  const [zeigeAbgelaufen, setZeigeAbgelaufen] = useState(false)
  const [filterKategorie, setFilterKategorie] = useState<string>('alle')
  const [filterStatus, setFilterStatus] = useState<string>('alle')

  const { data: rawData, loading } = useQuery(AUSSCHREIBUNGEN_ALL, {
    fetchPolicy: 'cache-and-network',
  })

  const allItems: Ausschreibung[] = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => ((rawData as any)?.ausschreibungen ?? []) as Ausschreibung[],
    [rawData]
  )

  // Scout-Einträge aus der Hauptliste herausfiltern
  const hauptItems = useMemo(
    () => allItems.filter(i => i.status !== SCOUT_STATUS),
    [allItems]
  )

  // Dynamische Filter-Optionen aus den Daten ableiten (ohne Scout-Einträge)
  const kategorien = useMemo(
    () =>
      Array.from(
        new Set(hauptItems.map(i => i.kategorie).filter(Boolean) as string[])
      ).sort(),
    [hauptItems]
  )
  const statusOptions = useMemo(
    () =>
      Array.from(
        new Set(hauptItems.map(i => i.status).filter(Boolean) as string[])
      ).sort(),
    [hauptItems]
  )

  // Filtern + Sortieren
  const gefiltert = useMemo(() => {
    const sucheTrimmed = suche.trim().toLowerCase()
    let items = hauptItems

    if (filterKategorie !== 'alle') {
      items = items.filter(i => i.kategorie === filterKategorie)
    }
    if (filterStatus !== 'alle') {
      items = items.filter(i => i.status === filterStatus)
    }
    if (sucheTrimmed) {
      items = items.filter(i =>
        (i.titel ?? '').toLowerCase().includes(sucheTrimmed)
      )
    }
    // Abgelaufene ausblenden (ausser laufend/wiederkehrend = ohne Deadline),
    // solange nicht explizit eingeblendet.
    if (!zeigeAbgelaufen) {
      items = items.filter(i => !istAbgelaufen(i.deadline))
    }

    return sortByDeadline(items)
  }, [hauptItems, filterKategorie, filterStatus, suche, zeigeAbgelaufen])

  // Anzahl abgelaufener (für den Einblenden-Schalter)
  const abgelaufenAnzahl = useMemo(
    () => hauptItems.filter(i => istAbgelaufen(i.deadline)).length,
    [hauptItems]
  )

  return (
    <div>
      {/* Scout-Abschnitt: Neu entdeckte Einträge zur Prüfung */}
      <ScoutAbschnitt />

      {/* Seiten-Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Ausschreibungen</h1>
        <p className="text-sm text-slate-500 mt-1">
          Aktuelle Förderausschreibungen und Eingabefristen im Überblick
        </p>
      </div>

      {/* Filter-Bar */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center mb-6">
        {/* Kategorie */}
        <div className="w-full md:w-52">
          <Select
            value={filterKategorie}
            onValueChange={v => { setFilterKategorie(v) }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Kategorie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle Kategorien</SelectItem>
              {kategorien.map(k => (
                <SelectItem key={k} value={k}>{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Status */}
        <div className="w-full md:w-48">
          <Select
            value={filterStatus}
            onValueChange={v => { setFilterStatus(v) }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle Status</SelectItem>
              {statusOptions.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Suche */}
        <div className="w-full md:w-72 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Titel suchen…"
            value={suche}
            onChange={e => setSuche(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Abgelaufene ein-/ausblenden (laufende/wiederkehrende ohne Deadline bleiben immer) */}
        {abgelaufenAnzahl > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs text-slate-600"
            onClick={() => setZeigeAbgelaufen(v => !v)}
          >
            {zeigeAbgelaufen
              ? `Abgelaufene ausblenden`
              : `Abgelaufene anzeigen (${abgelaufenAnzahl})`}
          </Button>
        )}

        {/* Trefferzahl */}
        {!loading && (
          <span className="text-xs text-slate-500 ml-auto">
            {gefiltert.length} von {hauptItems.length} Ausschreibungen
          </span>
        )}
      </div>

      {/* Lade-Skeleton */}
      {loading && allItems.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-4 py-3 border-b border-slate-100 flex gap-4">
              <div className="h-4 bg-slate-100 rounded animate-pulse flex-1" />
              <div className="h-4 bg-slate-100 rounded animate-pulse w-20" />
              <div className="h-4 bg-slate-100 rounded animate-pulse w-24" />
            </div>
          ))}
        </div>
      )}

      {/* Tabelle */}
      {gefiltert.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Tabellen-Header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-2 bg-slate-50 border-b border-slate-200">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Titel</span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Kategorie</span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Deadline</span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Link</span>
          </div>

          {gefiltert.map((item, idx) => {
            const rel = relativeDeadline(item.deadline)
            const isAbgelaufen = rel?.variant === 'gray'
            return (
              <div
                key={item.id}
                className={[
                  'grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-3 items-center',
                  idx < gefiltert.length - 1 ? 'border-b border-slate-100' : '',
                  isAbgelaufen ? 'opacity-60' : 'hover:bg-slate-50/60',
                ].join(' ')}
              >
                {/* Titel */}
                <span className="text-sm font-medium text-slate-800 leading-snug">
                  {item.titel ?? '—'}
                </span>

                {/* Kategorie */}
                <div className="flex justify-end">
                  <KategorieBadge kategorie={item.kategorie} />
                </div>

                {/* Status */}
                <div className="flex justify-end">
                  <StatusBadge status={item.status} />
                </div>

                {/* Deadline */}
                <div className="flex justify-end text-right min-w-[90px]">
                  <DeadlineBadge deadline={item.deadline} />
                </div>

                {/* Link */}
                <div className="flex justify-end">
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                      title="Zur Ausschreibung"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Leer-Zustand */}
      {!loading && gefiltert.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="text-sm">Keine Ausschreibungen gefunden.</p>
          <p className="text-xs mt-1">Filter anpassen oder Suche leeren.</p>
        </div>
      )}
    </div>
  )
}
