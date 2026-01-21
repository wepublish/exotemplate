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
      <template #header>Arbeitsprotokoll</template>
      <template #default>
        <UTable
          ref="table"
          :data="selectedEntryGroup?.sub_groups || entryGroups"
          :columns="columns"
          sticky
        >
          <template #jiraIssue-cell="{row}">
            <div v-if="row.original.jiraIssue">
              <p>
                Jira Schätzung: {{ (row.original.jiraIssue)?.fields?.customfield_10028 || 0 }}
              </p>
              <br />
              <p><b>Von We.Publish geleistet: 200 h</b></p>
                <p>In Abrechnungsperiode: {{ getDuration((row.original.duration)) }} h</p>
                <p>Vor Abrechnungsperiode: {{ getDuration((row.original.pastEntryGroup)?.duration || 0) }} h</p>

              <br />
              <p><b>Differenz: 80 h</b></p>
              <p>Zu Lasten von We.Publish: - 40 h</p>

              <br />
              <p><b><u>Effektiv verrechenbar: 70 h</u></b></p>
            </div>
          </template>

          <template #duration-cell="{row}">
            <UBadge size="lg">
              {{ getDuration(row.getValue('duration') as number) }} h
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