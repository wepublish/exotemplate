import { Search } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { tenant } from '../../config/tenant'
import type { Projekt } from '@/graphql/projekte'

interface FilterBarProps {
  medium: string
  onMedium: (m: string) => void
  q: string
  onQ: (s: string) => void
  projekte?: Projekt[]
  projekt?: number | null
  onProjekt?: (id: number | null) => void
}

const GESAMT = '__gesamt__'

export function FilterBar({ medium, onMedium, q, onQ, projekte = [], projekt = null, onProjekt }: FilterBarProps) {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center mb-6">
      <div className="w-full md:w-64">
        <Select value={medium} onValueChange={onMedium}>
          <SelectTrigger>
            <SelectValue placeholder="Medium auswählen..." />
          </SelectTrigger>
          <SelectContent>
            {tenant.clients.map(c => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {projekte.length > 0 && onProjekt && (
        <div className="w-full md:w-56">
          <Select
            value={projekt == null ? GESAMT : String(projekt)}
            onValueChange={v => onProjekt(v === GESAMT ? null : Number(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GESAMT}>Medium gesamt</SelectItem>
              {projekte.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>
                  Projekt: {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="w-full md:w-64 relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <Input
          placeholder="Stiftung suchen…"
          value={q}
          onChange={e => onQ(e.target.value)}
          className="pl-9"
        />
      </div>
    </div>
  )
}
