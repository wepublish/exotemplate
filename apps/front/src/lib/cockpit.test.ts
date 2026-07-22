import { baueHeute, type Zaehler } from './cockpit'

const leer: Zaehler = { sichten: 0, freigeben: 0, nachfassen: 0, frist: 0, ausgang: 0 }

test('leere Zaehler ergeben keine Handgriffe', () => {
  expect(baueHeute(leer)).toEqual([])
})

test('priorisiert Frist vor Nachfassen vor Freigeben vor Sichten', () => {
  const a = baueHeute({ sichten: 4, freigeben: 2, nachfassen: 1, frist: 3, ausgang: 0 })
  expect(a.map((x) => x.key)).toEqual(['frist', 'nachfassen', 'freigeben', 'sichten'])
})

test('blendet Kategorien mit 0 aus', () => {
  const a = baueHeute({ sichten: 4, freigeben: 0, nachfassen: 0, frist: 0, ausgang: 0 })
  expect(a.map((x) => x.key)).toEqual(['sichten'])
  expect(a[0].anzahl).toBe(4)
  expect(a[0].href).toBe('/sichten')
})

test('markiert Frist und Nachfassen als dringend', () => {
  const a = baueHeute({ sichten: 1, freigeben: 1, nachfassen: 1, frist: 1, ausgang: 0 })
  const dringend = Object.fromEntries(a.map((x) => [x.key, x.dringend]))
  expect(dringend).toEqual({ frist: true, nachfassen: true, freigeben: false, sichten: false })
})

test('ausgang-Handgriff erscheint mit Anzahl und Applications-Link', () => {
  const h = baueHeute({ ...leer, ausgang: 4 })
  expect(h).toHaveLength(1)
  expect(h[0].key).toBe('ausgang')
  expect(h[0].titel).toContain('4')
  expect(h[0].href).toBe('/applications')
})

test('ausgang rangiert nach nachfassen, vor freigeben', () => {
  const h = baueHeute({ ...leer, nachfassen: 1, ausgang: 1, freigeben: 1 })
  expect(h.map(x => x.key)).toEqual(['nachfassen', 'ausgang', 'freigeben'])
})
