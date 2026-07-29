import { useEffect, useState } from 'react'
import { usePortalMe } from '@/components/portal/PortalLayout'
import { PORTAL_TEXTE, baueSlackVerweis, fuelleText } from '@/lib/portal-texte'
import { SchrittInfo } from '@/components/portal/SchrittInfo'
import { baueAnzeigeSchritte, type Station, type Reminder } from '@/lib/portal-status'

/**
 * /portal (Übersicht): Fortschrittsleiste über die 5 Stationen, «Nächster
 * Schritt»-Karte, Nachfass-Reminder und Kontaktblock. Die Medium-Daten
 * kommen aus dem PortalLayout-Context (kein zweiter /me-Fetch), die
 * Stationen aus /api/portal/uebersicht.
 *
 * KEIN eigenes <PortalLayout>-Wrapping hier: _app.tsx legt PortalLayout für
 * alle /portal/*-Routen (ausser /portal/login) bereits UM diese Seite. Erst
 * dadurch ist die Seite ein echter Nachfahre von PortalLayouts Context, und
 * usePortalMe() liest den tatsächlichen Medium-Stand statt immer null.
 */

type UebersichtAntwort = {
  stationen: Station[]
  naechsterSchritt: string
  reminder: Reminder[]
  /** faas_medien.slack_channel — Ziel des Kontaktblocks (Slack statt Mail). */
  slackKanal?: string | null
}
type LadeStatus = 'laden' | 'bereit' | 'fehler'

function stationStil(status: Station['status']): { kreis: string; label: string } {
  if (status === 'erledigt') return { kreis: 'bg-indigo-500 text-white', label: 'text-slate-700' }
  if (status === 'aktiv') return { kreis: 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-500', label: 'text-slate-900' }
  return { kreis: 'bg-slate-100 text-slate-400', label: 'text-slate-400' }
}

/**
 * Fortschrittsleiste über die VIER Schritte, die auch als Reiter oben stehen
 * (baueAnzeigeSchritte). Vorher zeigte sie sechs Stationen und damit andere
 * Nummern als die Reiter — «3. Treffer» im Reiter war hier die 5.
 */
function Fortschrittsleiste({ stationen }: { stationen: Station[] }) {
  const schritte = baueAnzeigeSchritte(stationen)
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center">
        {schritte.map((schritt, i) => {
          const stil = stationStil(schritt.status)
          return (
            <div key={schritt.nummer} className="flex flex-1 items-center">
              <div className="flex min-w-0 flex-col items-center gap-1.5">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${stil.kreis}`}>
                  {schritt.status === 'erledigt' ? '✓' : schritt.nummer}
                </div>
                <span className={`whitespace-nowrap text-center text-[11px] font-medium ${stil.label}`}>
                  {schritt.nummer}. {schritt.label}
                </span>
              </div>
              {i < schritte.length - 1 && (
                <div className={`mx-1 h-0.5 flex-1 ${schritt.status === 'erledigt' ? 'bg-indigo-500' : 'bg-slate-100'}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function PortalUebersichtSeite() {
  const me = usePortalMe()
  const [uebersicht, setUebersicht] = useState<UebersichtAntwort | null>(null)
  // Slack-Verweis fuer den Kontaktblock; leer, solange kein Kanal hinterlegt ist.
  const slackVerweis = baueSlackVerweis(uebersicht?.slackKanal)
  const [status, setStatus] = useState<LadeStatus>('laden')

  useEffect(() => {
    let abgebrochen = false
    fetch(`/api/portal/uebersicht?cb=${Date.now()}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`uebersicht: Status ${res.status}`)
        const daten = (await res.json()) as UebersichtAntwort
        if (!abgebrochen) {
          setUebersicht(daten)
          setStatus('bereit')
        }
      })
      .catch((err: unknown) => {
        console.error('Übersicht: /api/portal/uebersicht nicht erreichbar', err)
        if (!abgebrochen) setStatus('fehler')
      })
    return () => {
      abgebrochen = true
    }
  }, [])

  const willkommen = me
    ? fuelleText(PORTAL_TEXTE['uebersicht.willkommen'], { medium: me.medium.name })
    : PORTAL_TEXTE['uebersicht.willkommen']

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{willkommen}</h1>
        <p className="mt-1 text-sm text-slate-500">{PORTAL_TEXTE['uebersicht.stationen_intro']}</p>
      </div>

      <SchrittInfo titel={PORTAL_TEXTE['uebersicht.info_titel']}>
        <p>{PORTAL_TEXTE['uebersicht.info_text']}</p>
      </SchrittInfo>

      {status === 'laden' && <p className="text-sm text-slate-400">Wird geladen …</p>}
      {status === 'fehler' && <p className="text-sm text-slate-500">{PORTAL_TEXTE['fehler.daten_nicht_verfuegbar']}</p>}

      {uebersicht && (
        <>
          <Fortschrittsleiste stationen={uebersicht.stationen} />

          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">Nächster Schritt</p>
            <p className="mt-1 text-sm text-indigo-900">{uebersicht.naechsterSchritt}</p>
          </div>

          {uebersicht.reminder.length > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600">Erinnerung</p>
              {uebersicht.reminder.map((r, i) => (
                <p key={i} className="text-sm text-amber-900">
                  {r.text}
                </p>
              ))}
            </div>
          )}
        </>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Eure Ansprechpartnerinnen bei We.Publish
        </p>
        {/*
          Slack statt Mail (Wunsch Michael Scheurer, 28.07.2026): alle
          Kommunikation an einem Ort, damit niemand am eigenen Postfach klebt
          und Ferien moeglich sind. Ohne hinterlegten Kanal bleibt der Hinweis
          allgemein, statt auf einen toten Link zu zeigen.
        */}
        <p className="mt-1 text-sm text-slate-600">
          Fragen? Schreibt uns in eurem Slack-Kanal, dort sind wir alle erreichbar
          {slackVerweis.startsWith('http') ? (
            <>
              :{' '}
              <a href={slackVerweis} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                Kanal öffnen
              </a>
            </>
          ) : slackVerweis ? (
            <> ({slackVerweis})</>
          ) : (
            <> im We.Publish-Slack</>
          )}
          .
        </p>
      </div>
    </div>
  )
}
