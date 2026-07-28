import { baueMailtoUrl, mailtoIstZuLang, MAILTO_MAX_LAENGE } from './mailto'

describe('baueMailtoUrl', () => {
  it('setzt Empfänger, Betreff und Text', () => {
    const url = baueMailtoUrl({ an: 'redaktion@medium.ch', betreff: 'Dein Zugang', text: 'Hallo Ramona' })
    expect(url.startsWith('mailto:redaktion%40medium.ch?')).toBe(true)
    expect(url).toContain('subject=Dein%20Zugang')
    expect(url).toContain('body=Hallo%20Ramona')
  })

  it('kodiert Zeilenumbrüche als %0A und nicht als doppelten Umbruch', () => {
    const url = baueMailtoUrl({ an: 'a@b.ch', betreff: 'x', text: 'Zeile 1\r\nZeile 2\rZeile 3\nZeile 4' })
    const body = url.split('body=')[1] ?? ''
    expect(body).toBe('Zeile%201%0AZeile%202%0AZeile%203%0AZeile%204')
    expect(body).not.toContain('%0D')
  })

  it('kodiert Leerzeichen als %20, nicht als Plus', () => {
    const url = baueMailtoUrl({ an: 'a@b.ch', betreff: 'zwei Wörter', text: 'auch hier' })
    expect(url).not.toContain('+')
    expect(url).toContain('zwei%20W%C3%B6rter')
  })

  it('erlaubt einen leeren Empfänger', () => {
    const url = baueMailtoUrl({ betreff: 'x', text: 'y' })
    expect(url.startsWith('mailto:?')).toBe(true)
  })

  it('lässt einen Link im Text unbeschädigt (Token mit Punkten und Unterstrichen)', () => {
    const link = 'https://fundraising.wepublish.cloud/api/portal/einloesen?token=eyJhbGc.iOiJIUzI1_NiJ9.abc-DEF'
    const url = baueMailtoUrl({ an: 'a@b.ch', betreff: 'x', text: `Hier: ${link}` })
    const body = decodeURIComponent((url.split('body=')[1] ?? '').replace(/%20/g, ' '))
    expect(body).toContain(link)
  })
})

describe('mailtoIstZuLang', () => {
  it('erkennt kurze URLs als unproblematisch', () => {
    expect(mailtoIstZuLang(baueMailtoUrl({ an: 'a@b.ch', betreff: 'x', text: 'kurz' }))).toBe(false)
  })

  it('erkennt zu lange URLs', () => {
    const url = baueMailtoUrl({ an: 'a@b.ch', betreff: 'x', text: 'w'.repeat(MAILTO_MAX_LAENGE + 100) })
    expect(mailtoIstZuLang(url)).toBe(true)
  })
})
