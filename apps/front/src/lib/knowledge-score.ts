/**
 * knowledge-score.ts — Knowledge-Score-Berechnung für das Medien-Onboarding.
 *
 * Die 5 Kern-Kategorien aus Base44 bestimmen die Matching-Bereitschaft.
 * Je vorhandene Kategorie = 1 Punkt → max. 5 Punkte.
 */

/**
 * Warum eine Dimension auch am TITEL erkannt wird (Fachentscheid Jolanda,
 * 29.07.2026: «statuten ist gemeinnützigkeitsnachweis und budget/jahresrechnung
 * reicht auch eines davon»):
 *
 * Die Schublade, in die ein Dokument gelegt wurde, sagt nicht zuverlässig, was
 * es belegt. Zwölf hatte «Statuten 2026 unterschrieben.pdf» unter «Allgemeine
 * Infos» — fachlich ist das der Gemeinnützigkeitsnachweis, der Balken zeigte
 * trotzdem eine Lücke. Ein reiner Kategorien-Vergleich zwingt dazu, jedes
 * bestehende Dokument von Hand umzutaggen und bestraft Medien, die richtig
 * hochladen, aber falsch einsortieren. Darum zählt eine Dimension als erfüllt,
 * wenn die Kategorie passt ODER der Titel das Dokument klar ausweist.
 */
export const SCORE_KATEGORIEN: Array<{
  key: string
  label: string
  beschreibung: string
  extraKey?: string
  /** Titel-Erkennung, wenn die Kategorie das Dokument nicht verrät. */
  titelMuster?: RegExp
}> = [
  {
    key: 'budget',
    label: 'Budget / Jahresrechnung',
    beschreibung: 'Jahresbudget, Finanzplan oder Jahresrechnung — eines davon genügt',
    titelMuster: /jahresrechnung|jahresabschluss|erfolgsrechnung|bilanz|finanzplan|budget/i,
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
    beschreibung: 'Statuten, Steuerbefreiung oder MWST-Ausnahme',
    titelMuster: /statuten|gemeinnütz|gemeinnuetz|steuerbefrei|steuererleichter/i,
  },
]

export interface KnowledgeEintrag {
  category: string
  /** Optional: Dateiname oder Titel. Fehlt er, zählt nur die Kategorie. */
  title?: string | null
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
 * Ein Punkt pro Dimension, unabhängig von der Anzahl der Einträge darin.
 * published_article und newsletter gelten zusammen als eine Dimension; Budget
 * und Gemeinnützigkeit zählen zusätzlich passende Titel (siehe Kommentar bei
 * SCORE_KATEGORIEN).
 */
export function berechneKnowledgeScore(eintraege: KnowledgeEintrag[]): ScoreErgebnis {
  const liste = Array.isArray(eintraege) ? eintraege : []
  const kategorien = liste.map((e) => String(e?.category ?? '')).filter(Boolean)
  const titel = liste.map((e) => String(e?.title ?? '')).filter(Boolean)

  const abgedeckt: string[] = []
  const fehlend: string[] = []

  for (const dim of SCORE_KATEGORIEN) {
    const vorhanden =
      kategorien.includes(dim.key) ||
      (dim.extraKey ? kategorien.includes(dim.extraKey) : false) ||
      (dim.titelMuster ? titel.some((t) => dim.titelMuster!.test(t)) : false)
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
