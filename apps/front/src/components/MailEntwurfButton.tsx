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
import { baueMailtoUrl } from '@/lib/mailto'

/**
 * Zeigt einen Mail-Entwurf (Betreff + Text) in einem Dialog zum Kopieren oder
 * zum Öffnen im eigenen Mail-Programm. Kein automatischer Versand (Entscheid
 * 28.07.2026): die Mail geht aus dem persönlichen Postfach der Bedienerin
 * raus, damit die Antwort des Mediums bei ihr landet.
 *
 * `an` ist optional — beim Onboarding-Willkommensgruss kennt die App die
 * Adresse der Redaktion nicht zwingend; dann öffnet das Mail-Programm ohne
 * Empfänger.
 */
export function MailEntwurfButton({
  betreff,
  text,
  an,
  label = 'Willkommensmail',
  titel = 'Mail-Entwurf',
  size = 'sm',
  variant = 'outline',
}: {
  betreff: string
  text: string
  an?: string
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
              Im Mail-Programm öffnen oder kopieren. Du schickst die Mail selbst — so kommt
              die Antwort direkt zu dir zurück.
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
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => kopieren(text, 'Mailtext')}>
              Text kopieren
            </Button>
            <Button asChild>
              <a href={baueMailtoUrl({ an, betreff, text })}>Im Mail-Programm öffnen</a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
