import { useMemo, useState } from 'react'
import { useQuery } from '@apollo/client/react'
import { Coins, Banknote, FileCheck, Receipt } from 'lucide-react'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { APPLICATIONS_ALL } from '@/graphql/applications'
import { PROVISION_SATZ, PROVISION_MIN_CHF, PROVISION_MAX_CHF, berechneProvision } from '@/lib/provision'

const MEDIUM_LABELS: Record<string, string> = {
  wepublish: 'We.Publish',
  cueltuer: 'Cueltuer',
  neue_wege: 'Neue Wege',
  ganzgraz: 'Ganz Graz',
  'ee-news': 'EE-News',
  bajour: 'Bajour',
}

interface Application {
  id: string
  medium_id: string | null
  stiftung_name: string | null
  status: string | null
  betrag_zugesagt_chf: number | null
}

function chf(n: number): string {
  return 'CHF ' + Math.round(n).toLocaleString('de-CH')
}
function mediumLabel(id: string | null): string {
  if (!id) return '—'
  return MEDIUM_LABELS[id] ?? id
}

export default function AbrechnungPage() {
  const [filterMedium, setFilterMedium] = useState('alle')
  const { data: raw, loading } = useQuery(APPLICATIONS_ALL, { fetchPolicy: 'cache-and-network' })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alle: Application[] = ((raw as any)?.applications ?? []) as Application[]

  // Abrechenbar = zugesagt mit zugesagtem Betrag
  const zugesagt = useMemo(
    () => alle.filter(a => a.status === 'zugesagt' && (a.betrag_zugesagt_chf ?? 0) > 0),
    [alle]
  )

  const medien = useMemo(
    () => Array.from(new Set(zugesagt.map(a => a.medium_id ?? '—'))).sort(),
    [zugesagt]
  )

  const gefiltert = useMemo(
    () => (filterMedium === 'alle' ? zugesagt : zugesagt.filter(a => (a.medium_id ?? '—') === filterMedium)),
    [zugesagt, filterMedium]
  )

  // Aggregation pro Medium
  const proMedium = useMemo(() => {
    const m = new Map<string, { anzahl: number; summe: number; provision: number }>()
    for (const a of gefiltert) {
      const k = a.medium_id ?? '—'
      const betrag = a.betrag_zugesagt_chf ?? 0
      const e = m.get(k) ?? { anzahl: 0, summe: 0, provision: 0 }
      e.anzahl += 1
      e.summe += betrag
      e.provision += berechneProvision(betrag)
      m.set(k, e)
    }
    return Array.from(m.entries()).sort((a, b) => b[1].provision - a[1].provision)
  }, [gefiltert])

  const totalSumme = gefiltert.reduce((s, a) => s + (a.betrag_zugesagt_chf ?? 0), 0)
  // Die Provision wird PRO GESUCH auf Minimum/Maximum geklammert, darum ist die Gesamtprovision
  // die Summe der einzeln geklammerten Provisionen, nicht der Satz auf die Gesamtsumme.
  const totalProvision = gefiltert.reduce((s, a) => s + berechneProvision(a.betrag_zugesagt_chf ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Abrechnung</h1>
          <p className="text-sm text-slate-500 mt-1">
            Provision aus zugesagten Förderbeiträgen · {Math.round(PROVISION_SATZ * 100)} %, mind. {chf(PROVISION_MIN_CHF)}, max. {chf(PROVISION_MAX_CHF)} pro Gesuch
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Select value={filterMedium} onValueChange={setFilterMedium}>
            <SelectTrigger>
              <SelectValue placeholder="Medium" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle Medien</SelectItem>
              {medien.map(mid => (
                <SelectItem key={mid} value={mid}>{mediumLabel(mid)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI-Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5 bg-white shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">Zugesagte Anträge</p>
            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-emerald-600"><FileCheck className="w-4 h-4" /></div>
          </div>
          <p className="text-3xl font-bold text-slate-900 tabular-nums">{gefiltert.length}</p>
        </Card>
        <Card className="p-5 bg-white shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">Zugesagte Beträge</p>
            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-indigo-600"><Banknote className="w-4 h-4" /></div>
          </div>
          <p className="text-3xl font-bold text-slate-900 tabular-nums">{chf(totalSumme)}</p>
        </Card>
        <Card className="p-5 bg-white shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">Provision ({Math.round(PROVISION_SATZ * 100)} %, mind./max. pro Gesuch)</p>
            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-violet-600"><Coins className="w-4 h-4" /></div>
          </div>
          <p className="text-3xl font-bold text-slate-900 tabular-nums">{chf(totalProvision)}</p>
        </Card>
      </div>

      {/* Pro Medium */}
      <Card className="p-5 bg-white shadow-sm">
        <p className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-3">Pro Medium</p>
        {gefiltert.length === 0 ? (
          <p className="text-sm text-slate-400">
            {loading ? 'Lade …' : 'Noch keine zugesagten Anträge zum Abrechnen.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs">
                <th className="font-medium pb-2">Medium</th>
                <th className="font-medium pb-2 text-right">Anträge</th>
                <th className="font-medium pb-2 text-right">Zugesagt</th>
                <th className="font-medium pb-2 text-right">Provision</th>
              </tr>
            </thead>
            <tbody>
              {proMedium.map(([mid, e]) => (
                <tr key={mid} className="border-t border-slate-100">
                  <td className="py-2 text-slate-700">{mediumLabel(mid)}</td>
                  <td className="py-2 text-right tabular-nums text-slate-600">{e.anzahl}</td>
                  <td className="py-2 text-right tabular-nums text-slate-600">{chf(e.summe)}</td>
                  <td className="py-2 text-right tabular-nums text-slate-900 font-medium">{chf(e.provision)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Hinweis: nächste Schritte (Bexio gegated) */}
      <Card className="p-4 bg-slate-50 border-slate-200">
        <div className="flex items-start gap-3">
          <Receipt className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-500 leading-relaxed">
            Provision = {Math.round(PROVISION_SATZ * 100)} % des zugesagten Betrags pro angenommenes Gesuch,
            mindestens {chf(PROVISION_MIN_CHF)}, höchstens {chf(PROVISION_MAX_CHF)}. Individueller Satz/Cap pro
            Antrag und die <strong>Bexio-Rechnungsstellung</strong> folgen. Bexio benötigt dafür API-Key und
            Konfiguration (Kontakt-, Artikel-, Steuer-ID). Diese Seite ist bis dahin eine Übersicht, keine
            Rechnungsstellung.
          </p>
        </div>
      </Card>
    </div>
  )
}
