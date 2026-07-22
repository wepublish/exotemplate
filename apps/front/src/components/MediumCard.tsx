import { Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { MediumLogo } from '@/components/MediumLogo'

export interface MediumListItem {
  id: number
  medium_id: string
  medium_name: string
  schaerfe_prozent: number | null
  version: number | null
  vocabulary_version_at_creation: number | null
  antragsteller_typ: string | null
  tags: unknown
}

interface MediumCardProps {
  medium: MediumListItem
  deepMatchCount: number | null
  onClick: () => void
}

/** Schärfe-Badge: Farbe nach Höhe des Werts. */
function SchaerfeBadge({ wert }: { wert: number | null }) {
  if (wert === null || wert === undefined) {
    return (
      <Badge variant="outline" className="text-[10px] text-slate-500 border-slate-200">
        —
      </Badge>
    )
  }
  const farbe =
    wert >= 90
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : wert >= 75
      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
      : 'bg-amber-50 text-amber-700 border-amber-200'

  return (
    <Badge variant="outline" className={`text-[10px] ${farbe}`}>
      {wert}% Schärfe
    </Badge>
  )
}

/** Anzahl Tags aus dem tags-JSON-Feld (defensiv). */
function tagAnzahl(tags: unknown): number | null {
  if (!Array.isArray(tags)) return null
  return tags.length
}

export function MediumCard({ medium, deepMatchCount, onClick }: MediumCardProps) {
  const anzahl = tagAnzahl(medium.tags)

  return (
    <Card
      onClick={onClick}
      className="p-5 shadow-sm hover:shadow-md cursor-pointer transition-shadow duration-150 bg-white"
    >
      <div className="flex gap-3 items-start">
        {/* Logo (gecacht via Directus) mit Initial-Fallback */}
        <MediumLogo slug={medium.medium_id} name={medium.medium_name} size={48} />

        {/* Inhalt */}
        <div className="min-w-0 flex-1">
          {/* Name */}
          <p className="text-sm font-semibold text-slate-900 leading-snug">
            {medium.medium_name}
          </p>

          {/* ID (mono) */}
          <p className="text-[10px] font-mono text-slate-400 mt-0.5">
            {medium.medium_id}
          </p>

          {/* Badges-Zeile */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <SchaerfeBadge wert={medium.schaerfe_prozent} />

            {medium.version !== null && medium.version !== undefined && (
              <Badge variant="outline" className="text-[10px] text-slate-500 border-slate-200">
                DNA v{medium.version}
              </Badge>
            )}

            {medium.vocabulary_version_at_creation !== null &&
              medium.vocabulary_version_at_creation !== undefined && (
                <Badge variant="outline" className="text-[10px] text-slate-500 border-slate-200">
                  Vok v{medium.vocabulary_version_at_creation}
                </Badge>
              )}
          </div>

          {/* Kennzahlen-Zeile */}
          <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
            {anzahl !== null && (
              <span>{anzahl} Tags</span>
            )}
            {deepMatchCount !== null && (
              <span className="flex items-center gap-1 text-violet-600 font-medium">
                <Zap className="w-3 h-3" />
                {deepMatchCount.toLocaleString('de-CH')} Matches
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
