export type MediumRoh = {
  slug: string
  slack_channel: string | null
  kontakt_emails: unknown // Array oder JSON-String (Directus liefert beides vor)
}

export type Luecke = { slug: string; fehlt: string[] }
export type Bereitschaft = { alleBereit: boolean; gmailFehlt: boolean; luecken: Luecke[] }

function hatMails(v: unknown): boolean {
  let arr = v
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v)
    } catch {
      return v.trim().length > 0
    }
  }
  return Array.isArray(arr) && arr.length > 0
}

/**
 * Leitet die Bereitschaft je Medium ab. Ein Medium ist startklar, wenn aktive DNA,
 * Slack-Kanal und Kontakt-Mails da sind. Gmail ist ein globaler Schalter.
 */
export function baueBereitschaft(
  medien: MediumRoh[],
  mitAktiverDna: Set<string>,
  gmailVerbunden: boolean,
): Bereitschaft {
  const luecken: Luecke[] = []
  for (const md of medien) {
    const fehlt: string[] = []
    if (!mitAktiverDna.has(md.slug)) fehlt.push('DNA')
    if (!md.slack_channel || !String(md.slack_channel).trim()) fehlt.push('Slack-Kanal')
    if (!hatMails(md.kontakt_emails)) fehlt.push('Kontakt-Mails')
    if (fehlt.length) luecken.push({ slug: md.slug, fehlt })
  }
  return { alleBereit: luecken.length === 0 && gmailVerbunden, gmailFehlt: !gmailVerbunden, luecken }
}
