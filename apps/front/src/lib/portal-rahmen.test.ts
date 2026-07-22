/**
 * Test der Rahmen-Wahl in _app.tsx (waehleRahmen). Liegt unter src/lib statt
 * neben _app.tsx, weil eine Datei src/pages/_app.test.tsx von Next als
 * eigene Seite (Route /_app.test) behandelt würde.
 */
import { waehleRahmen } from '../pages/_app'

describe('waehleRahmen (_app.tsx)', () => {
  it('/portal/login bleibt rahmenlos', () => {
    expect(waehleRahmen('/portal/login')).toBe('ohne_rahmen')
  })

  it('/portal bekommt das PortalLayout', () => {
    expect(waehleRahmen('/portal')).toBe('portal')
  })

  it('/portal/dna (Folgetask-Seite) bekommt das PortalLayout', () => {
    expect(waehleRahmen('/portal/dna')).toBe('portal')
  })

  it('/portal-steuerung ist eine Operator-Seite und bleibt in der normalen Sidebar', () => {
    expect(waehleRahmen('/portal-steuerung')).toBe('operator')
  })
})
