/**
 * portal-unterlagen.ts: reine Logik für die Unterlagen-Verwaltung im Portal
 * (Wunsch Ramona 29.07.2026: Titel ändern, löschen, taggen).
 *
 * Die Kategorien sind dieselben, die der Wissens-Score zählt
 * (SCORE_KATEGORIEN in knowledge-score.ts) plus `newsletter`, das dort mit
 * `published_article` eine Dimension bildet. Ein Medium soll genau die
 * Schubladen sehen, die auch den Score füllen — sonst tagt es fleissig und der
 * Balken bewegt sich nicht.
 */

/** Auswahl im Portal: Wert + Beschriftung, in Anzeige-Reihenfolge. */
export const PORTAL_KATEGORIEN = [
  { key: 'published_article', label: 'Artikel' },
  { key: 'newsletter', label: 'Newsletter' },
  { key: 'budget', label: 'Budget / Jahresrechnung' },
  { key: 'previous_application', label: 'Früheres Gesuch' },
  { key: 'tax_exemption', label: 'Gemeinnützigkeit / Statuten' },
  { key: 'general_info', label: 'Allgemeine Infos' },
] as const

export type PortalKategorieKey = typeof PORTAL_KATEGORIEN[number]['key']

export const TITEL_MAX_ZEICHEN = 200

export function istPortalKategorie(wert: string): wert is PortalKategorieKey {
  return PORTAL_KATEGORIEN.some((k) => k.key === wert)
}

/**
 * Beschriftung für eine Kategorie. Unbekannte Werte (Altbestand, von Hand in
 * Directus gesetzt) kommen unverändert zurück, statt zu verschwinden.
 */
export function portalKategorieLabel(key: string): string {
  return PORTAL_KATEGORIEN.find((k) => k.key === key)?.label ?? key
}

export interface UnterlagenEintrag {
  id: number
  title: string
  category: string
  quelle: 'We.Publish' | 'von euch'
  datum: string
}

/**
 * Gruppiert die Unterlagen nach Kategorie, in der Reihenfolge von
 * PORTAL_KATEGORIEN; unbekannte Kategorien hängen hinten an. Leere Gruppen
 * fallen weg — die Übersicht zeigt, was DA ist, der Score sagt, was fehlt.
 */
export function gruppiereUnterlagen(eintraege: UnterlagenEintrag[]): Array<{ key: string; label: string; eintraege: UnterlagenEintrag[] }> {
  const gruppen = new Map<string, UnterlagenEintrag[]>()
  for (const e of eintraege) {
    const liste = gruppen.get(e.category) ?? []
    liste.push(e)
    gruppen.set(e.category, liste)
  }
  const bekannt = PORTAL_KATEGORIEN.map((k) => k.key) as readonly string[]
  const sortierteKeys = [
    ...bekannt.filter((k) => gruppen.has(k)),
    ...[...gruppen.keys()].filter((k) => !bekannt.includes(k)).sort(),
  ]
  return sortierteKeys.map((key) => ({
    key,
    label: portalKategorieLabel(key),
    eintraege: gruppen.get(key) ?? [],
  }))
}

/** true, wenn das Medium diesen Eintrag bearbeiten darf (nicht automatisch eingelesen). */
export function istBearbeitbar(eintrag: Pick<UnterlagenEintrag, 'quelle'>): boolean {
  return eintrag.quelle === 'von euch'
}
