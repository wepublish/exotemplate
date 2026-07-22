import { parseEmails, formatEmails } from './kontakt-emails'

describe('parseEmails', () => {
  it('zerlegt kommagetrennte Adressen', () => {
    expect(parseEmails('a@b.ch, c@d.org')).toEqual(['a@b.ch', 'c@d.org'])
  })

  it('trennt auch an Semikolon, Zeilenumbruch und Leerzeichen', () => {
    expect(parseEmails('a@b.ch;\nc@d.org e@f.io')).toEqual(['a@b.ch', 'c@d.org', 'e@f.io'])
  })

  it('filtert unplausible Eingaben (kein @, kein Punkt)', () => {
    expect(parseEmails('hallo, a@b.ch, kaputt@, @x.ch')).toEqual(['a@b.ch'])
  })

  it('dedupliziert', () => {
    expect(parseEmails('a@b.ch, a@b.ch')).toEqual(['a@b.ch'])
  })

  it('leere Eingabe ergibt leere Liste', () => {
    expect(parseEmails('   ')).toEqual([])
  })
})

describe('formatEmails', () => {
  it('verbindet ein Array kommagetrennt', () => {
    expect(formatEmails(['a@b.ch', 'c@d.org'])).toBe('a@b.ch, c@d.org')
  })

  it('toleriert einen JSON-String', () => {
    expect(formatEmails('["a@b.ch"]')).toBe('a@b.ch')
  })

  it('null/undefined ergibt leeren String', () => {
    expect(formatEmails(null)).toBe('')
    expect(formatEmails(undefined)).toBe('')
  })
})
