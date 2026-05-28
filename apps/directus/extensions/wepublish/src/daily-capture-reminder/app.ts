import { defineOperationApp } from '@directus/extensions-sdk'

export default defineOperationApp({
  id: 'daily-capture-reminder',
  name: 'Daily Capture Reminder',
  icon: 'alarm',
  description:
    'Postet jeden Morgen einen freundlichen Slack-Reminder mit den Personen, die am Vortag (oder am letzten Werktag) keine Stunden in Clockodo erfasst haben. Ignorierte Personen werden ausgelassen. Wird über einen Directus-Flow zeitgesteuert. Slack-Channel wird aus der Settings-Singleton-Collection gelesen (Feld slack_time_tracking_channel_id).',
  overview: () => [],
  options: []
})
