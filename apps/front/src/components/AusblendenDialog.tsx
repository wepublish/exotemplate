import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AUSBLENDE_GRUENDE, type AusblendeGrund } from '@/lib/ausblenden'

// ─── Props ────────────────────────────────────────────────────────────────────

interface AusblendenDialogProps {
  offen: boolean
  stiftungName: string
  beschaeftigt: boolean
  onAbbrechen: () => void
  onBestaetigen: (grund: AusblendeGrund, freitext: string) => void
}

// ─── Komponente ───────────────────────────────────────────────────────────────

export function AusblendenDialog({
  offen,
  stiftungName,
  beschaeftigt,
  onAbbrechen,
  onBestaetigen,
}: AusblendenDialogProps) {
  const [gewaehlterGrund, setGewaehlterGrund] = useState<AusblendeGrund | null>(null)
  const [freitext, setFreitext] = useState('')

  function handleOeffnen(open: boolean) {
    if (!open) {
      // Zustand zurücksetzen wenn Dialog geschlossen wird
      setGewaehlterGrund(null)
      setFreitext('')
      onAbbrechen()
    }
  }

  function handleBestaetigen() {
    if (!gewaehlterGrund || beschaeftigt) return
    onBestaetigen(gewaehlterGrund, freitext)
    // Zustand zurücksetzen
    setGewaehlterGrund(null)
    setFreitext('')
  }

  return (
    <Dialog open={offen} onOpenChange={handleOeffnen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Match ausblenden</DialogTitle>
          <DialogDescription>
            {stiftungName} wird nicht mehr vorgeschlagen. Der Grund fliesst ins Lern-Gedächtnis.
          </DialogDescription>
        </DialogHeader>

        {/* Grund-Auswahl */}
        <div className="flex flex-col gap-2 mt-2">
          {AUSBLENDE_GRUENDE.map(g => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGewaehlterGrund(g)}
              className={[
                'text-left px-4 py-2.5 rounded-lg border text-sm transition-colors',
                gewaehlterGrund?.key === g.key
                  ? 'border-slate-900 bg-slate-900 text-white font-medium'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50',
              ].join(' ')}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Freitext */}
        <div className="mt-2">
          <Input
            placeholder="Ergänzung, optional"
            value={freitext}
            onChange={e => setFreitext(e.target.value)}
            className="text-sm"
          />
        </div>

        <DialogFooter className="mt-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOeffnen(false)}
            disabled={beschaeftigt}
          >
            Abbrechen
          </Button>
          <Button
            size="sm"
            className="bg-slate-900 hover:bg-slate-800 text-white"
            disabled={!gewaehlterGrund || beschaeftigt}
            onClick={handleBestaetigen}
          >
            Ausblenden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
