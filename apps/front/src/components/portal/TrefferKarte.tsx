import { Globe, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { PORTAL_TEXTE } from '@/lib/portal-texte'
import type { PortalTreffer } from '@/lib/portal-treffer'

/**
 * TrefferKarte: eine kuratierte Stiftung auf der Portal-Treffer-Seite.
 *
 * Zeigt NUR, was PortalTreffer mitgibt (kein Score, keine Stiftungs-DNA):
 * Name, Sitz, Label-Chip, Begründung, Themen-Chips, Website-Link. Solange
 * `status === 'offen'` erscheinen die beiden Aktionen «Anschreiben» und
 * «Nicht relevant»; ist der Treffer schon in Bearbeitung (jeder andere
 * Status), zeigt die Karte stattdessen einen Status-Chip.
 *
 * Reine Darstellungs-Komponente: die eigentliche Aktion (POST an
 * /api/portal/anschreiben bzw. /api/portal/nicht-relevant, Consent-Flow bei
 * «Anschreiben», Grund-Dialog bei «Nicht relevant») lebt in der Seite
 * (treffer.tsx, Task 8/9), hier nur die beiden Callback-Aufrufe.
 */

const LABEL_FARBE: Record<PortalTreffer['label'], string> = {
  'sehr hoch': 'border-emerald-200 bg-emerald-100 text-emerald-800',
  hoch: 'border-indigo-200 bg-indigo-100 text-indigo-700',
  gut: 'border-slate-200 bg-slate-100 text-slate-600',
}

// Kurze Status-Wörter, keine Fliesstext-Sätze, darum nicht in PORTAL_TEXTE
// (analog STATUS_LABEL in MatchRow.tsx, DNA_JOB_STUFE_LABEL in portal-dna.ts).
const STATUS_LABEL: Record<PortalTreffer['status'], string> = {
  offen: 'Offen',
  angefordert: 'Angefordert',
  in_arbeit: 'In Arbeit',
  bereit: 'Gesuch bereit',
  abgeschickt: 'Abgeschickt',
  nicht_relevant: 'Nicht relevant',
}

const STATUS_FARBE: Record<PortalTreffer['status'], string> = {
  offen: 'border-slate-200 bg-slate-100 text-slate-500',
  angefordert: 'border-amber-200 bg-amber-100 text-amber-700',
  in_arbeit: 'border-amber-200 bg-amber-100 text-amber-700',
  bereit: 'border-indigo-200 bg-indigo-100 text-indigo-700',
  abgeschickt: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  nicht_relevant: 'border-slate-200 bg-slate-100 text-slate-400',
}

interface TrefferKarteProps {
  treffer: PortalTreffer
  onAnschreiben: (treffer: PortalTreffer) => void
  onNichtRelevant: (treffer: PortalTreffer) => void
  /**
   * Rückmeldung «passt überhaupt nicht» (29.07.2026). Anders als «Nicht
   * relevant» (blendet den Treffer nur aus) beschreibt sie den Grund für die
   * Match-Engine — darum steht sie bei JEDEM Status zur Verfügung, auch wenn
   * schon ein Gesuch läuft.
   */
  onRueckmeldung: (treffer: PortalTreffer) => void
  /** Doppel-Submit-Schutz (Task 9): true, solange irgendeine Aktion auf der Seite läuft. */
  disabled?: boolean
}

export function TrefferKarte({ treffer, onAnschreiben, onNichtRelevant, onRueckmeldung, disabled }: TrefferKarteProps) {
  const laeuftBereits = treffer.status !== 'offen'

  return (
    <Card className="p-5 bg-white">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-900">{treffer.name}</p>
        <Badge variant="outline" className={`text-[10px] ${LABEL_FARBE[treffer.label]}`}>
          {treffer.label}
        </Badge>
        {treffer.fruehereFoerderung && (
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">
            {treffer.fruehereFoerderung}
          </Badge>
        )}
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {treffer.sitz && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0" />
            {treffer.sitz}
          </span>
        )}
        {treffer.website && (
          <a
            href={treffer.website}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
          >
            <Globe className="h-3 w-3 shrink-0" />
            Website
          </a>
        )}
      </div>

      {treffer.begruendung && <p className="mt-3 text-sm leading-relaxed text-slate-700">{treffer.begruendung}</p>}

      {treffer.themen.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {treffer.themen.map((thema, i) => (
            <Badge key={`${thema}-${i}`} variant="outline" className="border-slate-200 bg-slate-50 text-[11px] text-slate-600">
              {thema}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {laeuftBereits ? (
          <Badge variant="outline" className={`text-xs ${STATUS_FARBE[treffer.status]}`}>
            {STATUS_LABEL[treffer.status]}
          </Badge>
        ) : (
          <>
            <Button size="sm" onClick={() => onAnschreiben(treffer)} disabled={disabled}>
              {PORTAL_TEXTE['treffer.anschreiben_knopf']}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onNichtRelevant(treffer)} disabled={disabled}>
              {PORTAL_TEXTE['treffer.nicht_relevant_knopf']}
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => onRueckmeldung(treffer)} disabled={disabled}>
          {PORTAL_TEXTE['treffer.rueckmeldung_knopf']}
        </Button>
      </div>
    </Card>
  )
}
