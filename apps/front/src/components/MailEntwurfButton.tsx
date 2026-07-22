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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

/**
 * Zeigt einen Mail-Entwurf (Betreff + Text) in einem Dialog zum Kopieren.
 * Copy-paste in Gmail; die Nutzerin passt vor dem Versand an. Kein Auto-Versand.
 */
export function MailEntwurfButton({
  betreff,
  text,
  label = 'Willkommensmail',
  titel = 'Mail-Entwurf',
  size = 'sm',
  variant = 'outline',
}: {
  betreff: string
  text: string
  label?: string
  titel?: string
  size?: 'sm' | 'default'
  variant?: 'outline' | 'default' | 'ghost'
}) {
  const [open, setOpen] = useState(false)

  async function kopieren(was: string, label: string) {
    try {
      await navigator.clipboard.writeText(was)
      toast.success(`${label} kopiert`)
    } catch {
      toast.error('Kopieren nicht möglich — Text manuell markieren')
    }
  }

  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{titel}</DialogTitle>
            <DialogDescription>
              Copy-paste in Gmail. Vor dem Versand anpassen — kein automatischer Versand.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">Betreff</p>
            <div className="flex gap-2">
              <Input readOnly value={betreff} className="text-sm" />
              <Button size="sm" variant="outline" onClick={() => kopieren(betreff, 'Betreff')}>
                Kopieren
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">Text</p>
            <Textarea readOnly value={text} className="h-72 text-sm" />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => kopieren(text, 'Mailtext')}>Text kopieren</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
