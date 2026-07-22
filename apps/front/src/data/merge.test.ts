import { mergeMatches } from './merge'

test('join match + stiftung + dna by string-normalized id; konfidenz from datenbasis', () => {
  const out = mergeMatches(
    [{ id: '1', stiftung_id: 9, score: 87, begruendung: 'x', score_breakdown: {} }],
    [{ id: '9', Stiftungsname: 'Test-Stiftung', webseite: 'u', foerdersummen_range: '20-80k' }],
    [{ stiftung_id: { id: '9' }, tags: [{ tag_slug: 'a', gewicht: 3, begruendung: 'b' }], sound_feeling: 's', schaerfe_prozent: 80, quellen: { datenbasis: 'stammdaten+webseite' } }],
  )
  expect(out[0]).toMatchObject({ name: 'Test-Stiftung', stiftungId: '9', score: 87, konfidenz: 'web', schaerfe: 80, betrag: '20-80k' })
  expect(out[0].tags).toHaveLength(1)
})

test('konfidenz stammdaten-only and missing dna', () => {
  const out = mergeMatches(
    [{ id: '2', stiftung_id: 5, score: 50 }],
    [{ id: '5', Stiftungsname: 'Nackt' }],
    [{ stiftung_id: { id: '5' }, tags: [], sound_feeling: '', schaerfe_prozent: 40, quellen: { datenbasis: 'stammdaten' } }],
  )
  expect(out[0]).toMatchObject({ konfidenz: 'stammdaten', schaerfe: 40, tags: [] })
})

test('datenbasis as ARRAY (alt-DNA) does not crash and maps konfidenz', () => {
  const run = () => mergeMatches(
    [{ id: '3', stiftung_id: 7, score: 60 }, { id: '4', stiftung_id: 8, score: 55 }],
    [{ id: '7', Stiftungsname: 'A' }, { id: '8', Stiftungsname: 'B' }],
    [
      { stiftung_id: { id: '7' }, tags: [], quellen: { datenbasis: ['stammdaten', 'webseite'] } },
      { stiftung_id: { id: '8' }, tags: [], quellen: { datenbasis: null } },
    ],
  )
  expect(run).not.toThrow()
  const out = run()
  expect(out[0].konfidenz).toBe('web')        // array enthält 'webseite'
  expect(out[1].konfidenz).toBe('unbekannt')  // null
})
