import { entferneStiftungGlobal, nimmStiftungWiederAuf } from './foerderstatus'

describe('entferneStiftungGlobal', () => {
  it('setzt Flag false und löscht alle Match-Treffer', async () => {
    const calls: string[] = []
    const res = await entferneStiftungGlobal({
      setStatus: async ist => { calls.push(`status:${ist}`) },
      ladeMatchIds: async () => ['1', '2', '3'],
      loescheMatches: async ids => { calls.push(`del:${ids.join(',')}`) },
    })
    expect(res.geloeschteMatches).toBe(3)
    // Flag-Flip kommt VOR dem Löschen.
    expect(calls[0]).toBe('status:false')
    expect(calls).toContain('del:1,2,3')
  })

  it('löscht in Stapeln zu 100', async () => {
    const viele = Array.from({ length: 250 }, (_, i) => String(i))
    const stapelGroessen: number[] = []
    await entferneStiftungGlobal({
      setStatus: async () => {},
      ladeMatchIds: async () => viele,
      loescheMatches: async ids => { stapelGroessen.push(ids.length) },
    })
    expect(stapelGroessen).toEqual([100, 100, 50])
  })

  it('ruft loescheMatches nicht auf wenn keine Treffer', async () => {
    let geloescht = false
    const res = await entferneStiftungGlobal({
      setStatus: async () => {},
      ladeMatchIds: async () => [],
      loescheMatches: async () => { geloescht = true },
    })
    expect(res.geloeschteMatches).toBe(0)
    expect(geloescht).toBe(false)
  })
})

describe('nimmStiftungWiederAuf', () => {
  it('setzt Flag true', async () => {
    let val: boolean | null = null
    await nimmStiftungWiederAuf({ setStatus: async ist => { val = ist } })
    expect(val).toBe(true)
  })
})
