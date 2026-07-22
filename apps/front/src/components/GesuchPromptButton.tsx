import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

/**
 * Knopf, der den Copy-paste-Opus-Prompt für ein Medium-Stiftung-Paar holt
 * (/api/gesuch-prompt) und in einem Dialog zum Kopieren zeigt. Das Gold-Gesuch
 * schreibt anschliessend Opus 4.8 in der Claude-App.
 */
export function GesuchPromptButton({
  medium,
  stiftungId,
  stiftungName,
  projektId,
  ziel,
  size = 'sm',
  variant = 'outline',
}: {
  medium: string
  stiftungId: string | number
  stiftungName?: string | null
  projektId?: number | null
  /** Sonder-Förderer-Collection (kirchen|foerderer|lotteriefonds|sponsoren) statt stiftungen */
  ziel?: string | null
  size?: 'sm' | 'default'
  variant?: 'outline' | 'default' | 'ghost'
}) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)

  async function laden() {
    setOpen(true)
    setLoading(true)
    setPrompt('')
    try {
      // stil=verweis: der Prompt VERWEIST auf das Paradegesuch im Drive (statt es
      // einzubetten), damit Opus die Datei in Cowork öffnet und Schrift, Logo und
      // Grafiken sieht.
      const r = await fetch(
        `/api/gesuch-prompt?medium=${encodeURIComponent(medium)}&stiftung_id=${encodeURIComponent(
          String(stiftungId),
        )}&stil=verweis${projektId != null ? `&projekt_id=${encodeURIComponent(String(projektId))}` : ''}${
          ziel ? `&ziel=${encodeURIComponent(ziel)}` : ''
        }`,
      )
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Fehler beim Laden')
      setPrompt(j.prompt)
    } catch (e: unknown) {
      toast.error(`Fehler: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(prompt)
      toast.success('Prompt kopiert — in die Claude-App (Opus 4.8) einfügen')
    } catch {
      toast.error('Kopieren nicht möglich — Text manuell markieren')
    }
  }

  return (
    <>
      <Button size={size} variant={variant} onClick={laden}>
        Gesuch-Prompt
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Gesuch-Prompt für Opus 4.8{stiftungName ? ` — ${stiftungName}` : ''}
            </DialogTitle>
            <DialogDescription>
              In die Claude-App einfügen. Opus schreibt das Gold-Gesuch, dann zurückkopieren.
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <p className="py-8 text-center text-slate-400">Lädt …</p>
          ) : (
            <>
              <Textarea readOnly value={prompt} className="h-80 font-mono text-xs" />
              <div className="flex justify-end">
                <Button onClick={kopieren} disabled={!prompt}>
                  Kopieren
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
