import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@apollo/client/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PROJEKTE_ADMIN, CREATE_PROJEKT, slugify, type ProjektAdmin } from '@/graphql/projekte'
import { tenant } from '../../config/tenant'

// Region → Geo-Tags (weiche Präferenz: regional + national geo_schweiz_weit).
const REGIONEN: { key: string; label: string; tags: string[] }[] = [
  { key: 'national', label: 'National / keine Region', tags: ['geo_schweiz_weit'] },
  { key: 'basel', label: 'Basel', tags: ['geo_basel', 'geo_schweiz_weit'] },
  { key: 'bern', label: 'Bern', tags: ['geo_bern', 'geo_schweiz_weit'] },
  { key: 'zuerich', label: 'Zürich', tags: ['geo_zuerich', 'geo_schweiz_weit'] },
  { key: 'luzern', label: 'Luzern', tags: ['geo_luzern', 'geo_schweiz_weit'] },
  { key: 'st_gallen', label: 'St. Gallen', tags: ['geo_st_gallen', 'geo_schweiz_weit'] },
  { key: 'graubuenden', label: 'Graubünden', tags: ['geo_graubuenden', 'geo_schweiz_weit'] },
  { key: 'tessin', label: 'Tessin', tags: ['geo_tessin', 'geo_schweiz_weit'] },
  { key: 'genf_romandie', label: 'Genf / Romandie', tags: ['geo_genf_romandie', 'geo_schweiz_weit'] },
  { key: 'winterthur', label: 'Winterthur', tags: ['geo_winterthur', 'geo_schweiz_weit'] },
]

/**
 * Projekt-Onboarding: Projekte eines Mediums anlegen und ihren DNA-/Matching-Stand sehen.
 * Neu angelegte Projekte werden vom Spark-Cron (projekt_matcher --only-new) automatisch
 * gemessen und gematcht — danach erscheinen sie in der Projekt-Auswahl der Förderstiftungen.
 */
export function ProjekteBlock({ mediumSlug }: { mediumSlug: string }) {
  const { data, refetch, startPolling, stopPolling } = useQuery(PROJEKTE_ADMIN, {
    variables: { medium: mediumSlug },
    fetchPolicy: 'cache-and-network',
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projekte: ProjektAdmin[] = ((data as any)?.projekte ?? []) as ProjektAdmin[]
  const [createProjekt, { loading }] = useMutation(CREATE_PROJEKT)
  const [name, setName] = useState('')
  const [beschreibung, setBeschreibung] = useState('')
  const [region, setRegion] = useState('national')
  // slug -> arbeits_dna_stand beim Mess-Start (um Abschluss zu erkennen)
  const [laufend, setLaufend] = useState<Record<string, string>>({})

  // Während eine Messung läuft, alle 15s pollen; Abschluss erkennen (Stand wurde neuer).
  useEffect(() => {
    if (Object.keys(laufend).length === 0) {
      stopPolling()
      return
    }
    startPolling(15000)
    const fertig = projekte.filter(
      p => p.slug in laufend && (p.arbeits_dna_stand ?? '') > (laufend[p.slug] ?? ''),
    )
    if (fertig.length) {
      setLaufend(prev => {
        const n = { ...prev }
        fertig.forEach(p => delete n[p.slug])
        return n
      })
      fertig.forEach(p => toast.success(`DNA von «${p.name}» gemessen — Treffer sind da`))
    }
  }, [data, laufend, projekte, startPolling, stopPolling])

  async function messen(p: ProjektAdmin) {
    setLaufend(prev => ({ ...prev, [p.slug]: p.arbeits_dna_stand ?? '' }))
    try {
      const r = await fetch('/api/projekt-messen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projekt: p.slug }),
      })
      const d = await r.json()
      if (d.status === 'gestartet' || d.status === 'läuft bereits') {
        toast.success(`Messung für «${p.name}» läuft (~5 Min) — aktualisiert sich automatisch`)
      } else {
        toast.error(`Messung nicht gestartet: ${d.note ?? d.status}`)
        setLaufend(prev => { const n = { ...prev }; delete n[p.slug]; return n })
      }
    } catch (err: unknown) {
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
      setLaufend(prev => { const n = { ...prev }; delete n[p.slug]; return n })
    }
  }

  async function anlegen() {
    const n = name.trim()
    if (!n) return
    const geoTags = REGIONEN.find(r => r.key === region)?.tags ?? ['geo_schweiz_weit']
    try {
      await createProjekt({
        variables: {
          data: {
            name: n,
            slug: slugify(n),
            medium_id: mediumSlug,
            mandant: tenant.key,
            status: 'aktiv',
            beschreibung: beschreibung.trim() || null,
            geo_scope: geoTags,
          },
        },
      })
      toast.success(`Projekt «${n}» angelegt — DNA wird automatisch gemessen`)
      setName('')
      setBeschreibung('')
      setRegion('national')
      refetch()
    } catch (err: unknown) {
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-1">Projekte</h3>
      <p className="text-xs text-slate-400 mb-3">
        Projekte mit eigenem Förderprofil (z.B. KI-Exoskelett). Jedes Projekt bekommt eine eigene
        gemessene DNA und eigene Stiftungs-Treffer.
      </p>

      {projekte.length > 0 ? (
        <div className="space-y-1.5 mb-4">
          {projekte.map(p => {
            const gemessen = !!p.directus_aktive_dna_version_id
            const istLaufend = p.slug in laufend
            return (
              <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">{p.name}</span>
                <div className="flex items-center gap-3">
                  <span className={`text-xs ${gemessen ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {gemessen ? 'DNA gemessen' : 'Messung ausstehend'}
                  </span>
                  {istLaufend ? (
                    <span className="text-xs text-indigo-600">misst … (~5 Min)</span>
                  ) : (
                    <button
                      onClick={() => messen(p)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
                    >
                      {gemessen ? 'Neu messen' : 'Jetzt messen'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-slate-400 mb-4">Noch keine Projekte für dieses Medium.</p>
      )}

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <Input
          placeholder="Projektname (z.B. KI-Exoskelett)"
          value={name}
          onChange={e => setName(e.target.value)}
          className="text-sm"
        />
        <Textarea
          placeholder="Kurzbeschreibung: worum geht es, welche Förderung sucht das Projekt?"
          value={beschreibung}
          onChange={e => setBeschreibung(e.target.value)}
          className="h-20 text-sm"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 shrink-0">Förder-Region:</span>
          <Select value={region} onValueChange={setRegion}>
            <SelectTrigger className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REGIONEN.map(r => (
                <SelectItem key={r.key} value={r.key} className="text-sm">
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-[11px] text-slate-400">
          Region steuert, welche Stiftungen bevorzugt vorgeschlagen werden (regional + national, weich).
        </p>
        <div className="flex justify-end">
          <Button size="sm" onClick={anlegen} disabled={loading || !name.trim()}>
            Projekt anlegen
          </Button>
        </div>
      </div>
    </div>
  )
}
