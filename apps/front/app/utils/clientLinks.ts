import type { Client, ClientLink } from '~~/types/DirectusTypes'
import {
  WEPUBLISH_DOCS_URL,
  composeEditorUrl,
  composeJiraProjectUrl,
  composeWebsiteUrl
} from './externalLinks'
import { composeSlackChannelUrl } from './slack'

/**
 * A resolved quick-access link for the dashboard tile. Built-in links carry
 * i18n keys (`labelKey` / `descriptionKey`); user-defined custom links carry a
 * literal `label` and optional `description`. The component renders
 * `label ?? t(labelKey)` and `description ?? t(descriptionKey)`.
 */
export interface DashboardLink {
  key: string
  icon: string
  url: string
  labelKey?: string
  label?: string
  descriptionKey?: string
  description?: string
}

/** An editable custom-link row in the settings card (no id until persisted). */
export interface ClientLinkDraft {
  id?: number
  label: string
  url: string
  description: string
}

/**
 * Ensure a user-entered custom-link URL is treated as absolute/external. A bare
 * `example.com` would otherwise resolve relative to the dashboard route, so we
 * prepend `https://` when no scheme is present. Returns null for empty input.
 */
function ensureExternalUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim()
  if (!trimmed) return null
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function bySortThenId(a: ClientLink, b: ClientLink): number {
  const sa = a.sort ?? Number.MAX_SAFE_INTEGER
  const sb = b.sort ?? Number.MAX_SAFE_INTEGER
  return sa - sb || a.id - b.id
}

/**
 * Assemble the dashboard quick-links for a client: dedicated Slack channel,
 * network-wide #we-share, editor, Jira, website, the public We.Publish docs
 * (always shown), then the client's custom links (from the `ClientLinks`
 * collection). Built-in links whose target can't be resolved (missing
 * channel/key/apiUrl) are omitted. Each link carries a short description (i18n
 * key for built-ins, the user's text for custom links).
 */
export function buildDashboardLinks(
  client: Client | null | undefined,
  weShareChannelId: string | null | undefined,
  customLinks: ClientLink[] = [],
  // Authoritative production URLs from the infrastructure-configurator. When
  // present they beat the apiUrl-derived values (more reliable — e.g. custom
  // website domains), but an explicit per-client override still wins.
  infraUrls: { editor?: string | null; website?: string | null } | null = null
): DashboardLink[] {
  const links: DashboardLink[] = []
  if (!client) return links

  if (client.slack_channel_id) {
    links.push({
      key: 'slack',
      icon: 'lucide:slack',
      labelKey: 'dashboard.links.slack',
      descriptionKey: 'dashboard.links.descriptions.slack',
      url: composeSlackChannelUrl(client.slack_channel_id)
    })
  }

  if (weShareChannelId) {
    links.push({
      key: 'weShare',
      icon: 'lucide:users',
      labelKey: 'dashboard.links.weShare',
      descriptionKey: 'dashboard.links.descriptions.weShare',
      url: composeSlackChannelUrl(weShareChannelId)
    })
  }

  // Editor + Website belong together, so keep them adjacent, ahead of Jira.
  // Priority: infra config → apiUrl-derived (no manual per-client override).
  // Normalize to an absolute URL so a scheme-less value never renders relative.
  const editor = ensureExternalUrl(
    infraUrls?.editor || composeEditorUrl(client.apiUrl)
  )
  if (editor) {
    links.push({
      key: 'editor',
      icon: 'lucide:pencil-line',
      labelKey: 'dashboard.links.editor',
      descriptionKey: 'dashboard.links.descriptions.editor',
      url: editor
    })
  }

  const website = ensureExternalUrl(
    infraUrls?.website || composeWebsiteUrl(client.apiUrl)
  )
  if (website) {
    links.push({
      key: 'website',
      icon: 'lucide:globe',
      labelKey: 'dashboard.links.website',
      descriptionKey: 'dashboard.links.descriptions.website',
      url: website
    })
  }

  if (client.jira_short_code) {
    links.push({
      key: 'jira',
      icon: 'lucide:square-kanban',
      labelKey: 'dashboard.links.jira',
      descriptionKey: 'dashboard.links.descriptions.jira',
      url: composeJiraProjectUrl(client.jira_short_code)
    })
  }

  // Docs are network-wide and always available.
  links.push({
    key: 'docs',
    icon: 'lucide:book-open',
    labelKey: 'dashboard.links.docs',
    descriptionKey: 'dashboard.links.descriptions.docs',
    url: WEPUBLISH_DOCS_URL
  })

  for (const entry of [...customLinks].sort(bySortThenId)) {
    const url = ensureExternalUrl(entry.url)
    const label = entry.label?.trim()
    if (url && label) {
      links.push({
        key: `custom-${entry.id}`,
        icon: 'lucide:link',
        label,
        description: entry.description?.trim() || undefined,
        url
      })
    }
  }

  return links
}

/**
 * Staging quick-links (editor + website) built from the infra config's staging
 * URLs. Rendered as a separate "Staging" section on the dashboard; each present
 * URL becomes a link, and an empty/absent set yields no section.
 */
export function buildStagingLinks(
  urls: { editor?: string | null; website?: string | null } | null
): DashboardLink[] {
  const links: DashboardLink[] = []
  if (!urls) return links
  if (urls.editor) {
    links.push({
      key: 'editor-staging',
      icon: 'lucide:pencil-line',
      labelKey: 'dashboard.links.editorStaging',
      descriptionKey: 'dashboard.links.descriptions.editorStaging',
      url: urls.editor
    })
  }
  if (urls.website) {
    links.push({
      key: 'website-staging',
      icon: 'lucide:globe',
      labelKey: 'dashboard.links.websiteStaging',
      descriptionKey: 'dashboard.links.descriptions.websiteStaging',
      url: urls.website
    })
  }
  return links
}

export interface ClientLinksDiff {
  toCreate: { label: string; url: string; description: string | null }[]
  toUpdate: {
    id: number
    label: string
    url: string
    description: string | null
  }[]
  toDelete: number[]
}

/**
 * Compute the create/update/delete operations needed to turn the persisted
 * `ClientLinks` rows (`original`) into the edited `drafts`. Drafts with an empty
 * label or url are dropped — and if such a draft had an id, that row is deleted.
 * Only rows whose label/url/description actually changed are flagged for update.
 * Pure, so it can be unit-tested without hitting Directus.
 */
export function diffClientLinks(
  original: ClientLink[],
  drafts: ClientLinkDraft[]
): ClientLinksDiff {
  const clean = drafts
    .map((d) => ({
      id: d.id,
      label: d.label.trim(),
      url: d.url.trim(),
      description: d.description.trim()
    }))
    .filter((d) => d.label && d.url)

  const toCreate = clean
    .filter((d) => d.id == null)
    .map((d) => ({
      label: d.label,
      url: d.url,
      description: d.description || null
    }))

  const keptIds = new Set<number>()
  const toUpdate: ClientLinksDiff['toUpdate'] = []
  for (const d of clean) {
    if (d.id == null) continue
    keptIds.add(d.id)
    const orig = original.find((o) => o.id === d.id)
    if (!orig) continue
    const changed =
      (orig.label ?? '') !== d.label ||
      (orig.url ?? '') !== d.url ||
      (orig.description ?? '') !== d.description
    if (changed) {
      toUpdate.push({
        id: d.id,
        label: d.label,
        url: d.url,
        description: d.description || null
      })
    }
  }

  const toDelete = original.filter((o) => !keptIds.has(o.id)).map((o) => o.id)

  return { toCreate, toUpdate, toDelete }
}
