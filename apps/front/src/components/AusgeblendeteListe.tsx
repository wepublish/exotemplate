import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMutation } from '@apollo/client/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { UPDATE_APPLICATION, STATUS_STATION } from '@/graphql/applications.mutations'

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface AusgeblendetEintrag {
  id: string
  medium_id: string | null
  stiftung_id: string | null
  stiftung_name: string | null
  bemerkung: string | null
  date_created: string | null
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function formatDatum(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

// ─── Einzelne Zeile ───────────────────────────────────────────────────────────

function AusgeblendetZeile({
  eintrag,
  onWiederEingeblendet,
}: {
  eintrag: AusgeblendetEintrag
  onWiederEingeblendet: () => void
}) {
  // UPDATE statt DELETE: Prozesshistorie (Bemerkungen, Zeitstempel) bleibt erhalten.
  const [updateApp, { loading }] = useMutation(UPDATE_APPLICATION)

  async function handleWiederEinblenden() {
    try {
      await updateApp({
        variables: {
          id: eintrag.id,
          data: {
            status: 'identifiziert',
            station: STATUS_STATION['identifiziert'],
            zuletzt_geaendert_quelle: 'matching-app',
          },
        },
      })
      toast.success(`«${eintrag.stiftung_name ?? eintrag.id}» wieder eingeblendet`)
      onWiederEingeblendet()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-800 leading-snug">
            {eintrag.stiftung_name ?? '—'}
          </span>
          {eintrag.medium_id && (
            <span className="font-mono text-[10px] text-slate-400">
              {eintrag.medium_id}
            </span>
          )}
          {eintrag.date_created && (
            <span className="text-[10px] text-slate-400">
              {formatDatum(eintrag.date_created)}
            </span>
          )}
        </div>
        {eintrag.bemerkung && (
          <p className="text-xs text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
            {eintrag.bemerkung}
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="text-xs h-7 flex-shrink-0 text-slate-600 border-slate-200 hover:bg-slate-50"
        disabled={loading}
        onClick={handleWiederEinblenden}
      >
        Wieder einblenden
      </Button>
    </div>
  )
}

// ─── Hauptkomponente ──────────────────────────────────────────────────────────

interface AusgeblendeteListe {
  eintraege: AusgeblendetEintrag[]
  onRefetch: () => void
}

export function AusgeblendeteListe({ eintraege, onRefetch }: AusgeblendeteListe) {
  const [offen, setOffen] = useState(false)

  // Leere Sektion komplett weglassen
  if (eintraege.length === 0) return null

  return (
    <div className="mt-6">
      {/* Kopfzeile mit Toggle */}
      <button
        type="button"
        onClick={() => setOffen(v => !v)}
        className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors"
        aria-expanded={offen}
      >
        {offen
          ? <ChevronDown className="w-4 h-4 flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
        Ausgeblendet ({eintraege.length})
      </button>

      {offen && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-2">
          <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
            Ausgeblendete werden vom Paket-Builder nie wieder vorgeschlagen.
            Wieder einblenden hebt das auf; die Lern-Notiz bleibt bestehen.
          </p>
          {eintraege.map(e => (
            <AusgeblendetZeile
              key={e.id}
              eintrag={e}
              onWiederEingeblendet={onRefetch}
            />
          ))}
        </div>
      )}
    </div>
  )
}
