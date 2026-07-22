import { useMemo, useState } from 'react'
import { useQuery } from '@apollo/client/react'
import { Search, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LOTTERIEFONDS_ALL } from '@/graphql/lotteriefonds'
import { clean } from '@/graphql/stiftungen.helpers'

// ─── Typen ────────────────────────────────────────────────────────────────────

interface Lotteriefond {
  id: string
  kanton: string | null
  stiftungsname: string | null
  status: string | null
  url: string | null
  url_lotteriefonds: string | null
  url_eingabeformular: string | null
  antragsformular: string | null
  foerderbedingungen: string | null
  medientrigger: string | null
  wappen_url: string | null
  url_kulturfonds: string | null
}

// ─── Förderbedingungen mit Aufklapp-Funktion ──────────────────────────────────

const FOERDERBEDINGUNGEN_MAX = 200

function Foerderbedingungen({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false)
  const cleaned = clean(text)
  if (!cleaned) return <span className="text-slate-400 text-xs">—</span>

  const isLong = cleaned.length > FOERDERBEDINGUNGEN_MAX
  const display = isLong && !expanded ? cleaned.slice(0, FOERDERBEDINGUNGEN_MAX) + '…' : cleaned

  return (
    <div>
      <p className="text-xs text-slate-600 leading-relaxed">{display}</p>
      {isLong && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 text-[10px] text-indigo-600 hover:underline mt-1"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" /> weniger
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" /> mehr
            </>
          )}
        </button>
      )}
    </div>
  )
}

// ─── Externer Link ────────────────────────────────────────────────────────────

function ExternLink({ href, label }: { href: string | null | undefined; label: string }) {
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 text-xs text-indigo-600 hover:underline"
    >
      {label}
      <ExternalLink className="w-3 h-3 flex-shrink-0" />
    </a>
  )
}

// ─── Status-Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  const lower = status.toLowerCase()
  const cls =
    lower === 'aktiv' || lower === 'published'
      ? 'bg-green-100 text-green-700 border-green-200'
      : lower === 'inaktiv' || lower === 'archiviert'
      ? 'bg-slate-100 text-slate-500 border-slate-200'
      : 'bg-amber-100 text-amber-700 border-amber-200'

  return (
    <Badge variant="outline" className={`text-[10px] ${cls}`}>
      {status}
    </Badge>
  )
}

// ─── Kanton-Karte ─────────────────────────────────────────────────────────────

function LotteriefondCard({ fond }: { fond: Lotteriefond }) {
  const kanton = fond.kanton ?? '?'
  const name = fond.stiftungsname ?? kanton

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow flex flex-col gap-3">
      {/* Kopfzeile: Wappen + Kanton + Status */}
      <div className="flex items-start gap-3">
        {fond.wappen_url ? (
          <img
            src={fond.wappen_url}
            alt={`Wappen ${kanton}`}
            className="w-10 h-10 object-contain rounded flex-shrink-0"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-indigo-600">{kanton.slice(0, 2).toUpperCase()}</span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] text-slate-600 font-mono">
              {kanton}
            </Badge>
            <StatusBadge status={fond.status} />
          </div>
          <h3 className="text-sm font-semibold text-slate-800 mt-1 leading-snug">
            {name}
          </h3>
        </div>
      </div>

      {/* Förderbedingungen */}
      <div>
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
          Förderbedingungen
        </p>
        <Foerderbedingungen text={fond.foerderbedingungen} />
      </div>

      {/* Medientrigger */}
      {clean(fond.medientrigger) && (
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Medientrigger
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            {clean(fond.medientrigger)}
          </p>
        </div>
      )}

      {/* Links */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-slate-100">
        <ExternLink href={fond.url} label="Website" />
        <ExternLink href={fond.url_lotteriefonds} label="Lotteriefonds" />
        <ExternLink href={fond.url_kulturfonds} label="Kulturfonds" />
        <ExternLink href={fond.url_eingabeformular} label="Eingabeformular" />
        <ExternLink href={fond.antragsformular} label="Antragsformular" />
      </div>
    </div>
  )
}

// ─── Hauptseite ───────────────────────────────────────────────────────────────

export default function LotteriefondPage() {
  const [suche, setSuche] = useState('')

  const { data: rawData, loading } = useQuery(LOTTERIEFONDS_ALL, {
    fetchPolicy: 'cache-and-network',
  })

  const allFonds: Lotteriefond[] = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => ((rawData as any)?.lotteriefonds ?? []) as Lotteriefond[],
    [rawData]
  )

  const gefiltert = useMemo(() => {
    const s = suche.trim().toLowerCase()
    if (!s) return allFonds
    return allFonds.filter(
      f =>
        (f.kanton ?? '').toLowerCase().includes(s) ||
        (f.stiftungsname ?? '').toLowerCase().includes(s)
    )
  }, [allFonds, suche])

  return (
    <div>
      {/* Seiten-Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Lotteriefonds</h1>
        <p className="text-sm text-slate-500 mt-1">
          Kantonale Lotterie- und Kulturfonds — Übersicht Förderbedingungen und Links
        </p>
      </div>

      {/* Filter-Bar */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center mb-6">
        <div className="w-full md:w-72 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Kanton oder Name suchen…"
            value={suche}
            onChange={e => setSuche(e.target.value)}
            className="pl-9"
          />
        </div>
        {suche && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSuche('')}
            className="text-xs text-slate-500"
          >
            Zurücksetzen
          </Button>
        )}
        {!loading && (
          <span className="text-xs text-slate-500 ml-auto">
            {gefiltert.length} von {allFonds.length} Fonds
          </span>
        )}
      </div>

      {/* Lade-Skeletons */}
      {loading && allFonds.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="flex gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-slate-100 animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-100 rounded animate-pulse w-1/3" />
                  <div className="h-3 bg-slate-100 rounded animate-pulse w-2/3" />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="h-3 bg-slate-100 rounded animate-pulse w-full" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-5/6" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Karten-Grid */}
      {gefiltert.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {gefiltert.map(fond => (
            <LotteriefondCard key={fond.id} fond={fond} />
          ))}
        </div>
      )}

      {/* Leer-Zustand */}
      {!loading && gefiltert.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="text-sm">Keine Fonds gefunden.</p>
          <p className="text-xs mt-1">Suche anpassen oder zurücksetzen.</p>
        </div>
      )}
    </div>
  )
}
