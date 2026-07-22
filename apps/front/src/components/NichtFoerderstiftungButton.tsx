import { useState } from 'react'
import { useMutation, useApolloClient } from '@apollo/client/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  SET_STIFTUNG_FOERDERSTATUS,
  MATCH_RESULTS_FUER_STIFTUNG,
  DELETE_MATCH_RESULTS,
} from '@/graphql/stiftungen.mutations'
import { entferneStiftungGlobal } from '@/lib/foerderstatus'

/**
 * Globale Aktion: eine Stiftung als «keine Förderstiftung» markieren.
 * Entfernt sie aus dem gesamten Matching (alle Medien) und löscht ihre
 * bestehenden Treffer. Reversibel über die Stiftungsdatenbank.
 *
 * Bewusst getrennt vom per-Medium «Ausblenden» (das nur für EIN Medium gilt).
 */
export function NichtFoerderstiftungButton({
  stiftungId,
  stiftungName,
  variante = 'link',
  onDone,
}: {
  stiftungId: string
  stiftungName: string
  /** 'link' = dezenter Textknopf (Match-Liste), 'button' = Outline-Knopf (Detail-Dialog) */
  variante?: 'link' | 'button'
  onDone?: () => void
}) {
  const client = useApolloClient()
  const [setStatus] = useMutation(SET_STIFTUNG_FOERDERSTATUS)
  const [deleteMatches] = useMutation(DELETE_MATCH_RESULTS)
  const [offen, setOffen] = useState(false)
  const [beschaeftigt, setBeschaeftigt] = useState(false)

  const numId = Number(stiftungId)

  async function ausfuehren() {
    if (Number.isNaN(numId)) {
      toast.error('Ungültige Stiftungs-ID')
      return
    }
    setBeschaeftigt(true)
    try {
      const { geloeschteMatches } = await entferneStiftungGlobal({
        setStatus: async ist => { await setStatus({ variables: { id: stiftungId, ist } }) },
        ladeMatchIds: async () => {
          const { data } = await client.query({
            query: MATCH_RESULTS_FUER_STIFTUNG,
            variables: { stiftungId: numId },
            fetchPolicy: 'network-only',
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return ((data as any)?.match_results ?? []).map((m: { id: string }) => m.id)
        },
        loescheMatches: async ids => { await deleteMatches({ variables: { ids } }) },
      })
      toast.success(
        `«${stiftungName}» als keine Förderstiftung markiert${geloeschteMatches > 0 ? ` · ${geloeschteMatches} Treffer entfernt` : ''}`,
      )
      setOffen(false)
      onDone?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler beim Entfernen: ${msg}`)
    } finally {
      setBeschaeftigt(false)
    }
  }

  return (
    <>
      {variante === 'link' ? (
        <button
          type="button"
          className="text-xs text-slate-400 hover:text-red-600 hover:underline"
          onClick={() => setOffen(true)}
        >
          Keine Förderstiftung
        </button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-8 text-red-600 border-red-200 hover:bg-red-50"
          onClick={() => setOffen(true)}
        >
          Als Nicht-Förderstiftung markieren
        </Button>
      )}

      <Dialog open={offen} onOpenChange={o => { if (!o) setOffen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Keine Förderstiftung?</DialogTitle>
            <DialogDescription>
              «{stiftungName}» wird global aus dem Matching genommen — bei ALLEN Medien.
              Bestehende Treffer werden entfernt. Reversibel über die Stiftungsdatenbank
              (Filter «Alle Stiftungen» → wieder aufnehmen).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 gap-2">
            <Button variant="outline" size="sm" onClick={() => setOffen(false)} disabled={beschaeftigt}>
              Abbrechen
            </Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={beschaeftigt}
              onClick={ausfuehren}
            >
              {beschaeftigt ? 'Entferne…' : 'Entfernen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
