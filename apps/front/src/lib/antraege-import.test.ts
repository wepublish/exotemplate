import { normName, defaultStatus, istErfasst, nichtErfasst, type ScanEintrag } from './antraege-import'

const e = (medium: string, ordner: string, url: string, sub = '02_antraege_work_in_progress'): ScanEintrag => ({
  medium, ordner, unterordner: sub, drive_url: url,
})

describe('normName', () => {
  it('faltet Umlaute, entfernt Sonderzeichen, klein', () => {
    expect(normName('Greulich Stiftung Kulturpreis')).toBe('greulichstiftungkulturpreis')
    expect(normName('greulich_stiftung_kulturpreis')).toBe('greulichstiftungkulturpreis')
    expect(normName('Römisch-Katholische')).toBe('romischkatholische')
  })
})

describe('defaultStatus', () => {
  it('Archiv -> archiviert, sonst in_arbeit', () => {
    expect(defaultStatus('04_archiv')).toBe('archiviert')
    expect(defaultStatus('02_antraege_work_in_progress')).toBe('in_arbeit')
  })
})

describe('istErfasst / nichtErfasst', () => {
  it('Treffer über drive_link', () => {
    const apps = [{ medium_id: 'cueltuer', stiftung_name: 'X', drive_link: 'https://drive/abc' }]
    expect(istErfasst(e('cueltuer', 'irgendwas', 'https://drive/abc'), apps)).toBe(true)
  })

  it('Treffer über normalisierten Namen (Ordner vs Stiftungsname, gleiches Medium)', () => {
    const apps = [{ medium_id: 'cueltuer', stiftung_name: 'Greulich Stiftung Kulturpreis', drive_link: null }]
    expect(istErfasst(e('cueltuer', 'greulich_stiftung_kulturpreis', 'https://drive/neu'), apps)).toBe(true)
  })

  it('kein Treffer bei anderem Medium', () => {
    const apps = [{ medium_id: 'bajour', stiftung_name: 'Greulich Stiftung Kulturpreis', drive_link: null }]
    expect(istErfasst(e('cueltuer', 'greulich_stiftung_kulturpreis', 'https://drive/neu'), apps)).toBe(false)
  })

  it('nichtErfasst filtert die schon erfassten heraus', () => {
    const apps = [{ medium_id: 'cueltuer', stiftung_name: 'Greulich', drive_link: 'https://drive/g' }]
    const scan = [
      e('cueltuer', 'greulich', 'https://drive/g'),
      e('bajour', 'rtr_forderung', 'https://drive/r'),
    ]
    expect(nichtErfasst(scan, apps).map((x) => x.ordner)).toEqual(['rtr_forderung'])
  })
})
