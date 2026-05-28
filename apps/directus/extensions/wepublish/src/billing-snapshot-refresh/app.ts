import { defineOperationApp } from '@directus/extensions-sdk'

export default defineOperationApp({
  id: 'billing-snapshot-refresh',
  name: 'Billing-Snapshot aktualisieren',
  icon: 'cached',
  description:
    'Berechnet für jedes aktive Clients_Periods die Budget-Sums (Clockodo + Jira) und schreibt sie in die BillingSnapshots-Tabelle. Speist die Tile-Übersicht /overview ohne Live-API-Aufrufe.',
  overview: () => [],
  options: []
})
