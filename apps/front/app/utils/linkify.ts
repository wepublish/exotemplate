// Parses free-text strings out of Clockodo (entry descriptions, group names)
// into renderable segments so the dashboard can turn URLs and Jira issue keys
// into clickable links without using `v-html`.

import { composeJiraIssueUrl } from './externalLinks'

export type LinkifiedSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string }

const URL_REGEX = /https?:\/\/[^\s<>"'()]+/g
const JIRA_ISSUE_REGEX = /\b[A-Z][A-Z0-9]+-\d+\b/g

// Trailing punctuation that's almost always sentence punctuation, not part of
// the URL — strip it so "see https://x.y/foo." doesn't link to "foo.".
const TRAILING_PUNCT = /[.,;:!?]+$/

interface RawMatch {
  start: number
  end: number
  value: string
  href: string
}

function collect(
  text: string,
  regex: RegExp,
  toHref: (value: string) => string,
  trim: boolean
): RawMatch[] {
  const out: RawMatch[] = []
  regex.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    let value = m[0]
    let end = m.index + value.length
    if (trim) {
      const trimmed = value.replace(TRAILING_PUNCT, '')
      end -= value.length - trimmed.length
      value = trimmed
    }
    if (!value) continue
    out.push({ start: m.index, end, value, href: toHref(value) })
  }
  return out
}

export function linkifyText(
  text: string | null | undefined
): LinkifiedSegment[] {
  if (!text) return []

  // URLs are matched first so a Jira-shaped key that appears *inside* a URL
  // (e.g. /browse/BA-273) is absorbed by the URL and not split out.
  const urlMatches = collect(text, URL_REGEX, (v) => v, true)
  const jiraMatches = collect(
    text,
    JIRA_ISSUE_REGEX,
    composeJiraIssueUrl,
    false
  )

  const matches = [...urlMatches, ...jiraMatches].sort(
    (a, b) => a.start - b.start
  )

  const segments: LinkifiedSegment[] = []
  let cursor = 0
  let lastEnd = -1

  for (const match of matches) {
    if (match.start < lastEnd) continue
    if (match.start > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, match.start) })
    }
    segments.push({ type: 'link', value: match.value, href: match.href })
    cursor = match.end
    lastEnd = match.end
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) })
  }

  return segments
}
