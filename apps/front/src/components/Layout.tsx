import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useQuery } from '@apollo/client/react'
import {
  LayoutDashboard,
  Users,
  Building2,
  FileText,
  Sparkles,
  UploadCloud,
  Receipt,
  Inbox,
  Church,
  ListChecks,
  FolderInput,
  KeyRound,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VORSCHLAEGE_COUNT_OFFEN } from '@/graphql/vorschlaege'

// Flache Liste aller Nav-Eintraege — wird fuer aktiven-Eintrag-Suche gebraucht
const navItems = [
  { name: 'Der Gerät', href: '/agent', icon: Inbox },
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Roadmap', href: '/roadmap', icon: ListChecks },
  { name: 'Förderstiftungen', href: '/', icon: Sparkles },
  { name: 'Anträge', href: '/applications', icon: FileText },
  { name: 'Anträge importieren', href: '/antraege-import', icon: FolderInput },
  { name: 'Abrechnung', href: '/abrechnung', icon: Receipt },
  { name: 'Medien', href: '/clients', icon: Users },
  { name: 'Onboarding', href: '/onboarding', icon: UploadCloud },
  { name: 'Portal-Steuerung', href: '/portal-steuerung', icon: KeyRound },
  { name: 'Stiftungsdatenbank', href: '/stiftungsdatenbank', icon: Building2 },
  { name: 'Ausschreibungen', href: '/matching-ausschreibungen', icon: Sparkles },
  { name: 'Lotteriefonds', href: '/lotteriefonds', icon: Sparkles },
  { name: 'Kirchen & Förderer', href: '/kirchen-foerderer', icon: Church },
]

// Sidebar-Gruppen mit Mono-Labels
const navGruppen = [
  {
    label: 'cockpit',
    items: [
      { name: 'Der Gerät', href: '/agent', icon: Inbox },
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { name: 'Roadmap', href: '/roadmap', icon: ListChecks },
    ],
  },
  {
    label: 'fundraising',
    items: [
      { name: 'Förderstiftungen', href: '/', icon: Sparkles },
      { name: 'Anträge', href: '/applications', icon: FileText },
      { name: 'Anträge importieren', href: '/antraege-import', icon: FolderInput },
      { name: 'Abrechnung', href: '/abrechnung', icon: Receipt },
    ],
  },
  {
    label: 'medien',
    items: [
      { name: 'Medien', href: '/clients', icon: Users },
      { name: 'Onboarding', href: '/onboarding', icon: UploadCloud },
      { name: 'Portal-Steuerung', href: '/portal-steuerung', icon: KeyRound },
    ],
  },
  {
    label: 'quellen',
    items: [
      { name: 'Stiftungsdatenbank', href: '/stiftungsdatenbank', icon: Building2 },
      { name: 'Ausschreibungen', href: '/matching-ausschreibungen', icon: Sparkles },
      { name: 'Lotteriefonds', href: '/lotteriefonds', icon: Sparkles },
      { name: 'Kirchen & Förderer', href: '/kirchen-foerderer', icon: Church },
    ],
  },
]

interface LayoutProps {
  children: React.ReactNode
  pageTitle?: string
}

export default function Layout({ children, pageTitle }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const router = useRouter()

  // Zähler offener Vorschläge fürs Nav-Badge. Degradiert auf 0, wenn die
  // Collection (noch) nicht existiert oder leer ist — kein Crash.
  const { data: vData } = useQuery(VORSCHLAEGE_COUNT_OFFEN, {
    pollInterval: 30000,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const offen = Number((vData as any)?.agent_vorschlaege_aggregated?.[0]?.count?.id ?? 0)

  const currentItem = navItems.find(n => {
    if (n.href === '/') return router.pathname === '/'
    return router.pathname.startsWith(n.href)
  })

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — We.Publish-Designsystem: Ink-Fläche, Koralle als Aktivzustand */}
      <aside
        className={[
          'no-print',
          'fixed z-50 inset-y-0 left-0 w-64 bg-slate-900 flex flex-col transform transition-transform duration-300 ease-in-out',
          'lg:translate-x-0 lg:static lg:z-auto',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Logo block */}
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-weiss.png"
                alt="We.Publish"
                className="h-6 w-auto max-w-full object-contain self-start"
              />
              <p className="font-mono text-[10px] font-medium text-slate-300 uppercase tracking-[0.18em] whitespace-nowrap">
                Fundraising as a Service
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden -mr-2 flex-shrink-0 text-slate-200 hover:bg-white/10 hover:text-white"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto space-y-4">
          {navGruppen.map(gruppe => (
            <div key={gruppe.label}>
              {/* Gruppen-Label im Mono-Stil, analog Topbar-Eyebrow */}
              <p className="px-3 mb-1 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-slate-500 select-none">
                <span className="text-slate-600">{'// '}</span>
                {gruppe.label}
              </p>
              <div className="space-y-0.5">
                {gruppe.items.map(({ name, href, icon: Icon }) => {
                  const isActive = currentItem?.href === href
                  const badge = name === 'Der Gerät' && offen > 0 ? offen : null
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setSidebarOpen(false)}
                      className={[
                        'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-150',
                        isActive
                          ? 'bg-indigo-500 text-slate-900 font-bold'
                          : 'font-medium text-slate-200 hover:bg-white/5 hover:text-white',
                      ].join(' ')}
                    >
                      <Icon
                        className={[
                          'shrink-0 w-[18px] h-[18px]',
                          isActive ? 'text-slate-900' : 'text-slate-500',
                        ].join(' ')}
                      />
                      {name}
                      {badge != null && (
                        <span
                          className={[
                            'ml-auto rounded-full px-1.5 py-0.5 text-xs font-semibold',
                            isActive ? 'bg-slate-900 text-white' : 'bg-indigo-500 text-white',
                          ].join(' ')}
                        >
                          {badge}
                        </span>
                      )}
                      {isActive && badge == null && (
                        <ChevronRight className="w-3.5 h-3.5 ml-auto text-slate-900" />
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800">
          <p className="font-mono text-[10px] text-slate-500 text-center">
            © 2026 We.Publish · <span className="text-indigo-500 font-semibold">FaaS</span>
          </p>
          {/* Build-Marke: sagt auf einen Blick, WELCHER Stand im Browser geladen ist.
              Next.js ist eine SPA — ein Tab, der vor einem Deploy geoeffnet wurde,
              behaelt sein HTML-Dokument und damit die alten Chunks, ohne dass etwas
              fehlschlaegt. Am 27.07.2026 hat genau das zweimal zu der Fehlannahme
              gefuehrt, ein Deploy sei nicht angekommen. Diese Zeile beendet das Raten. */}
          <p
            className="font-mono text-[9px] text-slate-600 text-center mt-1 select-all"
            title="Geladener Build. Stimmt er nicht mit dem erwarteten Commit überein, hält der Tab einen alten Stand: privates Fenster öffnen."
          >
            build {process.env.NEXT_PUBLIC_BUILD_SHA || 'dev'}
          </p>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="no-print sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200/60 px-4 lg:px-8 h-14 flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden mr-3 -ml-2"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5 text-slate-600" />
          </Button>
          <h2 className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            <span className="text-slate-300">{'// '}</span>
            {pageTitle ?? currentItem?.name ?? ''}
          </h2>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-8 overflow-auto">
          <div className="max-w-[120rem] mx-auto">{children}</div>
        </main>

        {/* Fusszeile */}
        <footer className="no-print border-t border-slate-200/60 bg-white px-4 lg:px-8 py-4">
          <div className="max-w-[120rem] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-192.png" alt="We.Publish" className="w-8 h-8 rounded-md" />
              <span>We.Publish · Fundraising as a Service</span>
            </div>
            <div className="flex items-center gap-3">
              <span>© 2026 We.Publish</span>
              <a href="https://wepublish.ch" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600">wepublish.ch</a>
              <a href="https://wepublish.ch/de/impressum" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600">Impressum</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
