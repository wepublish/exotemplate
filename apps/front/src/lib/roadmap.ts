/**
 * roadmap.ts — reine Logik der 8-Stationen-Roadmap pro Medium.
 *
 * Die gespeicherte `stationen`-json (faas_roadmap) haelt NUR die menschlich
 * gepflegten Anteile (freigegeben/dokument_link/notiz). Titel, Rolle und Status
 * leiten sich hier ab: aus den statischen Stations-Definitionen und aus
 * Live-Signalen (aktive DNA, Anzahl Matches, Antraege).
 *
 * Kein Netz, keine React-Abhaengigkeit — voll testbar.
 */

export type StationStatus = 'offen' | 'euer_auftrag' | 'in_arbeit' | 'erledigt'
export type StationWer = 'medium' | 'wepublish' | 'gemeinsam'

/** Statische Definition einer Station (unabhaengig vom Medium). */
export type StationDef = { nr: number; titel: string; wer: StationWer }

/** Die acht Stationen in fester Reihenfolge. */
export const STATIONEN: readonly StationDef[] = [
  { nr: 1, titel: 'Organisations-Dateien', wer: 'medium' },
  { nr: 2, titel: 'Medien-DNA', wer: 'wepublish' },
  { nr: 3, titel: 'DNA freigeben', wer: 'medium' },
  { nr: 4, titel: 'Stiftungs-Matching', wer: 'wepublish' },
  { nr: 5, titel: 'Stiftungen auswählen', wer: 'medium' },
  { nr: 6, titel: 'Gesuchsentwürfe', wer: 'wepublish' },
  { nr: 7, titel: 'Prüfen und versenden', wer: 'medium' },
  { nr: 8, titel: 'Archiv', wer: 'gemeinsam' },
]

/** Ein Antrag, wie ihn die Roadmap führt (inkl. Link ins Drive-Dossier). */
export type Antrag = {
  id: string
  status: string
  stiftung_name: string | null
  stiftung_id: string | null
  drive_link: string | null
}

/**
 * Filtert auf Anträge, deren Gesuch tatsächlich erstellt und im Drive-Dossier
 * abgelegt ist (drive_link gesetzt). NUR diese erscheinen in der Roadmap und
 * zählen für die abgeleiteten Stationen-Status. Geplante bzw. nur identifizierte
 * Treffer ohne drive_link bleiben aussen vor (sie sind im Anträge-Kanban sichtbar).
 */
export function nurErstellteAntraege<T extends { drive_link?: string | null }>(antraege: T[]): T[] {
  return antraege.filter((a) => typeof a.drive_link === 'string' && a.drive_link.trim().length > 0)
}

/** Menschlich gepflegter Anteil einer Station (aus faas_roadmap.stationen). */
export type GespeicherteStation = {
  nr: number
  freigegeben: boolean | null
  dokument_link: string | null
  notiz: string | null
}

/** Live-Signale, aus denen sich die abgeleiteten Status ergeben. */
export type RoadmapSignale = {
  hatAktiveDna: boolean
  anzahlMatches: number
  antraege: { status: string }[]
}

/** Eine Station inklusive abgeleitetem Titel, Rolle und Status. */
export type BerechneteStation = {
  nr: number
  titel: string
  wer: StationWer
  status: StationStatus
  freigegeben: boolean | null
  dokument_link: string | null
  notiz: string | null
}

/**
 * Berechnet alle acht Stationen sequentiell. Spaetere Stationen duerfen den
 * Status frueherer Stationen referenzieren (z. B. St4 prueft, ob St3 erledigt ist).
 */
export function berechneStationen(
  gespeichert: GespeicherteStation[],
  signale: RoadmapSignale,
): BerechneteStation[] {
  const gespMap = new Map<number, GespeicherteStation>()
  for (const g of gespeichert) {
    if (g && typeof g.nr === 'number') gespMap.set(g.nr, g)
  }

  // frei(nr): ist die gespeicherte Station freigegeben === true?
  const frei = (nr: number): boolean => gespMap.get(nr)?.freigegeben === true

  const antraege = signale.antraege
  const hatAntraege = antraege.length > 0
  const matches = signale.anzahlMatches

  // Status pro Station; wird waehrend der Berechnung gefuellt und kann von
  // spaeteren Stationen gelesen werden.
  const status: Record<number, StationStatus> = {}

  status[1] = frei(1) ? 'erledigt' : 'euer_auftrag'
  status[2] = signale.hatAktiveDna ? 'erledigt' : 'in_arbeit'
  status[3] = frei(3) ? 'erledigt' : signale.hatAktiveDna ? 'euer_auftrag' : 'offen'
  status[4] = matches > 0 ? 'erledigt' : status[3] === 'erledigt' ? 'in_arbeit' : 'offen'
  status[5] = frei(5) ? 'erledigt' : matches > 0 ? 'euer_auftrag' : 'offen'
  status[6] = hatAntraege ? 'erledigt' : status[5] === 'erledigt' ? 'in_arbeit' : 'offen'
  status[7] =
    frei(7) || antraege.some((a) => a.status === 'eingereicht')
      ? 'erledigt'
      : hatAntraege
        ? 'euer_auftrag'
        : 'offen'
  status[8] =
    hatAntraege && antraege.every((a) => ['zugesagt', 'abgelehnt', 'archiviert'].includes(a.status))
      ? 'erledigt'
      : 'offen'

  return STATIONEN.map((def) => {
    const g = gespMap.get(def.nr)
    return {
      nr: def.nr,
      titel: def.titel,
      wer: def.wer,
      status: status[def.nr],
      freigegeben: g?.freigegeben ?? null,
      dokument_link: g?.dokument_link ?? null,
      notiz: g?.notiz ?? null,
    }
  })
}
