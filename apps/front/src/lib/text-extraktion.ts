/**
 * text-extraktion.ts — Server-seitige Text-Extraktion aus Dateien.
 *
 * Geteilt zwischen dem manuellen Upload (/api/medium-knowledge/upload) und dem
 * automatischen datensuppe-Reader (src/lib/datensuppe.ts). qwen3.6 ist text-only,
 * daher liefern Bilder/Videos keinen verwertbaren Inhalt.
 *
 * Unterstützte Endungen:
 *   - .docx          → mammoth (Word)
 *   - .xlsx / .xls   → xlsx-Bibliothek (alle Sheets als CSV)
 *   - .pdf           → pdf-parse v2 (PDFParse-Klasse)
 *   - .txt/.csv/.md  → direkt UTF-8
 *   - andere         → kein Text
 */

import fs from 'fs'
import path from 'path'

/** Maximale Zeichen pro Datei (Schutz gegen Riesendokumente). */
export const MAX_CHARS = 20_000

/** Endungen, aus denen Text gewonnen werden kann. */
export const EXTRAHIERBARE_ENDUNGEN = ['.docx', '.xlsx', '.xls', '.pdf', '.txt', '.csv', '.md'] as const

/** True, wenn aus einer Datei mit dieser Endung Text extrahierbar ist. */
export function istExtrahierbar(dateiname: string): boolean {
  const ext = path.extname(dateiname).toLowerCase()
  return (EXTRAHIERBARE_ENDUNGEN as readonly string[]).includes(ext)
}

/**
 * Extrahiert Text aus einer Datei. Wirft NICHT — bei Fehler oder unbekanntem Typ
 * wird ein erklärender Platzhalter-String zurückgegeben (kein Absturz).
 */
export async function extrahiereText(filePath: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase()

  try {
    if (ext === '.docx') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ path: filePath })
      return result.value.slice(0, MAX_CHARS)
    }

    if (ext === '.xlsx' || ext === '.xls') {
      const XLSX = await import('xlsx')
      const workbook = XLSX.readFile(filePath)
      const lines: string[] = []
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        if (!sheet) continue
        const csv = XLSX.utils.sheet_to_csv(sheet)
        if (csv.trim()) {
          lines.push(`=== ${sheetName} ===`)
          lines.push(csv)
        }
      }
      return lines.join('\n').slice(0, MAX_CHARS)
    }

    if (ext === '.pdf') {
      // pdf-parse v2 exportiert PDFParse als Named-Export (keine Default-Funktion).
      type PdfParseModule = { PDFParse: new () => { pdf: (buf: Buffer) => Promise<{ text: string }> } }
      const mod = await import('pdf-parse') as unknown as PdfParseModule
      const buffer = fs.readFileSync(filePath)
      const parser = new mod.PDFParse()
      const data = await parser.pdf(buffer)
      return (data.text ?? '').slice(0, MAX_CHARS)
    }

    if (ext === '.txt' || ext === '.csv' || ext === '.md') {
      const raw = fs.readFileSync(filePath, 'utf-8')
      return raw.slice(0, MAX_CHARS)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `(Text-Extraktion fehlgeschlagen für ${originalName}: ${msg})`
  }

  return `(Datei gespeichert, kein Text extrahierbar: ${originalName})`
}
