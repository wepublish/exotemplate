import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PORTAL_TEXTE } from '@/lib/portal-texte'
import type { GesuchVersion } from '@/lib/portal-status'

/**
 * GesuchEditor: Textarea + Versionsliste für den Gesuchtext auf der
 * Portal-Gesuche-Seite (Task 10).
 *
 * `bearbeitbar` steuert, ob die Textarea editierbar ist und die Knöpfe
 * («Speichern», «Als final markieren») erscheinen: true solange der Status
 * 'bereit' oder 'final' ist (deckt sich mit dem Server-Gate in
 * gesuch-text.ts). Ab 'abgeschickt'/'zusage'/'absage' zeigt die Komponente
 * den zuletzt gespeicherten Text nur noch schreibgeschützt (Referenz),
 * ohne Aktionen, ein POST würde die Route ohnehin mit 409 ablehnen.
 *
 * `istFinalMarkiert` blendet den «Als final markieren»-Knopf aus, sobald
 * final_am bereits gesetzt ist (erneutes Markieren wäre wirkungslos); die
 * Textarea bleibt trotzdem editierbar, solange `bearbeitbar` true ist (der
 * Server erlaubt Textänderungen ausdrücklich auch im Status 'final').
 *
 * Reine Darstellungs-/Interaktions-Komponente: die eigentlichen POSTs
 * (/api/portal/gesuch-text, /api/portal/gesuch-aktion) liegen in der Seite
 * (gesuche.tsx), hier nur die beiden Callback-Aufrufe.
 */

interface GesuchEditorProps {
  text: string
  versionen: GesuchVersion[]
  bearbeitbar: boolean
  istFinalMarkiert: boolean
  onSpeichern: (text: string) => void
  onAlsFinalMarkieren: () => void
  speichernLaeuft: boolean
  finalLaeuft: boolean
}

function formatVersionsDatum(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export function GesuchEditor({
  text,
  versionen,
  bearbeitbar,
  istFinalMarkiert,
  onSpeichern,
  onAlsFinalMarkieren,
  speichernLaeuft,
  finalLaeuft,
}: GesuchEditorProps) {
  const [wert, setWert] = useState(text)

  // Der Server-Text ist die Wahrheit: nach jedem Speichern lädt die Seite
  // frisch, und dieser Effekt übernimmt den (identischen) Wert wieder in die
  // Textarea. Ändert sich `text` zwischendurch nicht, bleiben ungespeicherte
  // Tipparbeiten unangetastet (kein Reset bei jedem Render).
  useEffect(() => {
    setWert(text)
  }, [text])

  return (
    <div className="space-y-3">
      <Textarea
        value={wert}
        onChange={(e) => setWert(e.target.value)}
        readOnly={!bearbeitbar}
        className="min-h-[280px] font-mono text-sm"
      />

      {bearbeitbar && (
        <div className="space-y-2">
          {!istFinalMarkiert && <p className="text-xs text-slate-400">{PORTAL_TEXTE['gesuche.final_hinweis']}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => onSpeichern(wert)} disabled={speichernLaeuft || wert === text}>
              {speichernLaeuft && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {PORTAL_TEXTE['gesuche.speichern_knopf']}
            </Button>
            {!istFinalMarkiert && (
              <Button size="sm" variant="outline" onClick={onAlsFinalMarkieren} disabled={finalLaeuft}>
                {finalLaeuft && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {PORTAL_TEXTE['gesuche.final_knopf']}
              </Button>
            )}
          </div>
        </div>
      )}

      {versionen.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-medium text-slate-500">Versionen</p>
          <ul className="space-y-1 text-xs text-slate-500">
            {[...versionen].reverse().map((v, i) => (
              <li key={`${v.ts}-${i}`}>
                {formatVersionsDatum(v.ts)} · {v.von}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
