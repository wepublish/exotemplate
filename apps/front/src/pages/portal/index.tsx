import { useEffect, useState } from 'react'
import { usePortalMe } from '@/components/portal/PortalLayout'
import { PORTAL_TEXTE, fuelleText } from '@/lib/portal-texte'
import { STATION_REIHENFOLGE, STATION_LABEL, type Station, type Reminder } from '@/lib/portal-status'

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

type UebersichtAntwort = { stationen: Station[]; naechsterSchritt: string; reminder: Reminder[] }
type LadeStatus = 'laden' | 'bereit' | 'fehler'

function stationStil(status: Station['status']): { kreis: string; label: string } {
  if (status === 'erledigt') return { kreis: 'bg-indigo-500 text-white', label: 'text-slate-700' }
  if (status === 'aktiv') return { kreis: 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-500', label: 'text-slate-900' }
  return { kreis: 'bg-slate-100 text-slate-400', label: 'text-slate-400' }
}

function Fortschrittsleiste({ stationen }: { stationen: Station[] }) {
  // Feste Anzeige-Reihenfolge statt der API-Reihenfolge zu vertrauen: die
  // Leiste bleibt stabil, selbst wenn die Route irgendwann anders sortiert.
  const geordnet = STATION_REIHENFOLGE.map((key) => stationen.find((s) => s.key === key)).filter(
    (s): s is Station => s != null,
  )
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center">
        {geordnet.map((station, i) => {
          const stil = stationStil(station.status)
          return (
            <div key={station.key} className="flex flex-1 items-center">
              <div className="flex min-w-0 flex-col items-center gap-1.5">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${stil.kreis}`}>
                  {station.status === 'erledigt' ? '✓' : i + 1}
                </div>
                <span className={`whitespace-nowrap text-center text-[11px] font-medium ${stil.label}`}>
                  {STATION_LABEL[station.key]}
                </span>
              </div>
              {i < geordnet.length - 1 && (
                <div className={`mx-1 h-0.5 flex-1 ${station.status === 'erledigt' ? 'bg-indigo-500' : 'bg-slate-100'}`} />
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
        <p className="mt-1 text-sm text-slate-600">
          Fragen? Schreibt uns an{' '}
          <a href="mailto:fundraising@wepublish.ch" className="text-indigo-600 hover:underline">
            fundraising@wepublish.ch
          </a>
          .
        </p>
      </div>
    </div>
  )
}
