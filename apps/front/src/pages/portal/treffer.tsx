import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { TrefferKarte } from '@/components/portal/TrefferKarte'
import { ConsentDialog } from '@/components/portal/ConsentDialog'
import { PORTAL_TEXTE } from '@/lib/portal-texte'
import { AUSBLENDE_GRUENDE, type AusblendeGrund } from '@/lib/ausblenden'
import type { PortalTreffer } from '@/lib/portal-treffer'

/**
 * /portal/treffer: kuratierte Stiftungs-Treffer des Mediums (Task 8/9).
 *
 * Lädt GET /api/portal/treffer beim Mount. Drei Zustände jenseits des
 * Ladens: `gesperrt` (Matching noch nicht freigeschaltet, 403), `fehler`
 * (Directus/Netz) und `bereit` (Liste, ggf. leer).
 *
 * «Anschreiben» hat einen Consent-Zwischenschritt (Task 9, erweitert Fix-Runde
 * 1): POST /api/portal/anschreiben ohne consent_bestaetigt; antwortet die
 * Route mit 409 {consent_noetig:true, text} (erstes Gesuch des Mediums oder
 * neue Textversion), öffnet der ConsentDialog mit dem VOLLEN CONSENT_TEXT +
 * Checkbox (voll=true); antwortet sie mit 409 {consent_kurz:true}
 * (Folge-Gesuch, Consent liegt schon in der aktuellen Version vor), öffnet
 * derselbe Dialog mit der Kurzfassung (voll=false, keine Checkbox nötig). In
 * beiden Fällen wird nach Bestätigung derselbe Aufruf mit
 * consent_bestaetigt:true wiederholt. 409 {bereits_vorhanden:true} zeigt
 * einen freundlichen Hinweis statt eines generischen Fehlers. «Nicht
 * relevant» öffnet wie in Task 8 den Grund-Dialog, trifft jetzt aber die
 * echte Route /api/portal/nicht-relevant.
 *
 * `aktionLaeuft` ist ein EINZIGER, seitenweiter Doppel-Submit-Schutz (Fix aus
 * dem Task-8-Review): er wird an TrefferKarte durchgereicht und deaktiviert
 * dort beide Knöpfe, solange irgendeine Aktion (Anschreiben, Consent-
 * Bestätigung oder Nicht-relevant-Bestätigung) läuft. Er bleibt AUCH während
 * der 409-Consent-Antwort gesetzt (Fix-Runde 1: `finally` setzt ihn nicht mehr
 * zurück, wenn der ConsentDialog offen bleibt), sonst liessen sich die
 * Treffer-Karten während der offenen Bestätigung erneut anklicken.
 *
 * KEIN eigenes <PortalLayout>-Wrapping (siehe src/pages/portal/index.tsx):
 * _app.tsx legt den Rahmen für alle /portal/*-Seiten bereits um.
 */

type LadeStatus = 'laden' | 'bereit' | 'fehler' | 'gesperrt'

export default function PortalTrefferSeite() {
  const [treffer, setTreffer] = useState<PortalTreffer[]>([])
  const [status, setStatus] = useState<LadeStatus>('laden')

  const [nichtRelevantTreffer, setNichtRelevantTreffer] = useState<PortalTreffer | null>(null)
  const [gewaehlterGrund, setGewaehlterGrund] = useState<AusblendeGrund | null>(null)
  const [freitext, setFreitext] = useState('')
  // Seitenweiter Doppel-Submit-Schutz (TrefferKarte.disabled): bleibt gesetzt,
  // solange irgendeine Aktion läuft ODER der ConsentDialog offen ist.
  const [aktionLaeuft, setAktionLaeuft] = useState(false)

  const [consentTreffer, setConsentTreffer] = useState<PortalTreffer | null>(null)
  const [consentText, setConsentText] = useState('')
  const [consentVoll, setConsentVoll] = useState(true)
  // Netzwerk-Indikator NUR für den laufenden fetch (steuert die Buttons IM
  // ConsentDialog selbst): anders als aktionLaeuft geht er zwischen dem
  // 409-Öffnen des Dialogs und dem Klick auf «Bestätigen» wieder auf false,
  // sonst liesse sich der Dialog nie bedienen.
  const [bestaetigenLaeuft, setBestaetigenLaeuft] = useState(false)

  const ladeTreffer = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/treffer')
      if (res.status === 403) {
        setStatus('gesperrt')
        return
      }
      if (!res.ok) throw new Error(`treffer: Status ${res.status}`)
      const json = (await res.json()) as { treffer: PortalTreffer[] }
      setTreffer(json.treffer ?? [])
      setStatus('bereit')
    } catch (err) {
      console.error('Treffer: /api/portal/treffer nicht erreichbar', err)
      setStatus('fehler')
    }
  }, [])

  useEffect(() => {
    void ladeTreffer()
  }, [ladeTreffer])

  function schliesseConsentDialog() {
    setConsentTreffer(null)
    setConsentText('')
    setConsentVoll(true)
    // Abschluss des Consent-Zwischenschritts (egal ob durch Erfolg oder
    // Abbrechen): erst hier gibt die Karte den Doppel-Submit-Schutz frei.
    setAktionLaeuft(false)
  }

  async function handleAnschreiben(t: PortalTreffer, consentBestaetigt = false) {
    setAktionLaeuft(true)
    setBestaetigenLaeuft(true)
    try {
      const res = await fetch('/api/portal/anschreiben', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stiftung_id: t.stiftungId, ...(consentBestaetigt ? { consent_bestaetigt: true } : {}) }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        consent_noetig?: boolean
        consent_kurz?: boolean
        text?: string
        bereits_vorhanden?: boolean
      }
      if (res.status === 409 && (json.consent_noetig || json.consent_kurz)) {
        // aktionLaeuft bleibt ABSICHTLICH gesetzt (siehe Modul-Kommentar
        // oben): die Karten bleiben gesperrt, solange der Dialog offen ist.
        // Erst schliesseConsentDialog (Bestätigen-Erfolg oder Abbrechen)
        // setzt ihn zurück.
        setConsentTreffer(t)
        setConsentVoll(!!json.consent_noetig)
        setConsentText(json.text ?? '')
        return
      }
      if (res.status === 409 && json.bereits_vorhanden) {
        toast.error(PORTAL_TEXTE['treffer.bereits_vorhanden_hinweis'])
        void ladeTreffer()
        setAktionLaeuft(false)
        return
      }
      if (!res.ok) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        setAktionLaeuft(false)
        return
      }
      toast.success('Danke, wir bereiten das Gesuch für diese Stiftung vor.')
      schliesseConsentDialog()
      void ladeTreffer()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      setAktionLaeuft(false)
    } finally {
      setBestaetigenLaeuft(false)
    }
  }

  async function handleConsentBestaetigen() {
    if (!consentTreffer) return
    await handleAnschreiben(consentTreffer, true)
  }

  function oeffneNichtRelevantDialog(t: PortalTreffer) {
    setNichtRelevantTreffer(t)
    setGewaehlterGrund(null)
    setFreitext('')
  }

  function schliesseNichtRelevantDialog() {
    setNichtRelevantTreffer(null)
    setGewaehlterGrund(null)
    setFreitext('')
  }

  async function handleNichtRelevantBestaetigen() {
    if (!nichtRelevantTreffer || !gewaehlterGrund) return
    setAktionLaeuft(true)
    try {
      const res = await fetch('/api/portal/nicht-relevant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stiftung_id: nichtRelevantTreffer.stiftungId, grund: gewaehlterGrund.key, freitext }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success('Danke für die Rückmeldung.')
      schliesseNichtRelevantDialog()
      void ladeTreffer()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setAktionLaeuft(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        {/* Kurzes Seiten-Label, kein Fliesstext-Satz: analog STATION_LABEL bewusst nicht in PORTAL_TEXTE. */}
        <h1 className="text-xl font-bold text-slate-900">Treffer</h1>
        <p className="mt-1 text-sm text-slate-500">{PORTAL_TEXTE['treffer.intro']}</p>
        <p className="mt-1 text-xs text-slate-400">{PORTAL_TEXTE['treffer.anschreiben_hinweis']}</p>
      </div>

      {status === 'laden' && <p className="text-sm text-slate-400">Wird geladen …</p>}
      {status === 'fehler' && <p className="text-sm text-slate-500">{PORTAL_TEXTE['fehler.daten_nicht_verfuegbar']}</p>}

      {status === 'gesperrt' && (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-6">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p className="text-sm text-slate-500">{PORTAL_TEXTE['uebersicht.naechster_schritt.freischaltung']}</p>
        </div>
      )}

      {status === 'bereit' && treffer.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <p className="text-sm text-slate-500">{PORTAL_TEXTE['treffer.leer']}</p>
        </div>
      )}

      {status === 'bereit' && treffer.length > 0 && (
        <div className="space-y-3">
          {treffer.map((t) => (
            <TrefferKarte
              key={t.stiftungId}
              treffer={t}
              onAnschreiben={handleAnschreiben}
              onNichtRelevant={oeffneNichtRelevantDialog}
              disabled={aktionLaeuft}
            />
          ))}
        </div>
      )}

      <Dialog open={!!nichtRelevantTreffer} onOpenChange={(open) => !open && schliesseNichtRelevantDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{PORTAL_TEXTE['treffer.nicht_relevant_knopf']}</DialogTitle>
            <DialogDescription>{PORTAL_TEXTE['treffer.nicht_relevant_hinweis']}</DialogDescription>
          </DialogHeader>

          <div className="mt-2 flex flex-col gap-2">
            {AUSBLENDE_GRUENDE.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setGewaehlterGrund(g)}
                className={[
                  'rounded-lg border px-4 py-2.5 text-left text-sm transition-colors',
                  gewaehlterGrund?.key === g.key
                    ? 'border-slate-900 bg-slate-900 font-medium text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50',
                ].join(' ')}
              >
                {g.label}
              </button>
            ))}
          </div>

          <div className="mt-2">
            <Input placeholder="Ergänzung, optional" value={freitext} onChange={(e) => setFreitext(e.target.value)} className="text-sm" />
          </div>

          <DialogFooter className="mt-2 gap-2">
            <Button variant="outline" size="sm" onClick={schliesseNichtRelevantDialog} disabled={aktionLaeuft}>
              Abbrechen
            </Button>
            <Button size="sm" disabled={!gewaehlterGrund || aktionLaeuft} onClick={() => void handleNichtRelevantBestaetigen()}>
              {PORTAL_TEXTE['treffer.nicht_relevant_knopf']}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConsentDialog
        open={!!consentTreffer}
        onOpenChange={(open) => !open && schliesseConsentDialog()}
        voll={consentVoll}
        text={consentText}
        onBestaetigen={() => void handleConsentBestaetigen()}
        bestaetigenLaeuft={bestaetigenLaeuft}
      />
    </div>
  )
}
