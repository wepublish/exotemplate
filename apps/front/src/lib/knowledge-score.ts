/**
 * knowledge-score.ts — Knowledge-Score-Berechnung für das Medien-Onboarding.
 *
 * Die 5 Kern-Kategorien aus Base44 bestimmen die Matching-Bereitschaft.
 * Je vorhandene Kategorie = 1 Punkt → max. 5 Punkte.
 */

export const SCORE_KATEGORIEN: Array<{
  key: string
  label: string
  beschreibung: string
  extraKey?: string
}> = [
  {
    key: 'budget',
    label: 'Budget',
    beschreibung: 'Finanzplan, Jahresbudget oder Kostenkalkulation',
  },
  {
    key: 'previous_application',
    label: 'Frühere Gesuche',
    beschreibung: 'Eingereichte Förderanträge oder Bewerbungsunterlagen',
  },
  {
    key: 'published_article',
    label: 'Artikel / Newsletter',
    beschreibung: 'Veröffentlichte Inhalte oder Newsletter-Ausgaben',
    extraKey: 'newsletter',
  },
  {
    key: 'general_info',
    label: 'Allgemeine Infos',
    beschreibung: 'Leitbild, Über uns, Strategie',
  },
  {
    key: 'tax_exemption',
    label: 'Gemeinnützigkeitsnachweis',
    beschreibung: 'Steuerbefreiung, MWST-Ausnahme oder entsprechendes Dokument',
  },
]

export interface KnowledgeEintrag {
  category: string
}

export interface ScoreErgebnis {
  punkte: number
  maxPunkte: number
  prozent: number
  abgedeckt: string[]
  fehlend: string[]
}

/**
 * Berechnet den Knowledge-Score aus einer Liste von medium_knowledge-Einträgen.
 * Ein Punkt pro Kategorie, unabhängig von der Anzahl der Einträge in dieser Kategorie.
 * published_article und newsletter gelten zusammen als eine Dimension.
 */
export function berechneKnowledgeScore(eintraege: KnowledgeEintrag[]): ScoreErgebnis {
  const kategorien = Array.isArray(eintraege)
    ? eintraege.map(e => String(e.category ?? '')).filter(Boolean)
    : []

  const abgedeckt: string[] = []
  const fehlend: string[] = []

  for (const dim of SCORE_KATEGORIEN) {
    const vorhanden =
      kategorien.includes(dim.key) ||
      (dim.extraKey ? kategorien.includes(dim.extraKey) : false)
    if (vorhanden) {
      abgedeckt.push(dim.label)
    } else {
      fehlend.push(dim.label)
    }
  }

  const punkte = abgedeckt.length
  const maxPunkte = SCORE_KATEGORIEN.length
  const prozent = Math.round((punkte / maxPunkte) * 100)

  return { punkte, maxPunkte, prozent, abgedeckt, fehlend }
}

/**
 * Gibt das Kategorie-Label zurück.
 * Unbekannte Kategorien werden mit dem Rohwert zurückgegeben.
 */
export function kategorieLabelFromKey(key: string): string {
  const LABELS: Record<string, string> = {
    previous_application: 'Früheres Gesuch',
    tax_exemption: 'Gemeinnützigkeitsnachweis',
    budget: 'Budget',
    published_article: 'Artikel',
    newsletter: 'Newsletter',
    testimonial: 'Testimonial',
    general_info: 'Allgemeine Infos',
  }
  return LABELS[key] ?? key
}
