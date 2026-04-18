import { InvalidPayloadError } from '@directus/errors'
import { asyncHandler, requireAdmin, requireEnv } from '../guards'
import { SlackService } from '../services/SlackService'
import { BaseController } from './BaseController'

const SLACK_ENV_KEYS = ['SLACK_BOT_TOKEN'] as const

export class SlackController extends BaseController {
  register(router: any): void {
    router.post('/create-slack-channel', asyncHandler(this.createChannel))
    router.get('/slack-channel/:channelId', asyncHandler(this.getChannel))
    router.post('/slack-send-dm', asyncHandler(this.sendDm))
  }

  private sendDm = async (req: any, res: any, next: any) => {
    if (!requireAdmin(req, next)) return
    const env = requireEnv(this.ctx.env, SLACK_ENV_KEYS, next)
    if (!env) return

    const emails = req.body?.emails
    const message = req.body?.message

    if (!Array.isArray(emails) || emails.length === 0) {
      return next(
        new InvalidPayloadError({ reason: 'emails must be a non-empty array' })
      )
    }
    if (typeof message !== 'string' || !message.trim()) {
      return next(
        new InvalidPayloadError({
          reason: 'message must be a non-empty string'
        })
      )
    }

    const slack = new SlackService(env.SLACK_BOT_TOKEN)
    const results = await Promise.all(
      emails.map((e: unknown) =>
        slack.sendDirectMessageByEmail(String(e), message)
      )
    )
    return res.json({ results })
  }

  private getChannel = async (req: any, res: any, next: any) => {
    if (!requireAdmin(req, next)) return
    const env = requireEnv(this.ctx.env, SLACK_ENV_KEYS, next)
    if (!env) return

    const channelId = String(req.params?.channelId ?? '').trim()
    if (!channelId) {
      return next(
        new InvalidPayloadError({ reason: 'Missing path param: channelId' })
      )
    }

    const slack = new SlackService(env.SLACK_BOT_TOKEN)
    const channel = await slack.getChannel(channelId)
    if (!channel) return res.status(404).json({ error: 'channel_not_found' })
    return res.json({ channel })
  }

  private createChannel = async (req: any, res: any, next: any) => {
    if (!requireAdmin(req, next)) return
    const env = requireEnv(this.ctx.env, SLACK_ENV_KEYS, next)
    if (!env) return

    const rawName = req.body?.channelName
    if (!rawName || typeof rawName !== 'string') {
      return next(
        new InvalidPayloadError({
          reason: 'Missing required param: channelName'
        })
      )
    }

    const name = SlackService.normalizeChannelName(rawName)
    if (!SlackService.isValidChannelName(name)) {
      return next(
        new InvalidPayloadError({
          reason:
            'channelName must be 1 to 80 characters using only lowercase letters, numbers, hyphens, or underscores.'
        })
      )
    }

    const slack = new SlackService(env.SLACK_BOT_TOKEN)
    const channel = await slack.createPublicChannel(name)

    const description = req.body?.description
    if (description && typeof description === 'string') {
      await slack.setChannelPurpose(channel.id, description)
    }

    return res.json({ success: true, channel })
  }
}
