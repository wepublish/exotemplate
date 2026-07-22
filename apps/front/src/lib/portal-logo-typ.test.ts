/**
 * Unit-Tests für die Bildtyp-Erkennung an den Magic Bytes (reine Logik, kein
 * IO), die /api/portal/logo beim Hochladen nutzt, um ein PNG oder JPG von
 * allem anderen (u. a. .ico, das der Word-Export nicht einbetten kann, siehe
 * gesuch-docx.ts) zu unterscheiden.
 */
import { erkenneLogoTyp } from './portal-logo'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const ICO_MAGIC = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00])
const GIF_MAGIC = Buffer.from('GIF89a')

describe('erkenneLogoTyp', () => {
  it('PNG-Magic-Bytes → "png"', () => {
    expect(erkenneLogoTyp(PNG_MAGIC)).toBe('png')
  })

  it('JPEG-Magic-Bytes → "jpg"', () => {
    expect(erkenneLogoTyp(JPG_MAGIC)).toBe('jpg')
  })

  it('ICO-Magic-Bytes → null (kein PNG/JPG, genau das bestehende .ico-Problem)', () => {
    expect(erkenneLogoTyp(ICO_MAGIC)).toBeNull()
  })

  it('GIF-Magic-Bytes → null (nicht unterstützt, nur PNG/JPG)', () => {
    expect(erkenneLogoTyp(GIF_MAGIC)).toBeNull()
  })

  it('leerer Buffer → null statt Absturz', () => {
    expect(erkenneLogoTyp(Buffer.alloc(0))).toBeNull()
  })

  it('zu kurzer Buffer (nur 2 Bytes) → null statt Absturz', () => {
    expect(erkenneLogoTyp(Buffer.from([0x89, 0x50]))).toBeNull()
  })

  it('beliebiger Text (kein Bild) → null', () => {
    expect(erkenneLogoTyp(Buffer.from('das ist kein Bild'))).toBeNull()
  })
})
