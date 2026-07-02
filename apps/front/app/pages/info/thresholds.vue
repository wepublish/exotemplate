<script lang="ts" setup>
  import { readItems } from '@directus/sdk'
  import type { NotificationThreshold } from '~~/types/DirectusTypes'

  const { directus } = useDirectus()
  const { t } = useI18n()
  const { formatHours } = useFormatters()

  function formatOffset(hours: number): string {
    const value = Number(hours)
    if (!Number.isFinite(value) || Math.abs(value) < 0.005)
      return t('thresholds.offsetZero')
    const sign = value > 0 ? '+' : '−'
    return `${sign}${formatHours(Math.abs(value))}`
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
    return t('thresholds.exampleLine', {
      min: formatHours(min),
      points: points.map(formatHours).join(', ')
    })
  }

  const columns = computed(() => [
    {
      accessorKey: 'min_hours_inclusive',
      header: t('thresholds.table.range')
    },
    {
      accessorKey: 'initial_threshold_offset_hours',
      header: t('thresholds.table.tolerance')
    },
    {
      accessorKey: 'recurring_threshold_hours',
      header: t('thresholds.table.recurring')
    },
    { id: 'examples', header: t('thresholds.table.example') }
  ])

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
            {{ t('thresholds.pageTitle') }}
          </p>
        </template>
        <template #default>
          <section class="space-y-4 leading-relaxed">
            <p>{{ t('thresholds.intro') }}</p>

            <h3 class="text-lg pt-2">
              {{ t('thresholds.firstNotificationHeading') }}
            </h3>
            <p v-html="t('thresholds.firstNotificationBody')" />
          </section>

          <USkeleton v-if="pending" class="h-32 mt-6" />

          <UTable
            v-else
            class="mt-6"
            :data="orderedThresholds"
            :columns="columns"
          >
            <template #min_hours_inclusive-cell="{ row }">
              {{
                t('thresholds.cellFrom', {
                  hours: formatHours(row.original.min_hours_inclusive)
                })
              }}
            </template>
            <template #initial_threshold_offset_hours-cell="{ row }">
              {{
                t('thresholds.cellTolerance', {
                  offset: formatOffset(
                    row.original.initial_threshold_offset_hours
                  )
                })
              }}
            </template>
            <template #recurring_threshold_hours-cell="{ row }">
              {{
                t('thresholds.cellRecurring', {
                  hours: formatHours(row.original.recurring_threshold_hours)
                })
              }}
            </template>
            <template #examples-cell="{ row }">
              {{ exampleNotifications(row.original) }}
            </template>
          </UTable>

          <h3 class="text-lg font-semibold pt-2">
            {{ t('thresholds.readingExamplesHeading') }}
          </h3>
          <ul class="list-disc ps-6 space-y-2">
            <li v-html="t('thresholds.readingExamples.item1')" />
            <li v-html="t('thresholds.readingExamples.item2')" />
            <li v-html="t('thresholds.readingExamples.item3')" />
          </ul>

          <section class="space-y-3 leading-relaxed mt-8">
            <h3 class="text-lg font-semibold">
              {{ t('thresholds.afterNotificationHeading') }}
            </h3>
            <ul class="list-disc ps-6 space-y-2">
              <li v-html="t('thresholds.afterNotification.halt')" />
              <li v-html="t('thresholds.afterNotification.silence')" />
            </ul>
          </section>
        </template>
      </UPageCard>
    </div>
  </div>
</template>
