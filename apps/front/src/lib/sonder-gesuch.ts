/**
 * Mapping der Sonder-Förderer-Collections (kirchen, foerderer, lotteriefonds,
 * sponsoren) auf die Gesuch-Prompt-Daten. Rein, ohne Seiteneffekte — testbar.
 *
 * Die vier Collections tragen ihre DNA-Felder direkt (kein stiftungs_dna-Join)
 * und haben je eigene Stammdaten-Felder. Das vertrauliche Feld `bemerkungen`
 * (interne Notizen, teils Personennamen) wird BEWUSST nicht gelesen.
 */

import type { GesuchPromptDaten } from './gesuch-prompt'

export type SonderZiel = 'kirchen' | 'foerderer' | 'lotteriefonds' | 'sponsoren'

export const SONDER_ZIELE: SonderZiel[] = ['kirchen', 'foerderer', 'lotteriefonds', 'sponsoren']

export function istSonderZiel(v: unknown): v is SonderZiel {
  return typeof v === 'string' && (SONDER_ZIELE as string[]).includes(v)
}

/** Referenz-Schlüssel für applications.sonder_ref und agent_lessons.stiftung_id. */
export function sonderRef(coll: string, id: number | string): string {
  return `${coll}:${id}`
}

/** Felder, die die Gesuch-Prompt-Route pro Collection liest (REST fields-Param). */
export const SONDER_FELDER: Record<SonderZiel, string[]> = {
  kirchen: ['name', 'organisationsform', 'keywords_ausrichtung', 'webseite', 'eingabefrist', 'form_gesuche', 'sound_feeling', 'foerderpraxis'],
  foerderer: ['name', 'organisationsform', 'keywords_ausrichtung', 'webseite', 'eingabefrist', 'form_gesuche', 'sound_feeling', 'foerderpraxis'],
  lotteriefonds: ['stiftungsname', 'kanton', 'foerderbedingungen', 'medientrigger', 'url_eingabeformular', 'antragsformular', 'url_lotteriefonds', 'sound_feeling', 'foerderpraxis'],
  sponsoren: ['firmenname', 'fokus_medium', 'sponsoring_paket', 'b2b_argumente', 'sound_feeling', 'foerderpraxis'],
}

type Roh = Record<string, unknown>

function text(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * Hängt fehlende praktische Angaben (Formular-URL, Frist, Webseite) an den
 * Förderpraxis-Text an — nur wenn der Wert nicht ohnehin schon im Text steht.
 */
export function ergaenzePraxis(
  basis: string | null,
  extras: Array<[label: string, wert: string | null]>,
): string | null {
  const teile: string[] = basis ? [basis] : []
  const haystack = (basis ?? '').toLowerCase()
  for (const [label, wert] of extras) {
    const w = (wert ?? '').trim()
    if (!w) continue
    if (haystack.includes(w.toLowerCase())) continue
    teile.push(`${label}: ${w}`)
  }
  return teile.length ? teile.join('\n') : null
}

export type SonderGesuchFelder = Pick<
  GesuchPromptDaten,
  'stiftungName' | 'stiftungSitz' | 'stiftungLand' | 'stiftungZweck' | 'stiftungFoerderpraxis' | 'stiftungSound'
>

/** Mappt ein rohes Collection-Item auf die Förderer-Felder des Gesuch-Prompts. */
export function mapSonderItem(ziel: SonderZiel, item: Roh): SonderGesuchFelder {
  if (ziel === 'kirchen' || ziel === 'foerderer') {
    const zweck = [text(item.organisationsform), text(item.keywords_ausrichtung)]
      .filter(Boolean)
      .join(' — ')
    return {
      stiftungName: text(item.name) ?? `${ziel} (ohne Name)`,
      stiftungSitz: null,
      stiftungLand: null,
      stiftungZweck: zweck || null,
      stiftungSound: text(item.sound_feeling),
      stiftungFoerderpraxis: ergaenzePraxis(text(item.foerderpraxis), [
        ['Gesuchseinreichung', text(item.form_gesuche)],
        ['Eingabefrist', text(item.eingabefrist)],
        ['Webseite', text(item.webseite)],
      ]),
    }
  }
  if (ziel === 'lotteriefonds') {
    const zweck = [
      text(item.foerderbedingungen),
      text(item.medientrigger) ? `Medien-Bezug: ${text(item.medientrigger)}` : null,
    ]
      .filter(Boolean)
      .join('\n')
    return {
      stiftungName: text(item.stiftungsname) ?? 'Lotteriefonds (ohne Name)',
      stiftungSitz: text(item.kanton),
      stiftungLand: 'CH',
      stiftungZweck: zweck || null,
      stiftungSound: text(item.sound_feeling),
      stiftungFoerderpraxis: ergaenzePraxis(text(item.foerderpraxis), [
        ['Eingabeformular', text(item.url_eingabeformular) ?? text(item.antragsformular)],
        ['Webseite', text(item.url_lotteriefonds)],
      ]),
    }
  }
  // sponsoren
  const zweck = [
    text(item.fokus_medium) ? `Fokus: ${text(item.fokus_medium)}` : null,
    text(item.sponsoring_paket) ? `Sponsoring-Paket: ${text(item.sponsoring_paket)}` : null,
    text(item.b2b_argumente) ? `B2B-Argumente: ${text(item.b2b_argumente)}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  return {
    stiftungName: text(item.firmenname) ?? 'Sponsor (ohne Name)',
    stiftungSitz: null,
    stiftungLand: null,
    stiftungZweck: zweck || null,
    stiftungSound: text(item.sound_feeling),
    stiftungFoerderpraxis: text(item.foerderpraxis),
  }
}
