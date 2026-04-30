import axios from 'axios'
import type { ComposedSlackMessage } from './composeMessage'

export interface SlackPostResult {
  ok: boolean
  error?: string
  ts?: string
}

/**
 * Post a pre-composed message to a Slack channel using the chat.postMessage
 * API. Throws on network / non-2xx errors; returns the Slack response
 * otherwise so callers can log partial failures per client.
 *
 * Pass a Slack user id as `channel` to send a direct message — the API
 * resolves it to the bot ↔ user IM channel automatically.
 */
export async function postSlackMessage(args: {
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
