import { MapPin, Banknote, Globe, Calendar } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { clean } from '@/graphql/stiftungen.helpers'

export interface StiftungListItem {
  id: string
  Stiftungsname: string
  webseite?: string | null
  logo_url?: string | null
  sitz?: string | null
  region?: string | null
  kategorie?: string | null
  foerdersummen_range?: string | null
  foerderbeitraege?: string | null
  land?: string | null
  verifiziert?: boolean | null
  datenqualitaet?: string | null
  ist_foerderstiftung?: boolean | null
  deadline?: string | null
}

interface FunderCardProps {
  stiftung: StiftungListItem
  onClick: () => void
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase()
}

function betragLabel(stiftung: StiftungListItem): string | null {
  const range = clean(stiftung.foerdersummen_range)
  if (range) return range
  const beitrag = clean(stiftung.foerderbeitraege)
  if (beitrag) return beitrag.length > 30 ? beitrag.slice(0, 28) + '…' : beitrag
  return null
}

export function FunderCard({ stiftung, onClick }: FunderCardProps) {
  const betrag = betragLabel(stiftung)
  const sitz = clean(stiftung.sitz)
  const deadline = clean(stiftung.deadline)
  const kategorie = clean(stiftung.kategorie)
  const datenqualitaet = clean(stiftung.datenqualitaet)

  return (
    <Card
      onClick={onClick}
      className="p-5 shadow-sm hover:shadow-md cursor-pointer transition-shadow duration-150 bg-white"
    >
      <div className="flex gap-3 items-start">
        {/* Avatar */}
        <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0 text-emerald-700 font-semibold text-sm overflow-hidden">
          {stiftung.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={stiftung.logo_url}
              alt=""
              className="w-full h-full object-contain"
              onError={e => {
                // Fallback auf Initiale bei Ladefehler
                const el = e.currentTarget as HTMLImageElement
                el.style.display = 'none'
                const parent = el.parentElement
                if (parent) parent.dataset.fallback = initials(stiftung.Stiftungsname)
              }}
            />
          ) : (
            initials(stiftung.Stiftungsname)
          )}
        </div>

        {/* Inhalt */}
        <div className="min-w-0 flex-1">
          {/* Name */}
          <p className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2">
            {stiftung.Stiftungsname}
          </p>

          {/* Meta-Zeile */}
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {sitz && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                {sitz}
                {stiftung.land && stiftung.land !== 'CH' && (
                  <span className="text-slate-400">({stiftung.land})</span>
                )}
              </span>
            )}
            {betrag && (
              <span className="flex items-center gap-1">
                <Banknote className="w-3 h-3 flex-shrink-0" />
                {betrag}
              </span>
            )}
            {deadline && (
              <span className="flex items-center gap-1 text-amber-600">
                <Calendar className="w-3 h-3 flex-shrink-0" />
                {deadline}
              </span>
            )}
            {stiftung.webseite && (
              <a
                href={stiftung.webseite}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
              >
                <Globe className="w-3 h-3 flex-shrink-0" />
                Website
              </a>
            )}
          </div>

          {/* Badges */}
          <div className="mt-2 flex flex-wrap gap-1">
            {kategorie && (
              <Badge variant="outline" className="text-[10px] text-slate-600 border-slate-200">
                {kategorie}
              </Badge>
            )}
            {stiftung.verifiziert && (
              <Badge
                variant="outline"
                className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200"
              >
                verifiziert
              </Badge>
            )}
            {datenqualitaet && datenqualitaet !== 'normal' && datenqualitaet !== 'verifiziert' && (
              <Badge
                variant="outline"
                className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200"
              >
                {datenqualitaet}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
