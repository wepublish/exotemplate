import { MatchView, Konfidenz } from './types'

function konf(datenbasis?: unknown): Konfidenz {
  // datenbasis ist in Alt-DNAs mal String, mal Array (z.B. ['stammdaten','webseite']),
  // mal null -> robust zu String zwingen, sonst crasht .toLowerCase die ganze Liste.
  const d = String(datenbasis ?? '').toLowerCase()
  if (d.includes('web')) return 'web'
  if (d.includes('stammdaten')) return 'stammdaten'
  return 'unbekannt'
}

// Normalise relation {id} OR raw scalar to string
const sid = (x: any): string => String(x?.id ?? x)

export function mergeMatches(matches: any[], stiftungen: any[], dnas: any[]): MatchView[] {
  const sById = new Map(stiftungen.map(s => [String(s.id), s]))
  const dById = new Map(dnas.map(d => [sid(d.stiftung_id), d]))
  return matches.map(m => {
    const key = String(m.stiftung_id)
    const s = sById.get(key) || ({} as any)
    const d = dById.get(key) || ({} as any)
    return {
      id: m.id,
      stiftungId: key,
      name: s.Stiftungsname || `Stiftung ${key}`,
      website: s.webseite,
      score: m.score,
      begruendung: m.begruendung,
      breakdown: m.score_breakdown,
      tags: Array.isArray(d.tags) ? d.tags : [],
      soundFeeling: d.sound_feeling || '',
      schaerfe: d.schaerfe_prozent ?? 0,
      konfidenz: konf(d?.quellen?.datenbasis),
      betrag: s.foerdersummen_range || s.foerderbeitraege || null,
      betragRecherche: m.betrag_recherche ?? null,
    }
  })
}
