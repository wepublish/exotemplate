import { useState } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * Schreibt den Onboarding-Plan des Mediums in einen Slack-Canvas (#faas-admin).
 * Freigabe-Knopf: erst auf Klick. Slack-Token bleibt agentseitig — die App
 * ruft nur /api/onboarding-slack, das an den Host-Adapter weiterleitet.
 */
export function OnboardingSlackButton({
  mediumSlug,
  mediumName,
  website,
}: {
  mediumSlug: string
  mediumName: string
  website?: string | null
}) {
  const [laeuft, setLaeuft] = useState(false)

  async function senden() {
    setLaeuft(true)
    try {
      const r = await fetch('/api/onboarding-slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medium_slug: mediumSlug, medium_name: mediumName, website }),
      })
      const d = await r.json()
      if (d.ok) {
        toast.success(
          d.neu
            ? `Onboarding-Canvas für «${mediumName}» in Slack angelegt`
            : `Onboarding-Canvas für «${mediumName}» aktualisiert`,
        )
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
    <Button variant="outline" size="sm" onClick={senden} disabled={laeuft} className="gap-1.5">
      {laeuft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      Onboarding nach Slack
    </Button>
  )
}
