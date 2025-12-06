<script lang="ts" setup>
  const route = useRoute()
  const clientId = route.params.clientId

  const {data: entryGroups, error: clError} = await useFetch('/api/clockodo/entryGroups')
  const {data: jiraData, error: jiraError} = await useFetch('/api/jira/issues')
</script>

<template>
  <UContainer>
    client id: {{ clientId }}


    <h1 class="text-2xl font-bold">Inside We.Publish</h1>

    <div v-if="jiraError" class="col-span-12">
      <UError :error="jiraError" />
    </div>


    <div v-if="clError" class="col-span-12">
      <UError :error="clError" />
    </div>
    
    <div class="grid grid-cols-12 gap-4">
      <div v-if="jiraData" class="col-span-12">
        {{ jiraData }}
      </div>

      <!-- Full width -->
      <div v-if="!!entryGroups?.groups.length" class="col-span-12">
        <EntryGroupComp :entry-groups="entryGroups.groups" />
      </div>
    </div>
  </UContainer>
</template>

<style>

</style>