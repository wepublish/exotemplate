import type { NoteFields } from '@/graphql/notes'

// Pure presentation helpers. Anything with a rule in it goes here so it can be
// tested without rendering a component — see notes.test.ts.

export interface DisplaySummary {
  text: string
  tags: string[]
}

/**
 * Splits the stored summary back into text and tags. The backend stores both in one
 * column as `text\n\n#tag #tag` (see formatSummaryForStorage in the extension).
 */
export function parseStoredSummary(stored: string | null): DisplaySummary | null {
  if (stored === null || stored.trim() === '') return null

  const [text, tagLine] = stored.split(/\n{2,}/)
  const tags = (tagLine ?? '')
    .split(/\s+/)
    .filter((token) => token.startsWith('#') && token.length > 1)
    .map((token) => token.slice(1))

  return { text: (text ?? '').trim(), tags }
}

/** German date/time for display. Falls back to an em dash rather than "Invalid Date". */
export function formatDateTime(value: string | null): string {
  if (value === null) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** A note is stale when its text was edited after the summary was generated. */
export function isSummaryStale(note: Pick<NoteFields, 'ai_summary' | 'body'>): boolean {
  return (note.body ?? '').trim() !== '' && (note.ai_summary === null || note.ai_summary.trim() === '')
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: 'Entwurf',
    published: 'Veroeffentlicht',
    archived: 'Archiviert'
  }

  return labels[status] ?? status
}
