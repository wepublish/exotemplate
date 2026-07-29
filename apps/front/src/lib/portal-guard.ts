import crypto from 'node:crypto'
import type { NextApiRequest, NextApiResponse } from 'next'
import { leseSessionAusCookie, erzeugeLoginToken, type PortalSession } from './portal-session'
import type { DnaProfil } from './generate-dna-jobs'
import type { PortalAktiveDnaRoh } from './portal-dna'
import { FRAGEBOGEN_TITEL_PREFIX, type GesuchVersion } from './portal-status'

/**
 * portal-guard.ts: Zugriffsschutz für das Medien-Selbstbedienungsportal.
 *
 * Zwei Aufgaben:
 * 1. Portal-Session lesen/verlangen (für die vier Portal-Routen unter
 *    src/pages/api/portal/).
 * 2. Den rohen Directus-Proxy (/api/directus) gegen Portal-Sessions sperren:
 *    Operatoren authentifizieren sich über Cloudflare Access, Medien nur über
 *    die kuratierten Portal-Routen, niemals über den GraphQL-Proxy direkt.
 *
 * Dazu kommen kleine Directus-REST-Helfer (Muster wie src/lib/faas-jobs-store.ts:
 * fetch mit Authorization-Header, DIRECTUS_URL/DIRECTUS_TOKEN aus der Env) für
 * die Zugriffe, die login-anfordern.ts, einloesen.ts und me.ts brauchen.
 */

const PORTAL_NICHT_KONFIGURIERT = { error: 'Portal nicht konfiguriert' } as const

// ─── Session-Guard ────────────────────────────────────────────────────────────

/**
 * Liest die Portal-Session aus dem Cookie-Header, sofern `PORTAL_SESSION_SECRET`
 * gesetzt ist. Ohne Secret oder ohne gültigen/passenden Cookie: null. Schreibt
 * NIE eine HTTP-Antwort (reine Lese-Funktion, für Guards und die Proxy-Sperre).
 */
export function getPortalSession(req: NextApiRequest): PortalSession | null {
  const secret = process.env.PORTAL_SESSION_SECRET
  if (!secret) return null
  return leseSessionAusCookie(req.headers.cookie, secret)
}

/**
 * Wie `getPortalSession`, verlangt aber eine gültige Session: schreibt bei
 * fehlendem Secret 503 (Portal nicht konfiguriert) bzw. bei fehlender/
 * ungültiger Session 401 auf die Antwort und liefert in beiden Fällen null.
 * Bei gültiger Session wird NICHTS auf die Antwort geschrieben (der Aufrufer
 * fährt normal fort).
 */
export function requirePortalSession(req: NextApiRequest, res: NextApiResponse): PortalSession | null {
  if (!process.env.PORTAL_SESSION_SECRET) {
    res.status(503).json(PORTAL_NICHT_KONFIGURIERT)
    return null
  }
  const session = getPortalSession(req)
  if (!session) {
    res.status(401).json({ error: 'Keine gültige Portal-Session.' })
    return null
  }
  return session
}

/**
 * Für die Portal-Routen, die (noch) keine Session verlangen, aber die
 * PORTAL_SESSION_SECRET-Konfiguration brauchen (login-anfordern, einloesen,
 * logout): schreibt bei fehlendem Secret 503 und liefert null, sonst das
 * Secret selbst.
 */
export function holeSecretOderAntworte503(res: NextApiResponse): string | null {
  const secret = process.env.PORTAL_SESSION_SECRET
  if (!secret) {
    res.status(503).json(PORTAL_NICHT_KONFIGURIERT)
    return null
  }
  return secret
}

/**
 * Sperrlogik für den rohen Directus-Proxy (/api/directus): eine gültige
 * Portal-Session darf NICHT direkt auf den GraphQL-Proxy zugreifen, ausser
 * Cloudflare Access hat die Anfrage bereits authentifiziert (Operator-
 * Zugriff, erkennbar am `cf-access-authenticated-user-email`-Header).
 *
 * Reine, IO-freie Funktion, testbar ohne Mocks. `directus.ts` liest nur
 * Cookie- und CF-Header aus und ruft dies auf.
 */
export function istPortalZugriffAufProxy(
  cookieHeader: string | undefined,
  cfAccessEmailHeader: string | undefined | null,
  secret: string | undefined,
): boolean {
  if (!secret) return false
  const session = leseSessionAusCookie(cookieHeader, secret)
  if (!session) return false
  return !cfAccessEmailHeader
}

// ─── Directus-REST-Helfer: faas_medien (Portal-Ansicht) ───────────────────────

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })
const schreibHeaders = () => ({ ...authHeaders(), 'Content-Type': 'application/json' })

export type PortalMedium = {
  id: string
  name: string
  slug: string
  matchingFreigeschaltet: string | null
  dnaFreigabe: string | null
  /**
   * faas_medien.logo_url (Directus-Datei-id des aktuellen Logos), null ohne
   * Logo. NUR für die Anzeige/den Word-Export (gesuch-export.ts): kann auch
   * ein automatisch abgerufenes Favicon sein (siehe medium-logo.ts), darum
   * KEINE Grundlage von hatLogo (Fix-Runde 1, Critical).
   */
  logoUrl: string | null
  /**
   * faas_medien.logo_hochgeladen: true nur, wenn das Medium selbst ein
   * echtes PNG/JPG über /api/portal/logo hochgeladen hat. Grundlage von
   * hatLogo (me.ts, uebersicht.ts, dna-erzeugen.ts), der eigentliche
   * Provenienz-Marker für den Logo-Pflicht-Erststep.
   */
  logoHochgeladen: boolean
  /** faas_medien.slack_channel — der Kanal, in dem das Medium uns erreicht. */
  slackKanal: string | null
}

/**
 * Lädt Stammdaten + Freigabe-Status eines Mediums für die Portal-Ansicht (`me`).
 * Liefert null NUR bei «nicht gefunden». Netzwerkfehler und Directus-Fehlerstatus
 * WERFEN bewusst, damit der Aufrufer 404 (Medium existiert nicht) von 502
 * (Daten momentan nicht verfügbar) unterscheiden kann; me.ts fängt den Fehler.
 */
export async function ladePortalMedium(slug: string): Promise<PortalMedium | null> {
  const filter = encodeURIComponent(JSON.stringify({ slug: { _eq: slug } }))
  const felder = 'id,name,slug,matching_freigeschaltet,dna_medium_freigabe,logo_url,logo_hochgeladen,slack_channel'
  const res = await fetch(`${base()}/items/faas_medien?filter=${filter}&limit=1&fields=${felder}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`faas_medien: Directus antwortete ${res.status}`)
  const json = (await res.json()) as {
    data?: Array<{
      id: string | number
      name?: string | null
      slug?: string | null
      matching_freigeschaltet?: string | null
      dna_medium_freigabe?: string | null
      logo_url?: string | null
      logo_hochgeladen?: boolean | null
      slack_channel?: string | null
    }>
  }
  const row = json.data?.[0]
  if (!row) return null
  return {
    id: String(row.id),
    name: row.name ?? '',
    slug: row.slug ?? slug,
    matchingFreigeschaltet: row.matching_freigeschaltet ?? null,
    dnaFreigabe: row.dna_medium_freigabe ?? null,
    logoUrl: row.logo_url ?? null,
    logoHochgeladen: row.logo_hochgeladen === true,
    slackKanal: row.slack_channel ?? null,
  }
}

/**
 * true, sobald für dieses Medium eine AKTIVE medium_dna existiert (Lookup
 * analog dnaAktiv in /api/zugangsverwaltung: medium_dna.medium_id trägt den
 * SLUG). Grundlage des DNA-Nav-Schlosses im Portal: gesperrt, solange keine
 * DNA gemessen ist. Bewusst NICHT auf dna_medium_freigabe gegatet, sonst
 * wäre die Seite genau während der Prüfphase zu. Fehler werfen wie
 * ladePortalMedium, damit me.ts einheitlich mit 502 antwortet.
 */
export async function hatAktiveMediumDna(slug: string): Promise<boolean> {
  const filter = encodeURIComponent(JSON.stringify({ medium_id: { _eq: slug }, is_active: { _eq: true } }))
  const res = await fetch(`${base()}/items/medium_dna?filter=${filter}&limit=1&fields=id`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`medium_dna: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: unknown[] }
  return (json.data?.length ?? 0) > 0
}

// ─── Directus-REST-Helfer: medium_dna (Portal-DNA-Seite, Task 7) ──────────────

/**
 * Lädt die aktive medium_dna eines Mediums mit den vollen Tag-Feldern
 * (inkl. Gewicht/Begründung, nicht nur die schlanken {slug,label} der
 * GET-Antwort, siehe portal-dna.ts baueDnaAnsicht/bauePdfDaten: dieselbe
 * Rohdaten-Quelle speist beide Ableitungen). null, wenn keine aktive Version
 * existiert (Task-7-Vertrag: kein Fehler, die Route antwortet dann mit
 * `dna: null`). Wirft bei Directus-Fehlern (Netz, Statuscode).
 */
export async function ladeAktiveDnaDetails(slug: string): Promise<PortalAktiveDnaRoh | null> {
  const filter = encodeURIComponent(JSON.stringify({ medium_id: { _eq: slug }, is_active: { _eq: true } }))
  const felder = 'id,version,sound_feeling,tags,schaerfe_prozent,veredelt_at,date_created,quellen'
  const res = await fetch(`${base()}/items/medium_dna?filter=${filter}&limit=1&fields=${felder}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`medium_dna: Directus antwortete ${res.status}`)
  const json = (await res.json()) as {
    data?: Array<{
      id: number | string
      version?: number | null
      sound_feeling?: string | null
      tags?: Array<{ tag_slug?: string; gewicht?: number; begruendung?: string }> | null
      schaerfe_prozent?: number | null
      veredelt_at?: string | null
      date_created?: string | null
      quellen?: { datenbasis?: string | null } | null
    }>
  }
  const row = json.data?.[0]
  if (!row) return null
  return {
    id: Number(row.id),
    version: row.version ?? 1,
    soundFeeling: row.sound_feeling ?? '',
    tags: (row.tags ?? []).map((t) => ({
      tag_slug: t.tag_slug ?? '',
      gewicht: typeof t.gewicht === 'number' ? t.gewicht : 1,
      begruendung: t.begruendung ?? '',
    })),
    schaerfe: row.schaerfe_prozent ?? 0,
    aktivSeit: row.veredelt_at ?? row.date_created ?? '',
    hatteCrawl: typeof row.quellen?.datenbasis === 'string' && row.quellen.datenbasis.includes('web'),
  }
}

/**
 * Lädt das menschenlesbare Profil aus faas_medien.arbeits_dna, sofern
 * vorhanden. Grundlage für den PDF-Export der Portal-DNA-Seite (siehe
 * bauePdfDaten in portal-dna.ts). null, wenn (noch) keine Arbeits-DNA
 * gespeichert ist. Wirft bei Directus-Fehlern.
 */
export async function ladeArbeitsDnaProfil(slug: string): Promise<DnaProfil | null> {
  const filter = encodeURIComponent(JSON.stringify({ slug: { _eq: slug } }))
  const res = await fetch(`${base()}/items/faas_medien?filter=${filter}&limit=1&fields=arbeits_dna`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`faas_medien (arbeits_dna): Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: Array<{ arbeits_dna?: Record<string, unknown> | null }> }
  const roh = json.data?.[0]?.arbeits_dna
  if (!roh || typeof roh !== 'object') return null

  const feld = (name: string): string[] => (Array.isArray(roh[name]) ? (roh[name] as unknown[]).filter((x): x is string => typeof x === 'string') : [])
  const text = (name: string): string => (typeof roh[name] === 'string' ? (roh[name] as string) : '')

  return {
    dna_summary: text('dna_summary'),
    core_themes: feld('core_themes'),
    editorial_stance: feld('editorial_stance'),
    societal_impact: feld('societal_impact'),
    target_groups: feld('target_groups'),
    geographic_focus: text('geographic_focus'),
    funding_keywords: feld('funding_keywords'),
    grant_strengths: feld('grant_strengths'),
    matching_foundation_themes: feld('matching_foundation_themes'),
  }
}

/**
 * Setzt die DNA-Freigabe eines Mediums (dna_medium_freigabe + _von). Bulk-
 * Update-Form wie bei /api/matching-freischalten.ts (Filter im Body, nicht in
 * der URL). Wirft bei Directus-Fehlern, damit die Route mit 502 antworten kann.
 */
export async function setzeDnaFreigabe(slug: string, wer: string, jetztIso: string): Promise<void> {
  const res = await fetch(`${base()}/items/faas_medien`, {
    method: 'PATCH',
    headers: schreibHeaders(),
    body: JSON.stringify({
      query: { filter: { slug: { _eq: slug } } },
      data: { dna_medium_freigabe: jetztIso, dna_medium_freigabe_von: wer },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`DNA-Freigabe fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`)
  }
}

// ─── Directus-REST-Helfer: portal_zugaenge (Magic-Link-Login) ─────────────────

export type PortalZugang = {
  id: string
  email: string
  mediumSlug: string
  status: string
  loginJti: string | null
}

/**
 * Sucht einen nicht gesperrten Zugang für diese E-Mail + diesen Mandanten.
 * `status ≠ gesperrt` und `mandant = mandant` sind Teil des Filters (nicht
 * erst client-seitig geprüft): ein gesperrter Zugang taucht hier nie auf.
 *
 * Die E-Mail wird vor dem Lookup normalisiert (trim + lowercase). Der
 * `_eq`-Filter ist case-sensitiv; KONVENTION: Zugänge in portal_zugaenge
 * werden immer lowercase angelegt (die Einladungs-Verwaltung in Task 4 hält
 * sich daran). Fehler (Netz, Directus) werden geloggt und als null behandelt,
 * damit login-anfordern in jedem Fall {status:'ok'} antworten kann.
 */
export async function findePortalZugang(email: string, mandant: string): Promise<PortalZugang | null> {
  const emailNorm = email.trim().toLowerCase()
  if (!emailNorm) return null
  const filter = encodeURIComponent(
    JSON.stringify({
      _and: [{ email: { _eq: emailNorm } }, { mandant: { _eq: mandant } }, { status: { _neq: 'gesperrt' } }],
    }),
  )
  const felder = 'id,email,medium_slug,status,login_jti'
  try {
    const res = await fetch(`${base()}/items/portal_zugaenge?filter=${filter}&limit=1&fields=${felder}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      data?: Array<{ id: string; email: string; medium_slug: string; status: string; login_jti: string | null }>
    }
    const row = json.data?.[0]
    if (!row) return null
    return { id: row.id, email: row.email, mediumSlug: row.medium_slug, status: row.status, loginJti: row.login_jti ?? null }
  } catch (err: unknown) {
    console.error('findePortalZugang: Directus nicht erreichbar', err)
    return null
  }
}

/**
 * Löst einen Login-Link ATOMAR ein: bedingter Directus-PATCH mit Filter auf
 * id UND login_jti im Body (Bulk-Update-Form, Filter NICHT in der URL). Nur
 * wenn das gespeicherte login_jti noch dem Token-jti entspricht, wird genau
 * eine Zeile aktualisiert; jede andere Antwort (0 Zeilen = schon eingelöst
 * oder überschrieben, Fehlerstatus, Netzfehler) ergibt false. Damit gibt es
 * kein check-then-patch-Fenster, in dem derselbe Link zweimal durchginge.
 */
export async function loeseZugangEin(id: string, jti: string, jetztIso: string): Promise<boolean> {
  try {
    // login_jti bleibt beim Einlösen STEHEN: der Link ist innerhalb seiner
    // Laufzeit mehrfach verwendbar (ein Doppelklick oder ein zweiter Versuch
    // aus demselben Postfach soll nicht ins Leere laufen). Begrenzt wird er
    // über die Zeit — wenige Stunden, siehe loginTokenTtlSekunden — und über
    // Daten: ein neu erzeugter Link rotiert das jti, ein gesperrter Zugang
    // wird schon von findePortalZugang nicht mehr gefunden.
    // Korrektur 28.07.2026: hier stand «dauerhaft», das galt nur für die
    // wenigen Stunden zwischen den zwei Entscheiden desselben Tages.
    const res = await fetch(`${base()}/items/portal_zugaenge`, {
      method: 'PATCH',
      headers: schreibHeaders(),
      body: JSON.stringify({
        query: { filter: { id: { _eq: id }, login_jti: { _eq: jti } } },
        data: { letzter_login: jetztIso, status: 'aktiv' },
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return false
    const json = (await res.json()) as { data?: unknown[] }
    return (json.data?.length ?? 0) === 1
  } catch (err: unknown) {
    console.error('loeseZugangEin: Directus nicht erreichbar', err)
    return false
  }
}

/** Schreibt ein Patch auf einen bestehenden Zugang (z. B. login_jti, letzter_link). */
export async function patchePortalZugang(id: string, patch: Record<string, unknown>): Promise<void> {
  await fetch(`${base()}/items/portal_zugaenge/${id}`, {
    method: 'PATCH',
    headers: schreibHeaders(),
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(15_000),
  })
}

/**
 * Erzeugt einen neuen, dauerhaft gültigen Login-Link für einen Zugang UND
 * persistiert ihn sofort (login_jti + letzter_link + letzter_link_ts). Ein
 * vorher ausgestellter Link wird dadurch ungültig: einloesen.ts prüft das
 * gespeicherte login_jti atomar gegen das jti im Token (loeseZugangEin). Nur
 * der zuletzt erzeugte Link passt, dieser aber beliebig oft (Entscheid
 * 28.07.2026: kein Verfall, die Medien speichern ihren Link).
 *
 * Gemeinsame Basis für login-anfordern.ts (das Medium fordert selbst einen
 * Link an) und die Operator-Zugangsverwaltung (Zugang anlegen / neuer Link):
 * beide Wege erzeugen und speichern den Link auf exakt demselben Weg.
 */
export async function erzeugeZugangsLink(zugangId: string, email: string, mediumSlug: string, secret: string): Promise<string> {
  const jti = crypto.randomUUID()
  const loginToken = erzeugeLoginToken(email, mediumSlug, jti, secret)
  const basisUrl = process.env.PORTAL_BASE_URL || ''
  const link = `${basisUrl}/api/portal/einloesen?token=${encodeURIComponent(loginToken)}`

  await patchePortalZugang(zugangId, {
    login_jti: jti,
    letzter_link: link,
    letzter_link_ts: new Date().toISOString(),
  })

  return link
}

/**
 * Legt einen Portal-Zugang an (E-Mail muss bereits normalisiert sein:
 * trim+lowercase) und erzeugt sofort den ersten Einladungs-Link. Existiert
 * für (email, mediumSlug, mandant) schon ein Zugang (Status egal, auch
 * gesperrte zählen), wird KEIN zweiter angelegt, sondern für den bestehenden
 * ein neuer Link erzeugt (`bestehend: true`). Ein Link auf einen gesperrten
 * Zugang ist beim Einlösen ohnehin wirkungslos (findePortalZugang filtert
 * gesperrte aus).
 *
 * Extrahiert aus /api/zugangsverwaltung aktion=anlegen, damit
 * /api/medium-aufnehmen den Hallo-plus-Magic-Link-Schritt wiederverwendet
 * (Entscheid Jolanda 28.07.2026: ein neues Medium bekommt das Hallo und den
 * Magic-Link in EINEM Schritt). Wirft bei Directus-Fehlern; die Routen
 * fangen das ab und antworten mit 502.
 */
export async function legeZugangAnMitLink(
  email: string,
  mediumSlug: string,
  mandant: string,
  wer: string,
  secret: string,
): Promise<{ link: string; bestehend: boolean }> {
  const filterBestehend = encodeURIComponent(
    JSON.stringify({
      _and: [{ email: { _eq: email } }, { medium_slug: { _eq: mediumSlug } }, { mandant: { _eq: mandant } }],
    }),
  )
  const resBestehend = await fetch(
    `${base()}/items/portal_zugaenge?filter=${filterBestehend}&limit=1&fields=id,email,medium_slug`,
    { headers: authHeaders(), signal: AbortSignal.timeout(15_000) },
  )
  if (!resBestehend.ok) {
    throw new Error(`portal_zugaenge-Lookup: Directus antwortete ${resBestehend.status}`)
  }
  const bestehendJson = (await resBestehend.json()) as { data?: Array<{ id: string }> }
  const bestehend = bestehendJson.data?.[0]
  if (bestehend) {
    const link = await erzeugeZugangsLink(bestehend.id, email, mediumSlug, secret)
    return { link, bestehend: true }
  }

  const resCreate = await fetch(`${base()}/items/portal_zugaenge`, {
    method: 'POST',
    headers: schreibHeaders(),
    body: JSON.stringify({
      email,
      medium_slug: mediumSlug,
      mandant,
      status: 'eingeladen',
      eingeladen_am: new Date().toISOString(),
      erstellt_von: wer,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!resCreate.ok) {
    const text = await resCreate.text().catch(() => '')
    throw new Error(`Zugang konnte nicht angelegt werden (${resCreate.status}): ${text.slice(0, 200)}`)
  }
  const createdJson = (await resCreate.json()) as { data?: { id?: string } }
  const id = createdJson.data?.id
  if (!id) {
    throw new Error('Zugang angelegt, aber keine id erhalten.')
  }

  const link = await erzeugeZugangsLink(id, email, mediumSlug, secret)
  return { link, bestehend: false }
}

// ─── Directus-REST-Helfer: medium_knowledge (Portal-Unterlagen) ──────────────

export type PortalWissenEintrag = {
  id: number
  title: string
  category: string
  sourceUrl: string | null
  autoScraped: boolean
  dateCreated: string
}

/**
 * Lädt alle medium_knowledge-Einträge eines Mediums, neueste zuerst.
 * Wirft bei Directus-Fehlern (Netz, Statuscode); die Route (wissen.ts)
 * fängt das ab und antwortet mit 502, statt einem Next-500.
 */
export async function ladeWissenFuerMedium(slug: string): Promise<PortalWissenEintrag[]> {
  const filter = encodeURIComponent(JSON.stringify({ medium_id: { _eq: slug } }))
  const felder = 'id,title,category,source_url,auto_scraped,date_created'
  const res = await fetch(`${base()}/items/medium_knowledge?filter=${filter}&sort=-date_created&limit=-1&fields=${felder}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`medium_knowledge: Directus antwortete ${res.status}`)
  const json = (await res.json()) as {
    data?: Array<{
      id: number
      title?: string | null
      category?: string | null
      source_url?: string | null
      auto_scraped?: boolean | null
      date_created?: string | null
    }>
  }
  return (json.data ?? []).map((row) => ({
    id: row.id,
    title: row.title ?? '',
    category: row.category ?? 'general_info',
    sourceUrl: row.source_url ?? null,
    autoScraped: !!row.auto_scraped,
    dateCreated: row.date_created ?? '',
  }))
}

/**
 * Legt einen medium_knowledge-Eintrag an. Generischer Schreib-Helfer für
 * beide Portal-Routen, die selbst schreiben (wissen.ts für den Fragebogen-
 * Eintrag, scrape.ts für die URL-Übernahme): dieselbe Mutation, die auch
 * die Operator-Routen unter /api/medium-knowledge/ verwenden.
 */
export async function legeWissensEintragAn(data: Record<string, unknown>): Promise<{ id: number }> {
  const mutation = `
    mutation CreateKnowledge($data: create_medium_knowledge_input!) {
      create_medium_knowledge_item(data: $data) {
        id
      }
    }
  `
  const res = await fetch(`${base()}/graphql`, {
    method: 'POST',
    headers: schreibHeaders(),
    body: JSON.stringify({ query: mutation, variables: { data } }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Directus-GraphQL-Fehler (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    data?: { create_medium_knowledge_item?: { id: number } }
    errors?: { message: string }[]
  }
  if (json.errors?.length) throw new Error(`Directus-Mutation fehlgeschlagen: ${json.errors[0]?.message}`)
  const created = json.data?.create_medium_knowledge_item
  if (!created?.id) throw new Error('Directus: Kein id nach create_medium_knowledge_item')
  return { id: created.id }
}

// ─── Directus-REST-Helfer: agent_vorschlaege (Operator-Benachrichtigung) ──────

/** Legt eine Zeile in agent_vorschlaege an, damit der Operator sie in der Inbox sieht. */
export async function legeAgentVorschlagAn(payload: Record<string, unknown>): Promise<void> {
  await fetch(`${base()}/items/agent_vorschlaege`, {
    method: 'POST',
    headers: schreibHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  })
}

/**
 * Prüft, ob bereits ein Vorschlag mit diesem dedup_key existiert (Spam-Schutz).
 * Fehler ergeben false: lieber einen Vorschlag doppelt anlegen als den
 * Operator bei einem transienten Directus-Aussetzer gar nicht informieren.
 */
export async function existiertVorschlagMitDedupKey(dedupKey: string): Promise<boolean> {
  try {
    const filter = encodeURIComponent(JSON.stringify({ dedup_key: { _eq: dedupKey } }))
    const res = await fetch(`${base()}/items/agent_vorschlaege?filter=${filter}&limit=1&fields=id`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return false
    const json = (await res.json()) as { data?: Array<{ id: string }> }
    return (json.data?.length ?? 0) > 0
  } catch (err: unknown) {
    console.error('existiertVorschlagMitDedupKey: Directus nicht erreichbar', err)
    return false
  }
}

// ─── Reine Bau-Helfer (testbar, kein IO) ──────────────────────────────────────

/**
 * Dedup-Schlüssel für den Login-Link-Vorschlag: pro E-Mail und Tag (UTC)
 * höchstens einer, damit mehrfaches Klicken auf "Login-Link senden" am selben
 * Tag den Operator nicht mit Vorschlägen zuspammt. Der Zugang selbst (jti,
 * letzter_link) wird bei jeder Anfrage trotzdem neu geschrieben.
 */
export function baueLoginDedupKey(email: string, jetzt: Date = new Date()): string {
  const datum = jetzt.toISOString().slice(0, 10)
  return `portal|login|${email}|${datum}`
}

/**
 * Parst `stiftung_id` aus einem rohen Request-Body (String oder Zahl). null
 * bei leer/ungültig. Gemeinsamer Helfer für anschreiben.ts und
 * nicht-relevant.ts (Fix-Runde 1: war zuvor in beiden Routen dupliziert).
 */
export function leseStiftungIdAusBody(body: unknown): number | null {
  const roh = (body as { stiftung_id?: unknown } | null)?.stiftung_id
  const str = typeof roh === 'string' ? roh.trim() : typeof roh === 'number' ? String(roh) : ''
  if (!str) return null
  const n = parseInt(str, 10)
  return Number.isNaN(n) ? null : n
}

// ─── Directus-REST-Helfer: stiftungen (Namen für Portal-Titel/Notizen, Task 9) ─

/**
 * Lädt den Stiftungsnamen für Titel/Notizen (anschreiben.ts, nicht-relevant.ts).
 * Fällt auf die id selbst zurück, wenn die Stiftung nicht ladbar ist (reine
 * Anzeige-Degradation, kein Fehlerfall: der eigentliche Schreibvorgang soll
 * daran nicht scheitern).
 */
export async function ladeStiftungName(stiftungId: number): Promise<string> {
  try {
    const res = await fetch(`${base()}/items/stiftungen/${stiftungId}?fields=Stiftungsname`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return String(stiftungId)
    const json = (await res.json()) as { data?: { Stiftungsname?: string } }
    return json.data?.Stiftungsname?.trim() || String(stiftungId)
  } catch (err: unknown) {
    console.error('ladeStiftungName: Directus nicht erreichbar', err)
    return String(stiftungId)
  }
}

// ─── Directus-REST-Helfer: applications (Portal-Gesuchsanfragen + Ausblenden, Task 9) ─

/**
 * true, wenn für dieses Medium+Stiftung-Paar bereits eine NICHT-ausgeblendete
 * Application existiert (Doppel-Schutz für anschreiben.ts: verhindert, dass
 * dieselbe Stiftung zweimal als Gesuchsanfrage angelegt wird).
 */
export async function existiertOffeneApplication(mediumSlug: string, stiftungId: number): Promise<boolean> {
  const filter = encodeURIComponent(
    JSON.stringify({ medium_id: { _eq: mediumSlug }, stiftung_id: { _eq: stiftungId }, status: { _neq: 'ausgeblendet' } }),
  )
  const res = await fetch(`${base()}/items/applications?filter=${filter}&limit=1&fields=id`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`applications: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: unknown[] }
  return (json.data?.length ?? 0) > 0
}

/**
 * Legt eine Application an (REST, liefert die neue id). Generischer
 * Schreib-Helfer für anschreiben.ts (Gesuchsanfrage, status identifiziert)
 * und nicht-relevant.ts (Marker-Application, status ausgeblendet).
 */
export async function legeApplicationAn(data: Record<string, unknown>): Promise<{ id: string }> {
  const res = await fetch(`${base()}/items/applications`, {
    method: 'POST',
    headers: schreibHeaders(),
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Application anlegen fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { data?: { id?: string } }
  if (!json.data?.id) throw new Error('Directus: keine id nach Application-Anlage')
  return { id: json.data.id }
}

// ─── Directus-REST-Helfer: applications per id (Portal-Gesuche, Task 10) ──────

/**
 * Form des `applications.portal`-json-Felds, das die drei Gesuch-Aktionsrouten
 * lesen/schreiben (Task 10). EINZIGE Quelle dieses Typs (Fix-Runde 1, Minor 4):
 * vorher stand hier UND in `gesuche.ts` (als lokales `PortalJsonRoh`) je eine
 * eigene, fast identische Deklaration; `gesuche.ts` importiert diesen Typ jetzt.
 * Alle Felder bewusst optional/nullable (auch innerhalb der Arrays): Directus
 * liefert ein json-Feld ungeprüft zurück, ein Eintrag kann älter sein als ein
 * inzwischen ergänztes Feld.
 */
export type PortalGesuchApplicationPortalRoh = {
  angefordert_am?: string | null
  freigegeben_am?: string | null
  final_am?: string | null
  abgeschickt_am?: string | null
  gesuch_text?: string | null
  gesuch_versionen?: GesuchVersion[] | null
  beilagen?: Array<{ fileId?: string | null; name?: string | null }> | null
  betrag_eingereicht_chf?: number | null
}

export type PortalGesuchApplicationRoh = {
  id: string
  stiftungId: string | null
  stiftungName: string | null
  status: string | null
  bemerkung: string | null
  eingereichtAm: string | null
  entschiedenAm: string | null
  /** Bisher zugesagter Betrag (Top-Level-Feld, NICHT im `portal`-json): Fallback-Basis für gesuch-aktion.ts (zusage). */
  betragZugesagtChf: number | null
  /** Immer ein Objekt (nie null): erspart jeder Route den `?? {}`-Fallback vor dem Lesen einzelner Felder. */
  portal: PortalGesuchApplicationPortalRoh
}

/**
 * Lädt eine Application per id UND prüft in einem Zug, dass sie dem
 * Session-Medium gehört. Gehört sie einem ANDEREN Medium oder existiert sie
 * nicht, liefert die Funktion null. Die aufrufende Route antwortet in
 * BEIDEN Fällen einheitlich mit 404, ein Aufrufer kann so nicht unterscheiden,
 * ob eine fremde Application existiert oder nicht (kein Informationsleck über
 * fremde Anträge). Jede der drei Gesuch-Aktionsrouten (gesuch-text.ts,
 * gesuch-aktion.ts, beilage.ts) MUSS diesen Loader statt eines rohen Fetches
 * verwenden, damit die Zugehörigkeitsprüfung nicht in jeder Route erneut von
 * Hand nachgebaut wird (und dabei vergessen werden kann).
 *
 * Wirft bei Netzwerk-/Directus-Serverfehlern (die Route antwortet dann mit
 * 502), NICHT bei einer schlicht nicht existierenden id (die Directus selbst
 * mit 404 beantwortet: das ergibt hier null, kein Fehler).
 */
export async function ladeApplicationFuerPortal(id: string, mediumSlug: string): Promise<PortalGesuchApplicationRoh | null> {
  const felder =
    'id,medium_id,stiftung_id,stiftung_name,status,bemerkung,eingereicht_am,entschieden_am,betrag_zugesagt_chf,portal'
  const res = await fetch(`${base()}/items/applications/${encodeURIComponent(id)}?fields=${felder}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`applications/${id}: Directus antwortete ${res.status}`)
  const json = (await res.json()) as {
    data?: {
      id: string | number
      medium_id?: string | null
      stiftung_id?: string | number | null
      stiftung_name?: string | null
      status?: string | null
      bemerkung?: string | null
      eingereicht_am?: string | null
      entschieden_am?: string | null
      betrag_zugesagt_chf?: number | null
      portal?: PortalGesuchApplicationPortalRoh | null
    }
  }
  const row = json.data
  if (!row) return null
  if ((row.medium_id ?? '') !== mediumSlug) return null

  return {
    id: String(row.id),
    stiftungId: row.stiftung_id != null ? String(row.stiftung_id) : null,
    stiftungName: row.stiftung_name ?? null,
    status: row.status ?? null,
    bemerkung: row.bemerkung ?? null,
    eingereichtAm: row.eingereicht_am ?? null,
    entschiedenAm: row.entschieden_am ?? null,
    betragZugesagtChf: typeof row.betrag_zugesagt_chf === 'number' ? row.betrag_zugesagt_chf : null,
    portal: row.portal && typeof row.portal === 'object' ? row.portal : {},
  }
}

/**
 * Schreibt ein Patch auf eine bestehende Application (REST, PATCH per id).
 * Gemeinsamer Schreib-Helfer für gesuch-text.ts und gesuch-aktion.ts: beide
 * lesen zuerst mit `ladeApplicationFuerPortal`, bauen daraus ein
 * vollständiges, gemergtes `portal`-Objekt (bestehende Felder bleiben
 * erhalten, siehe Modul-Kommentar der beiden Routen) und schreiben es hier
 * zusammen mit evtl. weiteren Top-Level-Feldern (status, station, bemerkung,
 * betrag_zugesagt_chf, eingereicht_am, entschieden_am) in EINEM PATCH zurück.
 */
export async function patchApplication(id: string, data: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${base()}/items/applications/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: schreibHeaders(),
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Application aktualisieren fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`)
  }
}

// ─── Directus-REST-Helfer: consent_log (Task 9) ────────────────────────────────

export type ConsentLogZeile = { text_version: string; kontext: string }

/**
 * Lädt alle consent_log-Zeilen eines Mediums (nur die zwei Felder, die
 * `brauchtVollConsent` braucht, siehe consent.ts).
 */
export async function ladeConsentLogs(mediumSlug: string): Promise<ConsentLogZeile[]> {
  const filter = encodeURIComponent(JSON.stringify({ medium_slug: { _eq: mediumSlug } }))
  const res = await fetch(`${base()}/items/consent_log?filter=${filter}&limit=-1&fields=text_version,kontext`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`consent_log: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: Array<{ text_version?: string; kontext?: string }> }
  return (json.data ?? []).map((r) => ({ text_version: r.text_version ?? '', kontext: r.kontext ?? '' }))
}

/** Legt eine consent_log-Zeile an (REST, liefert die neue id). */
export async function legeConsentLogAn(data: Record<string, unknown>): Promise<{ id: string }> {
  const res = await fetch(`${base()}/items/consent_log`, {
    method: 'POST',
    headers: schreibHeaders(),
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`consent_log anlegen fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { data?: { id?: string } }
  if (!json.data?.id) throw new Error('Directus: keine id nach consent_log-Anlage')
  return { id: json.data.id }
}

// ─── Directus-REST-Helfer: agent_lessons (Lern-Loop, Task 9) ──────────────────

/**
 * Legt eine agent_lessons-Zeile an (z. B. bauAusblendeLesson beim Ausblenden
 * übers Portal). Standardmässig fire-and-forget wie bisher: der Lern-Loop darf
 * die eigentliche Aktion nie scheitern lassen.
 *
 * Mit `{ mitId: true }` wird die Antwort ausgewertet und die neue id
 * zurückgegeben (Treffer-Rückmeldung: sie braucht die id für den
 * Freigabe-Vorschlag). Dann wirft die Funktion auch, wenn Directus die Zeile
 * ablehnt — eine Rückmeldung, die nicht liegt, darf nicht als gespeichert
 * gemeldet werden.
 */
export async function legeAgentLessonAn(
  data: Record<string, unknown>,
  opts?: { mitId?: boolean },
): Promise<{ id: string } | undefined> {
  const res = await fetch(`${base()}/items/agent_lessons`, {
    method: 'POST',
    headers: schreibHeaders(),
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15_000),
  })
  if (!opts?.mitId) return undefined
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`agent_lessons anlegen fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { data?: { id?: string } }
  if (!json.data?.id) throw new Error('Directus: keine id nach agent_lessons-Anlage')
  return { id: String(json.data.id) }
}

/**
 * Baut den agent_vorschlaege-Payload für eine Login-Link-Anfrage.
 *
 * Der Link steht bewusst als TEXT in der Beschreibung und NICHT in
 * artefakt_link: die VorschlagCard rendert artefakt_link als klickbaren
 * «Vorbereitetes Artefakt öffnen»-Anker, und ein Operator-Klick (oder ein
 * Link-Prefetcher) würde die Login-Seite fälschlich selbst öffnen. Der
 * Login-Link gehört ausschliesslich ans Medium.
 */
export function baueLoginVorschlag(params: {
  email: string
  mediumSlug: string
  mandant: string
  link: string
  dedupKey: string
}): Record<string, unknown> {
  return {
    typ: 'portal',
    status: 'offen',
    prioritaet: 'tief',
    medium_id: params.mediumSlug,
    stiftung_id: null,
    titel: `Login-Link angefordert: ${params.email}`,
    beschreibung:
      `Medium ${params.mediumSlug} hat über das Portal einen neuen Login-Link angefordert (bleibt gültig, der vorherige Link ist damit ungültig).\n\n` +
      `Login-Link, nur ans Medium weitergeben (nicht selbst öffnen):\n${params.link}`,
    begruendung: '',
    frist: null,
    artefakt_link: null,
    quelle_modell: 'portal',
    erstellt_von: 'portal',
    mandant: params.mandant,
    dedup_key: params.dedupKey,
  }
}

// ─── Directus-REST-Helfer: medium_foerderhistorie (Förderhistorie + Ausschlüsse) ─

/**
 * Rohzeile aus Directus → FoerderhistorieZeile (lib/foerderhistorie.ts).
 * stiftung_id wird zum String normalisiert (wie PortalTreffer.stiftungId,
 * damit Ausschluss-Set und Badge-Map direkt vergleichbar sind).
 */
function baueFoerderhistorieZeile(row: Record<string, unknown>): import('./foerderhistorie').FoerderhistorieZeile {
  return {
    id: Number(row.id),
    stiftungId: row.stiftung_id != null ? String(row.stiftung_id) : null,
    stiftungName: typeof row.stiftung_name === 'string' ? row.stiftung_name : '',
    typ: typeof row.typ === 'string' ? row.typ : '',
    jahr: typeof row.jahr === 'number' ? row.jahr : null,
    betrag: typeof row.betrag === 'number' ? row.betrag : null,
    zweck: typeof row.zweck === 'string' && row.zweck.trim() ? row.zweck : null,
    ausgeschlossen: row.ausgeschlossen === true,
    ausschlussGrund: typeof row.ausschluss_grund === 'string' && row.ausschluss_grund.trim() ? row.ausschluss_grund : null,
  }
}

const FOERDERHISTORIE_FELDER = 'id,stiftung_id,stiftung_name,typ,jahr,betrag,zweck,ausgeschlossen,ausschluss_grund'

/** Lädt alle aktiven Förderhistorie-Zeilen eines Mediums (neueste zuerst). */
export async function ladeFoerderhistorie(mediumSlug: string): Promise<import('./foerderhistorie').FoerderhistorieZeile[]> {
  const filter = encodeURIComponent(JSON.stringify({ medium_id: { _eq: mediumSlug }, aktiv: { _eq: true } }))
  const res = await fetch(
    `${base()}/items/medium_foerderhistorie?filter=${filter}&limit=-1&sort=-date_created&fields=${FOERDERHISTORIE_FELDER}`,
    { headers: authHeaders(), signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) throw new Error(`medium_foerderhistorie: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
  return (json.data ?? []).map(baueFoerderhistorieZeile)
}

/**
 * Lädt eine Förderhistorie-Zeile per id UND prüft die Zugehörigkeit zum
 * Session-Medium (dasselbe Muster wie ladeApplicationFuerPortal: fremde oder
 * fehlende Zeile → null, die Route antwortet einheitlich 404).
 */
export async function ladeFoerderhistorieEintrag(
  id: number,
  mediumSlug: string,
): Promise<{ id: number; knowledgeId: number | null } | null> {
  const res = await fetch(`${base()}/items/medium_foerderhistorie/${id}?fields=id,medium_id,knowledge_id,aktiv`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`medium_foerderhistorie/${id}: Directus antwortete ${res.status}`)
  const json = (await res.json()) as {
    data?: { id: number; medium_id?: string | null; knowledge_id?: number | null; aktiv?: boolean }
  }
  const row = json.data
  if (!row || (row.medium_id ?? '') !== mediumSlug || row.aktiv === false) return null
  return { id: Number(row.id), knowledgeId: typeof row.knowledge_id === 'number' ? row.knowledge_id : null }
}

/** Legt eine medium_foerderhistorie-Zeile an (REST, liefert die neue id). */
export async function legeFoerderhistorieAn(data: Record<string, unknown>): Promise<{ id: number }> {
  const res = await fetch(`${base()}/items/medium_foerderhistorie`, {
    method: 'POST',
    headers: schreibHeaders(),
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Förderhistorie anlegen fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { data?: { id?: number } }
  if (!json.data?.id) throw new Error('Directus: keine id nach Förderhistorie-Anlage')
  return { id: json.data.id }
}

/** Patcht eine medium_foerderhistorie-Zeile (Soft-Delete: { aktiv: false }). */
export async function patchFoerderhistorie(id: number, data: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${base()}/items/medium_foerderhistorie/${id}`, {
    method: 'PATCH',
    headers: schreibHeaders(),
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Förderhistorie aktualisieren fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`)
  }
}

/**
 * Löscht einen medium_knowledge-Eintrag (Aufräumen beim Entfernen einer
 * Förderhistorie-Zeile mit verknüpftem Wissens-Eintrag). Ein 404 ist kein
 * Fehler: der Eintrag kann bereits über das Operator-Cockpit entfernt sein.
 */
export async function loescheWissensEintrag(id: number): Promise<void> {
  const res = await fetch(`${base()}/items/medium_knowledge/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`medium_knowledge/${id} löschen fehlgeschlagen (${res.status})`)
  }
}

// ─── Directus-REST-Helfer: stiftungen-Suche (Typeahead im Portal) ─────────────

/**
 * Namens-Typeahead für das Förderhistorie-Formular: liefert höchstens 8
 * Stiftungen (id, Name, Sitz) für einen Suchbegriff ab 2 Zeichen. Bewusst
 * minimal gehalten (kein Zweck, keine Beträge, keine DNA): das Medium nennt
 * uns einen Namen, den es schon kennt — die Datenbank wird hier nicht
 * durchblätterbar. Duplikat-Zeilen (duplicate_of gesetzt) sind ausgenommen,
 * damit nie die Zweit-ID einer Stiftung verknüpft wird.
 */
export async function sucheStiftungenFuerPortal(q: string): Promise<Array<{ id: string; name: string; sitz: string | null }>> {
  const filter = encodeURIComponent(
    JSON.stringify({ _and: [{ Stiftungsname: { _icontains: q } }, { duplicate_of: { _null: true } }] }),
  )
  const res = await fetch(`${base()}/items/stiftungen?filter=${filter}&limit=8&sort=Stiftungsname&fields=id,Stiftungsname,sitz`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`stiftungen-Suche: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: Array<{ id?: number | string; Stiftungsname?: string; sitz?: string | null }> }
  return (json.data ?? [])
    .filter((r) => r.id != null && typeof r.Stiftungsname === 'string' && r.Stiftungsname.trim())
    .map((r) => ({
      id: String(r.id),
      name: (r.Stiftungsname as string).trim(),
      sitz: typeof r.sitz === 'string' && r.sitz.trim() ? r.sitz.trim() : null,
    }))
}

// ─── Directus-REST-Helfer: Fragebogen bearbeiten (Wunsch 29.07.2026) ──────────

/**
 * Lädt den bestehenden Fragebogen-Eintrag eines Mediums (jüngster, falls aus
 * der Zeit vor der Bearbeitbarkeit mehrere existieren) samt Inhalt, damit die
 * Portal-Seite die Antworten vorbefüllen und ein POST sie überschreiben kann
 * statt einen weiteren Eintrag anzulegen. Erkennung über den Titel-Präfix
 * (istFragebogenEintrag in portal-status.ts) — die Kategorie general_info
 * tragen auch andere Einträge.
 */
export async function ladeFragebogenEintrag(
  slug: string,
): Promise<{ id: number; content: string; dateUpdated: string } | null> {
  const filter = encodeURIComponent(
    JSON.stringify({ medium_id: { _eq: slug }, title: { _starts_with: FRAGEBOGEN_TITEL_PREFIX } }),
  )
  // NUR Felder anfragen, die die Collection wirklich hat: `medium_knowledge`
  // trägt kein `date_updated`, und Directus antwortet auf ein unbekanntes Feld
  // mit 403 (live belegt 29.07.2026) — die Route wäre dann dauerhaft 502.
  // Der Titel trägt das Datum des letzten Speichervorgangs (baueFragebogenEintrag
  // schreibt es beim Überschreiben neu), darum kommt der Stand von dort und
  // fällt auf date_created zurück.
  const res = await fetch(
    `${base()}/items/medium_knowledge?filter=${filter}&sort=-date_created&limit=1&fields=id,title,content,date_created`,
    { headers: authHeaders(), signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) throw new Error(`medium_knowledge (Fragebogen): Directus antwortete ${res.status}`)
  const json = (await res.json()) as {
    data?: Array<{ id: number; title?: string | null; content?: string | null; date_created?: string | null }>
  }
  const row = json.data?.[0]
  if (!row) return null
  const datumAusTitel = /(\d{4}-\d{2}-\d{2})/.exec(row.title ?? '')?.[1]
  return {
    id: row.id,
    content: row.content ?? '',
    dateUpdated: datumAusTitel ?? row.date_created ?? '',
  }
}

/** Patcht einen medium_knowledge-Eintrag (Fragebogen-Überschreiben). */
export async function patcheWissensEintrag(id: number, data: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${base()}/items/medium_knowledge/${id}`, {
    method: 'PATCH',
    headers: schreibHeaders(),
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`medium_knowledge aktualisieren fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`)
  }
}
