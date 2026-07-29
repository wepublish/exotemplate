import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RueckmeldungZeile } from '@/lib/match-rueckmeldung'

/**
 * Freigabe-Block für Rückmeldungen, die MEDIEN im Portal geschrieben haben
 * (Entscheid der Nutzerin 29.07.2026: «dann müssen wir es aber erst freigeben,
 * bevors in die Datenbank wandert»). Die Zeilen liegen bereits in Directus,
 * aber mit `aktiv: false` — erst «Freigeben» macht sie für die Match-Engine
 * wirksam, «Verwerfen» löscht sie.
 *
 * Rendert NICHTS, solange nichts wartet: kein leerer Kasten auf der
 * Matching-Seite, wenn es nichts zu tun gibt.
 */
export function RueckmeldungFreigabe({ onGeaendert }: { onGeaendert?: () => void }) {
  const [offen, setOffen] = useState<RueckmeldungZeile[]>([])
  const [laeuftId, setLaeuftId] = useState<string | null>(null)

  const laden = useCallback(() => {
    fetch(`/api/match-rueckmeldung?cb=${Date.now()}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return
        const json = (await res.json()) as { offen?: RueckmeldungZeile[] }
        setOffen(json.offen ?? [])
      })
      .catch(() => {
        /* stiller Fehler: der Block ist eine Zusatzansicht, keine Kernfunktion */
      })
  }, [])

  useEffect(() => {
    laden()
  }, [laden])

  async function handle(id: string, aktion: 'freigeben' | 'verwerfen') {
    setLaeuftId(id)
    try {
      const res = await fetch('/api/match-rueckmeldung', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aktion, id }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(
        aktion === 'freigeben'
          ? 'Freigegeben — die Rückmeldung zählt beim nächsten Matching-Lauf.'
          : 'Verworfen.',
      )
      setOffen((prev) => prev.filter((z) => z.id !== id))
      onGeaendert?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLaeuftId(null)
    }
  }

  if (offen.length === 0) return null

  return (
    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-900">
        Rückmeldungen von Medien — Freigabe nötig ({offen.length})
      </h3>
      <p className="text-xs text-amber-800">
        Diese Medien melden, dass ein Treffer nicht passt. Erst nach der Freigabe berücksichtigt die
        Match-Engine die Rückmeldung beim nächsten Lauf.
      </p>
      <ul className="space-y-2">
        {offen.map((z) => (
          <li key={z.id} className="rounded-lg border border-amber-100 bg-white px-3 py-2">
            <p className="text-xs font-medium text-slate-800">
              {z.mediumId} · Stiftung {z.stiftungId}
            </p>
            <p className="mt-0.5 text-sm text-slate-700">{z.notiz}</p>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" className="h-7 text-xs" disabled={laeuftId === z.id} onClick={() => void handle(z.id, 'freigeben')}>
                {laeuftId === z.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Freigeben
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={laeuftId === z.id}
                onClick={() => void handle(z.id, 'verwerfen')}
              >
                Verwerfen
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
