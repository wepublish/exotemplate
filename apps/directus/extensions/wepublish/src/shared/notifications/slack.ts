import axios from 'axios'
import type { ComposedSlackMessage } from './composeMessage'

export interface SlackPostResult {
  ok: boolean
  error?: string
  ts?: string
}

interface SlackJoinResult {
  ok: boolean
  error?: string
  channel?: { id: string }
}

// Public-channel IDs start with `C`. Private channels (`G`) cannot be joined
// via `conversations.join`, and user IDs (`U`/`W`) are DM targets where
// `not_in_channel` is not the failure mode. Guarding by prefix keeps the
// auto-join scoped to the only case it actually helps.
function isPublicChannelId(channel: string): boolean {
  return /^C[A-Z0-9]+$/.test(channel)
}

async function joinSlackChannel(
  token: string,
  channel: string
): Promise<SlackJoinResult> {
  const response = await axios.post<SlackJoinResult>(
    'https://slack.com/api/conversations.join',
    { channel },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    }
  )
  return response.data
}

async function postChatMessage(args: {
  token: string
  channel: string
  message: ComposedSlackMessage
}): Promise<SlackPostResult> {
  const response = await axios.post<SlackPostResult>(
    'https://slack.com/api/chat.postMessage',
    {
      channel: args.channel,
      text: args.message.text,
      blocks: args.message.blocks
    },
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    }
  )
  return response.data
}

/**
 * Post a pre-composed message to a Slack channel using the chat.postMessage
 * API. Throws on network / non-2xx errors; returns the Slack response
 * otherwise so callers can log partial failures per client.
 *
 * Pass a Slack user id as `channel` to send a direct message — the API
 * resolves it to the bot ↔ user IM channel automatically.
 *
 * If Slack rejects with `not_in_channel` and the target is a public channel
 * (id starts with `C`), the bot auto-joins via `conversations.join` and
 * retries once. Requires the `channels:join` OAuth scope on the bot token.
 */
export async function postSlackMessage(args: {
  token: string
  channel: string
  message: ComposedSlackMessage
}): Promise<SlackPostResult> {
  const first = await postChatMessage(args)
  if (first.ok || first.error !== 'not_in_channel') return first
  if (!isPublicChannelId(args.channel)) return first

  const join = await joinSlackChannel(args.token, args.channel)
  if (!join.ok) {
    console.warn(
      `[slack] auto-join failed for channel ${args.channel}: ${
        join.error ?? 'unknown'
      } — original chat.postMessage error: not_in_channel`
    )
    return first
  }

  return postChatMessage(args)
}

interface SlackUserLookupResult {
  ok: boolean
  error?: string
  user?: { id: string }
}

/**
 * Resolve a Slack user id from an email address using the
 * `users.lookupByEmail` API. Returns null if the email isn't a member of the
 * workspace or the lookup fails — the halt hook treats that as "skip the DM",
 * same as a missing Jira assignee.
 */
export async function lookupSlackUserIdByEmail(
  token: string,
  email: string
): Promise<string | null> {
  try {
    const response = await axios.get<SlackUserLookupResult>(
      'https://slack.com/api/users.lookupByEmail',
      {
        params: { email },
        headers: { Authorization: `Bearer ${token}` }
      }
    )
    if (!response.data.ok) {
      console.warn(
        `[slack] users.lookupByEmail failed for ${email}: ${
          response.data.error ?? 'unknown'
        }`
      )
      return null
    }
    return response.data.user?.id ?? null
  } catch (error) {
    console.error(
      `[slack] users.lookupByEmail request errored for ${email}`,
      error
    )
    return null
  }
}
