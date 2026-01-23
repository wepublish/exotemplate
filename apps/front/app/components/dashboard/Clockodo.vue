<script lang="ts" setup>
  import type { TableColumn } from '@nuxt/ui'
  import type {EntryGroup, JiraIssue} from '../../../types/ClockodoTypes'
  const {getCustomEndpoint} = useDirectus()

  const props = defineProps<{
    clientPeriodId: number | undefined
  }>()

  const selectedEntryGroup = ref<EntryGroup | undefined>(undefined)

  const {data: entryGroups, pending} = await useAsyncData(`clientPeriodId-${props.clientPeriodId}`, async () => {
    if (!props.clientPeriodId) {
      return
    }
    return (await getCustomEndpoint('aggregatedHours', {clientPeriodId: props.clientPeriodId})).data as Promise<EntryGroup[]>
  })

  const columns: TableColumn<EntryGroup>[] = [
    {
      accessorKey: 'name',
      header: 'Arbeit',
    },
    {
      accessorKey: 'jiraIssue',
      header: 'Details Abrechenbarkeit'
    },
    {
      accessorKey: 'duration',
      header: 'Verrechenbare Zeit',
    },
    {
      id: 'expand',
      header: 'Details'
    }
  ]

  function getDuration (seconds: number): string {
    return (seconds / 3600).toFixed(2)
  }
  
</script>

<template>
  <div class="flex-1 w-full">  
    <UPageCard>
      <template #title>Arbeitsprotokoll</template>
      <template #default>
        <UTable
          ref="table"
          :data="selectedEntryGroup?.sub_groups || entryGroups"
          :columns="columns"
          sticky
        >
          <template #jiraIssue-cell="{row}">
            <div v-if="row.original.billability" class="grid grid-cols-2">
              <!-- if jira estimation available -->
              <div class="col-span-2 grid grid-cols-2">
                <div>
                  Jira Schätzung
                </div>
                <div class="text-right">
                  {{ getDuration(row.original.billability.durationJira) }} h
                </div>

                <div>
                  Vor Abrechnungsperiode gleistet
                </div>
                <div class="text-right">
                  - {{ getDuration(row.original.billability.durationPast) }} h
                </div>

                <div class="border-t border-b">
                  Verfügbare Jira-Stunden
                </div>
                <div class="border-t border-b text-right">
                  {{ getDuration(row.original.billability.jiraAvailable) }} h
                </div>

                <div class="mt-4">In Abrechnungsperiode gleistet</div>
                <div class="mt-4 text-right">{{ getDuration(row.original.billability.durationCurrent) }} h</div>

                <div class="pl-3">Davon direkt verrechenbar</div>
                <div class="text-right font-bold">+ {{ getDuration(row.original.billability.billableDirect) }} h</div>
                
                <div class="pl-3">Davon hälftig verrechenbar</div>
                <div class="font-bold text-right">+ {{ getDuration(row.original.billability.billablePart) }} h</div>

                <div class="border-b pl-3">Davon hälftig nicht verrechenbar</div>
                <div class="border-b text-right">{{ getDuration(row.original.billability.billablePart) }} h</div>
              </div>

              <div class="font-bold mt-2">
                Total verrechenbar
              </div>
              <div class="font-bold text-right mt-2">
                {{ getDuration(row.original.billability.billableTotal) }} h
              </div>
            </div>
          </template>

          <template #duration-cell="{row}">
            <UBadge size="lg">
              {{ getDuration(row.original?.billability?.billableTotal || row.original.duration) }} h
            </UBadge>
          </template>

          <template #expand-cell="{row}">
            <UButton @click="selectedEntryGroup = row.original">Details anzeigen</UButton>
          </template>
        </UTable>
      </template>
    </UPageCard>
  </div>
</template>