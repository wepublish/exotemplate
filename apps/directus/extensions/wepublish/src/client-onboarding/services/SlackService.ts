import { InvalidPayloadError } from '@directus/errors'
import axios, { AxiosInstance } from 'axios'

// Slack channel names: 1–80 chars, lowercase letters, digits, hyphens or
// underscores. See https://api.slack.com/methods/conversations.create.
const SLACK_CHANNEL_NAME_PATTERN = /^[a-z0-9_-]{1,80}$/

export interface SlackChannel {
  id: string
  name: string
}

export interface SlackChannelInfo {
  id: string
  name: string
  topic: string
  purpose: string
  num_members: number | null
  is_archived: boolean
}

export class SlackService {
  private readonly http: AxiosInstance

  constructor(token: string) {
    this.http = axios.create({
      baseURL: 'https://slack.com/api',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    })
  }

  static normalizeChannelName(name: string): string {
    return name.toLowerCase().trim()
  }

  static isValidChannelName(name: string): boolean {
    return SLACK_CHANNEL_NAME_PATTERN.test(name)
  }

  async createPublicChannel(name: string): Promise<SlackChannel> {
    const { data } = await this.http.post('/conversations.create', {
      name,
      is_private: false
    })

    if (!data.ok) {
      const reason =
        data.error === 'name_taken'
          ? `A Slack channel named "${name}" already exists. Choose a different name.`
          : `Slack error creating channel: ${data.error}`
      throw new InvalidPayloadError({ reason })
    }

    return {
      id: data.channel.id as string,
      name: data.channel.name as string
    }
  }

  async setChannelPurpose(channelId: string, purpose: string): Promise<void> {
    await this.http.post('/conversations.setPurpose', {
      channel: channelId,
      purpose
    })
  }

  async lookupUserByEmail(
    email: string
  ): Promise<{ userId: string | null; error?: string }> {
    const { data } = await this.http.get('/users.lookupByEmail', {
      params: { email }
    })
    if (!data.ok) {
      return { userId: null, error: String(data.error ?? 'lookup_failed') }
    }
    return { userId: data.user?.id ?? null }
  }

  // Posts a DM using the user id as the channel. Slack bots with `chat:write`
  // can message a user directly this way — no `conversations.open` (and its
  // `im:write` scope) required. Returns the raw Slack error code on failure
  // so callers can surface actionable messages (e.g. missing_scope).
  async sendDirectMessageByEmail(
    email: string,
    text: string
  ): Promise<{ email: string; sent: boolean; error?: string }> {
    const { userId, error: lookupError } = await this.lookupUserByEmail(email)
    if (!userId) {
      return { email, sent: false, error: lookupError ?? 'user_not_found' }
    }

    const { data } = await this.http.post('/chat.postMessage', {
      channel: userId,
      text
    })
    if (!data.ok) {
      return { email, sent: false, error: String(data.error ?? 'post_failed') }
    }
    return { email, sent: true }
  }

  // Returns the read-only channel info, or null when Slack can't resolve or
  // expose the channel. A `missing_scope` response indicates the bot token
  // lacks `channels:read` (and/or `groups:read` for private channels) — we
  // degrade to null rather than 400 so the UI can still display the
  // persisted channel ID.
  async getChannel(channelId: string): Promise<SlackChannelInfo | null> {
    const { data } = await this.http.get('/conversations.info', {
      params: { channel: channelId }
    })

    if (!data.ok) {
      if (
        data.error === 'channel_not_found' ||
        data.error === 'missing_scope' ||
        data.error === 'not_in_channel'
      ) {
        return null
      }
      throw new InvalidPayloadError({
        reason: `Slack error fetching channel: ${data.error}`
      })
    }

    const ch = data.channel ?? {}
    return {
      id: String(ch.id ?? channelId),
      name: String(ch.name ?? ''),
      topic: String(ch.topic?.value ?? ''),
      purpose: String(ch.purpose?.value ?? ''),
      num_members: typeof ch.num_members === 'number' ? ch.num_members : null,
      is_archived: Boolean(ch.is_archived)
    }
  }
}
