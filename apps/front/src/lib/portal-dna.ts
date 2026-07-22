/**
 * portal-dna.ts: reine Ableitungslogik für die Portal-DNA-Seite
 * (/api/portal/dna, /api/portal/dna-erzeugen, src/pages/portal/dna.tsx).
 *
 * Kein IO hier: die Routen sammeln die Rohdaten aus Directus
 * (portal-guard.ladeAktiveDnaDetails, ladeArbeitsDnaProfil) und übergeben sie
 * an die Funktionen hier. Zwei Ableitungen aus derselben Rohdaten-Quelle:
 *
 *  - baueDnaAnsicht: die schlanke {soundFeeling,tags,schaerfe,aktivSeit}-Form
 *    aus dem Task-7-Brief-Vertrag (Sound-Feeling gross, Tag-Chips mit echten
 *    Labels, Schärfe als Balken).
 *  - bauePdfDaten: ein GenerateDnaResult-kompatibles Objekt, damit die
 *    bestehende DnaPdf-Komponente unverändert wiederverwendet werden kann,
 *    statt für die Portal-Seite einen eigenen PDF-Baustein zu bauen (siehe
 *    Task-7-Report, Abschnitt «DnaPdf-Klippe»). `quellen` bleibt bewusst weg:
 *    die «neu»-Zähler eines Erzeugungslaufs sind ein Schnappschuss GENAU
 *    dieses Laufs und liessen sich aus dem persistierten Stand im Nachhinein
 *    nicht ehrlich rekonstruieren (die Zahlen wären erfunden, nicht nur
 *    unvollständig). DnaPdf zeigt den Abschnitt dann einfach nicht.
 *
 * stufeAusPhase ordnet den rohen Job-Phase-String (GenerateDnaJob.phase) einer
 * von 5 Anzeige-Stufen zu, für den Fortschritts-Stepper während ein
 * Erzeugungs-Job läuft.
 */

import { labelFuerSlug } from './dna-mess-kern'
import type { GenerateDnaResult, DnaProfil } from './generate-dna-jobs'

// ─── Typen ────────────────────────────────────────────────────────────────────

export type PortalDnaTag = { slug: string; label: string }

export type PortalDnaAnsicht = {
  soundFeeling: string
  tags: PortalDnaTag[]
  schaerfe: number
  aktivSeit: string
}

/** Rohform der aktiven medium_dna, wie portal-guard.ladeAktiveDnaDetails sie liefert. */
export type PortalAktiveDnaRoh = {
  id: number
  version: number
  soundFeeling: string
  tags: { tag_slug: string; gewicht: number; begruendung: string }[]
  schaerfe: number
  aktivSeit: string
  hatteCrawl: boolean
}

const LEERES_PROFIL: DnaProfil = {
  dna_summary: '',
  core_themes: [],
  editorial_stance: [],
  societal_impact: [],
  target_groups: [],
  geographic_focus: '',
  funding_keywords: [],
  grant_strengths: [],
  matching_foundation_themes: [],
}

// ─── Schlanke Ansicht (GET-Vertrag) ────────────────────────────────────────────

export function baueDnaAnsicht(dna: PortalAktiveDnaRoh): PortalDnaAnsicht {
  return {
    soundFeeling: dna.soundFeeling,
    tags: dna.tags.map((t) => ({ slug: t.tag_slug, label: labelFuerSlug(t.tag_slug) })),
    schaerfe: dna.schaerfe,
    aktivSeit: dna.aktivSeit,
  }
}

// ─── PDF-Daten (DnaPdf-Wiederverwendung) ──────────────────────────────────────

export function bauePdfDaten(dna: PortalAktiveDnaRoh, profil: DnaProfil | null): GenerateDnaResult {
  return {
    id: dna.id,
    version: dna.version,
    schaerfe_prozent: dna.schaerfe,
    tag_count: dna.tags.length,
    sound_feeling: dna.soundFeeling,
    tags: dna.tags,
    hatte_crawl: dna.hatteCrawl,
    aktiv_geschaltet: true,
    profil: profil ?? LEERES_PROFIL,
    warnungen: [],
  }
}

// ─── Job-Fortschritt (Poll-Anzeige) ────────────────────────────────────────────

export type DnaJobStufe = 'sammeln' | 'verdichten' | 'messen' | 'aktivieren' | 'fertig'

/** Anzeige-Reihenfolge der 5 Stufen für den Fortschritts-Stepper. */
export const DNA_JOB_STUFEN: readonly DnaJobStufe[] = ['sammeln', 'verdichten', 'messen', 'aktivieren', 'fertig']

/** Kurze Stufen-Labels (keine Fliesstext-Sätze, darum nicht in PORTAL_TEXTE, analog STATION_LABEL). */
export const DNA_JOB_STUFE_LABEL: Record<DnaJobStufe, string> = {
  sammeln: 'Unterlagen sammeln',
  verdichten: 'DNA destillieren',
  messen: 'Themen messen',
  aktivieren: 'Aktivieren',
  fertig: 'Fertig',
}

/**
 * Ordnet einen rohen Job-Phase-String (z.B. "verdichten 3/7" oder "profil",
 * siehe runGenerate in /api/medium-knowledge/generate-dna.ts) einer der 5
 * Anzeige-Stufen zu. Unbekannte/leere Phasen fallen auf 'sammeln' zurück
 * (erste Stufe), statt die Seite crashen zu lassen.
 */
export function stufeAusPhase(phase: string): DnaJobStufe {
  const p = (phase || '').trim().toLowerCase()
  if (p.startsWith('verdichten') || p === 'profil') return 'verdichten'
  if (p.startsWith('messen')) return 'messen'
  if (p.startsWith('aktivieren')) return 'aktivieren'
  if (p.startsWith('fertig')) return 'fertig'
  return 'sammeln'
}
