/**
 * Tests für die reinen/lokalen Teile des datensuppe-Readers.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { findeMediumOrdner } from './datensuppe'
import { istExtrahierbar } from './text-extraktion'

describe('istExtrahierbar', () => {
  it('akzeptiert Text-/Dokument-Endungen', () => {
    expect(istExtrahierbar('artikel.pdf')).toBe(true)
    expect(istExtrahierbar('Newsletter.docx')).toBe(true)
    expect(istExtrahierbar('budget.xlsx')).toBe(true)
    expect(istExtrahierbar('notiz.TXT')).toBe(true) // case-insensitiv
    expect(istExtrahierbar('liste.csv')).toBe(true)
    expect(istExtrahierbar('readme.md')).toBe(true)
  })

  it('lehnt Bilder und Unbekanntes ab', () => {
    expect(istExtrahierbar('logo.png')).toBe(false)
    expect(istExtrahierbar('foto.jpg')).toBe(false)
    expect(istExtrahierbar('clip.mp4')).toBe(false)
    expect(istExtrahierbar('archiv.zip')).toBe(false)
    expect(istExtrahierbar('ohne_endung')).toBe(false)
  })
})

describe('findeMediumOrdner (Slug-Mapping Drive ↔ App)', () => {
  let basis: string

  beforeAll(() => {
    basis = fs.mkdtempSync(path.join(os.tmpdir(), 'datensuppe-test-'))
    // Drive nutzt Bindestriche, die App teils Unterstriche.
    fs.mkdirSync(path.join(basis, 'neue-wege', '01_datensuppe'), { recursive: true })
    fs.mkdirSync(path.join(basis, 'bajour', '01_datensuppe'), { recursive: true })
    // Ein Ordner OHNE 01_datensuppe darf nicht als Treffer gelten.
    fs.mkdirSync(path.join(basis, 'leer'), { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(basis, { recursive: true, force: true })
  })

  it('findet den Bindestrich-Ordner für einen Unterstrich-Slug', () => {
    expect(findeMediumOrdner(basis, 'neue_wege')).toBe('neue-wege')
  })

  it('findet den identischen Ordner', () => {
    expect(findeMediumOrdner(basis, 'bajour')).toBe('bajour')
  })

  it('gibt null zurück, wenn kein 01_datensuppe-Unterordner existiert', () => {
    expect(findeMediumOrdner(basis, 'leer')).toBeNull()
  })

  it('gibt null für ein unbekanntes Medium zurück', () => {
    expect(findeMediumOrdner(basis, 'gibtsnicht')).toBeNull()
  })
})
