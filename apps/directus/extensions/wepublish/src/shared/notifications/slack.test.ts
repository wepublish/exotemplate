import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import { postSlackMessage } from './slack'
import type { ComposedSlackMessage } from './composeMessage'

vi.mock('axios')

const POST_URL = 'https://slack.com/api/chat.postMessage'
const JOIN_URL = 'https://slack.com/api/conversations.join'

const message: ComposedSlackMessage = {
  text: 'hello',
  blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'hello' } }]
}

describe('postSlackMessage', () => {
  const mockedPost = vi.mocked(axios.post)

  beforeEach(() => {
    mockedPost.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the Slack response on success without attempting a join', async () => {
    mockedPost.mockResolvedValueOnce({ data: { ok: true, ts: '1.2' } })

    const result = await postSlackMessage({
      token: 't',
      channel: 'C123',
      message
    })

    expect(result).toEqual({ ok: true, ts: '1.2' })
    expect(mockedPost).toHaveBeenCalledTimes(1)
    expect(mockedPost.mock.calls[0]![0]).toBe(POST_URL)
  })

  it('auto-joins a public channel and retries when post returns not_in_channel', async () => {
    mockedPost
      .mockResolvedValueOnce({ data: { ok: false, error: 'not_in_channel' } })
      .mockResolvedValueOnce({ data: { ok: true, channel: { id: 'C123' } } })
      .mockResolvedValueOnce({ data: { ok: true, ts: '1.2' } })

    const result = await postSlackMessage({
      token: 't',
      channel: 'C123',
      message
    })

    expect(result).toEqual({ ok: true, ts: '1.2' })
    expect(mockedPost).toHaveBeenCalledTimes(3)
    expect(mockedPost.mock.calls[0]![0]).toBe(POST_URL)
    expect(mockedPost.mock.calls[1]![0]).toBe(JOIN_URL)
    expect(mockedPost.mock.calls[1]![1]).toEqual({ channel: 'C123' })
    expect(mockedPost.mock.calls[2]![0]).toBe(POST_URL)
  })

  it('returns the original not_in_channel error when conversations.join fails', async () => {
    mockedPost
      .mockResolvedValueOnce({ data: { ok: false, error: 'not_in_channel' } })
      .mockResolvedValueOnce({ data: { ok: false, error: 'missing_scope' } })

    const result = await postSlackMessage({
      token: 't',
      channel: 'C123',
      message
    })

    expect(result).toEqual({ ok: false, error: 'not_in_channel' })
    expect(mockedPost).toHaveBeenCalledTimes(2)
  })

  it('does not attempt to join when the target is a user id (DM)', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { ok: false, error: 'not_in_channel' }
    })

    const result = await postSlackMessage({
      token: 't',
      channel: 'U999',
      message
    })

    expect(result).toEqual({ ok: false, error: 'not_in_channel' })
    expect(mockedPost).toHaveBeenCalledTimes(1)
  })

  it('does not attempt to join private channel ids', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { ok: false, error: 'not_in_channel' }
    })

    const result = await postSlackMessage({
      token: 't',
      channel: 'G123',
      message
    })

    expect(result).toEqual({ ok: false, error: 'not_in_channel' })
    expect(mockedPost).toHaveBeenCalledTimes(1)
  })

  it('passes through other errors unchanged', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { ok: false, error: 'channel_not_found' }
    })

    const result = await postSlackMessage({
      token: 't',
      channel: 'C123',
      message
    })

    expect(result).toEqual({ ok: false, error: 'channel_not_found' })
    expect(mockedPost).toHaveBeenCalledTimes(1)
  })
})
