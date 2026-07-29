import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { Lock, LogOut } from 'lucide-react'
import { MediumLogo } from '@/components/MediumLogo'
import { PORTAL_TEXTE } from '@/lib/portal-texte'

/**
 * PortalLayout: eigener, schlankerer Rahmen für die Medien-Sicht des Portals
 * (/portal, /portal/*). KEINE Operator-Navigation.
 *
 * Wird von _app.tsx UM die jeweilige Seite gelegt (waehleRahmen dort), nicht
 * von der Seite selbst importiert und gerendert (Ausnahme /portal/login,
 * das ganz ohne Rahmen bleibt). Nur so ist die Seite ein echter Nachfahre
 * von PortalMeContext.Provider, und usePortalMe() liefert dort den echten
 * Medium-Stand statt immer null.
 *
 * Holt beim Mount /api/portal/me: 401 ⇒ Redirect nach /portal/login. Das
 * Ergebnis liegt danach über PortalMeContext/usePortalMe für Kind-Seiten
 * bereit (kein doppelter Fetch pro Seite).
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export type PortalMe = {
  email: string
  medium: { slug: string; name: string }
  freigeschaltet: boolean
  dnaFreigabe: boolean
  /** Aktive medium_dna existiert: erst dann ist der DNA-Nav-Punkt zugänglich. */
  hatDna: boolean
  /** faas_medien.logo_url ist gesetzt (echtes PNG/JPG hochgeladen, Pflicht-Erststep, siehe /api/portal/logo). */
  hatLogo: boolean
}

type LadeStatus = 'laden' | 'bereit' | 'fehler'

type NavItem = { key: 'uebersicht' | 'unterlagen' | 'dna' | 'treffer' | 'gesuche'; name: string; href: string }

// ─── Context ──────────────────────────────────────────────────────────────────

const PortalMeContext = createContext<PortalMe | null>(null)

/** Für Portal-Kind-Seiten: liefert die bereits geladenen /me-Daten, oder null solange sie fehlen. */
export function usePortalMe(): PortalMe | null {
  return useContext(PortalMeContext)
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

// Die Reiter SIND die Onboarding-Schritte (Wunsch Ramona 29.07.2026): keine
// separate Checkliste, die neben dem Portal lebt — die Nummer steht am Reiter,
// und jede Seite erklärt oben selbst, was hier zu tun ist und wozu. Die
// Übersicht bleibt ohne Nummer: sie ist die Landkarte, kein Schritt.
const NAV_ITEMS: NavItem[] = [
  { key: 'uebersicht', name: 'Übersicht', href: '/portal' },
  { key: 'unterlagen', name: '1. Unterlagen', href: '/portal/onboarding' },
  { key: 'dna', name: '2. DNA', href: '/portal/dna' },
  { key: 'treffer', name: '3. Treffer', href: '/portal/treffer' },
  { key: 'gesuche', name: '4. Gesuche', href: '/portal/gesuche' },
]

function istAktiv(pathname: string, href: string): boolean {
  if (href === '/portal') return pathname === '/portal'
  return pathname.startsWith(href)
}

// ─── Komponente ───────────────────────────────────────────────────────────────

interface PortalLayoutProps {
  children: ReactNode
}

export default function PortalLayout({ children }: PortalLayoutProps) {
  const router = useRouter()
  const [me, setMe] = useState<PortalMe | null>(null)
  const [status, setStatus] = useState<LadeStatus>('laden')

  useEffect(() => {
    let abgebrochen = false
    fetch(`/api/portal/me?cb=${Date.now()}`, { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace('/portal/login')
          return
        }
        if (!res.ok) throw new Error(`me: Status ${res.status}`)
        const daten = (await res.json()) as PortalMe
        if (!abgebrochen) {
          setMe(daten)
          setStatus('bereit')
        }
      })
      .catch((err: unknown) => {
        console.error('PortalLayout: /api/portal/me nicht erreichbar', err)
        if (!abgebrochen) setStatus('fehler')
      })
    return () => {
      abgebrochen = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function abmelden() {
    try {
      await fetch('/api/portal/logout', { method: 'POST' })
    } finally {
      router.push('/portal/login')
    }
  }

  if (status === 'laden') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Wird geladen …</p>
      </div>
    )
  }

  if (status === 'fehler' || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-center">
        <p className="text-sm text-slate-500">{PORTAL_TEXTE['fehler.daten_nicht_verfuegbar']}</p>
      </div>
    )
  }

  return (
    <PortalMeContext.Provider value={me}>
      <div className="flex min-h-screen flex-col bg-slate-50">
        {/* Kopf: Wortmarke links, Medium rechts */}
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/api/portal/marke/icon-192.png" alt="We.Publish" className="h-8 w-8 shrink-0 rounded-md" />
            <span className="truncate font-bold text-slate-900">We.Publish</span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
              · Fundraising
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <MediumLogo slug={me.medium.slug} name={me.medium.name} size={32} />
            <span className="hidden text-sm font-medium text-slate-700 sm:inline">{me.medium.name}</span>
            <button
              onClick={abmelden}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <LogOut className="h-3.5 w-3.5" />
              Abmelden
            </button>
          </div>
        </header>

        {/* Schmale Nav */}
        <nav className="border-b border-slate-200 bg-white px-4 sm:px-8">
          <div className="flex gap-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => {
              // Schloss-Zustände: Treffer bis zur Matching-Freischaltung,
              // DNA bis eine aktive medium_dna existiert (NICHT dnaFreigabe:
              // während der Prüfphase bleibt die Seite zugänglich).
              // Noch nicht freigeschaltete Schritte sind ANKLICKBAR (Wunsch
              // Ramona 29.07.2026): vorher war der Reiter toter Text, und man
              // sah nicht, was dort kommt. Jetzt führt er auf die Seite, die
              // ihren Wartezustand selbst erklärt (gedämpfte Vorschau plus
              // Hinweis, was wir gerade tun). Das Schloss bleibt als Signal.
              const sperrGrund =
                item.key === 'treffer' && !me.freigeschaltet
                  ? 'Wir prüfen und schalten eure Treffer frei'
                  : item.key === 'dna' && !me.hatDna
                    ? 'Entsteht, sobald eure Unterlagen da sind'
                    : null
              const aktiv = istAktiv(router.pathname, item.href)
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  title={sperrGrund ?? undefined}
                  className={[
                    '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors',
                    aktiv
                      ? 'border-indigo-500 text-indigo-600'
                      : sperrGrund
                        ? 'border-transparent text-slate-400 hover:text-slate-600'
                        : 'border-transparent text-slate-500 hover:text-slate-800',
                  ].join(' ')}
                >
                  {sperrGrund && <Lock className="h-3.5 w-3.5 shrink-0" />}
                  {item.name}
                </Link>
              )
            })}
          </div>
        </nav>

        {/* Seiteninhalt */}
        <main className="flex-1 px-4 py-8 sm:px-8">
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>

        {/* Fusszeile, wie die Haupt-App */}
        <footer className="border-t border-slate-200 bg-white px-4 py-4 sm:px-8">
          <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-2 text-xs text-slate-400 sm:flex-row">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/api/portal/marke/icon-192.png" alt="We.Publish" className="h-6 w-6 rounded-md" />
              <span>We.Publish · Fundraising as a Service</span>
            </div>
            <div className="flex items-center gap-3">
              <span>© 2026 We.Publish</span>
              <a href="https://wepublish.ch" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600">
                wepublish.ch
              </a>
              <a
                href="https://wepublish.ch/de/impressum"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-600"
              >
                Impressum
              </a>
            </div>
          </div>
        </footer>
      </div>
    </PortalMeContext.Provider>
  )
}
