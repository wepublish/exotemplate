<script lang="ts" setup>
  import type { TableColumn } from '@nuxt/ui'
  import type { ClientPeriod, ManualWorkEntry } from '~~/types/DirectusTypes'
  import type { Sums } from '~~/types/ClockodoTypes'
  import LinkifiedText from '~/components/LinkifiedText.vue'

  const props = defineProps<{
    clientPeriodId: number | undefined
    sums: Sums | undefined
  }>()

  const clientPeriodComp = useUseClientPeriods()

  const selectedClientPeriod = computed<ClientPeriod | undefined>(() =>
    clientPeriodComp.getClientPeriodById(props.clientPeriodId)
  )

  const columns: TableColumn<ManualWorkEntry>[] = [
    {
      accessorKey: 'date',
      header: 'Datum'
    },
    {
      accessorKey: 'title',
      header: 'Titel'
    },
    {
      accessorKey: 'description',
      header: 'Beschreibung'
    },
    {
      accessorKey: 'hours',
      header: 'Stunden'
    }
  ]
</script>

<template>
  <div class="flex-1 w-full">
    <UPageCard>
      <template #default>
        <div class="flex justify-between w-full font-bold">
          <div>Manuelle Korrekturen</div>
          <div class="font-bold text-4xl text-primary">
            {{ sums?.totalManualWorkHours ?? 0 }} h
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
            {{
              new Date(row.original.date as string).toLocaleDateString('de', {
                dateStyle: 'medium'
              })
            }}
          </template>
          <template #description-cell="{ row }">
            <LinkifiedText :text="row.original.description" />
          </template>
          <template #hours-cell="{ row }">
            {{ Number(row.original.hours) }}
          </template>
        </UTable>
      </template>
    </UPageCard>
  </div>
</template>
