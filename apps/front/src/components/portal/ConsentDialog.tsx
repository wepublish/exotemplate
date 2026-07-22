import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { PORTAL_TEXTE } from '@/lib/portal-texte'

/**
 * ConsentDialog: Zustimmung zur Provisionsregelung, bevor We.Publish ein
 * Gesuch für eine Stiftung anfordert (Task 9, verdrahtet in
 * src/pages/portal/treffer.tsx).
 *
 * Zwei Varianten, gesteuert über `voll`:
 * - `voll=true` (Voll-Consent nötig, siehe brauchtVollConsent in consent.ts):
 *   Scrollbox mit dem vollen `text` (die 409-Antwort von
 *   /api/portal/anschreiben liefert dafür CONSENT_TEXT mit), Checkbox «Wir
 *   bestätigen die Provisionsregelung» muss gesetzt sein, bevor «Bestätigen»
 *   aktiv wird.
 * - `voll=false` (Kurzfassung für Folge-Gesuche): kurzer Erinnerungstext
 *   (PORTAL_TEXTE['consent.kurzfassung']), Bestätigung ohne Checkbox-Zwang,
 *   denn die Bedingungen wurden bereits einmal vollständig gelesen und
 *   akzeptiert.
 *
 * Erreichbarkeit der Kurzfassung (Fix-Runde 1, siehe Task-9-Report): der
 * serverseitige Gate unterscheidet jetzt DREI Fälle. `brauchtVollConsent`
 * true ⇒ 409 {consent_noetig:true} (dieser Dialog öffnet mit `voll=true`);
 * `brauchtVollConsent` false, aber `consent_bestaetigt` fehlt im Body ⇒ 409
 * {consent_kurz:true} (öffnet mit `voll=false`); `consent_bestaetigt:true` ⇒
 * die Anfrage geht durch. So bekommt JEDES Gesuch (erstes = Volltext, jedes
 * weitere = Kurzfassung) eine eigene protokollierte consent_log-Zeile.
 *
 * Reine Präsentationskomponente: schreibt nichts selbst, ruft bei
 * Bestätigung nur `onBestaetigen` auf; der eigentliche POST (mit
 * consent_bestaetigt:true) lebt in der Seite.
 */

interface ConsentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  voll: boolean
  text: string
  onBestaetigen: () => void
  bestaetigenLaeuft?: boolean
}

/**
 * Rendert CONSENT_TEXT lesbar: Absätze (durch Leerzeile getrennt), die mit
 * "## " beginnen, werden als fette Zwischenüberschrift dargestellt (Präfix
 * nur für die Anzeige entfernt). Der zugrunde liegende String bleibt
 * unverändert der wörtliche Consent-Text.
 */
function ConsentBloecke({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\n+/).map((block, i) =>
        block.startsWith('## ') ? (
          <p key={i} className="mt-4 text-sm font-semibold text-slate-900 first:mt-0">
            {block.slice(3)}
          </p>
        ) : (
          <p key={i} className="mt-1.5 text-sm leading-relaxed text-slate-700">
            {block}
          </p>
        ),
      )}
    </>
  )
}

export function ConsentDialog({ open, onOpenChange, voll, text, onBestaetigen, bestaetigenLaeuft }: ConsentDialogProps) {
  const [bestaetigt, setBestaetigt] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next) setBestaetigt(false)
    onOpenChange(next)
  }

  const kannBestaetigen = voll ? bestaetigt : true

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{PORTAL_TEXTE['consent.titel']}</DialogTitle>
        </DialogHeader>

        {voll ? (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
            <ConsentBloecke text={text} />
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-slate-700">{PORTAL_TEXTE['consent.kurzfassung']}</p>
        )}

        {voll && (
          <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={bestaetigt}
              onChange={(e) => setBestaetigt(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            {PORTAL_TEXTE['consent.checkbox_label']}
          </label>
        )}

        <DialogFooter className="mt-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={bestaetigenLaeuft}>
            {PORTAL_TEXTE['consent.abbrechen_knopf']}
          </Button>
          <Button size="sm" disabled={!kannBestaetigen || bestaetigenLaeuft} onClick={onBestaetigen}>
            {PORTAL_TEXTE['consent.bestaetigen_knopf']}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
