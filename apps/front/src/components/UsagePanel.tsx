import { useQuery } from '@apollo/client/react'
import { Coins, Cpu, Activity } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { AGENT_USAGE } from '@/graphql/usage'

// ─── Anzeige-Helfer ───────────────────────────────────────────────────────────

const MEDIUM_LABELS: Record<string, string> = {
  wepublish: 'We.Publish',
  cueltuer: 'Cueltuer',
  neue_wege: 'Neue Wege',
  ganzgraz: 'Ganz Graz',
  'ee-news': 'EE-News',
  bajour: 'Bajour',
}

const QUELLE_LABEL: Record<string, string> = {
  api: 'API',
  abo: 'Abo (flat)',
  lokal: 'lokal (0)',
}

function formatChf(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return 'CHF ' + n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('de-CH')
}

function mediumLabel(id: string | null | undefined): string {
  if (!id) return '—'
  return MEDIUM_LABELS[id] ?? id
}

// ─── Datentypen (locker, defensive Extraktion wie im Dashboard) ─────────────────

type Aggregated = {
  group?: Record<string, unknown> | null
  count?: { id?: number | null } | null
  sum?: {
    input_tokens?: number | null
    output_tokens?: number | null
    kosten_chf?: number | null
  } | null
}

type RecentRow = {
  id: number
  ts?: string | null
  medium_id?: string | null
  aufgabe?: string | null
  modell?: string | null
  tier?: string | null
  quelle?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  kosten_chf?: number | null
}

type UsageData = {
  total?: Aggregated[]
  pro_medium?: Aggregated[]
  recent?: RecentRow[]
}

// ─── Komponente ─────────────────────────────────────────────────────────────

export function UsagePanel() {
  const { data, loading } = useQuery(AGENT_USAGE, {
    fetchPolicy: 'cache-and-network',
    pollInterval: 30000,
  })

  const d = (data ?? {}) as UsageData
  const total = d.total?.[0]
  const calls = total?.count?.id ?? 0
  const tokens = (total?.sum?.input_tokens ?? 0) + (total?.sum?.output_tokens ?? 0)
  const chf = total?.sum?.kosten_chf ?? 0
  const proMedium = (d.pro_medium ?? []).filter(g => (g.count?.id ?? 0) > 0)
  const recent = d.recent ?? []

  return (
    <section>
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
        Nutzung &amp; Kosten (Agent)
      </h2>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <Card className="p-5 bg-white shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">API-Kosten total</p>
            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-emerald-600">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-bold text-slate-900 tabular-nums">{formatChf(chf)}</p>
        </Card>
        <Card className="p-5 bg-white shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">Tokens total</p>
            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-indigo-600">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-bold text-slate-900 tabular-nums">{formatTokens(tokens)}</p>
        </Card>
        <Card className="p-5 bg-white shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">Agent-Calls</p>
            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-violet-600">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-bold text-slate-900 tabular-nums">{formatTokens(calls)}</p>
        </Card>
      </div>

      {calls === 0 ? (
        <Card className="p-6 bg-white shadow-sm">
          <p className="text-sm text-slate-500">
            {loading
              ? 'Lade Nutzungsdaten …'
              : 'Noch keine Agent-Calls erfasst. Das Panel füllt sich, sobald der Agent über die API arbeitet. Abo- (Copy-paste-Opus) und lokale Spark-Calls erscheinen mit 0 CHF.'}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Pro Medium */}
          <Card className="p-5 bg-white shadow-sm">
            <p className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-3">Pro Medium</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs">
                  <th className="font-medium pb-2">Medium</th>
                  <th className="font-medium pb-2 text-right">Calls</th>
                  <th className="font-medium pb-2 text-right">Tokens</th>
                  <th className="font-medium pb-2 text-right">CHF</th>
                </tr>
              </thead>
              <tbody>
                {proMedium.map((g, i) => {
                  const mid = (g.group?.medium_id as string | undefined) ?? null
                  const t = (g.sum?.input_tokens ?? 0) + (g.sum?.output_tokens ?? 0)
                  return (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-2 text-slate-700">{mediumLabel(mid)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-600">{formatTokens(g.count?.id ?? 0)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-600">{formatTokens(t)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-900 font-medium">{formatChf(g.sum?.kosten_chf ?? 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>

          {/* Letzte Calls */}
          <Card className="p-5 bg-white shadow-sm">
            <p className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-3">Letzte Calls</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs">
                  <th className="font-medium pb-2">Aufgabe</th>
                  <th className="font-medium pb-2">Modell</th>
                  <th className="font-medium pb-2">Quelle</th>
                  <th className="font-medium pb-2 text-right">CHF</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(r => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2 text-slate-700">{r.aufgabe ?? '—'}</td>
                    <td className="py-2 text-slate-500 text-xs">{r.modell ?? '—'}</td>
                    <td className="py-2 text-slate-500 text-xs">{QUELLE_LABEL[r.quelle ?? ''] ?? r.quelle ?? '—'}</td>
                    <td className="py-2 text-right tabular-nums text-slate-900">
                      {r.quelle === 'api' ? formatChf(r.kosten_chf ?? 0) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </section>
  )
}
