/**
 * Copy-paste-Mail-Entwürfe. Deterministisch (kein LLM) — instant, souverän,
 * editierbar. Die Nutzerin passt vor dem Versand an. Schweizer Orthografie,
 * echte Umlaute, kein scharfes ß, keine Emojis.
 */

export type WillkommensmailDaten = {
  mediumName: string
  absender?: string
}

export function bauWillkommensmail(d: WillkommensmailDaten): { betreff: string; text: string } {
  const name = d.mediumName
  const absender = d.absender || 'Ramona Sprenger\nWe.Publish'
  const betreff = `Willkommen bei Fundraising as a Service – ${name}`
  const text = `Liebe Redaktion von ${name}

schön, dass ${name} bei Fundraising as a Service dabei ist. Kurz, wie wir zusammenarbeiten:

- Wir recherchieren laufend passende Förderstiftungen für ${name} und gleichen sie mit eurem Profil ab.
- Für die stärksten Treffer bereiten wir die Gesuche vor – ihr entscheidet, was eingereicht wird, und unterschreibt.
- Ihr müsst nichts selbst suchen oder formulieren: wir bereiten vor, ihr gebt frei.

Als Nächstes erstellen wir euer Medien-Profil, damit das Matching greift. Danach melden wir uns mit den ersten Förder-Vorschlägen.

Bei Fragen sind wir jederzeit da.

Herzliche Grüsse
${absender}`
  return { betreff, text }
}
