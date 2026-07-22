import {
  bauGesuchPrompt, ablagePfad, ablageAnzeige, formularBlock, type GesuchPromptDaten,
} from './gesuch-prompt'

const daten: GesuchPromptDaten = {
  mediumName: 'bajour',
  mediumSlug: 'bajour',
  mediumSound: 'Lokaljournalismus aus Basel, nah und unabhängig',
  mediumTags: ['lokaljournalismus', 'basel', 'community'],
  stiftungName: 'Stiftung Mercator Schweiz',
  stiftungSitz: 'Zürich',
  stiftungLand: 'CH',
  stiftungZweck: 'Förderung von Medienvielfalt und Bildung',
  stiftungFoerderpraxis: 'Projektförderung, mittlere Beträge',
  stiftungSound: 'sachlich, wirkungsorientiert',
  matchBegruendung: 'Beide setzen auf Medienvielfalt und demokratische Teilhabe.',
  betragChf: 25000,
  lernhinweise: ['Stiftung mag konkrete Wirkungszahlen', 'kein Fokus auf Print'],
  formular: null,
  paradegesuch: null,
  paradegesuchRef: null,
}

describe('ablagePfad', () => {
  it('baut einen ASCII-snake_case-Pfad mit Medium und Stiftung', () => {
    expect(ablagePfad('bajour', 'Stiftung Mercator Schweiz')).toBe(
      'bajour/02_antraege_work_in_progress/stiftung_mercator_schweiz/',
    )
  })
  it('wandelt Umlaute um und fällt auf "stiftung" zurück', () => {
    expect(ablagePfad('m', 'Ärztekasse')).toBe('m/02_antraege_work_in_progress/arztekasse/')
    expect(ablagePfad('m', '!!!')).toBe('m/02_antraege_work_in_progress/stiftung/')
  })
})

describe('ablageAnzeige', () => {
  it('mappt abweichende Slugs auf den echten Drive-Ordner', () => {
    expect(ablageAnzeige('wepublish/02_antraege_work_in_progress/x/')).toBe(
      'Fundraising wepublish/02_antraege_work_in_progress/x/',
    )
    expect(ablageAnzeige('neue_wege/02_antraege_work_in_progress/y/')).toBe(
      'neue-wege/02_antraege_work_in_progress/y/',
    )
  })
  it('lässt identische Slugs und Leeres unverändert', () => {
    expect(ablageAnzeige('bajour/02_antraege_work_in_progress/z/')).toBe(
      'bajour/02_antraege_work_in_progress/z/',
    )
    expect(ablageAnzeige('')).toBe('')
  })
})

describe('bauGesuchPrompt', () => {
  const p = bauGesuchPrompt(daten)
  it('nennt Medium und Stiftung', () => {
    expect(p).toContain('bajour')
    expect(p).toContain('Stiftung Mercator Schweiz')
  })
  it('arbeitet die Matching-Begründung ein', () => {
    expect(p).toContain('Medienvielfalt und demokratische Teilhabe')
  })
  it('enthält Goldstandard-Anweisungen und Vertraulichkeit', () => {
    expect(p).toContain('ersten drei bis fünf Sätze')
    expect(p).toContain('NIE als Beilage')
  })
  it('enthält den Ablagepfad und den Betrag', () => {
    expect(p).toContain('02_antraege_work_in_progress')
    expect(p).toContain("25'000")
  })
  it('zeigt in der ABLAGE-Zeile den echten Drive-Ordner (nicht den Slug)', () => {
    const wp = bauGesuchPrompt({ ...daten, mediumSlug: 'wepublish' })
    expect(wp).toContain('Fundraising wepublish/02_antraege_work_in_progress')
    expect(wp).not.toContain('\nwepublish/02_antraege_work_in_progress')
  })
  it('ohne Betrag keine Betrags-Zeile', () => {
    const ohne = bauGesuchPrompt({ ...daten, betragChf: null })
    expect(ohne).not.toContain('Grössenordnung')
  })
  it('arbeitet gelernte Hinweise ein, lässt sie weg wenn leer', () => {
    expect(p).toContain('GELERNTE HINWEISE')
    expect(p).toContain('konkrete Wirkungszahlen')
    const ohne = bauGesuchPrompt({ ...daten, lernhinweise: [] })
    expect(ohne).not.toContain('GELERNTE HINWEISE')
  })
  it('ohne Formular keinen Formular-Block', () => {
    expect(p).not.toContain('FELDWEISE LIEFERN')
  })
  it('erzwingt Phase 1 (Intensivrecherche) vor Phase 2 (Schreiben)', () => {
    expect(p).toContain('PHASE 1')
    expect(p).toContain('PHASE 2')
    expect(p.indexOf('PHASE 1')).toBeLessThan(p.indexOf('PHASE 2'))
    expect(p).toContain('intensiv')
  })
  it('verlangt die Pruefung auf ein Einreiche-Formular auch ohne erfasste Felder', () => {
    const ohne = bauGesuchPrompt({ ...daten, formular: null })
    expect(ohne).toContain('Einreiche-Formular')
    expect(ohne).toContain('ermittle den Einreichungsweg')
  })
  it('nutzt erfasste Formularfelder als gesicherte Wahrheit, wenn vorhanden', () => {
    const mit = bauGesuchPrompt({
      ...daten,
      formular: { art: 'online_formular', felder: [{ feld: 'Titel' }] },
    })
    expect(mit).toContain('gesicherte Wahrheit')
    expect(mit).toContain('FELDWEISE LIEFERN')
  })
  it('verbietet, den Betrag aus Recherche oder Paradegesuch abzuleiten', () => {
    expect(p).toContain('NICHT aus deiner Recherche')
  })
  it('macht den DNA-Trigger explizit (sofort angesprochen)', () => {
    expect(p).toContain('genau unser Thema')
    expect(p).toContain('Herzstück des Gesuchs')
  })
  it('bettet das Paradegesuch ein (Volltext-Modus, fuer den Text-Loop)', () => {
    const mit = bauGesuchPrompt({ ...daten, paradegesuch: 'BAJOUR PARADE TEXT mit belegten Fakten.' })
    expect(mit).toContain('--- PARADEGESUCH ANFANG ---')
    expect(mit).toContain('BAJOUR PARADE TEXT mit belegten Fakten.')
    expect(mit).toContain('--- PARADEGESUCH ENDE ---')
    expect(mit).toContain('oben eingefügten Paradegesuchs')
  })
  it('VERWEIST im Verweis-Modus auf die Drive-Datei, statt sie einzubetten', () => {
    const mit = bauGesuchPrompt({
      ...daten,
      paradegesuchRef: { datei: 'PARADE-GESUCH_bajour.docx', drivePfad: 'bajour/05_paradegesuch/PARADE-GESUCH_bajour.docx' },
    })
    // Datei wird benannt und im Drive verortet
    expect(mit).toContain('PARADE-GESUCH_bajour.docx')
    expect(mit).toContain('Fundraising/FaaS/bajour/05_paradegesuch/PARADE-GESUCH_bajour.docx')
    // Anweisung, die Datei selbst zu öffnen, und worauf sie verbindlich ist
    expect(mit).toContain('Öffne diese Datei ZUERST')
    expect(mit).toContain('Schriftart')
    expect(mit).toContain('Logo')
    expect(mit).toContain('Grafiken')
    // KEIN eingebetteter Volltext im Verweis-Modus
    expect(mit).not.toContain('--- PARADEGESUCH ANFANG ---')
    // In Phase 1 wird das Öffnen als erste Aktion verlangt
    expect(mit).toContain('Öffne ZUERST das oben verwiesene Paradegesuch')
  })
  it('Verweis-Modus hat Vorrang vor eingebettetem Volltext', () => {
    const mit = bauGesuchPrompt({
      ...daten,
      paradegesuch: 'SOLLTE NICHT EINGEBETTET WERDEN',
      paradegesuchRef: { datei: 'PARADE.docx', drivePfad: 'bajour/05_paradegesuch/PARADE.docx' },
    })
    expect(mit).not.toContain('--- PARADEGESUCH ANFANG ---')
    expect(mit).not.toContain('SOLLTE NICHT EINGEBETTET WERDEN')
    expect(mit).toContain('PARADE.docx')
  })
  it('Verweis-Modus ohne Dateinamen: reiner Ordner-Verweis', () => {
    const mit = bauGesuchPrompt({
      ...daten,
      paradegesuchRef: { datei: null, drivePfad: 'bajour/05_paradegesuch' },
    })
    expect(mit).toContain('Fundraising/FaaS/bajour/05_paradegesuch/')
    expect(mit).toContain('«parade» im Namen')
    expect(mit).not.toContain('--- PARADEGESUCH ANFANG ---')
  })
  it('ohne Paradegesuch keinen Parade-Block und sauberer Fallback', () => {
    expect(p).not.toContain('--- PARADEGESUCH ANFANG ---')
    expect(p).not.toContain('Öffne diese Datei ZUERST')
    expect(p).toContain('kein Paradegesuch hinterlegt')
  })
})

describe('formularBlock', () => {
  it('ist leer ohne Felder', () => {
    expect(formularBlock(null)).toBe('')
    expect(formularBlock({ felder: [] })).toBe('')
    expect(formularBlock({ art: 'online_formular', felder: [{ feld: '   ' }] })).toBe('')
  })
  it('listet Felder mit Längenvorgabe und Einheit', () => {
    const b = formularBlock({
      art: 'online_formular',
      hinweis: 'Einreichung nur über das Portal',
      felder: [
        { feld: 'Projektbeschreibung', max: 1500, einheit: 'zeichen' },
        { feld: 'Wirkung', max: 200, einheit: 'woerter', hinweis: 'messbar' },
        { feld: 'Titel' },
      ],
    })
    expect(b).toContain('FELDWEISE LIEFERN')
    expect(b).toContain('online_formular')
    expect(b).toContain('Einreichung nur über das Portal')
    expect(b).toContain('«Projektbeschreibung» — maximal 1500 Zeichen')
    expect(b).toContain('«Wirkung» — maximal 200 Wörter (messbar)')
    expect(b).toContain('«Titel»')
  })
})
