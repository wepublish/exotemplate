// Pure prompt building and answer validation.
//
// Everything that can be tested without a network call lives in files like this
// one; `index.ts` keeps only the Directus wiring. That split is what makes an
// LLM feature testable — see prompt.test.ts.

export interface SummarySource {
  title: string
  body: string | null
}

export interface NoteSummary {
  summary: string
  tags: string[]
}

export const SUMMARY_SYSTEM_PROMPT = [
  'Du fasst Notizen fuer ein internes Redaktionswerkzeug zusammen.',
  'Antworte ausschliesslich mit JSON in der Form {"summary": string, "tags": string[]}.',
  'Die Zusammenfassung ist ein Satz, hoechstens 240 Zeichen, in der Sprache der Notiz.',
  'Vergib eins bis fuenf Tags, kleingeschrieben, ein Wort pro Tag.',
  'Erfinde nichts, was nicht in der Notiz steht.'
].join('\n')

export class EmptyNoteError extends Error {
  constructor() {
    super('Die Notiz enthaelt keinen Text, der zusammengefasst werden kann.')
    this.name = 'EmptyNoteError'
  }
}

export function buildSummaryPrompt(note: SummarySource): string {
  const body = (note.body ?? '').trim()
  const title = note.title.trim()

  if (body === '' && title === '') throw new EmptyNoteError()

  return [
    `Titel: ${title || '(kein Titel)'}`,
    '',
    'Text:',
    body || '(kein Text)'
  ].join('\n')
}

const MAX_SUMMARY_LENGTH = 240
const MAX_TAGS = 5

/**
 * Validates what came back before it is written to a collection. The model is
 * asked for this shape, which is not the same as being given it.
 */
export function parseSummary(value: unknown): NoteSummary {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Claude-Antwort ist kein Objekt.')
  }

  const candidate = value as { summary?: unknown; tags?: unknown }

  if (
    typeof candidate.summary !== 'string' ||
    candidate.summary.trim() === ''
  ) {
    throw new Error('Claude-Antwort enthaelt kein Feld "summary".')
  }

  const tags = Array.isArray(candidate.tags)
    ? candidate.tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag !== '')
        .slice(0, MAX_TAGS)
    : []

  return {
    summary: candidate.summary.trim().slice(0, MAX_SUMMARY_LENGTH),
    tags
  }
}

/** How the summary is stored in `notes.ai_summary` — one column, human readable. */
export function formatSummaryForStorage(summary: NoteSummary): string {
  return summary.tags.length === 0
    ? summary.summary
    : `${summary.summary}\n\n#${summary.tags.join(' #')}`
}
