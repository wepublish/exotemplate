/**
 * Themen-Filter für die Stiftungsdatenbank (Ramonas Wunsch): Dialog mit einem
 * Accordion pro Themenbereich, Mehrfachauswahl von Themen, gruppenweises
 * Ein-/Ausblenden. Die Auswahl (Slug-Liste) fliesst über onChange nach oben und
 * dort in buildFilter(...) -> serverseitiges Directus-Filtern.
 */
import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { THEMEN_GRUPPEN } from '@/lib/themen-facetten'

export function ThemenFilter({
  ausgewaehlt,
  onChange,
}: {
  ausgewaehlt: string[]
  onChange: (slugs: string[]) => void
}) {
  const [offen, setOffen] = useState(false)
  const set = new Set(ausgewaehlt)

  const toggle = (slug: string) => {
    const next = new Set(set)
    if (next.has(slug)) next.delete(slug)
    else next.add(slug)
    onChange([...next])
  }

  const toggleGruppe = (slugs: string[], alleAktiv: boolean) => {
    const next = new Set(set)
    for (const s of slugs) {
      if (alleAktiv) next.delete(s)
      else next.add(s)
    }
    onChange([...next])
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOffen(true)}
        className="relative"
      >
        <SlidersHorizontal className="w-4 h-4" />
        Themen
        {ausgewaehlt.length > 0 && (
          <span className="ml-1 inline-flex items-center justify-center rounded-full bg-emerald-600 text-white text-[10px] font-semibold h-5 min-w-5 px-1.5">
            {ausgewaehlt.length}
          </span>
        )}
      </Button>

      <Dialog open={offen} onOpenChange={setOffen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nach Themen filtern</DialogTitle>
            <DialogDescription>
              Mehrfachauswahl: Eine Stiftung erscheint, wenn sie mindestens eines der
              gewählten Themen abdeckt. Ganze Bereiche mit «Alle» ein- oder ausblenden.
            </DialogDescription>
          </DialogHeader>

          <Accordion type="multiple" className="w-full">
            {THEMEN_GRUPPEN.map((g) => {
              const slugs = g.facetten.map((f) => f.slug)
              const aktiv = slugs.filter((s) => set.has(s)).length
              const alleAktiv = aktiv === slugs.length
              return (
                <AccordionItem key={g.key} value={g.key}>
                  <AccordionTrigger className="text-sm">
                    <span className="flex-1 text-left">{g.label}</span>
                    {aktiv > 0 && (
                      <span className="mr-2 text-xs font-medium text-emerald-700">
                        {aktiv}/{slugs.length}
                      </span>
                    )}
                  </AccordionTrigger>
                  <AccordionContent>
                    <button
                      type="button"
                      onClick={() => toggleGruppe(slugs, alleAktiv)}
                      className="mb-2 text-xs font-medium text-emerald-700 hover:underline"
                    >
                      {alleAktiv ? 'Alle abwählen' : 'Alle auswählen'}
                    </button>
                    <div className="space-y-1.5">
                      {g.facetten.map((f) => (
                        <label
                          key={f.slug}
                          className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer hover:text-slate-900"
                        >
                          <input
                            type="checkbox"
                            checked={set.has(f.slug)}
                            onChange={() => toggle(f.slug)}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span>{f.label}</span>
                        </label>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>

          <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-100">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange([])}
              disabled={ausgewaehlt.length === 0}
            >
              Zurücksetzen
            </Button>
            <Button type="button" onClick={() => setOffen(false)}>
              Fertig ({ausgewaehlt.length})
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
