import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImageUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Logo eines Mediums im Cockpit hochladen oder auswechseln
 * (/api/medium-logo-setzen). Wunsch Jolanda 29.07.2026: bis dahin konnte nur
 * das Medium selbst ein Logo einliefern, ein falsches war vom Cockpit aus
 * nicht korrigierbar.
 */
export function LogoSetzenButton({
  mediumSlug,
  hatLogo,
  onGesetzt,
}: {
  mediumSlug: string
  hatLogo?: boolean
  onGesetzt?: (logoUrl: string) => void
}) {
  const [laeuft, setLaeuft] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function hochladen(datei: File) {
    setLaeuft(true)
    try {
      const form = new FormData()
      form.append('file', datei)
      form.append('medium_slug', mediumSlug)
      const res = await fetch('/api/medium-logo-setzen', { method: 'POST', body: form })
      const json = (await res.json()) as { logoUrl?: string; error?: string }
      if (!res.ok || json.error) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(hatLogo ? 'Logo ausgewechselt.' : 'Logo gespeichert.')
      if (json.logoUrl) onGesetzt?.(json.logoUrl)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLaeuft(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={laeuft}
        onClick={() => fileRef.current?.click()}
        title="PNG oder JPG, max 5 MB — ersetzt das bisherige Logo"
      >
        {laeuft ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImageUp className="mr-1.5 h-3.5 w-3.5" />}
        {hatLogo ? 'Logo auswechseln' : 'Logo hochladen'}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const datei = e.target.files?.[0]
          if (datei) void hochladen(datei)
        }}
      />
    </>
  )
}
