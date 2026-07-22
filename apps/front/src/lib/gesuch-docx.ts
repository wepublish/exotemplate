/**
 * gesuch-docx.ts: baut das Word-Dokument (.docx) für den Portal-Gesuch-Export
 * (Task 12, GET /api/portal/gesuch-export).
 *
 * Reine Logik + `docx`-Bibliothek, KEIN IO: Directus-/Datei-Zugriffe erledigt
 * die Route (gesuch-export.ts); diese Datei bekommt fertige Werte (Text,
 * Logo-Buffer, Namen) übergeben und liefert einen fertigen docx-Buffer
 * zurück (kein Netz, kein Directus, testbar ohne Mocks).
 *
 * Aufbau des Dokuments: A4, Kopfzeile mit Logo (falls vorhanden, Höhe auf
 * 2.2 cm gedeckelt, Seitenverhältnis erhalten) + Medienname, Titel
 * «Gesuch an <Stiftung>», Fliesstext in Absätzen (an Doppel-Zeilenumbrüchen
 * getrennt, 11 pt in der Hausschrift des Mediums), Fusszeile mit Medienname
 * + Datum.
 */
import { AlignmentType, Document, Footer, Header, ImageRun, Packer, Paragraph, TextRun } from 'docx'

// ─── Hausschrift pro Medium ─────────────────────────────────────────────────

/** Hausschrift je Medium (Slug) für Fliesstext, Kopf- und Fusszeile des Gesuch-Exports. */
export const MEDIUM_SCHRIFT: Record<string, string> = {
  cueltuer: 'Georgia',
  'ee-news': 'Montserrat',
  bajour: 'Montserrat',
  neue_wege: 'Montserrat',
  ganzgraz: 'Open Sans',
  vmz: 'Avenir',
}

/** Fallback-Hausschrift für Medien, die nicht in `MEDIUM_SCHRIFT` hinterlegt sind. */
const STANDARD_SCHRIFT = 'Calibri'

/** Hausschrift eines Mediums; unbekannte oder leere Slugs fallen auf `Calibri` zurück. */
export function schriftFuerMedium(mediumSlug: string): string {
  return MEDIUM_SCHRIFT[mediumSlug] ?? STANDARD_SCHRIFT
}

// ─── Logo: Bildtyp + -masse aus dem Buffer erkennen (kein Zusatzpaket nötig) ─

type DocxBildTyp = 'png' | 'jpg' | 'gif' | 'bmp'

/**
 * Erkennt den Bildtyp anhand der Magic Bytes. null, wenn keiner der vier von
 * `docx`s `ImageRun` unterstützten Typen erkannt wird (z. B. .ico oder .svg,
 * die medium-logo.ts ebenfalls liefern kann) - der Aufrufer lässt das Logo
 * dann einfach weg (best effort, kein Fehlerfall).
 */
function erkenneBildTyp(buffer: Buffer): DocxBildTyp | null {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 3) === 'GIF') return 'gif'
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp'
  return null
}

/** Liest Breite/Höhe aus dem Bild-Header. null, wenn der Header nicht auswertbar ist (defensiv, kein Absturz). */
function leseBildmasse(buffer: Buffer, typ: DocxBildTyp): { breite: number; hoehe: number } | null {
  try {
    if (typ === 'png') {
      if (buffer.length < 24) return null
      const breite = buffer.readUInt32BE(16)
      const hoehe = buffer.readUInt32BE(20)
      return breite > 0 && hoehe > 0 ? { breite, hoehe } : null
    }
    if (typ === 'gif') {
      if (buffer.length < 10) return null
      const breite = buffer.readUInt16LE(6)
      const hoehe = buffer.readUInt16LE(8)
      return breite > 0 && hoehe > 0 ? { breite, hoehe } : null
    }
    if (typ === 'bmp') {
      if (buffer.length < 26) return null
      const breite = buffer.readInt32LE(18)
      const hoehe = Math.abs(buffer.readInt32LE(22))
      return breite > 0 && hoehe > 0 ? { breite, hoehe } : null
    }
    // jpg: Marker-Kette absuchen, bis das SOFn-Segment (Breite/Höhe) kommt.
    let i = 2
    while (i + 9 < buffer.length) {
      if (buffer[i] !== 0xff) {
        i += 1
        continue
      }
      const marker = buffer[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      if (marker === 0xd9) break // EOI
      const segmentLaenge = buffer.readUInt16BE(i + 2)
      const istSofSegment = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (istSofSegment) {
        const hoehe = buffer.readUInt16BE(i + 5)
        const breite = buffer.readUInt16BE(i + 7)
        return breite > 0 && hoehe > 0 ? { breite, hoehe } : null
      }
      i += 2 + segmentLaenge
    }
    return null
  } catch {
    return null
  }
}

/** Maximale Logo-Höhe im Kopf: 2.2 cm, umgerechnet in Pixel bei 96 dpi (docx-`ImageRun`-Transformation ist px-basiert). */
const LOGO_MAX_HOEHE_PX = Math.round((22 / 25.4) * 96)

/**
 * Baut den `ImageRun` fürs Logo, Höhe auf `LOGO_MAX_HOEHE_PX` gedeckelt,
 * Seitenverhältnis anhand der echten Bildmasse erhalten. null bei fehlendem,
 * leerem oder nicht auswertbarem Logo (best effort: der Rest des Dokuments
 * entsteht in jedem Fall).
 */
function baueLogoRun(logo: Buffer | undefined): ImageRun | null {
  if (!logo || logo.length === 0) return null
  const typ = erkenneBildTyp(logo)
  if (!typ) return null
  const masse = leseBildmasse(logo, typ)
  if (!masse) return null

  const hoehe = LOGO_MAX_HOEHE_PX
  const breite = Math.max(1, Math.round((masse.breite / masse.hoehe) * hoehe))
  return new ImageRun({ type: typ, data: logo, transformation: { width: breite, height: hoehe } })
}

// ─── Fliesstext in Absätze ──────────────────────────────────────────────────

/** Trennt den Gesuchtext an Doppel-Zeilenumbrüchen in Absätze; leere Absätze fallen weg. */
function absaetzeAus(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((abs) => abs.trim())
    .filter((abs) => abs.length > 0)
}

// ─── Dokument bauen ──────────────────────────────────────────────────────────

export type GesuchDocxArgs = {
  mediumSlug: string
  mediumName: string
  stiftungName: string
  text: string
  logo?: Buffer
  /** Datum für die Fusszeile. Default `new Date()`; die Route übergibt es i. d. R. explizit für deterministisches Verhalten. */
  datum?: Date
}

/**
 * Baut das Gesuch als Word-Dokument und liefert den fertigen docx-Buffer
 * (ZIP-Container, beginnt mit den Bytes `PK`).
 */
export async function baueGesuchDocx(args: GesuchDocxArgs): Promise<Buffer> {
  const schrift = schriftFuerMedium(args.mediumSlug)
  const datum = args.datum ?? new Date()
  const datumText = datum.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const logoRun = baueLogoRun(args.logo)

  const kopf = new Header({
    children: [
      new Paragraph({
        children: [
          ...(logoRun ? [logoRun, new TextRun({ text: '   ' })] : []),
          new TextRun({ text: args.mediumName, bold: true, font: schrift, size: 24 }),
        ],
      }),
    ],
  })

  const fuss = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `${args.mediumName} · ${datumText}`, font: schrift, size: 16 })],
      }),
    ],
  })

  const titel = new Paragraph({
    children: [new TextRun({ text: `Gesuch an ${args.stiftungName}`, bold: true, font: schrift, size: 28 })],
    spacing: { after: 300 },
  })

  const absaetze = absaetzeAus(args.text).map(
    (abs) =>
      new Paragraph({
        children: [new TextRun({ text: abs, font: schrift, size: 22 })],
        spacing: { after: 200 },
      }),
  )

  const dokument = new Document({
    sections: [
      {
        properties: { page: { size: { width: '210mm', height: '297mm' } } },
        headers: { default: kopf },
        footers: { default: fuss },
        children: [titel, ...absaetze],
      },
    ],
  })

  return Packer.toBuffer(dokument)
}
