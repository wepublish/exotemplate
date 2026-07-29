import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import { RUECKMELDUNG_MIN_ZEICHEN, RUECKMELDUNG_MAX_ZEICHEN } from '@/lib/match-rueckmeldung'

/**
 * Dialog für die Rückmeldung zu EINEM Treffer («passt überhaupt nicht, weil …»).
 * Von beiden Seiten genutzt: Operator-Matching (wirkt sofort) und
 * Medien-Portal (wirkt nach der Freigabe). Der Unterschied steckt nur im
 * `hinweis`-Text und in der Route, die die aufrufende Seite anspricht — die
 * Komponente selbst kennt keinen der beiden Wege.
 */
export function RueckmeldungDialog({
  offen,
  stiftungName,
  hinweis,
  beschaeftigt,
  onAbbrechen,
  onBestaetigen,
}: {
  offen: boolean
  stiftungName: string
  hinweis: string
  beschaeftigt?: boolean
  onAbbrechen: () => void
  onBestaetigen: (notiz: string) => void
}) {
  const [notiz, setNotiz] = useState('')
  const zuKurz = notiz.trim().length < RUECKMELDUNG_MIN_ZEICHEN

  function abbrechen() {
    setNotiz('')
    onAbbrechen()
  }

  return (
    <Dialog
      open={offen}
      onOpenChange={(o) => {
        if (!o) abbrechen()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rückmeldung zu «{stiftungName}»</DialogTitle>
          <DialogDescription>{hinweis}</DialogDescription>
        </DialogHeader>

        <Textarea
          value={notiz}
          onChange={(e) => setNotiz(e.target.value)}
          maxLength={RUECKMELDUNG_MAX_ZEICHEN}
          className="min-h-[110px]"
          placeholder="Was passt nicht? Zum Beispiel: fördert nur Print, keine Medien, falsche Region, Absage erhalten."
        />

        <DialogFooter>
          <Button variant="outline" onClick={abbrechen} disabled={beschaeftigt}>
            Abbrechen
          </Button>
          <Button
            onClick={() => {
              onBestaetigen(notiz.trim())
              setNotiz('')
            }}
            disabled={beschaeftigt || zuKurz}
          >
            {beschaeftigt ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Rückmeldung senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
