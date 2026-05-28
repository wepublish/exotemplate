import type {
  ComposedSlackMessage,
  SlackMessageBlock
} from '../notifications/composeMessage'

/**
 * One missing-capture user as the daily reminder needs them — Slack ID
 * resolved upstream so this composer stays pure (no Slack API calls).
 * `slackUserId` is optional; when missing we fall back to the plain name.
 */
export interface MissingUser {
  name: string
  email: string
  slackUserId: string | null
}

export interface ComposeReminderMessageInput {
  missingUsers: MissingUser[]
  /** The day the reminder is about (yesterday, or last Friday on Mondays). */
  referenceDate: Date | string
}

const DATE_FORMATTER = new Intl.DateTimeFormat('de-CH', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
})

const OPENERS: string[] = [
  ':wave: Guten Morgen! Klein-erinnerung aus der Zeiterfassungs-Höhle',
  ':sun_with_face: Moin! Kurze Erinnerung von eurem freundlichen Buchhaltungs-Bot',
  ':coffee: Kaffee da? Gut. Jetzt nur noch die Stunden von gestern',
  ':sparkles: Hallo zusammen! Hier ist der allmorgendliche Stups',
  ':rocket: Aufgewacht, Team! Stunden-Tracking ruft',
  ':robot_face: Guten Morgen! Euer Lieblings-Reminder-Bot meldet sich kurz',
  ':seedling: Frischer Tag, frische Stunden — kleiner Reminder am Rande'
]

const ENDINGS: string[] = [
  'Kein Drama — einfach kurz nachtragen und das Wochenende ist gerettet :tada:',
  'Zwei Minuten in Clockodo und ihr seid wieder vorne dabei :muscle:',
  'Schnell nachtragen und weiter geht der Tag :sunglasses:',
  'Lieber jetzt eintragen, als am Monatsende rätseln :wink:',
  'Eine kleine Lücke ist schnell geschlossen — danke schon mal!',
  'Jeder vergisst mal einen Tag. Heute ist der perfekte Tag für ein Nachholmanöver :sparkles:'
]

const REFERENCE_FOR_ROTATION = new Date(Date.UTC(2024, 0, 1)).getTime()
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Picks an opener / ending deterministically by date so the message rotates
 * day-to-day but tests can reproduce the choice. Mod by array length is fine
 * since both arrays are small.
 */
function pickByDate<T>(items: T[], reference: Date): T {
  const daysSinceEpoch = Math.floor(
    (Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate()
    ) -
      REFERENCE_FOR_ROTATION) /
      DAY_MS
  )
  const idx = ((daysSinceEpoch % items.length) + items.length) % items.length
  return items[idx]!
}

function toDate(value: Date | string): Date {
  if (value instanceof Date) return value
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) {
    return new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    )
  }
  return new Date(value)
}

function formatMention(user: MissingUser): string {
  if (user.slackUserId) return `<@${user.slackUserId}>`
  return user.name
}

/**
 * Compose the daily reminder message. The caller is expected to skip posting
 * entirely when `missingUsers` is empty, so this composer doesn't produce a
 * "all clear" variant — keeping the message bank focused on the case we
 * actually send.
 */
export function composeDailyReminderMessage(
  input: ComposeReminderMessageInput
): ComposedSlackMessage {
  const { missingUsers, referenceDate } = input
  if (missingUsers.length === 0) {
    throw new Error(
      'composeDailyReminderMessage called with no users — caller should skip posting instead'
    )
  }

  const refDate = toDate(referenceDate)
  const opener = pickByDate(OPENERS, refDate)
  const ending = pickByDate(ENDINGS, refDate)
  const dateLabel = DATE_FORMATTER.format(refDate)

  const mentions = missingUsers.map(formatMention)
  const headline = `${opener}: für *${dateLabel}* fehlen noch Stunden von ${joinNames(
    mentions
  )}.`

  const blocks: SlackMessageBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Stunden-Erinnerung',
        emoji: false
      }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: headline }
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: ending }]
    }
  ]

  const fallbackNames = missingUsers.map((u) => u.name).join(', ')
  const fallbackText = `Stunden-Erinnerung für ${dateLabel}: ${fallbackNames}. ${ending}`

  return { text: fallbackText, blocks }
}

/**
 * Joins names with Oxford-comma style "A, B und C" — feels natural in German
 * Slack copy and avoids the awkward dangling "and" on two-name lists.
 */
function joinNames(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  if (names.length === 2) return `${names[0]} und ${names[1]}`
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`
}
