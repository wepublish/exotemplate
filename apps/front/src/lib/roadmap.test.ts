import {
  STATIONEN,
  berechneStationen,
  nurErstellteAntraege,
  type GespeicherteStation,
  type RoadmapSignale,
} from './roadmap'

// Hilfen: bequem gespeicherte Stationen und Signale bauen.
function gespeichert(overrides: Partial<GespeicherteStation> & { nr: number }): GespeicherteStation {
  return { freigegeben: null, dokument_link: null, notiz: null, ...overrides }
}

const leereSignale: RoadmapSignale = { hatAktiveDna: false, anzahlMatches: 0, antraege: [] }

describe('STATIONEN', () => {
  it('definiert genau 8 Stationen mit aufsteigenden Nummern 1..8', () => {
    expect(STATIONEN).toHaveLength(8)
    expect(STATIONEN.map((s) => s.nr)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('ordnet die Rollen korrekt zu (Medium-Stationen 1/3/5/7, We.Publish 2/4/6, gemeinsam 8)', () => {
    const wer = Object.fromEntries(STATIONEN.map((s) => [s.nr, s.wer]))
    expect(wer[1]).toBe('medium')
    expect(wer[2]).toBe('wepublish')
    expect(wer[3]).toBe('medium')
    expect(wer[4]).toBe('wepublish')
    expect(wer[5]).toBe('medium')
    expect(wer[6]).toBe('wepublish')
    expect(wer[7]).toBe('medium')
    expect(wer[8]).toBe('gemeinsam')
  })
})

describe('berechneStationen', () => {
  it('(a) frisches Medium ohne DNA/Matches/Antraege', () => {
    const out = berechneStationen([], leereSignale)
    const status = Object.fromEntries(out.map((s) => [s.nr, s.status]))
    expect(status[1]).toBe('euer_auftrag')
    expect(status[2]).toBe('in_arbeit')
    expect(status[3]).toBe('offen')
    expect(status[4]).toBe('offen')
    expect(status[8]).toBe('offen')
    // Titel und Rolle werden mit abgeleitet
    expect(out[0].titel).toBe('Organisations-Dateien')
    expect(out[0].wer).toBe('medium')
  })

  it('(b) hatAktiveDna + Matches + St3 freigegeben', () => {
    const gesp: GespeicherteStation[] = [gespeichert({ nr: 3, freigegeben: true })]
    const signale: RoadmapSignale = { hatAktiveDna: true, anzahlMatches: 5, antraege: [] }
    const out = berechneStationen(gesp, signale)
    const status = Object.fromEntries(out.map((s) => [s.nr, s.status]))
    expect(status[2]).toBe('erledigt')
    expect(status[3]).toBe('erledigt')
    expect(status[4]).toBe('erledigt')
    expect(status[5]).toBe('euer_auftrag')
  })

  it('(c) ein eingereichter Antrag → St6 und St7 erledigt', () => {
    const signale: RoadmapSignale = {
      hatAktiveDna: true,
      anzahlMatches: 3,
      antraege: [{ status: 'eingereicht' }],
    }
    const out = berechneStationen([], signale)
    const status = Object.fromEntries(out.map((s) => [s.nr, s.status]))
    expect(status[6]).toBe('erledigt')
    expect(status[7]).toBe('erledigt')
  })

  it('(d) alle Antraege zugesagt → St8 erledigt', () => {
    const signale: RoadmapSignale = {
      hatAktiveDna: true,
      anzahlMatches: 3,
      antraege: [{ status: 'zugesagt' }, { status: 'zugesagt' }],
    }
    const out = berechneStationen([], signale)
    const status = Object.fromEntries(out.map((s) => [s.nr, s.status]))
    expect(status[8]).toBe('erledigt')
  })

  it('St8 bleibt offen, solange noch ein Antrag laeuft', () => {
    const signale: RoadmapSignale = {
      hatAktiveDna: true,
      anzahlMatches: 3,
      antraege: [{ status: 'zugesagt' }, { status: 'eingereicht' }],
    }
    const out = berechneStationen([], signale)
    expect(out.find((s) => s.nr === 8)!.status).toBe('offen')
  })

  it('fehlende gespeicherte Station bricht nicht und liefert null-Felder', () => {
    const out = berechneStationen([gespeichert({ nr: 1, dokument_link: 'https://x' })], leereSignale)
    const st5 = out.find((s) => s.nr === 5)!
    expect(st5.freigegeben).toBeNull()
    expect(st5.dokument_link).toBeNull()
    expect(st5.notiz).toBeNull()
    // gespeicherte Werte werden uebernommen
    const st1 = out.find((s) => s.nr === 1)!
    expect(st1.dokument_link).toBe('https://x')
    expect(st1.status).toBe('euer_auftrag') // freigegeben war null
  })

  it('St1 erledigt, sobald freigegeben===true', () => {
    const out = berechneStationen([gespeichert({ nr: 1, freigegeben: true })], leereSignale)
    expect(out.find((s) => s.nr === 1)!.status).toBe('erledigt')
  })

  it('St7 erledigt auch ohne eingereichten Antrag, wenn manuell freigegeben', () => {
    const signale: RoadmapSignale = {
      hatAktiveDna: true,
      anzahlMatches: 3,
      antraege: [{ status: 'in_arbeit' }],
    }
    const out = berechneStationen([gespeichert({ nr: 7, freigegeben: true })], signale)
    expect(out.find((s) => s.nr === 7)!.status).toBe('erledigt')
  })
})

describe('nurErstellteAntraege', () => {
  it('listet nur Anträge mit gesetztem drive_link (Gesuch im Dossier)', () => {
    const eingang = [
      { id: 'a', drive_link: 'https://drive/x', status: 'identifiziert' },
      { id: 'b', drive_link: null, status: 'identifiziert' },
      { id: 'c', drive_link: '   ', status: 'in_arbeit' }, // nur Leerzeichen → nicht erstellt
      { id: 'd', drive_link: 'https://drive/y', status: 'eingereicht' },
    ]
    expect(nurErstellteAntraege(eingang).map((a) => a.id)).toEqual(['a', 'd'])
  })

  it('leere Eingabe ergibt leere Liste', () => {
    expect(nurErstellteAntraege([])).toEqual([])
  })
})
