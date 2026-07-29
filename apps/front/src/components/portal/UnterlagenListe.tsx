import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  PORTAL_KATEGORIEN,
  gruppiereUnterlagen,
  istBearbeitbar,
  portalKategorieLabel,
  type UnterlagenEintrag,
} from '@/lib/portal-unterlagen'
import { PORTAL_TEXTE } from '@/lib/portal-texte'

/**
 * Übersicht der eingelieferten Unterlagen, nach Kategorie gruppiert, mit
 * Bearbeiten (Titel + Kategorie) und Entfernen je Eintrag.
 *
 * Wunsch Ramona 29.07.2026: «Unklar, wohin Dokumente / hinzugefügte URLs dann
 * gehen → vielleicht oben alle hochgeladenen Dokumente anzeigen», dazu Titel
 * ändern, löschen und taggen. Automatisch eingelesene Einträge (von
 * We.Publish) sind schreibgeschützt und als solche gekennzeichnet — sie
 * entstehen bei jedem DNA-Lauf neu.
 */
/** Wie viele Einträge je Kategorie ohne Klick sichtbar sind. */
const SICHTBAR_JE_GRUPPE = 5

export function UnterlagenListe({
  eintraege,
  onGeaendert,
}: {
  eintraege: UnterlagenEintrag[]
  onGeaendert: () => void
}) {
  const [bearbeiteId, setBearbeiteId] = useState<number | null>(null)
  const [titelEntwurf, setTitelEntwurf] = useState('')
  const [kategorieEntwurf, setKategorieEntwurf] = useState('')
  const [laeuftId, setLaeuftId] = useState<number | null>(null)
  // Pro Kategorie erst die jüngsten paar Einträge zeigen (Befund beim
  // Durchklicken 29.07.2026): zwolf hatte 19 Einträge in einer Kategorie, die
  // Seite war 5 Bildschirme lang und die Upload-Formulare darunter praktisch
  // unerreichbar — bajour mit 140 Artikeln wären über 20 Bildschirme. Was DA
  // ist, soll man sehen (Ramonas Punkt), aber nicht auf Kosten des Arbeitens.
  const [aufgeklappt, setAufgeklappt] = useState<Set<string>>(new Set())

  const gruppen = gruppiereUnterlagen(eintraege)

  function starteBearbeitung(e: UnterlagenEintrag) {
    setBearbeiteId(e.id)
    setTitelEntwurf(e.title)
    setKategorieEntwurf(e.category)
  }

  async function speichere(id: number) {
    if (!titelEntwurf.trim()) {
      toast.error('Der Titel darf nicht leer sein.')
      return
    }
    setLaeuftId(id)
    try {
      const res = await fetch('/api/portal/unterlage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title: titelEntwurf.trim(), category: kategorieEntwurf }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(PORTAL_TEXTE['unterlagen.eintrag_gespeichert'])
      setBearbeiteId(null)
      onGeaendert()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLaeuftId(null)
    }
  }

  async function entferne(e: UnterlagenEintrag) {
    setLaeuftId(e.id)
    try {
      const res = await fetch(`/api/portal/unterlage?id=${e.id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(PORTAL_TEXTE['unterlagen.eintrag_entfernt'])
      onGeaendert()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLaeuftId(null)
    }
  }

  if (eintraege.length === 0) {
    return <p className="text-sm text-slate-400">{PORTAL_TEXTE['unterlagen.liste_leer']}</p>
  }

  return (
    <div className="space-y-5">
      {gruppen.map((gruppe) => (
        <div key={gruppe.key} className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{gruppe.label}</h3>
            <span className="text-xs text-slate-400">{gruppe.eintraege.length}</span>
          </div>

          <ul className="space-y-1.5">
            {(aufgeklappt.has(gruppe.key) ? gruppe.eintraege : gruppe.eintraege.slice(0, SICHTBAR_JE_GRUPPE)).map((e) => {
              const bearbeitbar = istBearbeitbar(e)
              const imBearbeiten = bearbeiteId === e.id
              return (
                <li key={e.id} className="rounded-lg border border-slate-100 px-3 py-2">
                  {imBearbeiten ? (
                    <div className="space-y-2">
                      <Input value={titelEntwurf} onChange={(ev) => setTitelEntwurf(ev.target.value)} className="text-sm" />
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={kategorieEntwurf}
                          onChange={(ev) => setKategorieEntwurf(ev.target.value)}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                        >
                          {PORTAL_KATEGORIEN.map((k) => (
                            <option key={k.key} value={k.key}>
                              {k.label}
                            </option>
                          ))}
                        </select>
                        <Button size="sm" className="h-7 text-xs" disabled={laeuftId === e.id} onClick={() => void speichere(e.id)}>
                          {laeuftId === e.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                          Speichern
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBearbeiteId(null)}>
                          <X className="mr-1 h-3 w-3" />
                          Abbrechen
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{e.title}</p>
                        <p className="text-xs text-slate-400">
                          {portalKategorieLabel(e.category)} · {e.quelle} · {e.datum}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {bearbeitbar ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-slate-400 hover:text-slate-700"
                              title={PORTAL_TEXTE['unterlagen.eintrag_bearbeiten']}
                              onClick={() => starteBearbeitung(e)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-slate-400 hover:text-red-600"
                              title={PORTAL_TEXTE['unterlagen.eintrag_entfernen']}
                              disabled={laeuftId === e.id}
                              onClick={() => void entferne(e)}
                            >
                              {laeuftId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </Button>
                          </>
                        ) : (
                          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] text-slate-400">
                            {PORTAL_TEXTE['unterlagen.automatisch']}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          {gruppe.eintraege.length > SICHTBAR_JE_GRUPPE && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-slate-500 hover:text-slate-800"
              onClick={() =>
                setAufgeklappt((prev) => {
                  const neu = new Set(prev)
                  if (neu.has(gruppe.key)) neu.delete(gruppe.key)
                  else neu.add(gruppe.key)
                  return neu
                })
              }
            >
              {aufgeklappt.has(gruppe.key)
                ? 'weniger zeigen'
                : `alle ${gruppe.eintraege.length} zeigen`}
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}
