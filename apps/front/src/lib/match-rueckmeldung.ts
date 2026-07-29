/**
 * match-rueckmeldung.ts: Rückmeldungen zu einzelnen Treffern
 * («diese Stiftung passt überhaupt nicht, weil …»).
 *
 * Zwei Wege, ein Speicherort (Collection `agent_lessons`, Kategorie
 * MATCH_RUECKMELDUNG_KATEGORIE):
 *   - **Operator** (Matching-Ansicht): geht sofort scharf, `aktiv: true`.
 *   - **Medium** (Portal-Treffer): wird als Vorschlag gespeichert,
 *     `aktiv: false` — erst die Freigabe durch We.Publish macht daraus eine
 *     wirksame Lesson (Entscheid der Nutzerin, 29.07.2026: «dann müssen wir
 *     es aber erst freigeben, bevors in die Datenbank wandert»). Der Eintrag
 *     liegt bewusst schon vor der Freigabe in Directus — sonst wäre er nur im
 *     Browser des Mediums und ginge verloren; wirksam wird er erst mit
 *     `aktiv: true`, und NUR aktive Zeilen liest die Match-Engine
 *     (load_match_rueckmeldungen in pipeline/spark/match_engine.py).
 *
 * Warum `agent_lessons` und keine neue Collection: die Zeilen tragen genau
 * die nötigen Felder (scope, medium_id, stiftung_id, kategorie, quelle,
 * notiz, aktiv, mandant), der Lern-Loop liest sie schon, und das bestehende
 * Ausblenden schreibt in dieselbe Tabelle (lib/ausblenden.ts). Eine zweite
 * Wahrheit für «was wir über dieses Paar gelernt haben» wäre ein Fehler.
 */

export const MATCH_RUECKMELDUNG_KATEGORIE = 'match_rueckmeldung'

/** Woher die Rückmeldung kommt. Bestimmt, ob sie sofort wirkt. */
export type RueckmeldungQuelle = 'matching-app' | 'portal'

export const RUECKMELDUNG_MIN_ZEICHEN = 5
export const RUECKMELDUNG_MAX_ZEICHEN = 1000

export type RueckmeldungEingabe = {
  stiftungId: number
  stiftungName: string
  notiz: string
}

export type RueckmeldungParseErgebnis =
  | { ok: true; eingabe: RueckmeldungEingabe }
  | { ok: false; fehler: string }

function leseId(roh: unknown): number | null {
  const str = typeof roh === 'string' ? roh.trim() : typeof roh === 'number' ? String(roh) : ''
  if (!str) return null
  const n = parseInt(str, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Prüft und normalisiert den POST-Body beider Routen. Der Stiftungsname ist
 * optional (die Route lädt ihn sonst nachträglich für die Notiz nach).
 */
export function parseRueckmeldung(body: unknown): RueckmeldungParseErgebnis {
  const b = (body ?? {}) as Record<string, unknown>

  const stiftungId = leseId(b.stiftung_id)
  if (stiftungId === null) {
    return { ok: false, fehler: 'stiftung_id (gültige Zahl) erforderlich.' }
  }

  const notiz = typeof b.notiz === 'string' ? b.notiz.trim() : ''
  if (notiz.length < RUECKMELDUNG_MIN_ZEICHEN) {
    return { ok: false, fehler: `Bitte beschreibt in mindestens ${RUECKMELDUNG_MIN_ZEICHEN} Zeichen, was nicht passt.` }
  }

  const stiftungName = typeof b.stiftung_name === 'string' ? b.stiftung_name.trim().slice(0, 200) : ''

  return { ok: true, eingabe: { stiftungId, stiftungName, notiz: notiz.slice(0, RUECKMELDUNG_MAX_ZEICHEN) } }
}

/**
 * Baut die agent_lessons-Zeile. `quelle` entscheidet über `aktiv`:
 * Operator-Rückmeldungen wirken sofort, Portal-Rückmeldungen warten auf die
 * Freigabe. Kein Feld wird aus dem Body übernommen, das nicht durch
 * parseRueckmeldung gelaufen ist.
 */
export function bauRueckmeldungLesson(params: {
  mediumId: string
  mandant: string
  eingabe: RueckmeldungEingabe
  quelle: RueckmeldungQuelle
}): Record<string, unknown> {
  const { mediumId, mandant, eingabe, quelle } = params
  return {
    scope: 'medium',
    mandant,
    medium_id: mediumId,
    stiftung_id: String(eingabe.stiftungId),
    kategorie: MATCH_RUECKMELDUNG_KATEGORIE,
    quelle,
    notiz: eingabe.notiz,
    aktiv: quelle === 'matching-app',
  }
}

/** Eine gelesene Rückmeldung, wie die Routen sie ausliefern. */
export type RueckmeldungZeile = {
  id: string
  mediumId: string
  stiftungId: string
  notiz: string
  quelle: string
  aktiv: boolean
  ts: string
}

/**
 * true, wenn diese Zeile noch auf die Freigabe wartet: aus dem Portal
 * gekommen und nicht aktiv. Operator-Zeilen sind nie freigabepflichtig.
 */
export function wartetAufFreigabe(zeile: Pick<RueckmeldungZeile, 'quelle' | 'aktiv'>): boolean {
  return zeile.quelle === 'portal' && !zeile.aktiv
}

/** Notiz für den agent_vorschlaege-Eintrag, mit dem der Operator die Freigabe sieht. */
export function bauFreigabeVorschlag(params: {
  mediumId: string
  mandant: string
  stiftungName: string
  stiftungId: number
  notiz: string
  lessonId: string
}): Record<string, unknown> {
  const { mediumId, mandant, stiftungName, stiftungId, notiz, lessonId } = params
  return {
    typ: 'matching',
    status: 'offen',
    prioritaet: 'mittel',
    medium_id: mediumId,
    stiftung_id: String(stiftungId),
    titel: `Rückmeldung freigeben: ${mediumId} zu ${stiftungName}`,
    beschreibung:
      `${mediumId} meldet zum Treffer «${stiftungName}»:\n\n${notiz}\n\n` +
      'Die Rückmeldung liegt als noch nicht aktive Lern-Notiz bereit. Erst nach der Freigabe ' +
      'berücksichtigt die Match-Engine sie beim nächsten Lauf.',
    begruendung: '',
    frist: null,
    artefakt_link: null,
    quelle_modell: 'portal',
    erstellt_von: 'portal',
    mandant,
    dedup_key: `match_rueckmeldung:${lessonId}`,
  }
}
