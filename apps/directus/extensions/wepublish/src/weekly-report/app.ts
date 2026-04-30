import { defineOperationApp } from '@directus/extensions-sdk'

export default defineOperationApp({
  id: 'weekly-report',
  name: 'Weekly Project Report',
  icon: 'insights',
  description:
    'Sendet einmal pro Woche einen Slack-Bericht je Projekt mit dem Vergleich Budget vs. abgelaufene Zeit. Eskaliert über Budget liegende Projekte zusätzlich an das Controlling.',
  overview: () => [],
  options: []
})
