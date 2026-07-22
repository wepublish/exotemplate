/**
 * paradegesuch.ts — Liest das medienspezifische Paradegesuch live aus dem
 * datensuppe-Mount (<medium>/05_paradegesuch/) und gibt den extrahierten Text
 * zurück. Es dient im Copy-paste-Opus-Prompt als Stil-, Layout- und Faktenreferenz.
 *
 * «Live aus dem Drive»: gepflegt wird die .docx im Drive. Eine Änderung dort
 * wirkt beim nächsten Prompt-Aufruf (mtime-basierter Cache, kein Redeploy nötig).
 *
 * Ordner-Auflösung wie datensuppe (Slug-/Bindestrich-Varianten) plus die bekannte
 * Ausnahme wepublish → «Fundraising wepublish». Die docx liegt meist direkt als
 * PARADE-GESUCH_*.docx; bei wepublish eine Ebene tiefer in standard/. Gewählt wird
 * rekursiv die .docx, deren Name «parade» enthält — so fällt z.B. der
 * exoskelett-Projektordner (eigene Gesuch-docx ohne «parade» im Namen) heraus.
 *
 * Reiner Datei-Reader: KEINE Directus-Writes. Wirft nie — bei fehlendem
 * Mount/Ordner/Paradegesuch kommt null zurück (Prompt degradiert sauber).
 */

import fs from 'fs'
import path from 'path'
import { DATENSUPPE_BASE } from './datensuppe'
import { extrahiereText } from './text-extraktion'

/** App-Slug → abweichender Drive-Ordnername (Ausnahmen jenseits der Varianten). */
const ORDNER_AUSNAHME: Record<string, string> = {
  wepublish: 'Fundraising wepublish',
}

const PARADE_UNTERORDNER = '05_paradegesuch'

/** Findet den 05_paradegesuch-Pfad eines Mediums im Mount, oder null. */
export function findeParadeOrdner(basis: string, slug: string): string | null {
  const kandidaten = Array.from(
    new Set(
      [
        ORDNER_AUSNAHME[slug],
        slug,
        slug.replace(/_/g, '-'),
        slug.replace(/-/g, '_'),
      ].filter((x): x is string => typeof x === 'string' && x.length > 0),
    ),
  )
  for (const k of kandidaten) {
    const p = path.join(basis, k, PARADE_UNTERORDNER)
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p
    } catch {
      // weiter
    }
  }
  return null
}

/** Sammelt rekursiv alle .docx-Pfade unter dir (begrenzte Tiefe). */
function sammleDocx(dir: string, tiefe = 0): string[] {
  if (tiefe > 3) return []
  const out: string[] = []
  let eintraege: fs.Dirent[]
  try {
    eintraege = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of eintraege) {
    if (e.name.startsWith('.')) continue
    const voll = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...sammleDocx(voll, tiefe + 1))
    else if (e.isFile() && e.name.toLowerCase().endsWith('.docx')) out.push(voll)
  }
  return out
}

/**
 * Wählt aus docx-Pfaden das Paradegesuch: bevorzugt eine Datei, deren Basisname
 * «parade» enthält (schliesst Projekt-/Formular-docx aus). Bei mehreren gewinnt
 * der kürzeste Pfad (die oberste Ebene). Pure Funktion (testbar).
 */
export function waehleParadeDocx(pfade: string[]): string | null {
  const parade = pfade
    .filter((p) => path.basename(p).toLowerCase().includes('parade'))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
  return parade[0] ?? null
}

export type ParadegesuchOrt = {
  /** Dateiname der gewählten Paradegesuch-docx, z.B. «PARADE-GESUCH_cueltuer.docx». */
  datei: string
  /**
   * Pfad ab dem FaaS-Drive-Wurzelordner (echte Drive-Ordnernamen), z.B.
   * «cueltuer/05_paradegesuch/PARADE-GESUCH_cueltuer.docx». Vorne steht im
   * Drive «Fundraising/FaaS/» — das ergänzt der Prompt-Builder.
   */
  drivePfad: string
}

/**
 * Findet Ordner und Dateiname des Paradegesuchs eines Mediums im Mount — für den
 * VERWEIS im Copy-paste-Prompt. Opus öffnet die Datei dann selbst im Drive und
 * sieht so Schriftart, Logo und Grafiken; ein eingebetteter Volltext verlöre genau
 * das. Liest NICHT den Inhalt. Gibt null zurück ohne Mount/Ordner/Datei.
 */
export function findeParadegesuchOrt(slug: string): ParadegesuchOrt | null {
  try {
    if (!fs.existsSync(DATENSUPPE_BASE)) return null
  } catch {
    return null
  }
  const ordner = findeParadeOrdner(DATENSUPPE_BASE, slug)
  if (!ordner) return null
  const docx = waehleParadeDocx(sammleDocx(ordner))
  if (!docx) return null
  return { datei: path.basename(docx), drivePfad: path.relative(DATENSUPPE_BASE, docx) }
}

// mtime-basierter Cache: Schlüssel «pfad:mtimeMs» → extrahierter Text.
const cache = new Map<string, string>()

/**
 * Liest das Paradegesuch eines Mediums als Text. Gibt null zurück, wenn kein
 * Mount/Ordner/Paradegesuch existiert oder die Extraktion scheitert.
 */
export async function leseParadegesuch(slug: string): Promise<string | null> {
  try {
    if (!fs.existsSync(DATENSUPPE_BASE)) return null
  } catch {
    return null
  }
  const ordner = findeParadeOrdner(DATENSUPPE_BASE, slug)
  if (!ordner) return null
  const docx = waehleParadeDocx(sammleDocx(ordner))
  if (!docx) return null
  let mtimeMs = 0
  try {
    mtimeMs = fs.statSync(docx).mtimeMs
  } catch {
    return null
  }
  const key = `${docx}:${mtimeMs}`
  const treffer = cache.get(key)
  if (treffer != null) return treffer || null
  const text = (await extrahiereText(docx, path.basename(docx))).trim()
  // Platzhalter-Rückgaben der Extraktion (beginnen mit «(») gelten als kein Text.
  const sauber = !text || text.startsWith('(') ? '' : text
  cache.set(key, sauber)
  return sauber || null
}
