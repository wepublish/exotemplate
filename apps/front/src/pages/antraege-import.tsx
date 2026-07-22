import { useState, useEffect, useMemo } from 'react'
import { gql } from '@apollo/client'
import { useQuery, useMutation } from '@apollo/client/react'
import { ExternalLink, Search, Check, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { CREATE_APPLICATION, STATUS_STATION } from '@/graphql/applications.mutations'
import { STIFTUNGEN_SUCHE } from '@/graphql/stiftungen'
import {
  nichtErfasst, defaultStatus, type ScanEintrag, type AntragSnap,
} from '@/lib/antraege-import'
import { tenant } from '../../config/tenant'

const MEDIUM_LABELS: Record<string, string> = {
  wepublish: 'We.Publish', cueltuer: 'Cueltuer', neue_wege: 'Neue Wege',
  ganzgraz: 'Ganz Graz', 'ee-news': 'EE-News', bajour: 'Bajour', vmz: 'VMZ',
}

const STATUS_OPTIONEN = [
  { value: 'in_arbeit', label: 'In Arbeit' },
  { value: 'eingereicht', label: 'Eingereicht' },
  { value: 'zugesagt', label: 'Zugesagt' },
  { value: 'abgelehnt', label: 'Abgelehnt' },
  { value: 'archiviert', label: 'Archiviert' },
]

// Alle Anträge (alle Status) für den Dedup-Abgleich.
const ALLE_APPS_SNAP = gql`
  query AlleAppsSnap {
    applications(filter: { mandant: { _eq: "${tenant.key}" } }, limit: -1) {
      id
      medium_id
      stiftung_name
      drive_link
    }
  }
`

/** Macht aus einem Ordnernamen einen lesbaren Default-Stiftungsnamen. */
function prettyName(ordner: string): string {
  return ordner.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// ─── Stiftungs-Picker ─────────────────────────────────────────────────────────

function StiftungPicker({
  onPick,
}: {
  onPick: (id: number | null, name: string) => void
}) {
  const [q, setQ] = useState('')
  const [offen, setOffen] = useState(false)
  const { data } = useQuery(STIFTUNGEN_SUCHE, {
    variables: { q: q.trim() },
    skip: q.trim().length < 2,
    fetchPolicy: 'cache-and-network',
  })
  // Directus liefert stiftungen.id als STRING; für das Int-Feld stiftung_id
  // muss beim Picken zu einer Zahl konvertiert werden.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const treffer: { id: string | number; Stiftungsname: string }[] = (data as any)?.stiftungen ?? []

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOffen(true) }}
          placeholder="Stiftung suchen ..."
          className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      {offen && treffer.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {treffer.map((t) => (
            <button
              key={t.id}
              className="block w-full px-2 py-1.5 text-left text-xs hover:bg-indigo-50"
              onClick={() => {
                const n = Number(t.id)
                onPick(Number.isFinite(n) ? n : null, t.Stiftungsname)
                setQ(t.Stiftungsname)
                setOffen(false)
              }}
            >
              {t.Stiftungsname}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Import-Zeile ─────────────────────────────────────────────────────────────

function ImportZeile({ eintrag, onImported }: { eintrag: ScanEintrag; onImported: () => void }) {
  const [stiftungId, setStiftungId] = useState<number | null>(null)
  const [stiftungName, setStiftungName] = useState(prettyName(eintrag.ordner))
  const [status, setStatus] = useState(defaultStatus(eintrag.unterordner))
  const [erledigt, setErledigt] = useState(false)
  const [createApp, { loading }] = useMutation(CREATE_APPLICATION)

  async function handleUebernehmen() {
    try {
      await createApp({
        variables: {
          data: {
            medium_id: eintrag.medium,
            stiftung_id: stiftungId,
            stiftung_name: stiftungName.trim() || prettyName(eintrag.ordner),
            status,
            station: STATUS_STATION[status] ?? 2,
            mandant: tenant.key,
            verantwortung: 'antraege-import',
            zuletzt_geaendert_quelle: 'antraege-import',
            drive_link: eintrag.drive_url,
          },
        },
      })
      toast.success('Als Antrag übernommen')
      setErledigt(true)
      onImported()
    } catch (e: unknown) {
      toast.error('Fehler: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  if (erledigt) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] items-center gap-2 border-t border-slate-100 px-3 py-2.5">
      <div className="min-w-0">
        <a
          href={eintrag.drive_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-slate-700 hover:text-indigo-700 truncate"
        >
          <span className="truncate">{prettyName(eintrag.ordner)}</span>
          <ExternalLink className="w-3 h-3 shrink-0 text-slate-400" />
        </a>
        {eintrag.unterordner === '04_archiv' && (
          <Badge variant="outline" className="ml-1 text-[9px] text-slate-400">Archiv</Badge>
        )}
      </div>
      <StiftungPicker onPick={(id, name) => { setStiftungId(id); setStiftungName(name) }} />
      <div className="w-32">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONEN.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" className="h-8 text-xs gap-1 shrink-0" disabled={loading} onClick={handleUebernehmen}>
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
        Übernehmen
      </Button>
    </div>
  )
}

// ─── Seite ────────────────────────────────────────────────────────────────────

export default function AntraegeImportPage() {
  const [scan, setScan] = useState<ScanEintrag[]>([])
  const [laden, setLaden] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const { data: appsData, refetch } = useQuery(ALLE_APPS_SNAP, { fetchPolicy: 'cache-and-network' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apps: AntragSnap[] = (appsData as any)?.applications ?? []

  async function ladeScan() {
    setLaden(true)
    setFehler(null)
    try {
      const r = await fetch('/api/drive-antraege-scan')
      const j = (await r.json()) as { ok?: boolean; eintraege?: ScanEintrag[]; fehler?: string }
      if (j.ok && Array.isArray(j.eintraege)) setScan(j.eintraege)
      else setFehler(j.fehler ?? 'Scan fehlgeschlagen')
    } catch (e: unknown) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setLaden(false)
    }
  }

  useEffect(() => { void ladeScan() }, [])

  const offen = useMemo(() => nichtErfasst(scan, apps), [scan, apps])
  const proMedium = useMemo(() => {
    const m = new Map<string, ScanEintrag[]>()
    for (const e of offen) {
      const arr = m.get(e.medium) ?? []
      arr.push(e)
      m.set(e.medium, arr)
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [offen])

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Anträge importieren</h1>
          <p className="text-sm text-slate-500 mt-1">
            Bestehende Antrags-Ordner aus dem Drive in die App übernehmen. Pro Ordner die Stiftung
            zuordnen und Status wählen. Schon erfasste Ordner erscheinen nicht.
          </p>
        </div>
        <Button variant="outline" size="sm" className="text-xs h-9 gap-1" disabled={laden} onClick={() => void ladeScan()}>
          {laden ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Drive neu scannen
        </Button>
      </div>

      {fehler && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">{fehler}</div>
      )}

      {laden && scan.length === 0 && (
        <p className="text-sm text-slate-400 py-8 text-center">Drive wird gescannt …</p>
      )}

      {!laden && offen.length === 0 && !fehler && (
        <p className="text-sm text-slate-400 py-8 text-center">
          Keine nicht-erfassten Antrags-Ordner gefunden. Alles bereits übernommen.
        </p>
      )}

      <div className="space-y-6">
        {proMedium.map(([medium, eintraege]) => (
          <div key={medium} className="rounded-xl border border-slate-200 bg-white">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">{MEDIUM_LABELS[medium] ?? medium}</span>
              <span className="text-xs font-mono text-slate-400">{eintraege.length}</span>
            </div>
            {eintraege.map((e) => (
              <ImportZeile
                key={e.drive_url}
                eintrag={e}
                onImported={() => refetch()}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
