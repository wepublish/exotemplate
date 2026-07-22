import { useEffect, useState } from 'react'
import type { Vorschlag } from '@/graphql/vorschlaege'

/**
 * Proaktiver Lagebericht — die «handfeste Assistentin»: «Der Gerät» (Sonnet) formuliert beim
 * Öffnen ein Morgenbriefing mit KONKRETEN Handlungs-To-dos, jedes mit einem Ein-Klick-Knopf,
 * der an die richtige Stelle führt (Matching-Liste, Onboarding, Anträge, Ausschreibungen).
 * Strukturiert vom Adapter (1× täglich gecacht). Die eigentliche Ausführung bleibt dort.
 */

type Todo = { text: string; aktion: string; medium: string }
type Briefing = { gruss: string; todos: Todo[] }

const AKTION: Record<string, { href: (m: string) => string; label: string }> = {
  matching_liste: { href: (m) => (m ? `/?medium=${encodeURIComponent(m)}` : '/'), label: 'Liste öffnen' },
  datensuppe: { href: () => '/onboarding', label: 'Onboarding' },
  gesuch: { href: () => '/applications', label: 'Anträge' },
  nachfassen: { href: () => '/applications', label: 'Anträge' },
  frist: { href: () => '/matching-ausschreibungen', label: 'Ausschreibungen' },
}

export function Lagebericht({ vorschlaege }: { vorschlaege: Vorschlag[] }) {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [zustand, setZustand] = useState<'laden' | 'ok' | 'fehler'>('laden')

  async function laden(force = false) {
    setZustand('laden')
    try {
      const r = await fetch('/api/briefing' + (force ? '?force=1' : ''))
      const d = (await r.json()) as { status?: string; briefing?: Briefing }
      if (d.status === 'ok' && d.briefing) {
        setBriefing(d.briefing)
        setZustand('ok')
      } else {
        setZustand('fehler')
      }
    } catch {
      setZustand('fehler')
    }
  }
  useEffect(() => {
    void laden()
  }, [])

  const offen = vorschlaege.length

  return (
    <section className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Morgenbriefing</h2>
        <button
          onClick={() => void laden(true)}
          disabled={zustand === 'laden'}
          className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50"
        >
          aktualisieren
        </button>
      </div>

      {zustand === 'laden' && !briefing && (
        <p className="mt-2 text-sm text-slate-500">Der Gerät stellt dein Briefing zusammen …</p>
      )}

      {zustand === 'fehler' && !briefing && (
        <p className="mt-2 text-sm text-slate-600">
          Briefing gerade nicht verfügbar.
          {offen > 0 ? ` ${offen} offene Punkte stehen unten.` : ' Aktuell nichts Offenes.'}
        </p>
      )}

      {briefing && (
        <div className="mt-2">
          <p className="text-sm font-medium text-slate-800">{briefing.gruss}</p>
          {briefing.todos.length > 0 && (
            <ul className="mt-2 space-y-2">
              {briefing.todos.map((t, i) => {
                const a = AKTION[t.aktion]
                return (
                  <li key={i} className="flex items-start justify-between gap-3">
                    <div className="flex gap-2 text-sm text-slate-700">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                      <span>{t.text}</span>
                    </div>
                    {a && (
                      <a
                        href={a.href(t.medium)}
                        className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                      >
                        {a.label} →
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
