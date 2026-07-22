/**
 * /api/gesuch-prompt — baut den Copy-paste-Opus-Prompt für ein Medium-Stiftung-Paar.
 *
 * GET ?medium=<slug>&stiftung_id=<id>
 *   → 200 { prompt: string; ablage: string }
 *   → 400 { error } bei fehlenden Parametern
 *   → 404 { error } wenn die Stiftung fehlt
 *
 * Sonder-Förderer (Kirchen & Förderer-Seite): zusätzlich ?ziel=<collection>
 * (kirchen|foerderer|lotteriefonds|sponsoren) — liest dann die jeweilige
 * Collection statt stiftungen und die Begründung aus sonder_match_results.
 *
 * Deterministisch — KEIN LLM, KEIN Schreiben. Nur lesend aus Directus.
 * Das Gold-Gesuch selbst schreibt Opus 4.8 in der Claude-App aus diesem Prompt.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { bauGesuchPrompt, ablagePfad, DRIVE_ORDNER, type GesuchPromptDaten } from '@/lib/gesuch-prompt'
import { leseParadegesuch, findeParadegesuchOrt } from '@/lib/paradegesuch'
import {
  istSonderZiel, mapSonderItem, sonderRef, SONDER_FELDER, type SonderZiel,
} from '@/lib/sonder-gesuch'
import { tenant } from '../../../config/tenant'

const QUERY = `
  query GesuchKontext($stiftungId: GraphQLStringOrFloat!, $mediumId: String!, $stiftungIdStr: String!) {
    stiftungen(filter: { id: { _eq: $stiftungId } }, limit: 1) {
      name: Stiftungsname
      sitz
      land
      zwecktext
      einreichung
    }
    stiftungs_dna(
      filter: { stiftung_id: { id: { _eq: $stiftungId } }, is_active: { _eq: true } }
      limit: 1
    ) {
      sound_feeling
      foerderpraxis
    }
    medium_dna(
      filter: { medium_id: { _eq: $mediumId }, is_active: { _eq: true } }
      limit: 1
    ) {
      medium_name
      sound_feeling
      tags
    }
    match_results(
      filter: { medium_id: { _eq: $mediumId }, stiftung_id: { _eq: $stiftungId } }
      sort: ["-score"]
      limit: 1
    ) {
      begruendung
    }
    agent_lessons(
      filter: {
        aktiv: { _eq: true }
        mandant: { _eq: "${tenant.key}" }
        _or: [
          { medium_id: { _eq: $mediumId } }
          { scope: { _eq: "global" } }
          { stiftung_id: { _eq: $stiftungIdStr } }
        ]
      }
      limit: 20
      sort: ["-ts"]
    ) {
      notiz
    }
    applications(
      filter: { medium_id: { _eq: $mediumId }, stiftung_id: { _eq: $stiftungId } }
      limit: 1
      sort: ["-date_updated"]
    ) {
      betrag_chf
    }
  }
`

function extractTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return tags
    .map((t) => {
      if (typeof t === 'string') return t
      if (t && typeof t === 'object') {
        const o = t as Record<string, unknown>
        return (o.tag_slug ?? o.slug ?? o.name ?? '') as string
      }
      return ''
    })
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
}

function asText(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * Befüllt die Paradegesuch-Felder je nach Modus:
 *   stil=verweis  → Verweis auf die Drive-Datei (Copy-paste nach Cowork/Claude-App;
 *                   Opus öffnet die Datei selbst und sieht Schrift, Logo, Grafiken).
 *   stil=volltext → eingebetteter Volltext (Default; reine Text-Konsumenten wie der
 *                   nächtliche Gesuch-Loop ohne Drive-Zugriff).
 */
async function paradegesuchFelder(
  slug: string,
  stil: 'verweis' | 'volltext',
): Promise<Pick<GesuchPromptDaten, 'paradegesuch' | 'paradegesuchRef'>> {
  if (stil === 'verweis') {
    const ort = findeParadegesuchOrt(slug)
    if (ort) {
      return { paradegesuch: null, paradegesuchRef: { datei: ort.datei, drivePfad: ort.drivePfad } }
    }
    // Ohne Mount/Datei: Ordner-Verweis aus der bekannten Drive-Struktur (jedes Medium
    // hat ein 05_paradegesuch/). Opus findet die Parade-docx im Ordner selbst.
    const ordner = DRIVE_ORDNER[slug] ?? slug
    return { paradegesuch: null, paradegesuchRef: { datei: null, drivePfad: `${ordner}/05_paradegesuch` } }
  }
  return { paradegesuch: await leseParadegesuch(slug), paradegesuchRef: null }
}

// ─── Sonder-Förderer (kirchen/foerderer/lotteriefonds/sponsoren) ─────────────

/** Medium-DNA, Lern-Hinweise und Betrag für ein Sonder-Paar (eine Abfrage). */
const SONDER_KONTEXT_QUERY = `
  query SonderGesuchKontext($mediumId: String!, $ref: String!) {
    medium_dna(
      filter: { medium_id: { _eq: $mediumId }, is_active: { _eq: true } }
      limit: 1
    ) {
      medium_name
      sound_feeling
      tags
    }
    agent_lessons(
      filter: {
        aktiv: { _eq: true }
        mandant: { _eq: "${tenant.key}" }
        _or: [
          { medium_id: { _eq: $mediumId } }
          { scope: { _eq: "global" } }
          { stiftung_id: { _eq: $ref } }
        ]
      }
      limit: 20
      sort: ["-ts"]
    ) {
      notiz
    }
    applications(
      filter: { medium_id: { _eq: $mediumId }, sonder_ref: { _eq: $ref } }
      limit: 1
      sort: ["-date_updated"]
    ) {
      betrag_chf
    }
  }
`

async function sonderGesuch(
  res: NextApiResponse,
  base: string,
  token: string,
  medium: string,
  zielId: string,
  ziel: SonderZiel,
  stil: 'verweis' | 'volltext',
) {
  const headers = { Authorization: `Bearer ${token}` }
  const ref = sonderRef(ziel, zielId)

  // Sonder-Item (Stammdaten + DNA direkt auf der Collection; bemerkungen bewusst nicht)
  const ir = await fetch(
    `${base}/items/${ziel}/${encodeURIComponent(zielId)}?fields=${SONDER_FELDER[ziel].join(',')}`,
    { headers, signal: AbortSignal.timeout(15_000) },
  )
  const item = (await ir.json())?.data
  if (!ir.ok || !item) {
    return res.status(404).json({ error: `${ziel}/${zielId} nicht gefunden` })
  }

  // Match-Begründung aus dem Sonder-Matching
  let begruendung: string | null = null
  try {
    const mr = await fetch(
      `${base}/items/sonder_match_results?filter[medium_id][_eq]=${encodeURIComponent(medium)}` +
        `&filter[ziel_collection][_eq]=${encodeURIComponent(ziel)}` +
        `&filter[ziel_id][_eq]=${encodeURIComponent(zielId)}&sort=-score&limit=1&fields=begruendung`,
      { headers, signal: AbortSignal.timeout(15_000) },
    )
    begruendung = asText((await mr.json())?.data?.[0]?.begruendung)
  } catch {
    // Begründung ist optional — der Prompt leitet die Gemeinsamkeiten sonst selbst ab
  }

  // Medium-DNA + Lern-Hinweise + Betrag
  const kr = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SONDER_KONTEXT_QUERY, variables: { mediumId: medium, ref } }),
    signal: AbortSignal.timeout(20_000),
  })
  const kj = await kr.json()
  if (kj.errors?.length) {
    return res.status(500).json({ error: 'Directus-Fehler: ' + kj.errors[0]?.message })
  }
  const kd = kj.data ?? {}
  const medDna = kd.medium_dna?.[0] ?? null
  const lernhinweise: string[] = (kd.agent_lessons ?? [])
    .map((x: { notiz?: string }) => (x?.notiz ?? '').trim())
    .filter((s: string) => s.length > 0)
  const betragRoh = kd.applications?.[0]?.betrag_chf
  const betragChf = typeof betragRoh === 'number' && betragRoh > 0 ? betragRoh : null

  const daten: GesuchPromptDaten = {
    mediumName: medDna?.medium_name ?? medium,
    mediumSlug: medium,
    mediumSound: asText(medDna?.sound_feeling),
    mediumTags: extractTags(medDna?.tags),
    ...mapSonderItem(ziel, item),
    matchBegruendung: begruendung,
    betragChf,
    lernhinweise,
    formular: null,
    paradegesuch: null,
    paradegesuchRef: null,
  }
  Object.assign(daten, await paradegesuchFelder(daten.mediumSlug, stil))

  return res.status(200).json({
    prompt: bauGesuchPrompt(daten),
    ablage: ablagePfad(daten.mediumSlug, daten.stiftungName),
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }
  const medium = typeof req.query.medium === 'string' ? req.query.medium : ''
  const stiftungId = typeof req.query.stiftung_id === 'string' ? req.query.stiftung_id : ''
  const projektId = typeof req.query.projekt_id === 'string' ? req.query.projekt_id : ''
  const ziel = typeof req.query.ziel === 'string' ? req.query.ziel : ''
  // Verweis = Drive-Datei (Copy-paste nach Cowork), volltext = eingebettet (Loop, Default).
  const stil: 'verweis' | 'volltext' = req.query.stil === 'verweis' ? 'verweis' : 'volltext'
  if (!medium || !stiftungId) {
    return res.status(400).json({ error: 'medium und stiftung_id erforderlich' })
  }

  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const directusToken = process.env.DIRECTUS_TOKEN || ''

  // Sonder-Förderer-Pfad (Kirchen & Förderer): eigene Collection statt stiftungen.
  if (ziel) {
    if (!istSonderZiel(ziel)) {
      return res.status(400).json({ error: 'ziel muss kirchen, foerderer, lotteriefonds oder sponsoren sein' })
    }
    try {
      return await sonderGesuch(res, directusBase, directusToken, medium, stiftungId, ziel, stil)
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  try {
    const r = await fetch(`${directusBase}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${directusToken}` },
      body: JSON.stringify({ query: QUERY, variables: { stiftungId, mediumId: medium, stiftungIdStr: String(stiftungId) } }),
      signal: AbortSignal.timeout(20_000),
    })
    const json = await r.json()
    if (json.errors?.length) {
      return res.status(500).json({ error: 'Directus-Fehler: ' + json.errors[0]?.message })
    }
    const d = json.data ?? {}
    const stiftung = d.stiftungen?.[0]
    if (!stiftung) {
      return res.status(404).json({ error: `Stiftung ${stiftungId} nicht gefunden` })
    }
    const dna = d.stiftungs_dna?.[0] ?? null
    const medDna = d.medium_dna?.[0] ?? null
    const match = d.match_results?.[0] ?? null
    const lernhinweise: string[] = (d.agent_lessons ?? [])
      .map((x: { notiz?: string }) => (x?.notiz ?? '').trim())
      .filter((s: string) => s.length > 0)
    const betragRoh = d.applications?.[0]?.betrag_chf
    const betragChf = typeof betragRoh === 'number' && betragRoh > 0 ? betragRoh : null

    const daten: GesuchPromptDaten = {
      mediumName: medDna?.medium_name ?? medium,
      mediumSlug: medium,
      mediumSound: asText(medDna?.sound_feeling),
      mediumTags: extractTags(medDna?.tags),
      stiftungName: stiftung.name ?? `Stiftung ${stiftungId}`,
      stiftungSitz: asText(stiftung.sitz),
      stiftungLand: asText(stiftung.land),
      stiftungZweck: asText(stiftung.zwecktext),
      stiftungFoerderpraxis: asText(dna?.foerderpraxis),
      stiftungSound: asText(dna?.sound_feeling),
      matchBegruendung: asText(match?.begruendung),
      betragChf,
      lernhinweise,
      formular: (stiftung.einreichung ?? null) as GesuchPromptDaten['formular'],
      paradegesuch: null,
      paradegesuchRef: null,
    }

    // Projekt-Ebene: Profil des Projekts (eigene DNA) statt der Medium-DNA verwenden.
    if (projektId) {
      const pr = await fetch(
        `${directusBase}/items/projekte/${encodeURIComponent(projektId)}?fields=name,medium_id,slug,beschreibung,arbeits_dna`,
        { headers: { Authorization: `Bearer ${directusToken}` }, signal: AbortSignal.timeout(15_000) },
      )
      const pj = (await pr.json())?.data
      if (pj) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const adna = (pj.arbeits_dna ?? {}) as any
        daten.mediumName = `${pj.medium_id} · Projekt «${pj.name}»`
        daten.mediumSlug = pj.medium_id || daten.mediumSlug
        daten.mediumSound = asText(adna.sound_feeling) ?? asText(pj.beschreibung)
        daten.mediumTags = extractTags(adna.tags)
        // Projekt-spezifische Matching-Begründung
        const mr = await fetch(
          `${directusBase}/items/match_results?filter[projekt_id][_eq]=${encodeURIComponent(projektId)}` +
            `&filter[stiftung_id][_eq]=${encodeURIComponent(stiftungId)}&sort=-score&limit=1&fields=begruendung`,
          { headers: { Authorization: `Bearer ${directusToken}` }, signal: AbortSignal.timeout(15_000) },
        )
        const mrows = (await mr.json())?.data
        if (mrows?.[0]?.begruendung) daten.matchBegruendung = asText(mrows[0].begruendung)
      }
    }

    // Paradegesuch: Verweis auf die Drive-Datei (Copy-paste) oder eingebetteter
    // Volltext (Loop), je nach stil. Slug erst nach dem Projekt-Block, da dieser ihn ändert.
    Object.assign(daten, await paradegesuchFelder(daten.mediumSlug, stil))

    return res.status(200).json({
      prompt: bauGesuchPrompt(daten),
      ablage: ablagePfad(daten.mediumSlug, daten.stiftungName),
    })
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
