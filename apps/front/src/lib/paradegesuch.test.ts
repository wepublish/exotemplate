import { waehleParadeDocx } from './paradegesuch'

describe('waehleParadeDocx', () => {
  it('wählt die docx mit «parade» im Namen', () => {
    expect(
      waehleParadeDocx([
        '/datensuppe/bajour/05_paradegesuch/PARADE-GESUCH_bajour.docx',
      ]),
    ).toBe('/datensuppe/bajour/05_paradegesuch/PARADE-GESUCH_bajour.docx')
  })

  it('schliesst Projekt-/Formular-docx ohne «parade» aus (wepublish-Fall)', () => {
    const pfade = [
      '/datensuppe/Fundraising wepublish/05_paradegesuch/exoskelett/00 Gesuch_WePublish_ZEIT-Stiftung FINAL.docx',
      '/datensuppe/Fundraising wepublish/05_paradegesuch/exoskelett/05 We.Publish_Jahresbericht_2025.docx',
      '/datensuppe/Fundraising wepublish/05_paradegesuch/standard/paradegesuch_wepublish.docx',
    ]
    expect(waehleParadeDocx(pfade)).toBe(
      '/datensuppe/Fundraising wepublish/05_paradegesuch/standard/paradegesuch_wepublish.docx',
    )
  })

  it('gibt null zurück, wenn keine «parade»-docx vorhanden ist', () => {
    expect(waehleParadeDocx(['/x/y/Jahresbericht.docx', '/x/y/budget.docx'])).toBeNull()
    expect(waehleParadeDocx([])).toBeNull()
  })

  it('bevorzugt bei mehreren Treffern den kürzesten Pfad (oberste Ebene)', () => {
    const pfade = [
      '/m/05_paradegesuch/unter/PARADE_alt.docx',
      '/m/05_paradegesuch/PARADE.docx',
    ]
    expect(waehleParadeDocx(pfade)).toBe('/m/05_paradegesuch/PARADE.docx')
  })
})
