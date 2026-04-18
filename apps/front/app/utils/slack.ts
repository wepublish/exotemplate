// Universal Slack deep link for a channel. `slack.com/app_redirect` lets
// Slack pick the right workspace based on the user's session, so it survives
// workspace renames / subdomain changes.
export function composeSlackChannelUrl(
  channelId: string | null | undefined
): string {
  if (!channelId) return 'https://slack.com'
  return `https://slack.com/app_redirect?channel=${encodeURIComponent(channelId)}`
}
