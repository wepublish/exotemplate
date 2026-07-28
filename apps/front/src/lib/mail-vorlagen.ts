/**
 * Copy-paste-Mail-Entwürfe. Deterministisch (kein LLM) — instant, souverän,
 * editierbar. Die Nutzerin passt vor dem Versand an. Schweizer Orthografie,
 * echte Umlaute, kein scharfes ß, keine Emojis.
 *
 * Kein fixer Absender-Name (Korrektur Jolanda 28.07.2026): ohne übergebenen
 * `absender` bleibt der Platzhalter {absender} wörtlich stehen und fällt beim
 * Korrekturlesen auf, dasselbe Muster wie die Vorlagen in portal-texte.ts.
 * Der Ablauf im Text spiegelt den Portal-Onboarding-Weg (MAIL_EINLADUNG),
 * nur ohne Login-Link: diese Mail geht raus, BEVOR beziehungsweise separat
 * vom Magic-Link.
 */

export type WillkommensmailDaten = {
  mediumName: string
  absender?: string
}

export function bauWillkommensmail(d: WillkommensmailDaten): { betreff: string; text: string } {
  const name = d.mediumName
  const absender = d.absender || '{absender}'
  const betreff = `Willkommen bei Fundraising as a Service – ${name}`
  const text = `Liebe Redaktion von ${name}

schön, dass ${name} beim Fundraising as a Service von We.Publish dabei ist. So läuft es:

1. Ihr bekommt einen persönlichen Zugang zu unserem Portal. Der Anmeldelink kommt separat. Er bleibt gültig: speichert ihn am besten als Lesezeichen, und meldet euch kurz, falls er verloren geht.
2. Im Portal ladet ihr euer Logo und eure Unterlagen hoch: Artikel, Newsletter, frühere Gesuche, Budgets, Selbstbeschriebe. Je mehr wir von euch sehen, desto genauer wird euer Profil. Unvollständig ist völlig ok.
3. Aus euren Unterlagen entsteht eure Fundraising-DNA, euer Profil in unseren Worten. Ihr lest sie in Ruhe durch und gebt sie frei, wenn sie euch trifft.
4. Wir schauen nochmals darüber und schalten das Matching für euch frei. Ihr seht dann die Stiftungen, die am besten zu euch passen.
5. Ihr sagt uns mit einem Klick, für welche Stiftungen wir Gesuche vorbereiten sollen. Wir schreiben die Entwürfe, ihr prüft und ergänzt sie im Portal, entscheidet, was eingereicht wird, und unterschreibt.
6. Den aktuellen Stand seht ihr jederzeit im Portal und in eurem Slack-Kanal.

Bei Fragen antworte einfach auf diese Mail.

Herzliche Grüsse
${absender}, Fundraising-Team We.Publish`
  return { betreff, text }
}
