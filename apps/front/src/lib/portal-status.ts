import { PORTAL_TEXTE } from './portal-texte'

/**
 * portal-status.ts: reine Ableitungslogik für die Portal-Übersichtsseite
 * (/api/portal/uebersicht, src/pages/portal/index.tsx).
 *
 * Kein IO hier: die Route (uebersicht.ts) sammelt die Rohdaten aus Directus
 * und übergibt sie an `baueUebersicht`. Das macht die Fortschritts- und
 * Reminder-Regeln ohne Mocks testbar.
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export type StationKey = 'logo' | 'unterlagen' | 'dna' | 'freischaltung' | 'treffer' | 'gesuche'
export type StationStatus = 'offen' | 'aktiv' | 'erledigt'
export type Station = { key: StationKey; status: StationStatus }
export type Reminder = { text: string; datum: string }

export type UebersichtFlags = {
  /** faas_medien.logo_url ist gesetzt (echtes PNG/JPG-Logo hochgeladen, Pflicht-Erststep). */
  hatLogo: boolean
  /** ≥1 medium_knowledge-Eintrag für dieses Medium. */
  hatUnterlagen: boolean
  /** faas_medien.dna_medium_freigabe ist gesetzt. */
  dnaFreigegeben: boolean
  /** faas_medien.matching_freigeschaltet ist gesetzt. */
  freigeschaltet: boolean
  /** ≥1 application mit zuletzt_geaendert_quelle 'portal'. */
  hatGesuchUeberPortal: boolean
  /**
   * ≥1 aktive medium_foerderhistorie-Zeile (Design 2026-07-29). Optional und
   * nur bei EXPLIZITEM false wirksam: dann hängt der Nächste-Schritt-Satz in
   * der Unterlagen-/DNA-Phase den Förderhistorie-Hinweis an. Kein harter
   * Schritt in der Stationen-Kette — Förderhistorie ist freiwillig (nicht
   * jedes Medium hat frühere Förderungen zu melden) und darf nichts blockieren.
   */
  hatFoerderhistorie?: boolean
}

export type ReminderKandidat = {
  /** ISO-Zeitstempel aus applications.portal.abgeschickt_am. */
  abgeschicktAm: string
  /** applications.status. */
  status: string
  /** Bereits bekannter Stiftungsname (denormalisiert oder nachgeladen), sonst null. */
  stiftungName: string | null
}

export type UebersichtAntwort = {
  stationen: Station[]
  naechsterSchritt: string
  reminder: Reminder[]
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

/** Anzeige-Reihenfolge der Stationen. Logo steht ganz am Anfang (Pflicht-Erststep vor Unterlagen). */
export const STATION_REIHENFOLGE: readonly StationKey[] = ['logo', 'unterlagen', 'dna', 'freischaltung', 'treffer', 'gesuche']

/** Kurze Stations-Labels für die Fortschrittsleiste (keine Fliesstext-Sätze, darum nicht in PORTAL_TEXTE). */
export const STATION_LABEL: Record<StationKey, string> = {
  logo: 'Logo',
  unterlagen: 'Unterlagen',
  dna: 'DNA',
  freischaltung: 'Freischaltung',
  treffer: 'Treffer',
  gesuche: 'Gesuche',
}

const NAECHSTER_SCHRITT_SCHLUESSEL: Record<StationKey, string> = {
  logo: 'uebersicht.naechster_schritt.logo',
  unterlagen: 'uebersicht.naechster_schritt.unterlagen',
  dna: 'uebersicht.naechster_schritt.dna',
  freischaltung: 'uebersicht.naechster_schritt.freischaltung',
  treffer: 'uebersicht.naechster_schritt.treffer',
  gesuche: 'uebersicht.naechster_schritt.gesuche',
}

const NEUNZIG_TAGE_MS = 90 * 24 * 60 * 60 * 1000

/** Ausgang bereits entschieden, kein Nachfassen mehr nötig. */
const AUSGANG_ENTSCHIEDEN = new Set(['zugesagt', 'abgelehnt'])

// ─── Stationen-Ableitung ──────────────────────────────────────────────────────

/**
 * Baut die 6 Stationen aus den Rohdaten-Flags.
 *
 * Reihenfolge logo → unterlagen → dna → freischaltung ist ein strikter
 * Ablauf: die erste NICHT erledigte Station in dieser Kette ist 'aktiv',
 * alles danach 'offen'. Logo ist der Pflicht-Erststep: ohne ein
 * hochgeladenes Logo (echtes PNG/JPG, siehe /api/portal/logo) bleibt jede
 * weitere Station 'offen', unabhängig davon, was sonst schon erledigt ist.
 * Ab Freischaltung läuft es anders weiter: 'treffer' hat KEIN eigenes
 * Erledigt-Kriterium (Treffer kommen laufend, die Station endet nie) und
 * ist darum 'aktiv', sobald freigeschaltet ist, unabhängig davon, ob
 * bereits ein Gesuch läuft. 'gesuche' hängt NICHT von 'treffer' ab, sondern
 * ausschliesslich vom eigenen Kriterium (≥1 Antrag mit Quelle Portal): offen
 * ohne ein solches Gesuch, erledigt sobald eines existiert. So bleibt in
 * jedem Fall genau eine Station 'aktiv' (treffer, sobald freigeschaltet).
 */
export function baueStationen(flags: UebersichtFlags): Station[] {
  const { hatLogo, hatUnterlagen, dnaFreigegeben, freigeschaltet, hatGesuchUeberPortal } = flags

  if (!hatLogo) {
    return [
      { key: 'logo', status: 'aktiv' },
      { key: 'unterlagen', status: 'offen' },
      { key: 'dna', status: 'offen' },
      { key: 'freischaltung', status: 'offen' },
      { key: 'treffer', status: 'offen' },
      { key: 'gesuche', status: 'offen' },
    ]
  }
  if (!hatUnterlagen) {
    return [
      { key: 'logo', status: 'erledigt' },
      { key: 'unterlagen', status: 'aktiv' },
      { key: 'dna', status: 'offen' },
      { key: 'freischaltung', status: 'offen' },
      { key: 'treffer', status: 'offen' },
      { key: 'gesuche', status: 'offen' },
    ]
  }
  if (!dnaFreigegeben) {
    return [
      { key: 'logo', status: 'erledigt' },
      { key: 'unterlagen', status: 'erledigt' },
      { key: 'dna', status: 'aktiv' },
      { key: 'freischaltung', status: 'offen' },
      { key: 'treffer', status: 'offen' },
      { key: 'gesuche', status: 'offen' },
    ]
  }
  if (!freigeschaltet) {
    return [
      { key: 'logo', status: 'erledigt' },
      { key: 'unterlagen', status: 'erledigt' },
      { key: 'dna', status: 'erledigt' },
      { key: 'freischaltung', status: 'aktiv' },
      { key: 'treffer', status: 'offen' },
      { key: 'gesuche', status: 'offen' },
    ]
  }
  return [
    { key: 'logo', status: 'erledigt' },
    { key: 'unterlagen', status: 'erledigt' },
    { key: 'dna', status: 'erledigt' },
    { key: 'freischaltung', status: 'erledigt' },
    { key: 'treffer', status: 'aktiv' },
    { key: 'gesuche', status: hatGesuchUeberPortal ? 'erledigt' : 'offen' },
  ]
}

/**
 * Liefert den kurzen deutschen Nächster-Schritt-Satz passend zur aktiven
 * Station. Der 'gesuche'-Zweig ist mit der heutigen baueStationen-Regel
 * bewusst unerreichbar (es ist immer genau eine Station aktiv, und nach der
 * Freischaltung ist das dauerhaft 'treffer'); er bleibt als defensives Netz
 * stehen, falls die Stationen-Regel später ändert.
 *
 * Solange die Unterlagen- oder DNA-Phase aktiv ist und das Medium EXPLIZIT
 * noch keine Förderhistorie erfasst hat (hatFoerderhistorie === false), wird
 * der Hinweis auf den neuen Block angehängt — damit er im geführten Weg
 * nicht übersehen wird (Wunsch 29.07.2026). Ab der Freischaltung entfällt
 * der Hinweis: erfassen geht weiterhin jederzeit, aber genagt wird nicht.
 */
export function baueNaechsterSchrittText(stationen: Station[], hatFoerderhistorie?: boolean): string {
  const aktive = stationen.find((s) => s.status === 'aktiv')
  const schluessel = NAECHSTER_SCHRITT_SCHLUESSEL[aktive?.key ?? 'gesuche']
  const basis = PORTAL_TEXTE[schluessel]
  if (hatFoerderhistorie === false && (aktive?.key === 'unterlagen' || aktive?.key === 'dna')) {
    return `${basis} ${PORTAL_TEXTE['uebersicht.naechster_schritt.foerderhistorie_hinweis']}`
  }
  return basis
}

// ─── Reminder-Ableitung ───────────────────────────────────────────────────────

/**
 * Filtert Nachfass-Kandidaten auf die tatsächlich fälligen: Einreichung
 * STRIKT länger als 90 Tage zurück, Ausgang noch nicht entschieden
 * (weder zugesagt noch abgelehnt). Ein ungültiges Datum wird übersprungen
 * statt die Route crashen zu lassen.
 */
export function baueReminder(kandidaten: ReminderKandidat[], jetzt: Date): Reminder[] {
  const reminder: Reminder[] = []
  for (const kandidat of kandidaten) {
    if (AUSGANG_ENTSCHIEDEN.has(kandidat.status)) continue
    const abgeschickt = new Date(kandidat.abgeschicktAm)
    if (Number.isNaN(abgeschickt.getTime())) continue
    if (jetzt.getTime() - abgeschickt.getTime() <= NEUNZIG_TAGE_MS) continue

    const basisText = PORTAL_TEXTE['gesuche.nachfassen_reminder']
    reminder.push({
      text: kandidat.stiftungName ? `${basisText} (Stiftung: ${kandidat.stiftungName})` : basisText,
      datum: kandidat.abgeschicktAm,
    })
  }
  return reminder
}

// ─── Zusammenbau ──────────────────────────────────────────────────────────────

/** Baut die vollständige Antwort für GET /api/portal/uebersicht. */
export function baueUebersicht(flags: UebersichtFlags, reminderKandidaten: ReminderKandidat[], jetzt: Date): UebersichtAntwort {
  const stationen = baueStationen(flags)
  return {
    stationen,
    naechsterSchritt: baueNaechsterSchrittText(stationen, flags.hatFoerderhistorie),
    reminder: baueReminder(reminderKandidaten, jetzt),
  }
}

// ─── Gesuch-Status (/api/portal/gesuche, src/pages/portal/gesuche.tsx, Task 10) ─

export type GesuchPortalStatus = 'angefordert' | 'in_arbeit' | 'bereit' | 'final' | 'abgeschickt' | 'zusage' | 'absage'

export interface GesuchPortalApplicationPortal {
  angefordert_am?: string | null
  freigegeben_am?: string | null
  final_am?: string | null
  abgeschickt_am?: string | null
}

export interface GesuchPortalApplication {
  /** applications.status (Directus-Roh-Wert, z. B. 'identifiziert', 'in_arbeit', 'eingereicht', 'zugesagt', 'abgelehnt'). */
  status: string | null
  portal?: GesuchPortalApplicationPortal | null
}

/** Die Status, ab denen Gesuchstext/Beilagen sichtbar sind (siehe /api/portal/gesuche: "NUR ab Status bereit"). */
export const GESUCH_STATUS_AB_BEREIT: ReadonlySet<GesuchPortalStatus> = new Set(['bereit', 'final', 'abgeschickt', 'zusage', 'absage'])

/**
 * Leitet den Portal-Anzeigestatus eines Gesuchs (einer Application) ab.
 *
 * Präzedenz nach Fortschritt, konsistent mit `leiteStatusAb` in
 * portal-treffer.ts, dort erweitert um die drei Zwischen-/Endzustände final,
 * zusage, absage (fortgeschrittenster Zustand gewinnt, unabhängig davon,
 * welche älteren Zeitstempel daneben noch gesetzt sind):
 *
 *   zusage (status 'zugesagt') > absage (status 'abgelehnt')
 *   > abgeschickt (portal.abgeschickt_am ODER status 'eingereicht')
 *   > final (portal.final_am)
 *   > bereit (portal.freigegeben_am, der Operator hat freigegeben)
 *   > in_arbeit (application-status 'in_arbeit')
 *   > angefordert (Rest, inkl. defensiver Default ohne jedes Signal: jedes
 *     Gesuch auf dieser Seite entsteht über /api/portal/anschreiben, das
 *     `portal.angefordert_am` immer mitschreibt, siehe consent.ts
 *     baueGesuchAuftrag; ein Gesuch ganz ohne Signal sollte also nicht
 *     vorkommen, dieser Fall bleibt trotzdem als sicherer Fallback stehen).
 */
export function gesuchPortalStatus(app: GesuchPortalApplication): GesuchPortalStatus {
  const portal = app.portal ?? null
  if (app.status === 'zugesagt') return 'zusage'
  if (app.status === 'abgelehnt') return 'absage'
  if (portal?.abgeschickt_am || app.status === 'eingereicht') return 'abgeschickt'
  if (portal?.final_am) return 'final'
  if (portal?.freigegeben_am) return 'bereit'
  if (app.status === 'in_arbeit') return 'in_arbeit'
  return 'angefordert'
}

// ─── Gesuch-Versionen-Kippregel (/api/portal/gesuch-text, Task 10) ────────────

export type GesuchVersion = { ts: string; von: string }

/** Maximale Anzahl gespeicherter Gesuchtext-Versionen (portal.gesuch_versionen). */
export const GESUCH_VERSIONEN_MAX = 20

/**
 * Hängt eine neue Version an die Liste an. Solange die Liste danach nicht
 * länger als `max` ist, wächst sie einfach; wird sie länger, kippt die
 * älteste (Index 0) heraus, so dass genau `max` Einträge bleiben und die
 * neue Version am Ende steht. Reine Funktion, kein IO: die Route
 * (gesuch-text.ts) liest die bisherige Liste aus `portal.gesuch_versionen`
 * und schreibt das Ergebnis zurück.
 */
export function fuegeGesuchVersionHinzu(bisherige: GesuchVersion[], neu: GesuchVersion, max: number = GESUCH_VERSIONEN_MAX): GesuchVersion[] {
  const erweitert = [...bisherige, neu]
  return erweitert.length <= max ? erweitert : erweitert.slice(erweitert.length - max)
}

// ─── Portal-JSON parsen (Operator-Warteschlange, Task 11) ─────────────────────

/**
 * Rohe Form des `applications.portal`-json-Felds, wie sie sowohl die
 * Portal-Routen (Task 9/10, siehe `PortalGesuchApplicationPortalRoh` in
 * portal-guard.ts) als auch die Operator-Warteschlange «Vom Medium
 * angefordert» (applications.tsx + gesuch-text-erfassen.ts +
 * gesuch-freigeben.ts, Task 11) lesen. Feldgleich mit dem Portal-Pendant,
 * hier zusätzlich `angefordert_von` (wird von consent.ts baueGesuchAuftrag
 * geschrieben, aber vom Portal-Typ bisher nicht gebraucht) und
 * `freigegeben_von` (neu, Task 11: gesuch-freigeben.ts). Alle Felder bewusst
 * optional/nullable: Directus liefert ein json-Feld ungeprüft zurück, ein
 * Eintrag kann älter sein als ein inzwischen ergänztes Feld.
 */
export type PortalJsonRoh = {
  angefordert_am?: string | null
  angefordert_von?: string | null
  freigegeben_am?: string | null
  freigegeben_von?: string | null
  final_am?: string | null
  abgeschickt_am?: string | null
  gesuch_text?: string | null
  gesuch_versionen?: GesuchVersion[] | null
  beilagen?: Array<{ fileId?: string | null; name?: string | null }> | null
  betrag_eingereicht_chf?: number | null
}

/**
 * Parst das rohe `applications.portal`-Feld defensiv: akzeptiert ein Objekt
 * direkt, einen JSON-String oder null/undefined. Liefert IMMER ein Objekt
 * (nie null), anders als `parsePaket` (pakete.ts), das bei fehlenden
 * Pflichtfeldern null liefert: das `portal`-json hat keine Pflichtfelder,
 * jedes Feld ist optional, darum ist ein leeres Objekt der sichere Default.
 * So kann jeder Aufrufer direkt `parsePortal(app.portal).angefordert_am`
 * lesen, ohne vorher selbst auf null zu prüfen (»null-safe«).
 */
export function parsePortal(raw: unknown): PortalJsonRoh {
  if (raw == null) return {}

  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return {}
    }
  }

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return {}
  return obj as PortalJsonRoh
}

// ─── Unterlagen (/api/portal/wissen, src/pages/portal/onboarding.tsx) ─────────

/**
 * Kategorie-Zähler für die vier im Portal sichtbaren medium_knowledge-
 * Kategorien. Andere Kategorien (z. B. budget, tax_exemption), die der
 * Operator evtl. schon angelegt hat, fliessen zwar in `eintraege` der
 * Route, aber NICHT in diesen Zähler; die Portal-Vollständigkeit bezieht
 * sich bewusst nur auf die vier hier gelisteten.
 */
export type WissensZaehler = {
  published_article: number
  newsletter: number
  previous_application: number
  general_info: number
}

/**
 * Drei Dimensionen für die Portal-Vollständigkeit (bewusst schlanker als
 * das Operator-Pendant `berechneKnowledgeScore` in knowledge-score.ts, das
 * zusätzlich budget und tax_exemption zählt: für den Portal-Selbstservice
 * zählen nur die vier Kategorien, die dort überhaupt bedienbar sind).
 * published_article und newsletter gelten weiterhin zusammen als EINE
 * Dimension («Beispiele eurer Arbeit»), analog zur Operator-Logik.
 */
const WISSENS_DIMENSIONEN: Array<(z: WissensZaehler) => boolean> = [
  (z) => z.published_article > 0 || z.newsletter > 0,
  (z) => z.previous_application > 0,
  (z) => z.general_info > 0,
]

/** Prozentualer Vollständigkeits-Score (0-100, gerundet) aus den vier Portal-Zählern. */
export function berechneWissensScore(zaehler: WissensZaehler): number {
  const erreicht = WISSENS_DIMENSIONEN.filter((istErfuellt) => istErfuellt(zaehler)).length
  return Math.round((erreicht / WISSENS_DIMENSIONEN.length) * 100)
}

export type WissensQuelle = 'We.Publish' | 'von euch'

/**
 * Kurze Quellen-Kennzeichnung eines Wissens-Eintrags für die Portal-Ansicht.
 * medium_knowledge hat kein eigenes Ursprungs-Feld, `auto_scraped` ist das
 * einzige verfügbare Signal: automatisch eingesammelte Inhalte (We.Publish-
 * Ingest, URL-Scrape, Web-Crawl bei der DNA-Generierung) heissen
 * «We.Publish», von Hand hochgeladene/eingetragene Inhalte «von euch».
 */
export function bestimmeWissensQuelle(autoScraped: boolean): WissensQuelle {
  return autoScraped ? 'We.Publish' : 'von euch'
}

/** Rohe Fragebogen-Antworten aus POST /api/portal/wissen, noch ungetrimmt. */
export type FragebogenFelder = {
  selbstbeschrieb: string
  fokus: string
  nogos: string
}

export type FragebogenEintrag = { title: string; content: string }

const FRAGEBOGEN_ABSCHNITTE: Array<{ key: keyof FragebogenFelder; titel: string }> = [
  { key: 'selbstbeschrieb', titel: 'Selbstbeschrieb' },
  { key: 'fokus', titel: 'Fokus, was ihr erreichen wollt' },
  { key: 'nogos', titel: 'No-Gos' },
]

/**
 * Baut Titel + Inhalt des einen medium_knowledge-Eintrags, den der
 * Fragebogen erzeugt. Leere (oder nur aus Leerraum bestehende) Felder
 * fallen weg; sind ALLE Felder leer, liefert die Funktion null. Die Route
 * antwortet dann mit 422, statt einen leeren Eintrag anzulegen.
 */
export function baueFragebogenEintrag(felder: FragebogenFelder, jetzt: Date): FragebogenEintrag | null {
  const abschnitte = FRAGEBOGEN_ABSCHNITTE.map(({ key, titel }) => ({ titel, text: (felder[key] ?? '').trim() })).filter(
    (a) => a.text.length > 0,
  )
  if (abschnitte.length === 0) return null

  const datum = jetzt.toISOString().slice(0, 10)
  const content = abschnitte.map((a) => `${a.titel}\n${a.text}`).join('\n\n')
  return { title: `Fragebogen ${datum}`, content }
}
