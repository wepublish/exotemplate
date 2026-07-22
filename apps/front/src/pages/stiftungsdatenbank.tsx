import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation } from '@apollo/client/react'
import { toast } from 'sonner'
import { Search, CheckCircle2, AlertTriangle, ExternalLink, MapPin, Banknote, Globe } from 'lucide-react'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { FunderCard, type StiftungListItem } from '@/components/FunderCard'
import {
  STIFTUNGEN_BROWSE,
  STIFTUNGEN_COUNT,
  STIFTUNG_DETAIL,
} from '@/graphql/stiftungen'
import { SET_STIFTUNG_FOERDERSTATUS } from '@/graphql/stiftungen.mutations'
import { StiftungAnlegenDialog } from '@/components/StiftungAnlegenDialog'
import { NichtFoerderstiftungButton } from '@/components/NichtFoerderstiftungButton'
import {
  buildFilterForTest as buildFilter,
  clean,
  type Land,
  type FoerderFilter,
} from '@/graphql/stiftungen.helpers'

const PAGE_SIZE = 50

// ─── DNA-Block im Dialog ──────────────────────────────────────────────────────

function dnaKonfidenz(quellen: unknown): string {
  if (!quellen || typeof quellen !== 'object') return 'unbekannt'
  const q = quellen as Record<string, unknown>
  const db = q.datenbasis
  const val = typeof db === 'string' ? db : Array.isArray(db) ? String(db[0] ?? '') : ''
  if (val.includes('web') || val.includes('crawl')) return 'web'
  if (val.includes('stamm')) return 'stammdaten'
  return val || 'unbekannt'
}

interface DnaBlockProps {
  dna: {
    schaerfe_prozent?: number | null
    sound_feeling?: string | null
    tags?: unknown
    foerderpraxis?: unknown
    quellen?: unknown
    version_number?: number | null
    vocabulary_version_at_creation?: number | null
  }
}

function DnaBlock({ dna }: DnaBlockProps) {
  const konf = dnaKonfidenz(dna.quellen)
  const isWeb = konf === 'web'

  const tags: { tag_slug: string; gewicht: number; begruendung: string }[] = Array.isArray(dna.tags)
    ? (dna.tags as { tag_slug: string; gewicht: number; begruendung: string }[])
    : []

  const fp = (dna.foerderpraxis && typeof dna.foerderpraxis === 'object'
    ? dna.foerderpraxis
    : {}) as Record<string, unknown>

  const topTags = [...tags].sort((a, b) => b.gewicht - a.gewicht).slice(0, 12)

  return (
    <div className="rounded-xl border border-violet-100 bg-white overflow-hidden shadow-sm mt-4">
      {/* Verifikations-Banner */}
      {isWeb ? (
        <div className="bg-emerald-50 px-4 py-2 border-b border-emerald-100 flex items-center gap-2 text-emerald-700 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          Web-Crawl (belastbar) · Schärfe {dna.schaerfe_prozent ?? '?'}%
        </div>
      ) : (
        <div className="bg-amber-50 px-4 py-2 border-b border-amber-100 flex items-center gap-2 text-amber-700 text-xs font-medium">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {konf === 'stammdaten' ? 'Nur Stammdaten — vorsichtig' : 'Datenbasis unbekannt'} · Schärfe {dna.schaerfe_prozent ?? '?'}%
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Sound-Feeling */}
        {dna.sound_feeling && (
          <p className="text-sm text-slate-800 leading-relaxed italic">
            «{dna.sound_feeling}»
          </p>
        )}

        {/* Top-Tags */}
        {topTags.length > 0 ? (
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Top-Tags
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {topTags.map(t => (
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
        ) : null}

        {/* Förderpraxis */}
        {Boolean(fp.durchschnitt || fp.min_betrag || fp.max_betrag || fp.geo_scope || fp.einreichmodalitaet) ? (
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Förderpraxis
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-4 text-xs">
              {Boolean(fp.durchschnitt || fp.min_betrag || fp.max_betrag) ? (
                <div className="flex">
                  <span className="w-24 text-slate-500">Fördersumme:</span>
                  <span className="font-medium text-slate-800">
                    {typeof fp.durchschnitt === 'number'
                      ? `Ø CHF ${fp.durchschnitt.toLocaleString('de-CH')}`
                      : fp.durchschnitt
                      ? `Ø CHF ${String(fp.durchschnitt)}`
                      : fp.min_betrag || fp.max_betrag
                      ? `${fp.min_betrag ?? 0} – ${fp.max_betrag ?? '?'} CHF`
                      : '—'}
                  </span>
                </div>
              ) : null}
              {Array.isArray(fp.geo_scope) && fp.geo_scope.length > 0 ? (
                <div className="flex">
                  <span className="w-24 text-slate-500">Geo-Scope:</span>
                  <span className="font-medium text-slate-800">{(fp.geo_scope as string[]).join(', ')}</span>
                </div>
              ) : null}
              {fp.einreichmodalitaet ? (
                <div className="flex col-span-1 md:col-span-2">
                  <span className="w-24 text-slate-500">Einreichungen:</span>
                  <span className="font-medium text-slate-800">{String(fp.einreichmodalitaet)}</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Metadaten */}
        <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-100">
          DNA v{dna.version_number ?? '?'} · Vokabular v{dna.vocabulary_version_at_creation ?? '?'}
        </div>
      </div>
    </div>
  )
}

// ─── Stiftungs-Detail-Dialog ──────────────────────────────────────────────────

function DetailDialog({ stiftungId, onClose }: { stiftungId: string | null; onClose: () => void }) {
  const { data, loading, error, refetch } = useQuery(STIFTUNG_DETAIL, {
    variables: { id: stiftungId ?? '' },
    skip: !stiftungId,
    fetchPolicy: 'cache-first',
  })
  const [setFoerder, { loading: foerderLoading }] = useMutation(SET_STIFTUNG_FOERDERSTATUS)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const typedData = data as any
  const stiftung = typedData?.stiftungen?.[0]
  const dna = typedData?.stiftungs_dna?.[0]
  // Bereinigt Scraper-Platzhalter («Keine Angabe gefunden» u.ä.) auf null.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (k: string): string | null => clean((stiftung as any)?.[k])

  return (
    <Dialog open={!!stiftungId} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl">
        {/* DialogTitle ist für die Barrierefreiheit IMMER nötig — auch im Lade-/Leerzustand. */}
        <DialogHeader>
          <DialogTitle>
            {stiftung ? stiftung.Stiftungsname : loading ? 'Wird geladen…' : 'Stiftung'}
          </DialogTitle>
          {stiftung && (
            <DialogDescription asChild>
              <div className="flex flex-wrap gap-2 mt-1">
                {c('sitz') && (
                  <span className="flex items-center gap-1 text-slate-500 text-xs">
                    <MapPin className="w-3 h-3" />
                    {c('sitz')}
                    {stiftung.land && ` (${stiftung.land})`}
                  </span>
                )}
                {c('region_fokus') && (
                  <span className="text-xs text-slate-500">Fokus: {c('region_fokus')}</span>
                )}
                {stiftung.verifiziert && (
                  <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                    verifiziert
                  </Badge>
                )}
              </div>
            </DialogDescription>
          )}
        </DialogHeader>

        {loading && (
          <div className="space-y-3 py-2">
            <div className="h-4 bg-slate-100 rounded animate-pulse w-full" />
            <div className="h-4 bg-slate-100 rounded animate-pulse w-5/6" />
            <div className="h-4 bg-slate-100 rounded animate-pulse w-2/3" />
          </div>
        )}

        {!loading && !stiftung && (
          <p className="text-sm text-slate-500 py-4">
            {error
              ? 'Die Stiftungsdetails konnten nicht geladen werden.'
              : 'Keine Daten gefunden.'}
          </p>
        )}

        {stiftung && (
          <div className="space-y-4 text-sm">
            {/* Zweck */}
            {c('zwecktext') && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Stiftungszweck
                </h4>
                <p className="text-slate-700 leading-relaxed">{c('zwecktext')}</p>
              </div>
            )}

            {/* Förderbedingungen */}
            {c('foerderbedingungen') && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Förderbedingungen
                </h4>
                <p className="text-slate-700 leading-relaxed">{c('foerderbedingungen')}</p>
              </div>
            )}

            {/* Kennzahlen-Grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              {c('foerdersummen_range') && (
                <div>
                  <span className="text-slate-500">Fördersummen: </span>
                  <span className="font-medium text-slate-800">{c('foerdersummen_range')}</span>
                </div>
              )}
              {c('foerderbeitraege') && (
                <div>
                  <span className="text-slate-500">Förderbeiträge: </span>
                  <span className="font-medium text-slate-800">{c('foerderbeitraege')}</span>
                </div>
              )}
              {c('deadline') && (
                <div>
                  <span className="text-slate-500">Frist: </span>
                  <span className="font-medium text-slate-800">{c('deadline')}</span>
                </div>
              )}
              {c('antragsform') && (
                <div>
                  <span className="text-slate-500">Antragsform: </span>
                  <span className="font-medium text-slate-800">{c('antragsform')}</span>
                </div>
              )}
              {c('einreichungsform_verifiziert') && (
                <div className="col-span-2">
                  <span className="text-slate-500">Einreichung: </span>
                  <span className="font-medium text-slate-800">{c('einreichungsform_verifiziert')}</span>
                </div>
              )}
            </div>

            {/* Ansprechperson */}
            {(c('ansprechsperson') || stiftung.email) && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Kontakt
                </h4>
                <div className="text-xs space-y-0.5">
                  {c('ansprechsperson') && (
                    <p className="text-slate-700">{c('ansprechsperson')}</p>
                  )}
                  {stiftung.email && (
                    <a href={`mailto:${stiftung.email}`} className="text-indigo-600 hover:underline">
                      {stiftung.email}
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Links */}
            <div className="flex flex-wrap gap-3 text-xs">
              {stiftung.webseite && (
                <a
                  href={stiftung.webseite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-indigo-600 hover:underline"
                >
                  <Globe className="w-3.5 h-3.5" />
                  Website
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {stiftung.info_link && (
                <a
                  href={stiftung.info_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-indigo-600 hover:underline"
                >
                  <Banknote className="w-3.5 h-3.5" />
                  Infos
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {stiftung.zefix_link && (
                <a
                  href={stiftung.zefix_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-slate-500 hover:underline"
                >
                  Zefix
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* DNA-Block */}
            {dna ? (
              <DnaBlock dna={dna} />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 mt-2">
                Noch keine DNA gemessen
              </div>
            )}

            {/* Förderstatus: global entfernen / wieder aufnehmen */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
              {stiftung.ist_foerderstiftung === false ? (
                <>
                  <span className="text-xs text-slate-500">
                    Als keine Förderstiftung markiert — erscheint in keinem Matching.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-8 text-emerald-700 border-emerald-200 hover:bg-emerald-50 flex-shrink-0"
                    disabled={foerderLoading}
                    onClick={async () => {
                      try {
                        await setFoerder({ variables: { id: String(stiftung.id), ist: true } })
                        toast.success(`«${stiftung.Stiftungsname}» wieder als Förderstiftung aufgenommen`)
                        refetch?.()
                      } catch (e: unknown) {
                        toast.error(`Fehler: ${e instanceof Error ? e.message : 'unbekannt'}`)
                      }
                    }}
                  >
                    Wieder als Förderstiftung aufnehmen
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-xs text-slate-500">
                    Gibt diese Stiftung gar kein Geld?
                  </span>
                  <NichtFoerderstiftungButton
                    stiftungId={String(stiftung.id)}
                    stiftungName={stiftung.Stiftungsname}
                    variante="button"
                    onDone={() => refetch?.()}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Hauptseite ───────────────────────────────────────────────────────────────

export default function StiftungsdatenbankPage() {
  const [land, setLand] = useState<Land>('alle')
  const [foerder, setFoerder] = useState<FoerderFilter>('nur_foerder')
  const [sucheInput, setSucheInput] = useState('')
  const [suche, setSuche] = useState('')
  const [page, setPage] = useState(1)
  const [detailId, setDetailId] = useState<string | null>(null)

  // Debounce der Suche: erst 300 ms nach dem letzten Tastendruck feuert die
  // Query (und der Count) neu — sonst eine Abfrage pro Zeichen gegen 40k Einträge.
  useEffect(() => {
    const t = setTimeout(() => {
      setSuche(sucheInput)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [sucheInput])

  const filter = buildFilter(land, foerder, suche)
  const offset = (page - 1) * PAGE_SIZE

  const handleFilterChange = useCallback((fn: () => void) => {
    fn()
    setPage(1)
  }, [])

  // Live-Sync: alle 30s neu laden, damit neu gemessene/klassifizierte Stiftungen
  // von selbst auftauchen (kein manueller Reload).
  const { data: listDataRaw, loading: listLoading, refetch: refetchListe } = useQuery(STIFTUNGEN_BROWSE, {
    variables: { filter, offset },
    fetchPolicy: 'cache-and-network',
    pollInterval: 30000,
  })

  const { data: countDataRaw, refetch: refetchCount } = useQuery(STIFTUNGEN_COUNT, {
    variables: { filter },
    fetchPolicy: 'cache-and-network',
    pollInterval: 30000,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listData = listDataRaw as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const countData = countDataRaw as any

  const stiftungen: StiftungListItem[] = listData?.stiftungen ?? []
  const total: number = countData?.stiftungen_aggregated?.[0]?.count?.id ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      {/* Filter-Bar */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center mb-6">
        {/* Land-Select */}
        <div className="w-full md:w-40">
          <Select value={land} onValueChange={v => handleFilterChange(() => setLand(v as Land))}>
            <SelectTrigger>
              <SelectValue placeholder="Land" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle Länder</SelectItem>
              <SelectItem value="CH">Schweiz (CH)</SelectItem>
              <SelectItem value="AT">Österreich (AT)</SelectItem>
              <SelectItem value="DE">Deutschland (DE)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Förderstiftungen-Filter */}
        <div className="w-full md:w-52">
          <Select value={foerder} onValueChange={v => handleFilterChange(() => setFoerder(v as FoerderFilter))}>
            <SelectTrigger>
              <SelectValue placeholder="Typ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nur_foerder">Nur Förderstiftungen</SelectItem>
              <SelectItem value="alle">Alle Stiftungen</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Suchfeld */}
        <div className="w-full md:w-72 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Stiftungsname suchen…"
            value={sucheInput}
            onChange={e => setSucheInput(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Trefferzahl + Stiftung hinzufügen */}
        <div className="ml-auto flex items-center gap-4">
          {!listLoading && (
            <span className="text-xs text-slate-500">
              {total.toLocaleString('de-CH')} Einträge
            </span>
          )}
          <StiftungAnlegenDialog onAngelegt={() => { refetchListe(); refetchCount() }} />
        </div>
      </div>

      {/* Lade-Skeletons */}
      {listLoading && stiftungen.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-xl bg-slate-100 animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-100 rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-slate-100 rounded animate-pulse w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Card-Grid */}
      {stiftungen.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
          {stiftungen.map(s => (
            <FunderCard
              key={s.id}
              stiftung={s}
              onClick={() => setDetailId(s.id)}
            />
          ))}
        </div>
      )}

      {/* Leer-Zustand */}
      {!listLoading && stiftungen.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="text-sm">Keine Stiftungen gefunden.</p>
          <p className="text-xs mt-1">Filter anpassen oder Suche leeren.</p>
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Zurück
          </Button>
          <span className="text-sm text-slate-600">
            Seite {page} von {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Weiter
          </Button>
        </div>
      )}

      {/* Detail-Dialog */}
      <DetailDialog stiftungId={detailId} onClose={() => setDetailId(null)} />
    </div>
  )
}
