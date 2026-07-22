import { PROVISION_SATZ, PROVISION_MIN_CHF, PROVISION_MAX_CHF, berechneProvision } from './provision'

describe('berechneProvision', () => {
  it('Konstanten sind korrekt (10 %, Minimum CHF 1\'000, Maximum CHF 10\'000)', () => {
    expect(PROVISION_SATZ).toBe(0.10)
    expect(PROVISION_MIN_CHF).toBe(1000)
    expect(PROVISION_MAX_CHF).toBe(10000)
  })

  it('0 ergibt 0 (kein Betrag, keine Provision)', () => {
    expect(berechneProvision(0)).toBe(0)
  })

  it('5\'000 ergibt 1\'000 (10 % wären 500, Minimum greift)', () => {
    expect(berechneProvision(5000)).toBe(1000)
  })

  it('50\'000 ergibt 5\'000 (10 % ohne Klammerung)', () => {
    expect(berechneProvision(50000)).toBe(5000)
  })

  it('200\'000 ergibt 10\'000 (10 % wären 20\'000, Deckel greift)', () => {
    expect(berechneProvision(200000)).toBe(10000)
  })

  it('negativer Betrag ergibt 0', () => {
    expect(berechneProvision(-5000)).toBe(0)
  })

  it('9\'999 ergibt 1\'000 (10 % wären 999.90, knapp unter der Minimum-Grenze)', () => {
    expect(berechneProvision(9999)).toBe(1000)
  })

  it('100\'000 ergibt 10\'000 (10 % wären genau 10\'000, an der Obergrenze)', () => {
    expect(berechneProvision(100000)).toBe(10000)
  })
})
