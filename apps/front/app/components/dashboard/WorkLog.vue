<script lang="ts" setup>
  import type { BreadcrumbItem, TableColumn } from '@nuxt/ui'
  import type {
    EntryGroup,
    EntryGroupsWithSums
  } from '../../../types/ClockodoTypes'

  const props = defineProps<{
    entryGroups: EntryGroupsWithSums | undefined
  }>()

  const { secondsToHours } = useHours()

  const entryGroupNavigation = ref<EntryGroup[]>([])

  const columns: TableColumn<EntryGroup>[] = [
    {
      accessorKey: 'name',
      header: 'Arbeit',
      meta: {
        style: {
          td: 'max-width: 340px;'
        }
      }
    },
    {
      accessorKey: 'jiraIssue',
      header: 'Details Abrechenbarkeit'
    },
    {
      accessorKey: 'duration',
      header: 'Verrechenbare Zeit'
    },
    {
      id: 'expand',
      header: 'Details'
    }
  ]

  const selectedEntryGroup = computed<EntryGroup | undefined>(() =>
    entryGroupNavigation.value.at(-1)
  )

  const breadCrums = computed<BreadcrumbItem[]>(() =>
    entryGroupNavigation.value?.map((eg) => ({
      label: eg.name
    }))
  )

  function navigateEntryGroup(entryGroup: EntryGroup | undefined): void {
    if (!entryGroup || !entryGroup.sub_groups?.length) {
      // reset navigation
      entryGroupNavigation.value = []
    } else {
      entryGroupNavigation.value.push(entryGroup)
    }
  }
</script>

<template>
  <div class="flex-1 w-full">
    <UPageCard>
      <template #default>
        <div class="flex justify-between w-full font-bold">
          <div>Arbeitsprotokoll</div>
          <div class="font-bold text-4xl text-primary">
            {{ props.entryGroups?.sums?.billableHours || 0 }} h
          </div>
        </div>

        <div class="w-full">
          <UBreadcrumb :items="breadCrums" />
        </div>

        <UTable
          ref="table"
          :data="selectedEntryGroup?.sub_groups || entryGroups?.groups || []"
          :columns="columns"
          sticky
        >
          <template #name-cell="row">
            <p
              v-if="
                (row.row.original.grouped_by as unknown as string) === 'day'
              "
            >
              {{
                new Date(row.row.original.name).toLocaleDateString('de', {
                  dateStyle: 'medium'
                })
              }}
            </p>
            <p v-else class="whitespace-normal">
              {{ row.row.original.name }}
            </p>
          </template>

          <template #jiraIssue-cell="{ row }">
            <div v-if="row.original.billability" class="grid grid-cols-2">
              <!-- if jira estimation available -->
              <div class="col-span-2 grid grid-cols-2">
                <div>Jira Schätzung</div>
                <div class="text-right">
                  {{ secondsToHours(row.original.billability.durationJira) }} h
                </div>

                <div>Vor Abrechnungsperiode gleistet</div>
                <div class="text-right">
                  -
                  {{ secondsToHours(row.original.billability.durationPast) }} h
                </div>

                <div class="border-t border-b">Verfügbare Jira-Stunden</div>
                <div class="border-t border-b text-right">
                  {{ secondsToHours(row.original.billability.jiraAvailable) }} h
                </div>

                <div class="mt-4">In Abrechnungsperiode gleistet</div>
                <div class="mt-4 text-right">
                  {{ secondsToHours(row.original.billability.durationCurrent) }}
                  h
                </div>

                <div class="pl-3">Davon voll verrechenbar</div>
                <div class="text-right font-bold">
                  +
                  {{ secondsToHours(row.original.billability.billableDirect) }}
                  h
                </div>

                <div class="pl-3">Davon hälftig verrechenbar</div>
                <div class="font-bold text-right">
                  +
                  {{ secondsToHours(row.original.billability.billablePart) }} h
                </div>

                <div class="border-b pl-3">
                  Davon hälftig nicht verrechenbar
                </div>
                <div class="border-b text-right">
                  {{ secondsToHours(row.original.billability.billablePart) }} h
                </div>
              </div>

              <div class="font-bold mt-2">Total verrechenbar</div>
              <div class="font-bold text-right mt-2">
                {{ secondsToHours(row.original.billability.billableTotal) }} h
              </div>
            </div>
          </template>

          <template #duration-cell="{ row }">
            <UBadge size="lg">
              {{
                secondsToHours(
                  row.original?.billability?.billableTotal ||
                    row.original.duration
                )
              }}
              h
            </UBadge>
          </template>

          <template #expand-cell="{ row }">
            <UButton
              v-if="!!entryGroupNavigation.length"
              @click="entryGroupNavigation = []"
              class="mr-2"
              color="warning"
              variant="subtle"
              >Zurück</UButton
            >
            <UButton
              v-if="entryGroupNavigation.length < 2"
              @click="navigateEntryGroup(row.original)"
              variant="outline"
              >Details anzeigen</UButton
            >
          </template>
        </UTable>
      </template>
    </UPageCard>
  </div>
</template>
