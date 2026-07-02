<script lang="ts" setup>
  import type { TableColumn } from '@nuxt/ui'
  import type { ClientPeriod, ManualWorkEntry } from '~~/types/DirectusTypes'
  import type { Sums } from '~~/types/ClockodoTypes'
  import LinkifiedText from '~/components/LinkifiedText.vue'

  const props = defineProps<{
    clientPeriodId: number | undefined
    sums: Sums | undefined
  }>()

  const { t } = useI18n()
  const { formatDate, formatNumber, formatHours } = useFormatters()
  const clientPeriodComp = useUseClientPeriods()

  const selectedClientPeriod = computed<ClientPeriod | undefined>(() =>
    clientPeriodComp.getClientPeriodById(props.clientPeriodId)
  )

  const columns = computed<TableColumn<ManualWorkEntry>[]>(() => [
    {
      accessorKey: 'date',
      header: t('billing.manualCorrections.table.date')
    },
    {
      accessorKey: 'title',
      header: t('billing.manualCorrections.table.title')
    },
    {
      accessorKey: 'description',
      header: t('billing.manualCorrections.table.description')
    },
    {
      accessorKey: 'hours',
      header: t('billing.manualCorrections.table.hours')
    }
  ])
</script>

<template>
  <div class="flex-1 w-full">
    <UPageCard>
      <template #default>
        <div class="flex justify-between w-full font-bold">
          <div>{{ t('billing.manualCorrections.title') }}</div>
          <div class="font-bold text-4xl text-primary">
            {{ formatHours(sums?.totalManualWorkHours ?? 0) }}
          </div>
        </div>

        <UTable
          ref="table"
          :data="
            (selectedClientPeriod?.manualWorkEntries || []) as ManualWorkEntry[]
          "
          :columns="columns"
          sticky
        >
          <template #date-cell="{ row }">
            {{ formatDate(row.original.date as string) }}
          </template>
          <template #description-cell="{ row }">
            <LinkifiedText :text="row.original.description" />
          </template>
          <template #hours-cell="{ row }">
            {{ formatNumber(Number(row.original.hours)) }}
          </template>
        </UTable>
      </template>
    </UPageCard>
  </div>
</template>
