/**
 * portal-dna-bearbeiten.ts: das Medium passt seine DNA selbst an — Text und
 * Tags (Wunsch Ramona 29.07.2026: «ich möchte die DNA manuell anpassen (Text
 * und Tags)»).
 *
 * WARUM EINE NEUE VERSION statt eines Patch auf die aktive Zeile: Die
 * Match-Engine schlüsselt ihren LLM-Score-Cache über
 * `(medium_dna_version_id, stiftung_id)` (cache_lookup in
 * pipeline/spark/match_engine.py). Würde die aktive Zeile in-place geändert,
 * bliebe die version_id gleich — und jeder Treffer behielte den Score, der zur
 * ALTEN Selbstbeschreibung gehört. Genau dieses Einfrieren hat am 27.07.2026
 * Tage gekostet. Eine neue Version macht den Cache automatisch kalt und
 * lässt die bestehende Versions-Hygiene (cleanup_stale_match_results) die
 * alten Treffer-Zeilen aufräumen.
 *
 * Der Score (`schaerfe_prozent`) wird bewusst ÜBERNOMMEN, nicht neu berechnet:
 * er ist das Ergebnis einer Messung, keine Eigenschaft des Texts. Eine
 * ehrliche Neuberechnung braucht einen Mess-Lauf — dafür gibt es den Knopf
 * «DNA neu erstellen» mit Rückmeldung.
 */

export const SOUND_FEELING_MAX = 2000
export const TAGS_MAX = 40

/** Gewichte wie im Mess-Kern (DnaTag): 1 = Rand, 2 = wichtig, 3 = Kern. */
export const TAG_GEWICHTE = [1, 2, 3] as const
export type TagGewicht = typeof TAG_GEWICHTE[number]

export const GEWICHT_LABEL: Record<TagGewicht, string> = {
  1: 'am Rand',
  2: 'wichtig',
  3: 'Kernthema',
}

export interface DnaTagEingabe {
  tag_slug: string
  gewicht: TagGewicht
  begruendung: string
}

export type BearbeitenEingabe = {
  soundFeeling: string
  tags: DnaTagEingabe[]
}

export type BearbeitenParse =
  | { ok: true; eingabe: BearbeitenEingabe }
  | { ok: false; fehler: string }

function leseGewicht(roh: unknown): TagGewicht | null {
  const n = typeof roh === 'number' ? roh : typeof roh === 'string' ? parseInt(roh, 10) : NaN
  return n === 1 || n === 2 || n === 3 ? n : null
}

/**
 * Prüft den POST-Body. `istBekannterSlug` kommt vom Aufrufer (Route), damit
 * diese Datei ohne das Vokabular-JSON testbar bleibt: unbekannte Slugs werden
 * abgewiesen, sonst könnte ein Medium beliebige Tags erfinden, die die
 * Match-Engine nie mit einer Stiftung überschneiden würde.
 */
export function parseDnaBearbeitung(body: unknown, istBekannterSlug: (slug: string) => boolean): BearbeitenParse {
  const b = (body ?? {}) as Record<string, unknown>

  const soundFeeling = typeof b.sound_feeling === 'string' ? b.sound_feeling.trim() : ''
  if (soundFeeling.length < 20) {
    return { ok: false, fehler: 'Der Beschreibungstext braucht mindestens 20 Zeichen.' }
  }

  const rohTags = Array.isArray(b.tags) ? b.tags : null
  if (!rohTags) {
    return { ok: false, fehler: 'tags (Liste) erforderlich.' }
  }
  if (rohTags.length === 0) {
    return { ok: false, fehler: 'Mindestens ein Thema muss bleiben — ohne Themen findet das Matching nichts.' }
  }
  if (rohTags.length > TAGS_MAX) {
    return { ok: false, fehler: `Höchstens ${TAGS_MAX} Themen.` }
  }

  const tags: DnaTagEingabe[] = []
  const gesehen = new Set<string>()
  for (const roh of rohTags) {
    const t = (roh ?? {}) as Record<string, unknown>
    const slug = typeof t.tag_slug === 'string' ? t.tag_slug.trim() : ''
    if (!slug) return { ok: false, fehler: 'Jedes Thema braucht einen tag_slug.' }
    if (!istBekannterSlug(slug)) {
      return { ok: false, fehler: `Unbekanntes Thema: ${slug}` }
    }
    if (gesehen.has(slug)) continue // stille Dedup: dasselbe Thema zweimal ist kein Fehler
    gesehen.add(slug)

    const gewicht = leseGewicht(t.gewicht)
    if (gewicht === null) return { ok: false, fehler: `Gewicht für ${slug} muss 1, 2 oder 3 sein.` }

    tags.push({
      tag_slug: slug,
      gewicht,
      begruendung: typeof t.begruendung === 'string' ? t.begruendung.trim().slice(0, 500) : '',
    })
  }

  return { ok: true, eingabe: { soundFeeling: soundFeeling.slice(0, SOUND_FEELING_MAX), tags } }
}

/** Die Felder der aktiven Zeile, die eine neue Version unverändert übernimmt. */
export interface DnaVorlage {
  medium_id: string
  medium_name: string | null
  version: number
  version_id: string
  schaerfe_prozent: number | null
  sektionen: unknown
  exclusion_tags: unknown
  quellen: unknown
  foerderpraxis: unknown
  vocabulary_version_at_creation: number | null
  antragsteller_typ: string | null
}

/**
 * Baut den Datensatz der neuen, sofort aktiven DNA-Version.
 *
 * `version_id`-Muster wie die App-Messung (`v<N>-app-<ISO>`), hier mit der
 * Herkunft `portal`: an der id ist damit ablesbar, dass diese Fassung vom
 * Medium selbst kommt. `embedding` wird bewusst NICHT übernommen — es gehört
 * zum alten Text; der Embedding-Pass auf dem Spark (Cron alle zwei Minuten,
 * nur `--only-missing`) berechnet es für die neue Version selbst nach, bis
 * dahin fehlt der Embedding-Anteil im Score (Math- und LLM-Teil tragen).
 */
export function baueNeueDnaVersion(vorlage: DnaVorlage, eingabe: BearbeitenEingabe, jetzt: Date): Record<string, unknown> {
  const neueVersion = (vorlage.version ?? 1) + 1
  const stempel = jetzt.toISOString().replace(/[:.]/g, '-')
  return {
    medium_id: vorlage.medium_id,
    medium_name: vorlage.medium_name,
    version: neueVersion,
    version_id: `v${neueVersion}-portal-${stempel}`,
    vorgaenger_version_id: vorlage.version_id,
    is_active: true,
    sound_feeling: eingabe.soundFeeling,
    tags: eingabe.tags,
    schaerfe_prozent: vorlage.schaerfe_prozent,
    sektionen: vorlage.sektionen ?? null,
    exclusion_tags: vorlage.exclusion_tags ?? null,
    quellen: vorlage.quellen ?? null,
    foerderpraxis: vorlage.foerderpraxis ?? null,
    vocabulary_version_at_creation: vorlage.vocabulary_version_at_creation,
    antragsteller_typ: vorlage.antragsteller_typ,
    veredelt_by: 'portal-medium',
    veredelt_at: jetzt.toISOString(),
  }
}
