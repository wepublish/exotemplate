import type { ReactNode } from 'react'
import { Info } from 'lucide-react'

/**
 * Erklär-Box am Kopf jeder Portal-Seite: was ist hier zu tun, und wozu.
 *
 * Wunsch Ramona 29.07.2026: die Reiter sind die Onboarding-Schritte, und die
 * Anleitung steht DORT, wo gearbeitet wird — nicht in einer separaten
 * Checkliste, die man nach dem Onboarding nie wieder sieht. Darum bleibt die
 * Box dauerhaft stehen (nicht wegklickbar): ein Medium, das drei Monate später
 * Unterlagen nachliefert, liest dieselbe Erklärung wie am ersten Tag.
 */
export function SchrittInfo({
  schritt,
  titel,
  children,
}: {
  /** Nummer wie im Reiter («1»…«4»); ohne Nummer für die Übersicht. */
  schritt?: string
  titel: string
  /** Fliesstext: was ist zu tun, und wozu dient es. */
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
          {schritt ?? <Info className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-indigo-900">{titel}</p>
          <div className="space-y-2 text-sm leading-relaxed text-indigo-900/80">{children}</div>
        </div>
      </div>
    </div>
  )
}
