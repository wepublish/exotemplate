import { useState } from 'react'
import { FileText, Plus, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { FormularFeld } from '@/lib/gesuch-prompt'

const ARTEN = [
  { value: 'online_formular', label: 'Online-Formular' },
  { value: 'email', label: 'E-Mail' },
  { value: 'post', label: 'Post / PDF' },
  { value: 'unbekannt', label: 'Unbekannt' },
]

/**
 * Manuelle Erfassung der Einreichungs-Formularstruktur einer Stiftung.
 * Wird vom Gesuch-Prompt gelesen, damit Opus den Text feldweise (mit Längenvorgaben)
 * liefert statt als Fliesstext. Kein LLM, kein Versand — reine Dateneingabe.
 */
export function FormularErfassung({ stiftungId, stiftungName }: { stiftungId: string; stiftungName: string }) {
  const [open, setOpen] = useState(false)
  const [art, setArt] = useState('online_formular')
  const [hinweis, setHinweis] = useState('')
  const [felder, setFelder] = useState<FormularFeld[]>([])
  const [laden, setLaden] = useState(false)
  const [speichern, setSpeichern] = useState(false)
  const [geladen, setGeladen] = useState(false)

  async function laden_() {
    setLaden(true)
    try {
      const r = await fetch(`/api/stiftung-formular?stiftung_id=${encodeURIComponent(stiftungId)}`)
      const d = await r.json()
      const e = d.einreichung ?? {}
      setArt(typeof e.art === 'string' && e.art ? e.art : 'online_formular')
      setHinweis(typeof e.hinweis === 'string' ? e.hinweis : '')
      setFelder(Array.isArray(e.felder) ? e.felder : [])
    } catch {
      toast.error('Konnte die Formularstruktur nicht laden.')
    } finally {
      setLaden(false)
      setGeladen(true)
    }
  }

  function onOpenChange(o: boolean) {
    setOpen(o)
    if (o && !geladen) laden_()
  }

  function setFeld(i: number, patch: Partial<FormularFeld>) {
    setFelder(prev => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }
  function addFeld() {
    setFelder(prev => [...prev, { feld: '', max: null, einheit: 'zeichen', hinweis: '' }])
  }
  function delFeld(i: number) {
    setFelder(prev => prev.filter((_, idx) => idx !== i))
  }

  async function sichern() {
    setSpeichern(true)
    try {
      const r = await fetch('/api/stiftung-formular', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stiftung_id: stiftungId, einreichung: { art, hinweis, felder } }),
      })
      if (!r.ok) throw new Error(String(r.status))
      toast.success('Einreichungs-Formular gespeichert — fliesst in den Gesuch-Prompt')
      setOpen(false)
    } catch {
      toast.error('Speichern fehlgeschlagen.')
    } finally {
      setSpeichern(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FileText className="h-4 w-4" />
          Einreichungs-Formular
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Einreichungs-Formular · {stiftungName}</DialogTitle>
        </DialogHeader>
        {laden ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> lädt …
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              Trage die Felder des Einreichungs-Formulars manuell ein (mit Längenvorgaben). Der Gesuch-Prompt
              weist Opus dann an, den Text feldweise und formgerecht portioniert zu liefern.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 shrink-0 w-20">Art:</span>
              <Select value={art} onValueChange={setArt}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ARTEN.map(a => (
                    <SelectItem key={a.value} value={a.value} className="text-sm">{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              {felder.length === 0 && (
                <p className="text-xs text-slate-400">Noch keine Felder erfasst.</p>
              )}
              {felder.map((f, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Feldname (z.B. Projektbeschreibung)"
                      value={f.feld}
                      onChange={e => setFeld(i, { feld: e.target.value })}
                      className="text-sm"
                    />
                    <button onClick={() => delFeld(i)} className="text-slate-400 hover:text-rose-600 shrink-0">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder="max"
                      value={f.max ?? ''}
                      onChange={e => setFeld(i, { max: e.target.value ? Number(e.target.value) : null })}
                      className="text-sm w-24"
                    />
                    <Select
                      value={f.einheit ?? 'zeichen'}
                      onValueChange={v => setFeld(i, { einheit: v as FormularFeld['einheit'] })}
                    >
                      <SelectTrigger className="text-sm w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="zeichen" className="text-sm">Zeichen</SelectItem>
                        <SelectItem value="woerter" className="text-sm">Wörter</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Hinweis (optional)"
                      value={f.hinweis ?? ''}
                      onChange={e => setFeld(i, { hinweis: e.target.value })}
                      className="text-sm flex-1"
                    />
                  </div>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={addFeld} className="gap-1.5 text-indigo-600">
                <Plus className="h-4 w-4" /> Feld hinzufügen
              </Button>
            </div>
            <Textarea
              placeholder="Allgemeiner Hinweis zur Einreichung (z.B. Portal-URL, Frist, Eigenheiten)"
              value={hinweis}
              onChange={e => setHinweis(e.target.value)}
              className="h-16 text-sm"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={sichern} disabled={speichern} className="gap-1.5">
                {speichern && <Loader2 className="h-4 w-4 animate-spin" />}
                Speichern
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
