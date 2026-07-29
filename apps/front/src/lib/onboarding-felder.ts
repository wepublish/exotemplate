/**
 * onboarding-felder.ts: reine Logik für den Feld-Block im Onboarding-Cockpit
 * (Website, We.Publish-API, Mailchimp-Archiv, Kontakt-Mails, Slack-Kanal).
 *
 * ANLASS (Befund 29.07.2026, Screenshot von Jolanda): Im Cockpit stand oben
 * «Zwölf», der Feld-Block zeigte aber Slack-Kanal `C0B4HDNQ5K5` — den von
 * **vmz** — und leere Website/API-Felder, obwohl zwölf beide gesetzt hat. Ein
 * Klick auf «Speichern» hätte damit vmz' Kanal nach zwölf geschrieben und
 * zwölfs Website samt API-URL gelöscht, weil die Mutation immer ALLE fünf
 * Felder schickte und ein leeres Feld als `null` sendet.
 *
 * Zwei Vorkehrungen, die den Schaden unabhängig von der Ursache verhindern:
 *
 * 1. `baueFelderDiff` schickt nur, was sich gegenüber dem geladenen Medium
 *    wirklich geändert hat. Ein Formular, das niemand angefasst hat, schreibt
 *    nichts — es kann also auch nichts leeren.
 * 2. `pruefeMediumIdentitaet` vergleicht das Medium des Formulars mit dem oben
 *    ausgewählten. Bei Abweichung wird nicht gespeichert, sondern gemeldet.
 *    Das ist die Notbremse für genau den Fall aus dem Screenshot.
 */

export interface FelderEingabe {
  website: string
  wepublishUrl: string
  mailchimpUrl: string
  kontaktEmails: string
  slackChannel: string
}

/** Die Werte des geladenen Mediums, gegen die verglichen wird. */
export interface FelderStand {
  website?: string | null
  wepublish_api_url?: string | null
  mailchimp_archive_url?: string | null
  kontakt_emails?: string[] | null
  slack_channel?: string | null
}

export type FelderDiff = Partial<{
  website: string | null
  wepublish_api_url: string | null
  mailchimp_archive_url: string | null
  kontakt_emails: string[] | null
  slack_channel: string | null
}>

/** Kommagetrennte Eingabe → Liste ohne Leereinträge. */
export function leseEmailListe(roh: string): string[] {
  return roh
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function textOderNull(roh: string): string | null {
  return roh.trim() || null
}

/** true, wenn beide Listen dieselben Adressen in derselben Reihenfolge tragen. */
function gleicheListe(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((wert, i) => wert === b[i])
}

/**
 * Nur die geänderten Felder. Leeres Objekt = nichts zu tun (die Route wird dann
 * gar nicht gerufen). Ein bewusst geleertes Feld erscheint als `null` und wird
 * geschrieben — Leeren bleibt möglich, es passiert nur nicht mehr versehentlich.
 */
export function baueFelderDiff(eingabe: FelderEingabe, stand: FelderStand): FelderDiff {
  const diff: FelderDiff = {}

  const paare: Array<[keyof FelderDiff, string | null, string | null]> = [
    ['website', textOderNull(eingabe.website), stand.website ?? null],
    ['wepublish_api_url', textOderNull(eingabe.wepublishUrl), stand.wepublish_api_url ?? null],
    ['mailchimp_archive_url', textOderNull(eingabe.mailchimpUrl), stand.mailchimp_archive_url ?? null],
    ['slack_channel', textOderNull(eingabe.slackChannel), stand.slack_channel ?? null],
  ]
  for (const [feld, neu, alt] of paare) {
    if (neu !== alt) {
      ;(diff as Record<string, unknown>)[feld] = neu
    }
  }

  const neueMails = leseEmailListe(eingabe.kontaktEmails)
  const alteMails = stand.kontakt_emails ?? []
  if (!gleicheListe(neueMails, alteMails)) {
    diff.kontakt_emails = neueMails.length > 0 ? neueMails : null
  }

  return diff
}

/** Menschenlesbare Liste der Felder, die der Diff anfasst. */
export const FELD_LABEL: Record<string, string> = {
  website: 'Website',
  wepublish_api_url: 'We.Publish-API-URL',
  mailchimp_archive_url: 'Mailchimp-Archiv',
  kontakt_emails: 'Kontakt-Mails',
  slack_channel: 'Slack-Kanal',
}

export function beschreibeDiff(diff: FelderDiff): string {
  return Object.keys(diff)
    .map((k) => FELD_LABEL[k] ?? k)
    .join(', ')
}

export type IdentitaetsPruefung = { ok: true } | { ok: false; fehler: string }

/**
 * Notbremse: das Formular darf nur das Medium schreiben, das oben ausgewählt
 * ist. Ohne ausgewählten Slug (z.B. während des ersten Renders) wird nicht
 * geprüft — dann gibt es auch keine widersprüchliche Anzeige.
 */
export function pruefeMediumIdentitaet(formularSlug: string, ausgewaehlterSlug: string): IdentitaetsPruefung {
  if (!ausgewaehlterSlug || formularSlug === ausgewaehlterSlug) {
    return { ok: true }
  }
  return {
    ok: false,
    fehler:
      `Nicht gespeichert: dieses Formular gehört zu «${formularSlug}», ausgewählt ist aber «${ausgewaehlterSlug}». ` +
      'Seite neu laden und noch einmal versuchen.',
  }
}
