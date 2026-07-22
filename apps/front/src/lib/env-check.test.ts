import { fehlendePflichtEnvs, warneEinmalig, __resetWarnungFuerTests } from './env-check'

const VOLLSTAENDIG = {
  DIRECTUS_URL: 'http://localhost:8055',
  DIRECTUS_TOKEN: 'geheim',
  PORTAL_SESSION_SECRET: 'ein-langes-zufälliges-geheimnis',
  PORTAL_BASE_URL: 'https://matching.winkelriedtoechter.ch',
}

describe('fehlendePflichtEnvs', () => {
  it('meldet nichts, wenn alle Pflicht-Envs gesetzt sind', () => {
    expect(fehlendePflichtEnvs(VOLLSTAENDIG)).toEqual([])
  })

  it('meldet eine einzelne fehlende Variable', () => {
    const { DIRECTUS_TOKEN: _weg, ...rest } = VOLLSTAENDIG
    expect(fehlendePflichtEnvs(rest)).toEqual(['DIRECTUS_TOKEN'])
  })

  it('behandelt einen leeren String wie fehlend', () => {
    expect(fehlendePflichtEnvs({ ...VOLLSTAENDIG, PORTAL_BASE_URL: '' })).toEqual(['PORTAL_BASE_URL'])
  })

  it('meldet mehrere fehlende Variablen in fester Reihenfolge', () => {
    expect(fehlendePflichtEnvs({})).toEqual([
      'DIRECTUS_URL',
      'DIRECTUS_TOKEN',
      'PORTAL_SESSION_SECRET',
      'PORTAL_BASE_URL',
    ])
  })

  it('ignoriert Variablen, die nicht zur Pflichtliste gehören', () => {
    expect(fehlendePflichtEnvs({ ...VOLLSTAENDIG, LLM_URL: undefined })).toEqual([])
  })
})

describe('warneEinmalig', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    __resetWarnungFuerTests()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('loggt eine einzige Warnzeile mit den fehlenden Envs', () => {
    warneEinmalig({})
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const zeile = warnSpy.mock.calls[0][0] as string
    expect(zeile).toContain('DIRECTUS_URL')
    expect(zeile).toContain('DIRECTUS_TOKEN')
    expect(zeile).toContain('PORTAL_SESSION_SECRET')
    expect(zeile).toContain('PORTAL_BASE_URL')
  })

  it('warnt beim zweiten Aufruf nicht mehr, auch wenn immer noch etwas fehlt', () => {
    warneEinmalig({})
    warneEinmalig({})
    warneEinmalig({})
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('bleibt still, wenn alle Pflicht-Envs gesetzt sind', () => {
    warneEinmalig(VOLLSTAENDIG)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('warnt bei einem späteren Aufruf noch, wenn der erste Aufruf vollständig war und schweigt danach dauerhaft', () => {
    // Einmal-Flag greift unabhängig vom Ergebnis: sobald einmal geprüft wurde,
    // wird nie wieder gewarnt (auch wenn sich der Zustand danach verschlechtert).
    warneEinmalig(VOLLSTAENDIG)
    warneEinmalig({})
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
