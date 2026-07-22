/**
 * Tests für bildeBatches aus working-dna.ts.
 */

import { bildeBatches } from '@/pages/api/medium-knowledge/working-dna'

const ei = (category: string, title: string, content: string) => ({ category, title, content })

describe('bildeBatches', () => {
  it('gibt leeres Array zurück bei leerer Eingabe', () => {
    const { batches, gekappt } = bildeBatches([], 14_000, 15)
    expect(batches).toEqual([])
    expect(gekappt).toBe(false)
  })

  it('fasst kleine Einträge in einen Batch', () => {
    const eintraege = [
      ei('artikel', 'Titel A', 'Inhalt A'),
      ei('artikel', 'Titel B', 'Inhalt B'),
    ]
    const { batches, gekappt } = bildeBatches(eintraege, 14_000, 15)
    expect(batches).toHaveLength(1)
    expect(gekappt).toBe(false)
    expect(batches[0]).toContain('[artikel] Titel A')
    expect(batches[0]).toContain('[artikel] Titel B')
  })

  it('teilt bei Überschreitung der Zeichengrenze in mehrere Batches', () => {
    const grosserInhalt = 'x'.repeat(8_000)
    const eintraege = [
      ei('artikel', 'Titel A', grosserInhalt),
      ei('artikel', 'Titel B', grosserInhalt),
      ei('artikel', 'Titel C', grosserInhalt),
    ]
    const { batches, gekappt } = bildeBatches(eintraege, 14_000, 15)
    // Jeder Eintrag ist ~8k Zeichen; A+B passen in einen Batch (16k > 14k → trennen)
    expect(batches.length).toBeGreaterThanOrEqual(2)
    expect(gekappt).toBe(false)
  })

  it('kürzt auf maxBatches und setzt gekappt=true', () => {
    const eintraege = Array.from({ length: 20 }, (_, i) =>
      ei('artikel', `Titel ${i}`, 'x'.repeat(8_000))
    )
    const { batches, gekappt } = bildeBatches(eintraege, 14_000, 3)
    expect(batches.length).toBeLessThanOrEqual(3)
    expect(gekappt).toBe(true)
  })

  it('setzt gekappt=false wenn maxBatches nicht erreicht wird', () => {
    const eintraege = [ei('artikel', 'Einziger', 'kurzer Inhalt')]
    const { gekappt } = bildeBatches(eintraege, 14_000, 15)
    expect(gekappt).toBe(false)
  })
})
