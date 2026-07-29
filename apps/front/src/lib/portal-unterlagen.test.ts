import {
  PORTAL_KATEGORIEN,
  istPortalKategorie,
  portalKategorieLabel,
  gruppiereUnterlagen,
  istBearbeitbar,
  type UnterlagenEintrag,
} from './portal-unterlagen'
import { SCORE_KATEGORIEN } from './knowledge-score'

function eintrag(teil: Partial<UnterlagenEintrag> & { id: number }): UnterlagenEintrag {
  return { title: `Titel ${teil.id}`, category: 'general_info', quelle: 'von euch', datum: '29.07.2026', ...teil }
}

describe('PORTAL_KATEGORIEN', () => {
  it('deckt jede Score-Dimension ab — sonst tagt das Medium ins Leere', () => {
    const portalKeys = PORTAL_KATEGORIEN.map((k) => k.key) as readonly string[]
    for (const dim of SCORE_KATEGORIEN) {
      const abgedeckt = portalKeys.includes(dim.key) || (dim.extraKey ? portalKeys.includes(dim.extraKey) : false)
      expect(abgedeckt).toBe(true)
    }
  })

  it('istPortalKategorie erkennt nur bekannte Werte', () => {
    expect(istPortalKategorie('budget')).toBe(true)
    expect(istPortalKategorie('newsletter')).toBe(true)
    expect(istPortalKategorie('erfunden')).toBe(false)
    expect(istPortalKategorie('')).toBe(false)
  })

  it('portalKategorieLabel fällt auf den Rohwert zurück (Altbestand bleibt sichtbar)', () => {
    expect(portalKategorieLabel('budget')).toBe('Budget / Jahresrechnung')
    expect(portalKategorieLabel('alt_irgendwas')).toBe('alt_irgendwas')
  })
})

describe('gruppiereUnterlagen', () => {
  it('gruppiert in der Reihenfolge von PORTAL_KATEGORIEN, leere Gruppen fallen weg', () => {
    const gruppen = gruppiereUnterlagen([
      eintrag({ id: 1, category: 'general_info' }),
      eintrag({ id: 2, category: 'published_article' }),
      eintrag({ id: 3, category: 'budget' }),
      eintrag({ id: 4, category: 'published_article' }),
    ])
    expect(gruppen.map((g) => g.key)).toEqual(['published_article', 'budget', 'general_info'])
    expect(gruppen[0].eintraege.map((e) => e.id)).toEqual([2, 4])
    expect(gruppen.every((g) => g.eintraege.length > 0)).toBe(true)
  })

  it('unbekannte Kategorien hängen hinten an, alphabetisch', () => {
    const gruppen = gruppiereUnterlagen([
      eintrag({ id: 1, category: 'zzz_alt' }),
      eintrag({ id: 2, category: 'budget' }),
      eintrag({ id: 3, category: 'aaa_alt' }),
    ])
    expect(gruppen.map((g) => g.key)).toEqual(['budget', 'aaa_alt', 'zzz_alt'])
  })

  it('leere Eingabe ergibt keine Gruppen', () => {
    expect(gruppiereUnterlagen([])).toEqual([])
  })

  it('kein Eintrag geht verloren', () => {
    const eintraege = [1, 2, 3, 4, 5].map((id) => eintrag({ id, category: id % 2 ? 'budget' : 'newsletter' }))
    const gesamt = gruppiereUnterlagen(eintraege).reduce((s, g) => s + g.eintraege.length, 0)
    expect(gesamt).toBe(5)
  })
})

describe('istBearbeitbar', () => {
  it('nur selbst eingelieferte Einträge sind bearbeitbar', () => {
    expect(istBearbeitbar({ quelle: 'von euch' })).toBe(true)
    expect(istBearbeitbar({ quelle: 'We.Publish' })).toBe(false)
  })
})
