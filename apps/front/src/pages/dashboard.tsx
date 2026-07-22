import { useQuery } from '@apollo/client/react'
import {
  Database,
  Heart,
  Layers,
  Zap,
  Globe,
  Clock,
} from 'lucide-react'
import { KpiTile } from '@/components/KpiTile'
import { UsagePanel } from '@/components/UsagePanel'
import { Card } from '@/components/ui/card'
import { DASHBOARD_KPIS, mediumAlias } from '@/graphql/dashboard'
import { tenant } from '../../config/tenant'

// Anzeigenamen für Medien
const MEDIUM_LABELS: Record<string, string> = {
  wepublish: 'We.Publish',
  cueltuer: 'Cueltuer',
  neue_wege: 'Neue Wege',
  ganzgraz: 'Ganz Graz',
  'ee-news': 'EE-News',
}

function extractCount(data: unknown, key: string): number | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const arr = d[key]
  if (!Array.isArray(arr) || arr.length === 0) return null
  const first = arr[0] as Record<string, unknown>
  const count = first?.count as Record<string, unknown> | undefined
  return typeof count?.id === 'number' ? count.id : null
}

export default function DashboardPage() {
  // Live-Sync: KPIs alle 30s aktualisieren (wachsende Stiftungs-/DNA-Zahlen).
  const { data, loading } = useQuery(DASHBOARD_KPIS, {
    fetchPolicy: 'cache-and-network',
    pollInterval: 30000,
  })

  const total = extractCount(data, 'total_stiftungen')
  const foerder = extractCount(data, 'foerderstiftungen')
  const aktive = extractCount(data, 'aktive_dnas')
  const matches = extractCount(data, 'deep_matches')
  const ch = extractCount(data, 'stiftungen_ch')
  const at = extractCount(data, 'stiftungen_at')
  const de = extractCount(data, 'stiftungen_de')
  const mitFrist = extractCount(data, 'mit_frist')

  return (
    <div className="space-y-8">
      {/* Haupt-KPIs */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
          Gesamtpool
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile
            label="Stiftungen total"
            value={total}
            icon={Database}
            accentColor="text-slate-600"
            loading={loading && total === null}
          />
          <KpiTile
            label="Förderstiftungen"
            value={foerder}
            icon={Heart}
            accentColor="text-emerald-600"
            loading={loading && foerder === null}
          />
          <KpiTile
            label="Aktive DNAs"
            value={aktive}
            icon={Layers}
            accentColor="text-indigo-600"
            loading={loading && aktive === null}
          />
          <KpiTile
            label="Matches"
            value={matches}
            icon={Zap}
            accentColor="text-violet-600"
            loading={loading && matches === null}
          />
        </div>
      </section>

      {/* Nach Land */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
          Stiftungen nach Land
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile
            label="Schweiz (CH)"
            value={ch}
            icon={Globe}
            accentColor="text-red-600"
            loading={loading && ch === null}
          />
          <KpiTile
            label="Österreich (AT)"
            value={at}
            icon={Globe}
            accentColor="text-red-500"
            loading={loading && at === null}
          />
          <KpiTile
            label="Deutschland (DE)"
            value={de}
            icon={Globe}
            accentColor="text-yellow-600"
            loading={loading && de === null}
          />
          <KpiTile
            label="Mit Fristangabe"
            value={mitFrist}
            icon={Clock}
            accentColor="text-amber-600"
            loading={loading && mitFrist === null}
          />
        </div>
      </section>

      {/* Matches pro Medium */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
          Matches pro Medium
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {tenant.clients.map(client => {
            const alias = mediumAlias(client)
            const count = extractCount(data, alias)
            return (
              <KpiTile
                key={client}
                label={MEDIUM_LABELS[client] ?? client}
                value={count}
                icon={Zap}
                accentColor="text-indigo-600"
                loading={loading && count === null}
              />
            )
          })}
        </div>
      </section>

      {/* Nutzung & Kosten (Agent) */}
      <UsagePanel />

      {/* Hinweis-Box */}
      <Card className="p-4 bg-slate-50 border-slate-200">
        <p className="text-xs text-slate-500">
          Alle Zahlen live aus Directus (Tailscale-Proxy). Daten werden alle 45 Sekunden
          aktualisiert. Fristangaben sind Freitext und werden nur gezählt, nicht sortiert.
        </p>
      </Card>
    </div>
  )
}
