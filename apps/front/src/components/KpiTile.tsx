import { type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface KpiTileProps {
  label: string
  value: number | null | undefined
  icon?: LucideIcon
  accentColor?: string
  loading?: boolean
}

function formatNumber(n: number): string {
  return n.toLocaleString('de-CH')
}

export function KpiTile({ label, value, icon: Icon, accentColor = 'text-indigo-600', loading = false }: KpiTileProps) {
  return (
    <Card className="p-5 bg-white shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">{label}</p>
        {Icon && (
          <div className={cn('w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center', accentColor)}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
      {loading ? (
        <div className="h-9 w-24 bg-slate-100 rounded animate-pulse" />
      ) : (
        <p className={cn('text-3xl font-bold text-slate-900 tabular-nums')}>
          {value !== null && value !== undefined ? formatNumber(value) : '—'}
        </p>
      )}
    </Card>
  )
}
