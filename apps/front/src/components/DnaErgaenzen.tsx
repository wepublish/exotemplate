import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DnaBearbeiten } from '@/components/portal/DnaBearbeiten'
import type { DnaTagEingabe, TagGewicht } from '@/lib/portal-dna-bearbeiten'

/**
 * Operator-Sicht: die aktive DNA eines Mediums im Cockpit ergänzen
 * (Wunsch Jolanda 29.07.2026: «ich finde noch gut, wenn ramona und ich für die
 * medien die dna ergänzen können»).
 *
 * Nutzt bewusst dieselbe Bearbeiten-Oberfläche wie das Portal
 * (components/portal/DnaBearbeiten) — die Eingabe-Regeln (nur Themen aus dem
 * Vokabular, Text ≥ 20 Zeichen) sind identisch, weil es dieselbe DNA ist. Nur
 * der Weg dahin unterscheidet sich: hier kommt der Slug aus dem Cockpit, nicht
 * aus einer Medium-Session, und die neue Version trägt die Herkunft «cockpit».
 *
 * Speichern erzeugt eine NEUE, sofort aktive DNA-Version (nie ein Patch) —
 * Begründung im Modul-Kommentar von portal-dna-bearbeiten.ts.
 */
interface AktiveDna {
  soundFeeling: string
  tags: { tag_slug: string; gewicht: number; begruendung: string }[]
  version: number | null
  schaerfe: number | null
}

export default function DnaErgaenzen({ mediumSlug, mediumName }: { mediumSlug: string; mediumName?: string }) {
  const [dna, setDna] = useState<AktiveDna | null>(null)
  const [vokabular, setVokabular] = useState<Array<{ slug: string; label: string; bereich: string }>>([])
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [offen, setOffen] = useState(false)

  const lade = useCallback(async () => {
    setLaedt(true)
    setFehler(null)
    try {
      // Cache-Buster: Cloudflare cached GET-API-Antworten am Edge (Befund
      // 28.07.2026), no-store allein hat dort nicht genügt.
      const res = await fetch(`/api/medium-dna-anpassen?medium=${encodeURIComponent(mediumSlug)}&t=${Date.now()}`)
      const json = (await res.json().catch(() => ({}))) as {
        dna?: AktiveDna | null
        vokabular?: Array<{ slug: string; label: string; bereich: string }>
        error?: string
      }
      if (!res.ok) {
        setFehler(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      setDna(json.dna ?? null)
      setVokabular(json.vokabular ?? [])
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err))
    } finally {
      setLaedt(false)
    }
  }, [mediumSlug])

  // Beim Medienwechsel neu laden und die Bearbeitung schliessen: sonst stünde
  // im offenen Formular die DNA des vorher gewählten Mediums (dieselbe Falle
  // wie beim Felder-Remount im Onboarding, Befund 28.07.2026).
  useEffect(() => {
    setOffen(false)
    setDna(null)
    void lade()
  }, [lade])

  if (laedt && !dna) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <Loader2 className="h-3 w-3 animate-spin" /> DNA laden …
      </p>
    )
  }

  if (fehler) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
        <span>{fehler}</span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => void lade()}>
          <RefreshCw className="mr-1 h-3 w-3" /> nochmal
        </Button>
      </div>
    )
  }

  if (!dna) {
    return (
      <p className="text-[11px] text-slate-500">
        Noch keine aktive DNA — zuerst messen lassen, danach kann sie hier ergänzt werden.
      </p>
    )
  }

  if (offen) {
    return (
      <DnaBearbeiten
        soundFeelingStart={dna.soundFeeling}
        tagsStart={dna.tags.map(
          (t): DnaTagEingabe => ({
            tag_slug: t.tag_slug,
            gewicht: (t.gewicht === 1 || t.gewicht === 2 || t.gewicht === 3 ? t.gewicht : 2) as TagGewicht,
            begruendung: t.begruendung,
          }),
        )}
        vokabular={vokabular}
        speicherPfad="/api/medium-dna-anpassen"
        zusatzFelder={{ medium: mediumSlug }}
        erfolgsMeldung="DNA ergänzt — die neue Version ist aktiv."
        texte={{
          titel: `DNA von ${mediumName || mediumSlug} ergänzen`,
          hinweis:
            'Beschreibungstext und Themen für das Medium anpassen. Beim Speichern entsteht eine neue Fassung; das Matching rechnet beim nächsten Lauf damit neu, die bisherigen Treffer werden also ersetzt.',
          textLabel: 'Beschreibung des Mediums',
          tagsLabel: 'Themen des Mediums (mit Gewicht)',
          speichern: 'Ergänzte DNA speichern',
        }}
        onAbbrechen={() => setOffen(false)}
        onGespeichert={() => {
          setOffen(false)
          void lade()
        }}
      />
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-500">
          Aktive DNA: <strong className="text-slate-700">v{dna.version ?? '?'}</strong>
          {dna.schaerfe !== null && <> · Schärfe {dna.schaerfe}%</>} · {dna.tags.length} Themen
        </div>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setOffen(true)}>
          <Pencil className="mr-1 h-3 w-3" /> DNA ergänzen
        </Button>
      </div>
      {dna.soundFeeling && (
        <p className="text-[11px] leading-relaxed text-slate-600">
          {dna.soundFeeling.slice(0, 220)}
          {dna.soundFeeling.length > 220 ? ' …' : ''}
        </p>
      )}
      <p className="text-[10px] text-slate-400">
        Text und Themen für das Medium anpassen. Es entsteht eine neue aktive Version; die Treffer werden beim
        nächsten Matching-Lauf neu berechnet.
      </p>
    </div>
  )
}
