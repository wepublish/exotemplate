<script lang="ts" setup>
  const props = defineProps<{
    clockodoCustomerId?: string | null,
    from?: string
    to?: string
  }>()

  const {data: entryGroups, error: clError} = await useFetch('/api/clockodo/entryGroups', {
    query: {
      customer_id: props.clockodoCustomerId,
      from: props.from,
      to: props.to
    }
  })
  const {data: jiraData, error: jiraError} = await useFetch('/api/jira/issues')
</script>

<template>
  <div class="flex gap-4">
    <UPageCard class="flex-1">
      <template #header>Arbeitsprotokoll</template>
      <template #body>
        <div v-if="jiraError" class="col-span-12">
          <UError :error="jiraError" />
        </div>


        <div v-if="clError" class="col-span-12">
          <UError :error="clError" />
        </div>
        
        <div class="grid grid-cols-12 gap-4">
          <!-- Full width -->
          <div v-if="!!entryGroups?.groups.length" class="col-span-12">
            <DashboardEntryGroupComp :entry-groups="entryGroups.groups" />
          </div>
        </div>
      </template>
    </UPageCard>
  </div>
</template>