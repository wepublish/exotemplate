import {
  parseProjektEingabe,
  baueProjektSlug,
  eindeutigerSlug,
  projektZustand,
  PROJEKT_NAME_MAX,
  PROJEKT_BESCHREIBUNG_MAX,
  type ProjektZeile,
} from './portal-projekte'

const BESCHREIBUNG = 'Eine mehrteilige Recherche zum Klimawandel in der Region, mit Fokus auf lokale Folgen.'

function zeile(teil: Partial<ProjektZeile> = {}): ProjektZeile {
  return { id: 1, name: 'Klimaserie', slug: 'zwolf-klimaserie', beschreibung: BESCHREIBUNG, hatDna: false, treffer: 0, ...teil }
}

describe('parseProjektEingabe', () => {
  it('akzeptiert Name und Beschreibung, trimmt', () => {
    const r = parseProjektEingabe({ name: '  Klimaserie  ', beschreibung: `  ${BESCHREIBUNG}  ` })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe).toEqual({ name: 'Klimaserie', beschreibung: BESCHREIBUNG })
  })

  it('weist zu kurze Namen ab', () => {
    expect(parseProjektEingabe({ name: 'AB', beschreibung: BESCHREIBUNG }).ok).toBe(false)
    expect(parseProjektEingabe({ beschreibung: BESCHREIBUNG }).ok).toBe(false)
  })

  it('weist zu kurze Beschreibungen ab — aus zwei Wörtern entsteht kein Profil', () => {
    const r = parseProjektEingabe({ name: 'Klimaserie', beschreibung: 'Kurz.' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.fehler).toMatch(/mindestens 40 Zeichen/)
  })

  it('deckelt überlange Eingaben', () => {
    const r = parseProjektEingabe({ name: 'x'.repeat(500), beschreibung: 'y'.repeat(9000) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe.name).toHaveLength(PROJEKT_NAME_MAX)
    expect(r.eingabe.beschreibung).toHaveLength(PROJEKT_BESCHREIBUNG_MAX)
  })
})

describe('baueProjektSlug', () => {
  it('baut medium-präfixierte, URL-taugliche Slugs', () => {
    expect(baueProjektSlug('zwolf', 'Klimaserie 2026')).toBe('zwolf-klimaserie-2026')
  })

  it('ersetzt Umlaute statt sie zu verlieren', () => {
    expect(baueProjektSlug('zwolf', 'Fussball & Öffentlichkeit')).toBe('zwolf-fussball-oeffentlichkeit')
    expect(baueProjektSlug('zwolf', 'Grösse')).toBe('zwolf-groesse')
  })

  it('kein doppeltes oder abschliessendes Minus', () => {
    const slug = baueProjektSlug('zwolf', '  ---Serie!!!  ')
    expect(slug).toBe('zwolf-serie')
    expect(slug).not.toMatch(/--/)
    expect(slug).not.toMatch(/-$/)
  })

  it('Name ohne brauchbare Zeichen ergibt einen Rückfall', () => {
    expect(baueProjektSlug('zwolf', '???')).toBe('zwolf-projekt')
  })

  it('kürzt lange Namen', () => {
    const slug = baueProjektSlug('zwolf', 'a'.repeat(200))
    expect(slug.length).toBeLessThanOrEqual('zwolf-'.length + 40)
  })
})

describe('eindeutigerSlug', () => {
  it('gibt die Basis zurück, wenn frei', () => {
    expect(eindeutigerSlug('zwolf-serie', ['zwolf-anderes'])).toBe('zwolf-serie')
  })

  it('zählt hoch, wenn belegt', () => {
    expect(eindeutigerSlug('zwolf-serie', ['zwolf-serie'])).toBe('zwolf-serie-2')
    expect(eindeutigerSlug('zwolf-serie', ['zwolf-serie', 'zwolf-serie-2'])).toBe('zwolf-serie-3')
  })
})

describe('projektZustand', () => {
  it('neu ohne DNA und ohne Treffer', () => {
    expect(projektZustand(zeile())).toBe('neu')
  })

  it('bereit mit DNA, aber ohne Treffer', () => {
    expect(projektZustand(zeile({ hatDna: true }))).toBe('bereit')
  })

  it('treffer_da, sobald Treffer da sind', () => {
    expect(projektZustand(zeile({ hatDna: true, treffer: 12 }))).toBe('treffer_da')
  })

  it('ein laufender Lauf schlägt alles', () => {
    expect(projektZustand(zeile({ hatDna: true, treffer: 12, laeuft: true }))).toBe('wird_gemessen')
  })
})
