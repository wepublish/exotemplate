import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Postet die Onboarding-Einladung in den Slack-Kanal des Mediums
 * (/api/einladung-slack → Spark-Adapter → chat.postMessage in
 * faas_medien.slack_channel). Wunsch Ramona 29.07.2026: die Kommunikation soll
 * von Anfang an im Kanal liegen, nicht in einem Postfach.
 *
 * Unterschied zum OnboardingSlackButton: der schreibt den Onboarding-CANVAS
 * (Arbeitsblatt für We.Publish), dieser die EINLADUNG an das Medium.
 */
export function EinladungSlackButton({
  mediumSlug,
  mediumName,
  variant = 'outline',
}: {
  mediumSlug: string
  mediumName: string
  variant?: 'outline' | 'default'
}) {
  const [laeuft, setLaeuft] = useState(false)

  async function senden() {
    setLaeuft(true)
    try {
      const r = await fetch('/api/einladung-slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medium_slug: mediumSlug, medium_name: mediumName }),
      })
      const d = (await r.json()) as { ok?: boolean; note?: string }
      if (d.ok) {
        toast.success(`Einladung für «${mediumName}» in Slack gepostet`)
      } else {
        toast.error(`Slack: ${d.note ?? 'nicht ausgeführt'}`)
      }
    } catch (err) {
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <Button size="sm" variant={variant} disabled={laeuft} onClick={() => void senden()} title="Einladung in den Slack-Kanal des Mediums posten">
      {laeuft ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="mr-1.5 h-3.5 w-3.5" />}
      Einladung in Slack
    </Button>
  )
}
