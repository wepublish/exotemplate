/**
 * Baut den vollständigen Copy-paste-Prompt für Claude Opus 4.8 (Claude-App),
 * mit dem das Gold-Gesuch geschrieben wird. Deterministisch — kein LLM.
 * Tier-2-Default der Spec: Opus schreibt, der Assistent bereitet nur den Prompt.
 */

export type FormularFeld = {
  feld: string
  max?: number | null
  einheit?: 'zeichen' | 'woerter' | null
  hinweis?: string | null
}
export type EinreichungsFormular = {
  art?: string | null
  hinweis?: string | null
  felder?: FormularFeld[]
}

/**
 * Verweis auf das Paradegesuch im Drive (Verweis-Modus). Opus öffnet die Datei
 * selbst und sieht so Schriftart, Logo und Grafiken — was ein eingebetteter
 * Volltext verlöre. Gegenstück zum `paradegesuch`-Volltext (Volltext-Modus).
 */
export type ParadegesuchVerweis = {
  /** Dateiname der Paradegesuch-docx, falls bekannt; sonst null → reiner Ordner-Verweis. */
  datei: string | null
  /** Drive-Pfad ab dem FaaS-Wurzelordner: zur Datei (wenn `datei` gesetzt) bzw. zum 05_paradegesuch-Ordner. */
  drivePfad: string
}

export type GesuchPromptDaten = {
  mediumName: string
  mediumSlug: string
  mediumSound: string | null
  mediumTags: string[]
  stiftungName: string
  stiftungSitz: string | null
  stiftungLand: string | null
  stiftungZweck: string | null
  stiftungFoerderpraxis: string | null
  stiftungSound: string | null
  matchBegruendung: string | null
  betragChf: number | null
  lernhinweise: string[]
  formular: EinreichungsFormular | null
  /**
   * Volltext des Paradegesuchs (Volltext-Modus) — wird in den Prompt eingebettet.
   * Für reine Text-Konsumenten ohne Drive-Zugriff (nächtlicher Gesuch-Loop).
   */
  paradegesuch: string | null
  /**
   * Verweis auf das Paradegesuch im Drive (Verweis-Modus) — hat Vorrang vor
   * `paradegesuch`. Für Copy-paste nach Cowork/Claude-App: Opus öffnet die Datei
   * selbst und übernimmt Layout, Schriftart, Logo und Grafiken.
   */
  paradegesuchRef: ParadegesuchVerweis | null
}

/** Baut den Formular-Block für den Prompt (leer, wenn keine Felder erfasst). */
export function formularBlock(f: EinreichungsFormular | null): string {
  if (!f || !Array.isArray(f.felder) || f.felder.length === 0) return ''
  const zeilen = f.felder
    .filter((x) => x && (x.feld ?? '').trim())
    .map((x) => {
      const limit =
        x.max && x.einheit
          ? ` — maximal ${x.max} ${x.einheit === 'woerter' ? 'Wörter' : 'Zeichen'}`
          : x.max
            ? ` — maximal ${x.max} Zeichen`
            : ''
      const hint = (x.hinweis ?? '').trim() ? ` (${(x.hinweis ?? '').trim()})` : ''
      return `- «${x.feld.trim()}»${limit}${hint}`
    })
  if (zeilen.length === 0) return ''
  const art = (f.art ?? '').trim()
  const hinweis = (f.hinweis ?? '').trim()
  return `

EINREICHUNG ${art ? `(${art})` : ''}— FELDWEISE LIEFERN:
Die Stiftung nimmt das Gesuch über ein vorgegebenes Formular entgegen. Liefere den Text NICHT als Fliesstext, sondern portioniert: pro Feld einen eigenen, in sich geschlossenen Abschnitt, der die jeweilige Längenvorgabe strikt einhält. Beschrifte jeden Abschnitt mit dem Feldnamen.${hinweis ? `\nHinweis zur Einreichung: ${hinweis}` : ''}
Felder:
${zeilen.join('\n')}`
}

/**
 * Maschinen-Ablagepfad (slug-basiert, ASCII-snake_case-Stiftungsteil). Diese
 * Form ist der Vertrag mit dem Adapter `drive_ordner` (Regex [a-z0-9_-]+, mappt
 * den Slug selbst auf den echten Drive-Ordner) — daher NICHT auf echte
 * Ordnernamen umstellen, sonst bricht der Verknüpf-Knopf. Für die menschliche
 * Anzeige siehe ablageAnzeige().
 */
export function ablagePfad(mediumSlug: string, stiftungName: string): string {
  const safe = stiftungName
    .toLowerCase()
    .replace(/[äàâ]/g, 'a')
    .replace(/[öô]/g, 'o')
    .replace(/[üû]/g, 'u')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return `${mediumSlug}/02_antraege_work_in_progress/${safe || 'stiftung'}/`
}

/**
 * Slug (App) → echter Drive-Ordnername (FaaS-Drive). Muss mit MEDIUM_DRIVE_ORDNER
 * im Adapter (spark/faas_chat_adapter.py) übereinstimmen — wepublish und neue_wege
 * weichen ab.
 */
export const DRIVE_ORDNER: Record<string, string> = {
  bajour: 'bajour',
  cueltuer: 'cueltuer',
  'ee-news': 'ee-news',
  ganzgraz: 'ganzgraz',
  neue_wege: 'neue-wege',
  vmz: 'vmz',
  wepublish: 'Fundraising wepublish',
}

/**
 * Macht aus einem slug-basierten Ablagepfad den ANZEIGE-Pfad mit dem echten
 * Drive-Ordnernamen (nur Darstellung). Der Maschinen-Pfad bleibt slug-basiert,
 * der Adapter mappt ihn selbst. z.B. «wepublish/…» → «Fundraising wepublish/…».
 */
export function ablageAnzeige(slugPfad: string): string {
  const teile = (slugPfad ?? '').split('/')
  if (!teile.length) return slugPfad
  teile[0] = DRIVE_ORDNER[teile[0]] ?? teile[0]
  return teile.join('/')
}

export function bauGesuchPrompt(d: GesuchPromptDaten): string {
  const tags = d.mediumTags.length ? d.mediumTags.join(', ') : '(keine Angabe)'
  const betrag = d.betragChf
    ? `\n- Angestrebte Grössenordnung: rund CHF ${d.betragChf.toLocaleString('de-CH')} (im Text nicht zwingend beziffern).`
    : ''
  const lernblock = d.lernhinweise.length
    ? `\nGELERNTE HINWEISE (aus früheren Entscheiden zu diesem Medium, beachten):\n${d.lernhinweise
        .map((h) => `- ${h}`)
        .join('\n')}\n`
    : ''
  const formularHinweis =
    d.formular && Array.isArray(d.formular.felder) && d.formular.felder.length
      ? 'Die unten gelisteten Formularfelder sind bereits erfasst und gelten als gesicherte Wahrheit; bestätige sie kurz und liefere danach feldweise.'
      : 'Es sind KEINE Formularfelder hinterlegt, ermittle den Einreichungsweg in dieser Recherche selbst (gibt es ein Formular? welche Felder, Limits, Frist, Sprache? sonst E-Mail oder Post?).'
  const betragGuard = d.betragChf
    ? 'Den Förderbetrag NICHT aus deiner Recherche oder aus dem Paradegesuch ableiten; die angestrebte Grössenordnung steht oben.'
    : 'Den Förderbetrag NICHT aus deiner Recherche oder aus dem Paradegesuch ableiten; nenne keinen konkreten Betrag.'
  const ref = d.paradegesuchRef
  const parade = (d.paradegesuch ?? '').trim()
  // Drei Modi: Verweis (Drive-Datei, Vorrang), Volltext (eingebettet), oder kein Paradegesuch.
  let paradeBlock = ''
  let phase1Parade = ''
  let stilZeile =
    '- Schreibe das Gesuch im Layout und Stil des Mediums (es ist kein Paradegesuch hinterlegt, orientiere dich am Medium-Profil oben).'
  if (ref) {
    const ortZeilen = ref.datei
      ? `Datei: «${ref.datei}»\nIm Google Drive zu finden unter: Fundraising/FaaS/${ref.drivePfad}`
      : `Im Google Drive zu finden im Ordner: Fundraising/FaaS/${ref.drivePfad}/ (öffne dort die .docx mit «parade» im Namen)`
    paradeBlock = `
PARADEGESUCH DIESES MEDIUMS (verbindliche Vorlage — als Datei im Google Drive, hier bewusst NICHT eingefügt):
${ortZeilen}
Öffne diese Datei ZUERST über deinen Google-Drive-Zugriff und sieh sie dir vollständig an (Inhalt UND Gestaltung). Sie ist die verbindliche Vorlage für das fertige Gesuch:
- Layout, Schriftart, Logo, Grafiken und das gesamte visuelle Erscheinungsbild übernimmst du eins zu eins.
- Aufbau, Ton, Gliederung und ungefähre Länge ebenso.
- Die belegten Fakten des Mediums (Budget, Reichweite, Eigenleistung, frühere Förderungen, Trägerschaft) entnimmst du ihr und verwendest sie, soweit sie zu dieser Stiftung passen.
Die Vorlage ist KEIN Mustertext zum Abschreiben: schreibe den Text neu und auf diese Stiftung zugeschnitten. Den Förderbetrag NICHT daraus übernehmen.
`
    phase1Parade =
      '- Öffne ZUERST das oben verwiesene Paradegesuch dieses Mediums aus dem Drive und präge dir Layout, Schriftart, Logo, Grafiken und die belegten Medien-Fakten ein; ohne diese Vorlage kannst du das Gesuch nicht gestalten.\n'
    stilZeile =
      '- Schreibe das Gesuch in Layout, Schriftart und Gestaltung des in Phase 1 geöffneten Paradegesuchs, als eigenständigen, auf diese Stiftung zugeschnittenen Text.'
  } else if (parade) {
    paradeBlock = `
PARADEGESUCH DIESES MEDIUMS (verbindliche Stil-, Layout- und Faktenreferenz, KEIN Mustertext zum Abschreiben):
Übernimm Aufbau, Ton, Gliederung und ungefähre Länge. Entnimm ihm die belegten Fakten des Mediums (Budget, Reichweite, Eigenleistung, frühere Förderungen, Trägerschaft) und verwende sie, soweit sie zu dieser Stiftung passen. Den Förderbetrag NICHT daraus übernehmen.
--- PARADEGESUCH ANFANG ---
${parade}
--- PARADEGESUCH ENDE ---
`
    stilZeile =
      '- Schreibe das Gesuch in Aufbau, Ton und Layout des oben eingefügten Paradegesuchs, aber als eigenständigen, auf diese Stiftung zugeschnittenen Text.'
  }
  return `Du bist eine erstklassige Fundraising-Texterin für unabhängigen Journalismus in der Schweiz. Schreibe ein überzeugendes Förder-Gesuch für das Medium «${d.mediumName}» an die Stiftung «${d.stiftungName}».

DAS MEDIUM (Antragsteller):
- Stimme und Sound: ${d.mediumSound ?? '(keine Angabe)'}
- Themen und Schwerpunkte: ${tags}

DIE FÖRDERSTIFTUNG:
- Name: ${d.stiftungName}${d.stiftungSitz ? `, Sitz ${d.stiftungSitz}` : ''}${d.stiftungLand ? `, ${d.stiftungLand}` : ''}
- Zweck: ${d.stiftungZweck ?? '(keine Angabe)'}
- Förderpraxis: ${d.stiftungFoerderpraxis ?? '(keine Angabe)'}
- Tonalität der Stiftung: ${d.stiftungSound ?? '(keine Angabe)'}

GEMEINSAMER NENNER, das Herzstück des Gesuchs (er trägt die ersten Absätze):
${d.matchBegruendung ?? '(keine Matching-Begründung vorhanden, leite die Gemeinsamkeiten aus den Profilen oben ab)'}
Dieser inhaltliche Überschnitt ist der Auslöser: Der Einstieg muss bei der Stiftung sofort das Gefühl erzeugen «das ist genau unser Thema, genau das fördern wir». Trage diese präzise Überschneidung, nicht Allgemeinplätze. Subtil im Handwerk (keine Aufzählung), aber unmissverständlich in der Wirkung.
${lernblock}${paradeBlock}
VORGEHEN, zwingend in zwei Phasen:

PHASE 1, Stiftung intensiv recherchieren (ZUERST, bevor du auch nur einen Satz des Gesuchs schreibst):
${phase1Parade}- Recherchiere die Stiftung aktiv im Web: aktuelle Förderausrichtung, jüngst vergebene Förderungen, Schwerpunkte, wer entscheidet (Stiftungsrat oder Kuratorium), Tonalität.
- Prüfe ZUERST, OB die Stiftung ein Einreiche-Formular hat (Online-Portal oder Formular). ${formularHinweis}
- Halte das Rechercheergebnis, besonders den Einreichungsweg, in zwei, drei Sätzen fest, BEVOR du das Gesuch schreibst.

PHASE 2, Gesuch schreiben (erst nach Phase 1):
${stilZeile}
- Die ersten drei bis fünf Sätze müssen den Stiftungsrat packen, indem sie den gemeinsamen Nenner sofort sichtbar machen.
- Spiegle die Sprache der Stiftung, wahre zugleich die Stimme des Mediums.
- Arbeite die Gemeinsamkeiten subtil ein, nicht plump aufzählend.
- Richte das Gesuch nach dem in Phase 1 ermittelten Einreichungsweg: gibt es ein Formular, liefere feldweise gemäss dessen Vorgaben statt Fliesstext.
- Keine Platzhalter. Schweizer Orthografie (kein scharfes ß, immer ss), echte Umlaute.
- Die DNA- und Matching-Dokumente sind intern und gehen NIE als Beilage an die Stiftung.
- ${betragGuard}${betrag}${formularBlock(d.formular)}

ABLAGE der fertigen Dokumente (Google Drive):
${ablageAnzeige(ablagePfad(d.mediumSlug, d.stiftungName))}`
}
