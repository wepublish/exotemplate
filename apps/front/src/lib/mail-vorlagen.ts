/**
 * Copy-paste-Mail-Entwürfe. Deterministisch (kein LLM) — instant, souverän,
 * editierbar. Die Nutzerin passt vor dem Versand an. Schweizer Orthografie,
 * echte Umlaute, kein scharfes ß, keine Emojis.
 *
 * Absender ist mit «Ramona» vorbelegt (Entscheid Jolanda 28.07.2026) und pro
 * Mail überschreibbar. Vorher blieb ohne Übergabe der Platzhalter {absender}
 * wörtlich stehen — und ist am 28.07. genau so an ein Medium rausgegangen
 * (Befund Michael Scheurer). Ein roher Platzhalter kann hier deshalb nicht mehr
 * entstehen: die Anrede fällt notfalls auf «Liebe Redaktion von <Medium>»
 * zurück, der Absender auf die Vorbelegung.
 *
 * Diese Mail trägt keinen Login-Link, sie beschreibt den Weg über die
 * Login-Seite (siehe Sicherheitshinweis in portal-texte.ts).
 */

import { LOGIN_TTL_STUNDEN_STANDARD } from './portal-texte'

/** Vorbelegter Absender-Vorname für alle Mail-Entwürfe. */
export const ABSENDER_STANDARD = 'Ramona'

export type WillkommensmailDaten = {
  mediumName: string
  /** Vorname der Bedienerin; leer heisst Vorbelegung. */
  absender?: string
  /** Ansprechperson beim Medium; leer heisst «Liebe Redaktion von <Medium>». */
  name?: string
  /** URL der Login-Seite, z. B. https://fundraising.wepublish.cloud/portal/login */
  loginSeite?: string
  /** Slack-Kanal des Mediums (Link oder #name); leer lässt den Hinweis weg. */
  slack?: string
  /** Gültigkeit des Anmeldelinks in Stunden. */
  stunden?: number
}

/** Anrede: Name wenn bekannt, sonst der Rückfall auf die Redaktion. */
export function baueAnrede(mediumName: string, name?: string): string {
  const n = (name ?? '').trim()
  return n ? `Hallo ${n}` : `Liebe Redaktion von ${mediumName}`
}

export function bauWillkommensmail(d: WillkommensmailDaten): { betreff: string; text: string } {
  const name = d.mediumName
  const absender = (d.absender ?? '').trim() || ABSENDER_STANDARD
  const stunden = d.stunden && d.stunden > 0 ? d.stunden : LOGIN_TTL_STUNDEN_STANDARD
  const loginSeite = (d.loginSeite ?? '').trim()
  const slack = (d.slack ?? '').trim()

  const zugangsBlock = loginSeite
    ? `So kommt ihr hinein:

${loginSeite}

Dort gebt ihr eure E-Mail-Adresse ein, und wir schicken euch einen Anmeldelink. Kein Passwort nötig, ein Klick genügt. Der Anmeldelink gilt ${stunden} Stunden; danach fordert ihr auf derselben Seite einfach einen neuen an.`
    : `Ihr bekommt einen persönlichen Zugang zu unserem Portal. Ihr meldet euch dort mit eurer E-Mail-Adresse an und erhaltet einen Anmeldelink, der ${stunden} Stunden gilt. Kein Passwort nötig.`

  const rueckfrage = slack
    ? `Fragen, Stolpersteine, Rückmeldungen: am besten in eurem Slack-Kanal, dort sind wir alle erreichbar und niemand muss auf eine einzelne Person warten.

${slack}`
    : 'Fragen, Stolpersteine, Rückmeldungen: am besten in eurem Slack-Kanal, dort sind wir alle erreichbar.'

  const betreff = `Willkommen bei Fundraising as a Service – ${name}`
  const text = `${baueAnrede(name, d.name)}

schön, dass ${name} beim Fundraising as a Service von We.Publish dabei ist. So läuft es:

${zugangsBlock}

1. Im Portal ladet ihr euer Logo und eure Unterlagen hoch: Artikel, Newsletter, frühere Gesuche, Budgets, Selbstbeschriebe. Je mehr wir von euch sehen, desto genauer wird euer Profil. Unvollständig ist völlig ok.
2. Aus euren Unterlagen entsteht eure Fundraising-DNA, euer Profil in unseren Worten. Ihr lest sie in Ruhe durch und gebt sie frei, wenn sie euch trifft.
3. Wir schauen nochmals darüber und schalten das Matching für euch frei. Ihr seht dann die Stiftungen, die am besten zu euch passen.
4. Ihr sagt uns mit einem Klick, für welche Stiftungen wir Gesuche vorbereiten sollen. Wir schreiben die Entwürfe, ihr prüft und ergänzt sie im Portal, entscheidet, was eingereicht wird, und unterschreibt.
5. Den aktuellen Stand seht ihr jederzeit im Portal und in eurem Slack-Kanal.

${rueckfrage}

Herzliche Grüsse
${absender}, Fundraising-Team We.Publish`
  return { betreff, text }
}
