import { formatDeadline, relativeDeadline, sortByDeadline, istAbgelaufen } from './ausschreibungen.helpers'

describe('formatDeadline', () => {
  it('formatiert ISO-Timestamp auf de-CH', () => {
    expect(formatDeadline('2026-06-15T00:00:00')).toBe('15.06.2026')
  })

  it('gibt null bei null zurück', () => {
    expect(formatDeadline(null)).toBeNull()
  })

  it('gibt null bei ungültigem String zurück', () => {
    expect(formatDeadline('kein-datum')).toBeNull()
  })
})

describe('relativeDeadline', () => {
  it('gibt null bei null zurück', () => {
    expect(relativeDeadline(null)).toBeNull()
  })

  it('gibt gray/abgelaufen für vergangenes Datum zurück', () => {
    const result = relativeDeadline('2020-01-01T00:00:00')
    expect(result?.variant).toBe('gray')
    expect(result?.text).toBe('abgelaufen')
  })

  it('gibt amber für Deadline innerhalb von 14 Tagen zurück', () => {
    // ISO ohne Z wird als lokale Zeit geparst. Der Helper vergleicht lokale Mitternachten
    // via UTC-Snapping. Wir prüfen nur das Variant, nicht den exakten Text,
    // um Timezone-Offsets zu umgehen.
    const now = new Date()
    // +7 Tage ab lokaler Mitternacht
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)
    const iso =
      target.getFullYear().toString().padStart(4, '0') +
      '-' +
      (target.getMonth() + 1).toString().padStart(2, '0') +
      '-' +
      target.getDate().toString().padStart(2, '0') +
      'T00:00:00'
    const result = relativeDeadline(iso)
    expect(result?.variant).toBe('amber')
    expect(result?.text).toMatch(/^in \d+ Tag(en)?$/)
  })

  it('gibt normal für Deadline in 30 Tagen zurück', () => {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30)
    const iso =
      target.getFullYear().toString().padStart(4, '0') +
      '-' +
      (target.getMonth() + 1).toString().padStart(2, '0') +
      '-' +
      target.getDate().toString().padStart(2, '0') +
      'T00:00:00'
    const result = relativeDeadline(iso)
    expect(result?.variant).toBe('normal')
  })
})

describe('istAbgelaufen', () => {
  it('vergangenes Datum = abgelaufen', () => {
    expect(istAbgelaufen('2020-01-01T00:00:00')).toBe(true)
  })

  it('ohne Deadline (null) = NICHT abgelaufen (laufend/wiederkehrend)', () => {
    expect(istAbgelaufen(null)).toBe(false)
    expect(istAbgelaufen(undefined)).toBe(false)
  })

  it('ungültiges Datum = nicht abgelaufen', () => {
    expect(istAbgelaufen('kein-datum')).toBe(false)
  })

  it('künftiges Datum = nicht abgelaufen', () => {
    const t = new Date()
    const future = new Date(t.getFullYear() + 1, t.getMonth(), t.getDate())
    const iso = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T00:00:00`
    expect(istAbgelaufen(iso)).toBe(false)
  })
})

describe('sortByDeadline', () => {
  it('sortiert aufsteigend nach Deadline, null ans Ende', () => {
    const items = [
      { id: 'c', deadline: '2026-12-01T00:00:00' },
      { id: 'a', deadline: '2026-06-01T00:00:00' },
      { id: 'b', deadline: null },
      { id: 'd', deadline: '2026-09-01T00:00:00' },
    ]
    const sorted = sortByDeadline(items)
    expect(sorted.map(i => i.id)).toEqual(['a', 'd', 'c', 'b'])
  })

  it('verändert das Original-Array nicht', () => {
    const items = [
      { id: 'b', deadline: '2026-12-01T00:00:00' },
      { id: 'a', deadline: '2026-06-01T00:00:00' },
    ]
    const original = [...items]
    sortByDeadline(items)
    expect(items.map(i => i.id)).toEqual(original.map(i => i.id))
  })
})
