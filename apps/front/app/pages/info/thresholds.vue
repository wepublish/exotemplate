<script lang="ts" setup>
  import { readItems } from '@directus/sdk'
  import type { NotificationThreshold } from '~~/types/DirectusTypes'

  const { directus } = useDirectus()

  const HOURS_FORMATTER = new Intl.NumberFormat('de-CH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })

  function formatHours(hours: number): string {
    return `${HOURS_FORMATTER.format(hours)} h`
  }

  /**
   * Builds the first ~5 notification points for a threshold so users can
   * quickly see the cadence without us having to render an infinite list.
   */
  function exampleNotifications(threshold: NotificationThreshold): string {
    const initial = Number(threshold.initial_threshold_hours)
    const recurring = Number(threshold.recurring_threshold_hours)
    if (!Number.isFinite(initial)) return ''
    const points = [initial]
    if (Number.isFinite(recurring) && recurring > 0) {
      for (let i = 1; i < 4; i += 1) points.push(initial + i * recurring)
    }
    return points.map(formatHours).join(', ') + ', …'
  }

  const { data: thresholds, pending } = await useAsyncData(
    'info-thresholds',
    () =>
      directus.request<NotificationThreshold[]>(
        readItems('NotificationThresholds', {
          filter: { status: { _eq: 'published' } },
          sort: ['min_hours_inclusive'],
          limit: -1
        })
      )
  )

  const orderedThresholds = computed<NotificationThreshold[]>(
    () => thresholds.value ?? []
  )
</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UPageCard>
        <template #title> Schwellenwerte für Slack-Warnungen </template>
        <template #description>
          So entscheidet die Anwendung, wann ein Jira-Ticket gemeldet wird.
        </template>
        <template #body>
          <div class="prose max-w-none">
            <p>
              Für jedes Jira-Ticket vergleichen wir die kumulierte Clockodo-Zeit
              (alle bisher gebuchten Stunden inklusive den letzten 12 Monaten
              vor der laufenden Abrechnungsperiode) mit der Aufwandsschätzung in
              Jira. Sobald die verbrauchte Zeit eine definierte Schwelle
              erreicht, geht eine Slack-Meldung an den Kunden-Channel.
            </p>
            <p>
              Welche Schwelle gilt, hängt von der ursprünglichen Schätzung des
              Tickets ab. Wir wählen den passenden Eintrag aus der
              untenstehen­den Tabelle: kleinere Tickets erhalten engere
              Schwellen, grössere Tickets dürfen mehr Mehraufwand verursachen,
              bevor wir warnen.
            </p>
            <p>
              <strong>Ablesebeispiel:</strong> Ein Ticket mit Schätzung
              <em>3 h</em> fällt in den Bereich „ab 3 h Schätzung“. Sobald die
              gebuchte Zeit die <em>erste Meldung</em> erreicht, wird eine
              Warnung verschickt; danach folgt jeweils eine weitere Warnung im
              <em>wiederkehrenden Abstand</em>, ohne Obergrenze.
            </p>
          </div>

          <USkeleton v-if="pending" class="h-32 mt-4" />

          <UTable
            v-else
            class="mt-4"
            :data="orderedThresholds"
            :columns="[
              {
                accessorKey: 'min_hours_inclusive',
                header: 'Bereich (Schätzung)'
              },
              {
                accessorKey: 'initial_threshold_hours',
                header: 'Erste Meldung'
              },
              {
                accessorKey: 'recurring_threshold_hours',
                header: 'Wiederkehrend'
              },
              { id: 'examples', header: 'Folgemeldungen' }
            ]"
          >
            <template #min_hours_inclusive-cell="{ row }">
              ab {{ formatHours(row.original.min_hours_inclusive) }} Schätzung
            </template>
            <template #initial_threshold_hours-cell="{ row }">
              bei
              {{ formatHours(row.original.initial_threshold_hours) }}
              verbraucht
            </template>
            <template #recurring_threshold_hours-cell="{ row }">
              alle
              {{ formatHours(row.original.recurring_threshold_hours) }}
            </template>
            <template #examples-cell="{ row }">
              {{ exampleNotifications(row.original) }}
            </template>
          </UTable>

          <div class="prose max-w-none mt-6">
            <h3>Was passiert nach einer Meldung?</h3>
            <ul>
              <li>
                <strong>Bestätigen:</strong> nimmt die Slack-Meldung als gesehen
                zur Kenntnis. Die nächste Meldung folgt erst, wenn der Verbrauch
                die nächste Schwelle erreicht.
              </li>
              <li>
                <strong>Arbeit stoppen:</strong> markiert das Ticket als
                blockiert; das Team erhält in Slack die Anweisung, sofort die
                Arbeit einzustellen, und die zugewiesene Person bekommt
                zusätzlich eine persönliche Direktnachricht.
              </li>
              <li>
                <strong>Stummschalten:</strong> unterdrückt zukünftige Meldungen
                für dieses Ticket dauerhaft, bis die Stummschaltung explizit
                aufgehoben wird.
              </li>
              <li>
                <strong>Kunde pausieren:</strong> über den Schalter im
                Warnungs-Dashboard können sämtliche Slack-Meldungen für einen
                Kunden temporär unterbunden werden.
              </li>
            </ul>
          </div>
        </template>
      </UPageCard>
    </div>
  </div>
</template>
