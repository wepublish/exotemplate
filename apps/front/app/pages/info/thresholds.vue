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

  function formatOffset(hours: number): string {
    const value = Number(hours)
    if (!Number.isFinite(value) || Math.abs(value) < 0.005) return '±0 h'
    const sign = value > 0 ? '+' : '−'
    return `${sign}${HOURS_FORMATTER.format(Math.abs(value))} h`
  }

  /**
   * Builds an example walkthrough for a threshold: takes the bucket's lower
   * bound as a sample estimate and shows the first ~4 warning points.
   */
  function exampleNotifications(threshold: NotificationThreshold): string {
    const min = Number(threshold.min_hours_inclusive)
    const offset = Number(threshold.initial_threshold_offset_hours)
    const recurring = Number(threshold.recurring_threshold_hours)
    if (!Number.isFinite(min) || !Number.isFinite(offset)) return ''
    const initial = min + offset
    const points = [initial]
    if (Number.isFinite(recurring) && recurring > 0) {
      for (let i = 1; i < 4; i += 1) points.push(initial + i * recurring)
    }
    return `Schätzung ${formatHours(min)} → ${points.map(formatHours).join(', ')}, …`
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
        <template #header>
          <p class="text-2xl font-semibold">
            Wann wird ein Jira-Ticket gemeldet?
          </p>
        </template>
        <template #default>
          <section class="space-y-4 leading-relaxed">
            <p>
              Wir vergleichen die geleistete Arbeitszeit eines Jira-Tickets
              (alle bisher gebuchten Stunden inklusive der letzten 12 Monate vor
              der laufenden Abrechnungsperiode) mit der Aufwandsschätzung im
              Jira-Ticket. Sobald die verbrauchte Zeit eine Schwelle erreicht,
              meldet sich der Bot im Slack-Channel.
            </p>

            <h3 class="text-lg pt-2">Erste Meldung = Schätzung + Toleranz</h3>
            <p>
              Die erste Meldung erfolgt, sobald die Schätzung eines Jira-Tickets
              zuzüglich oder abzüglich der Toleranz erreicht wird. Die
              <em>Toleranz</em> kommt aus der Tabelle unten und kann positiv
              (Meldung nach Erreichen der Schätzung) oder negativ (Meldung schon
              vor Erreichen) sein. Danach folgt jeweils eine weitere Meldung im
              <em>wiederkehrenden Abstand</em>, ohne Obergrenze.
            </p>
          </section>

          <USkeleton v-if="pending" class="h-32 mt-6" />

          <UTable
            v-else
            class="mt-6"
            :data="orderedThresholds"
            :columns="[
              {
                accessorKey: 'min_hours_inclusive',
                header: 'Bereich (Schätzung)'
              },
              {
                accessorKey: 'initial_threshold_offset_hours',
                header: 'Toleranz'
              },
              {
                accessorKey: 'recurring_threshold_hours',
                header: 'Wiederkehrend'
              },
              { id: 'examples', header: 'Beispiel' }
            ]"
          >
            <template #min_hours_inclusive-cell="{ row }">
              ab {{ formatHours(row.original.min_hours_inclusive) }}
            </template>
            <template #initial_threshold_offset_hours-cell="{ row }">
              Schätzung
              {{ formatOffset(row.original.initial_threshold_offset_hours) }}
            </template>
            <template #recurring_threshold_hours-cell="{ row }">
              alle
              {{ formatHours(row.original.recurring_threshold_hours) }}
            </template>
            <template #examples-cell="{ row }">
              {{ exampleNotifications(row.original) }}
            </template>
          </UTable>

          <h3 class="text-lg font-semibold pt-2">Lesebeispiele</h3>
          <ul class="list-disc ps-6 space-y-2">
            <li>
              Toleranz <strong>+2 h</strong>, Wiederkehrend
              <strong>4 h</strong>: Ticket mit Schätzung <strong>5 h</strong> →
              erste Meldung bei <strong>7 h</strong>, dann 11 h, 15 h …
            </li>
            <li>
              Gleicher Bereich, Ticket mit Schätzung <strong>9 h</strong> →
              erste Meldung bei <strong>11 h</strong>, dann 15 h, 19 h … (kein
              „zu früh" mehr).
            </li>
            <li>
              Toleranz <strong>−1 h</strong>: Wir warnen bewusst kurz
              <em>bevor</em> die Schätzung aufgebraucht ist – nützlich bei
              grösseren Tickets.
            </li>
          </ul>

          <section class="space-y-3 leading-relaxed mt-8">
            <h3 class="text-lg font-semibold">
              Was passiert nach einer Meldung?
            </h3>
            <ul class="list-disc ps-6 space-y-2">
              <li>
                <strong>Arbeit stoppen:</strong> markiert das Ticket als
                blockiert. Das Team erhält in Slack die Anweisung, sofort die
                Arbeit einzustellen, und die zugewiesene Person bekommt
                zusätzlich eine persönliche Direktnachricht.
              </li>
              <li>
                <strong>Stummschalten:</strong> unterdrückt zukünftige Meldungen
                für dieses Ticket dauerhaft, bis die Stummschaltung explizit
                aufgehoben wird.
              </li>
            </ul>
          </section>
        </template>
      </UPageCard>
    </div>
  </div>
</template>
