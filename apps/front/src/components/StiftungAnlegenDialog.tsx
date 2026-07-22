import { useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { validiereStiftungEingabe, type StiftungLand } from '@/lib/stiftung-anlegen'

/**
 * Dialog zum manuellen Anlegen einer Stiftung im Pool. Legt den Eintrag an und
 * stösst (server-seitig) sofort eine DNA-Messung auf dem Spark an → in wenigen
 * Minuten matchbar. Funktioniert auch für internationale Stiftungen.
 */
export function StiftungAnlegenDialog({ onAngelegt }: { onAngelegt?: () => void }) {
  const [offen, setOffen] = useState(false)
  const [name, setName] = useState('')
  const [webseite, setWebseite] = useState('')
  const [land, setLand] = useState<StiftungLand>('CH')
  const [sitz, setSitz] = useState('')
  const [beschaeftigt, setBeschaeftigt] = useState(false)

  function reset() {
    setName(''); setWebseite(''); setLand('CH'); setSitz('')
  }

  async function anlegen() {
    const fehler = validiereStiftungEingabe({ name, webseite })
    if (fehler.length > 0) {
      toast.error(fehler[0].meldung)
      return
    }
    setBeschaeftigt(true)
    try {
      const res = await fetch('/api/stiftung-anlegen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, webseite, land, sitz }),
      })
      const j = await res.json()
      if (!res.ok) {
        const msg = j?.fehler?.[0]?.meldung ?? j?.error ?? `HTTP ${res.status}`
        toast.error(`Anlegen fehlgeschlagen: ${msg}`)
        return
      }
      const messHinweis =
        j.mess_status === 'gestartet'
          ? ' · DNA-Messung läuft (in wenigen Minuten matchbar)'
          : j.mess_status === 'läuft bereits'
          ? ' · DNA-Messung läuft bereits'
          : ' · DNA wird beim nächsten Pool-Lauf gemessen'
      toast.success(`«${name}» angelegt${messHinweis}`)
      reset()
      setOffen(false)
      onAngelegt?.()
    } catch (e: unknown) {
      toast.error(`Anlegen fehlgeschlagen: ${e instanceof Error ? e.message : 'unbekannt'}`)
    } finally {
      setBeschaeftigt(false)
    }
  }

  return (
    <Dialog open={offen} onOpenChange={o => { setOffen(o); if (!o) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white">
          <Plus className="w-4 h-4 mr-1.5" />
          Stiftung hinzufügen
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Stiftung manuell hinzufügen</DialogTitle>
          <DialogDescription>
            Wird in den Pool aufgenommen; die DNA wird sofort auf dem Spark gemessen,
            damit sie ins Matching kommt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-1">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="z.B. Porticus" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Webseite</label>
            <Input value={webseite} onChange={e => setWebseite(e.target.value)} placeholder="z.B. porticus.com" />
          </div>
          <div className="flex gap-3">
            <div className="w-32">
              <label className="text-xs font-medium text-slate-600 mb-1 block">Land</label>
              <Select value={land} onValueChange={v => setLand(v as StiftungLand)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CH">Schweiz</SelectItem>
                  <SelectItem value="AT">Österreich</SelectItem>
                  <SelectItem value="DE">Deutschland</SelectItem>
                  <SelectItem value="INT">International</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-slate-600 mb-1 block">Sitz (optional)</label>
              <Input value={sitz} onChange={e => setSitz(e.target.value)} placeholder="z.B. Amsterdam" />
            </div>
          </div>
        </div>

        <DialogFooter className="mt-3 gap-2">
          <Button variant="outline" size="sm" onClick={() => setOffen(false)} disabled={beschaeftigt}>
            Abbrechen
          </Button>
          <Button
            size="sm"
            className="bg-slate-900 hover:bg-slate-800 text-white"
            disabled={beschaeftigt}
            onClick={anlegen}
          >
            {beschaeftigt ? 'Lege an…' : 'Anlegen & messen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
