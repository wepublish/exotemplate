import { defineOperationApp } from '@directus/extensions-sdk'

export default defineOperationApp({
  id: 'jira-threshold-notifier',
  name: 'Jira Threshold Notifier',
  icon: 'notifications_active',
  description:
    'Sends one composed Slack reminder per client for Jira issues that crossed a budget threshold.',
  overview: () => [],
  options: []
})
