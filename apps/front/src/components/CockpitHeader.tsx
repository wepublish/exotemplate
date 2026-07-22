import { useState } from 'react'

/** Kopf des Cockpits: das mentale Modell in einem Satz, Details auf Klick. */
export function CockpitHeader() {
  const [offen, setOffen] = useState(false)
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Fundraising</div>
          <h1 className="text-xl font-bold text-slate-900">Cockpit</h1>
        </div>
        <button
          onClick={() => setOffen((o) => !o)}
          className="shrink-0 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 hover:bg-indigo-100"
        >
          So läuft&apos;s {offen ? '▴' : '▾'}
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-700">
        Das System findet Stiftungen, prüft sie und schnürt Förderpakete, von selbst. Dein Teil:
        sichten, freigeben, senden. Den Rest macht der Gerät allein.
      </p>
      {offen && (
        <p className="mt-2 border-t border-slate-100 pt-2 text-sm text-slate-600">
          Vorwärts findet das System Förderstiftungen, gleicht sie mit jedem Medium ab und legt
          nachts fertige Förderpakete an. Du sichtest diese Pakete, gibst die vorbereiteten
          Nachrichten frei und fasst bei Bedarf nach. Versendet wird nur, was du freigibst.
        </p>
      )}
    </section>
  )
}
