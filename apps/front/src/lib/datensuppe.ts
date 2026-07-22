/**
 * datensuppe.ts — Liest den Drive-Ordner «01_datensuppe» eines Mediums.
 *
 * Der FaaS-Drive («Admin» Shared Drive → Fundraising/FaaS/<medium>/01_datensuppe)
 * ist auf dem Spark read-only via rclone gemountet und in den faas-matching-Container
 * unter DATENSUPPE_BASE (Default /datensuppe) gebunden. Struktur pro Medium:
 *
 *   <DATENSUPPE_BASE>/<medium-ordner>/01_datensuppe/
 *       artikel/            → category published_article
 *       newsletter/         → category newsletter
 *       fruehere-gesuche/   → category previous_application
 *       _corpus/            → category general_info
 *       assets/             → IGNORIERT (Bilder, qwen3.6 ist text-only)
 *
 * Slug-Mapping: Die App-Slugs nutzen teils Unterstriche (neue_wege), der Drive
 * Bindestriche (neue-wege). findeMediumOrdner testet beide Schreibweisen.
 *
 * Reiner Datei-Reader: KEINE Directus-Writes (das macht der Aufrufer).
 */

import fs from 'fs'
import path from 'path'
import { extrahiereText, istExtrahierbar } from './text-extraktion'

/** Basis-Mountpoint im Container. Per Env überschreibbar (Hetzner-Portabilität). */
export const DATENSUPPE_BASE = process.env.DATENSUPPE_BASE || '/datensuppe'

/** Höchstzahl gelesener Dateien pro Lauf (Schutz). */
const MAX_DATEIEN = 200

/** Unterordner → medium_knowledge-Kategorie. assets fehlt bewusst (Bilder). */
const ORDNER_KATEGORIE: Record<string, string> = {
  artikel: 'published_article',
  newsletter: 'newsletter',
  'fruehere-gesuche': 'previous_application',
  _corpus: 'general_info',
}

export interface DatensuppeEintrag {
  category: string
  title: string
  content: string
  /** Relativer Pfad ab dem Medium-Ordner — dient als stabiler Dedup-Schlüssel. */
  relPfad: string
}

export interface DatensuppeErgebnis {
  /** True, wenn der Medium-Ordner mit 01_datensuppe gefunden wurde. */
  ordnerGefunden: boolean
  /** Tatsächlich aufgelöster Ordnername im Drive (z.B. «neue-wege»), falls gefunden. */
  ordnerName: string | null
  eintraege: DatensuppeEintrag[]
  /** Anzahl Dateien, die wegen Typ (Bild/unbekannt) oder Leerheit übersprungen wurden. */
  uebersprungen: number
  /** True, wenn die Datei-Obergrenze erreicht wurde (Korpus war grösser). */
  gekappt: boolean
}

/**
 * Findet den Drive-Ordnernamen für einen App-Slug. Testet den Slug selbst sowie
 * die Bindestrich-/Unterstrich-Varianten, da Drive und App divergieren
 * (App «neue_wege» ↔ Drive «neue-wege»).
 */
export function findeMediumOrdner(basis: string, slug: string): string | null {
  const kandidaten = Array.from(new Set([
    slug,
    slug.replace(/_/g, '-'),
    slug.replace(/-/g, '_'),
  ]))
  for (const k of kandidaten) {
    const p = path.join(basis, k, '01_datensuppe')
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        return k
      }
    } catch {
      // weiter
    }
  }
  return null
}

/** Sammelt rekursiv alle Dateipfade unter `dir` ( flache Tiefe genügt, aber robust). */
function sammleDateien(dir: string): string[] {
  const ergebnis: string[] = []
  let eintraege: fs.Dirent[]
  try {
    eintraege = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return ergebnis
  }
  for (const e of eintraege) {
    if (e.name.startsWith('.')) continue // .DS_Store etc.
    const voll = path.join(dir, e.name)
    if (e.isDirectory()) {
      ergebnis.push(...sammleDateien(voll))
    } else if (e.isFile()) {
      ergebnis.push(voll)
    }
  }
  return ergebnis
}

/**
 * Liest die datensuppe eines Mediums und gibt die extrahierten Text-Einträge zurück.
 * Wirft NICHT — bei fehlendem Mount/Ordner kommt ordnerGefunden=false zurück.
 */
export async function leseDatensuppe(slug: string): Promise<DatensuppeErgebnis> {
  const leer: DatensuppeErgebnis = {
    ordnerGefunden: false,
    ordnerName: null,
    eintraege: [],
    uebersprungen: 0,
    gekappt: false,
  }

  // Mount überhaupt vorhanden?
  try {
    if (!fs.existsSync(DATENSUPPE_BASE)) return leer
  } catch {
    return leer
  }

  const ordnerName = findeMediumOrdner(DATENSUPPE_BASE, slug)
  if (!ordnerName) return leer

  const wurzel = path.join(DATENSUPPE_BASE, ordnerName, '01_datensuppe')
  const eintraege: DatensuppeEintrag[] = []
  let uebersprungen = 0
  let gekappt = false

  for (const [unterordner, category] of Object.entries(ORDNER_KATEGORIE)) {
    const dir = path.join(wurzel, unterordner)
    let exists = false
    try {
      exists = fs.existsSync(dir) && fs.statSync(dir).isDirectory()
    } catch {
      exists = false
    }
    if (!exists) continue

    for (const dateiPfad of sammleDateien(dir)) {
      if (eintraege.length >= MAX_DATEIEN) {
        gekappt = true
        break
      }
      const name = path.basename(dateiPfad)
      if (!istExtrahierbar(name)) {
        uebersprungen++
        continue
      }
      const content = (await extrahiereText(dateiPfad, name)).trim()
      // Platzhalter-Rückgaben der Extraktion (beginnen mit «(») oder Leeres überspringen.
      if (!content || content.startsWith('(')) {
        uebersprungen++
        continue
      }
      const titel = name.replace(/\.[^.]+$/, '').slice(0, 200)
      eintraege.push({
        category,
        title: titel,
        content,
        relPfad: path.relative(path.join(DATENSUPPE_BASE, ordnerName), dateiPfad),
      })
    }
    if (gekappt) break
  }

  return {
    ordnerGefunden: true,
    ordnerName,
    eintraege,
    uebersprungen,
    gekappt,
  }
}
