/**
 * @jest-environment node
 *
 * Tests fuer gesuch-docx.ts (Task 12, Word-Export des Gesuchs).
 *
 * Reine Logik + `docx`-Bibliothek, kein IO: kein Mock noetig. Geprueft wird,
 * dass `baueGesuchDocx` einen echten docx-Buffer liefert (ZIP-Signatur `PK`,
 * > 1 kB) und dass die Hausschriften-Zuordnung (`MEDIUM_SCHRIFT` /
 * `schriftFuerMedium`) inkl. Fallback auf `Calibri` stimmt.
 *
 * `@jest-environment node` (statt des projektweiten jsdom-Defaults, siehe
 * jest.config.js): `docx`s Packer braucht `TextEncoder`, das jsdom nicht
 * global bereitstellt. Node-Umgebung statt eines Polyfills im geteilten
 * jest.setup.js, um andere Tests nicht zu beeinflussen.
 */
import { MEDIUM_SCHRIFT, schriftFuerMedium, baueGesuchDocx } from './gesuch-docx'

// Kleinstes gueltiges PNG (1x1 Pixel, transparent) - fuer den Logo-Pfad.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

describe('MEDIUM_SCHRIFT / schriftFuerMedium', () => {
  it('enthaelt die Hausschriften der sechs bekannten Medien', () => {
    expect(MEDIUM_SCHRIFT.cueltuer).toBe('Georgia')
    expect(MEDIUM_SCHRIFT['ee-news']).toBe('Montserrat')
    expect(MEDIUM_SCHRIFT.bajour).toBe('Montserrat')
    expect(MEDIUM_SCHRIFT.neue_wege).toBe('Montserrat')
    expect(MEDIUM_SCHRIFT.ganzgraz).toBe('Open Sans')
    expect(MEDIUM_SCHRIFT.vmz).toBe('Avenir')
  })

  it('liefert fuer bekannte Slugs die hinterlegte Hausschrift', () => {
    expect(schriftFuerMedium('cueltuer')).toBe('Georgia')
    expect(schriftFuerMedium('vmz')).toBe('Avenir')
  })

  it('faellt fuer unbekannte oder leere Slugs auf Calibri zurueck', () => {
    expect(schriftFuerMedium('unbekanntes_medium')).toBe('Calibri')
    expect(schriftFuerMedium('')).toBe('Calibri')
  })
})

describe('baueGesuchDocx', () => {
  it('liefert einen docx-Buffer (ZIP-Signatur PK, > 1 kB)', async () => {
    const buffer = await baueGesuchDocx({
      mediumSlug: 'wepublish',
      mediumName: 'We.Publish',
      stiftungName: 'Stiftung Test',
      text: 'Erster Absatz mit etwas Text.\n\nZweiter Absatz, ebenfalls mit Inhalt.',
      datum: new Date('2026-07-09T08:00:00Z'),
    })

    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.length).toBeGreaterThan(1024)
    expect(buffer[0]).toBe(0x50) // 'P'
    expect(buffer[1]).toBe(0x4b) // 'K'
  })

  it('baut mit einem gueltigen Logo ebenfalls einen validen docx-Buffer', async () => {
    const buffer = await baueGesuchDocx({
      mediumSlug: 'cueltuer',
      mediumName: 'cültür',
      stiftungName: 'Stiftung Kultur',
      text: 'Text mit Logo im Kopf.',
      logo: PNG_1X1,
      datum: new Date('2026-07-09T08:00:00Z'),
    })

    expect(buffer.length).toBeGreaterThan(1024)
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK')
  })

  it('ignoriert ein nicht auswertbares Logo (best effort, kein Absturz)', async () => {
    const buffer = await baueGesuchDocx({
      mediumSlug: 'ganzgraz',
      mediumName: 'ganz.graz',
      stiftungName: 'Stiftung ohne Logo',
      text: 'Text ohne brauchbares Logo.',
      logo: Buffer.from('kein-bild-hier, nur ein paar Zeichen'),
      datum: new Date('2026-07-09T08:00:00Z'),
    })

    expect(buffer.length).toBeGreaterThan(1024)
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK')
  })

  it('verwendet ohne uebergebenes Datum den aktuellen Zeitpunkt', async () => {
    const buffer = await baueGesuchDocx({
      mediumSlug: 'vmz',
      mediumName: 'vmz',
      stiftungName: 'Stiftung ohne Datum-Argument',
      text: 'Ein Absatz ohne explizites Datum.',
    })

    expect(buffer.length).toBeGreaterThan(1024)
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK')
  })
})
