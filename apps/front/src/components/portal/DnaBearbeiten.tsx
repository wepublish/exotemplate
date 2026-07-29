import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { PORTAL_TEXTE } from '@/lib/portal-texte'
import {
  GEWICHT_LABEL,
  SOUND_FEELING_MAX,
  TAG_GEWICHTE,
  type DnaTagEingabe,
  type TagGewicht,
} from '@/lib/portal-dna-bearbeiten'

/**
 * Bearbeiten-Ansicht der eigenen DNA: Beschreibungstext ändern, Themen
 * entfernen, Themen aus dem Vokabular hinzufügen, Gewicht setzen
 * (Wunsch Ramona 29.07.2026: «ich möchte die DNA manuell anpassen (Text und Tags)»).
 *
 * Die Themen-Auswahl kommt als `vokabular` von der Seite (aus
 * alleVokabularTags, serverseitig gerendert): ein Medium kann nur Themen
 * wählen, die die Match-Engine auch bei Stiftungen kennt — erfundene Themen
 * würden die DNA still entwerten.
 */
export function DnaBearbeiten({
  soundFeelingStart,
  tagsStart,
  vokabular,
  onAbbrechen,
  onGespeichert,
}: {
  soundFeelingStart: string
  tagsStart: DnaTagEingabe[]
  vokabular: Array<{ slug: string; label: string; bereich: string }>
  onAbbrechen: () => void
  onGespeichert: () => void
}) {
  const [soundFeeling, setSoundFeeling] = useState(soundFeelingStart)
  const [tags, setTags] = useState<DnaTagEingabe[]>(tagsStart)
  const [suche, setSuche] = useState('')
  const [speichert, setSpeichert] = useState(false)

  const labelFuer = useMemo(() => new Map(vokabular.map((v) => [v.slug, v.label])), [vokabular])

  const vorschlaege = useMemo(() => {
    const begriff = suche.trim().toLowerCase()
    if (begriff.length < 2) return []
    const gesetzt = new Set(tags.map((t) => t.tag_slug))
    return vokabular
      .filter((v) => !gesetzt.has(v.slug) && (v.label.toLowerCase().includes(begriff) || v.slug.includes(begriff)))
      .slice(0, 8)
  }, [suche, tags, vokabular])

  function entferne(slug: string) {
    setTags((prev) => prev.filter((t) => t.tag_slug !== slug))
  }

  function fuegeHinzu(slug: string) {
    setTags((prev) => (prev.some((t) => t.tag_slug === slug) ? prev : [...prev, { tag_slug: slug, gewicht: 2, begruendung: '' }]))
    setSuche('')
  }

  function setzeGewicht(slug: string, gewicht: TagGewicht) {
    setTags((prev) => prev.map((t) => (t.tag_slug === slug ? { ...t, gewicht } : t)))
  }

  async function speichere() {
    setSpeichert(true)
    try {
      const res = await fetch('/api/portal/dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aktion: 'anpassen', sound_feeling: soundFeeling, tags }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; version?: number }
      if (!res.ok) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(PORTAL_TEXTE['dna.bearbeiten_gespeichert'])
      onGespeichert()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSpeichert(false)
    }
  }

  return (
    <div className="space-y-5 rounded-xl border border-indigo-200 bg-white p-6">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{PORTAL_TEXTE['dna.bearbeiten_titel']}</h2>
        <p className="mt-1 text-sm text-slate-500">{PORTAL_TEXTE['dna.bearbeiten_hinweis']}</p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">{PORTAL_TEXTE['dna.bearbeiten_text_label']}</label>
        <Textarea
          value={soundFeeling}
          onChange={(e) => setSoundFeeling(e.target.value)}
          maxLength={SOUND_FEELING_MAX}
          className="min-h-[140px]"
        />
        <p className="mt-1 text-[11px] text-slate-400">
          {soundFeeling.trim().length} / {SOUND_FEELING_MAX} Zeichen
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-600">{PORTAL_TEXTE['dna.bearbeiten_tags_label']}</label>
        {tags.length === 0 && <p className="text-sm text-amber-700">{PORTAL_TEXTE['dna.bearbeiten_tags_leer']}</p>}
        <ul className="space-y-1.5">
          {tags.map((t) => (
            <li key={t.tag_slug} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{labelFuer.get(t.tag_slug) ?? t.tag_slug}</span>
              <div className="flex shrink-0 gap-1">
                {TAG_GEWICHTE.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setzeGewicht(t.tag_slug, g)}
                    className={[
                      'rounded-md border px-2 py-0.5 text-[11px] transition-colors',
                      t.gewicht === g
                        ? 'border-indigo-300 bg-indigo-100 text-indigo-800'
                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    {GEWICHT_LABEL[g]}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-slate-400 hover:text-red-600"
                onClick={() => entferne(t.tag_slug)}
                title="Thema entfernen"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>

        <div className="relative">
          <Input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder={PORTAL_TEXTE['dna.bearbeiten_tag_suche']}
            className="text-sm"
          />
          {vorschlaege.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-md">
              {vorschlaege.map((v) => (
                <li key={v.slug}>
                  <button
                    type="button"
                    className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50"
                    onClick={() => fuegeHinzu(v.slug)}
                  >
                    <span className="min-w-0 truncate text-slate-800">{v.label}</span>
                    <Badge variant="outline" className="shrink-0 border-slate-200 bg-slate-50 text-[10px] text-slate-400">
                      {v.bereich}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void speichere()} disabled={speichert || tags.length === 0 || soundFeeling.trim().length < 20}>
          {speichert ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
          {PORTAL_TEXTE['dna.bearbeiten_speichern']}
        </Button>
        <Button variant="ghost" onClick={onAbbrechen} disabled={speichert}>
          Abbrechen
        </Button>
      </div>
    </div>
  )
}
