import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PORTAL_TEXTE } from '@/lib/portal-texte'

/**
 * /portal/login: Magic-Link-Anmeldung für Medien. Aussen vor dem
 * PortalLayout (kein Nav, keine Medium-Kopfzeile), gleiche Optik
 * (zentrierte Karte, Wortmarke), aber eigenständig, weil vor dem Login
 * weder Session noch Medium bekannt sind.
 *
 * POST /api/portal/login-anfordern antwortet immer mit {status:'ok'}, egal
 * ob die Adresse existiert (kein E-Mail-Enumerieren): die Bestätigung ist
 * darum immer dieselbe.
 */
export default function PortalLoginSeite() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [angefordert, setAngefordert] = useState(false)
  const [sendet, setSendet] = useState(false)

  const zeigeFehler = router.query.fehler === '1' && !angefordert

  async function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!email.trim() || sendet) return
    setSendet(true)
    try {
      await fetch('/api/portal/login-anfordern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
    } catch (err: unknown) {
      // login-anfordern antwortet auch bei internem Fehler mit 200/ok; ein
      // Netzfehler auf dem Weg dorthin zeigt trotzdem die Bestätigung, nie
      // eine technische Fehlermeldung (kein E-Mail-Enumerieren, ruhiger Ton).
      console.error('Login-Anfrage nicht zugestellt', err)
    } finally {
      setSendet(false)
      setAngefordert(true)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/portal/marke/icon-192.png" alt="We.Publish" className="h-8 w-8 rounded-md" />
          <span className="font-bold text-slate-900">We.Publish</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">· Fundraising</span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {zeigeFehler && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {PORTAL_TEXTE['login.fehler']}
            </div>
          )}

          <h1 className="text-lg font-bold text-slate-900">{PORTAL_TEXTE['login.titel']}</h1>
          <p className="mt-2 text-sm text-slate-500">{PORTAL_TEXTE['login.intro']}</p>

          {angefordert ? (
            <p className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              {PORTAL_TEXTE['login.link_angefordert']}
            </p>
          ) : (
            <form onSubmit={absenden} className="mt-6 space-y-3">
              <Input
                type="email"
                required
                autoFocus
                placeholder="euer-name@medium.ch"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button type="submit" disabled={sendet} className="w-full">
                {sendet ? 'Einen Moment …' : 'Anmeldelink senden'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
