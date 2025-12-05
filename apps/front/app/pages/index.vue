<script setup lang="ts">
  const {data, error} = await useFetch('/api/clockodo/entryGroups')
</script>

<template>
  <UContainer class="py-8">
    <h1 class="text-2xl font-bold">Inside We.Publish</h1>
    
    <div class="grid grid-cols-12 gap-4">
      <!-- Full width -->
      <div v-if="!!data?.groups.length" class="col-span-12 bg-primary-500/10 p-4 rounded border border-primary-500/20 flex items-center justify-center">
        <div class="grid grid-cols-12 gap-4">
          <div v-for="group in data.groups" class="col-span-6">
            {{ group }}
          </div>

        </div>
      </div>

      <div v-if="error" class="col-span-12">
        <UError :error="error" />
      </div>
    </div>
  </UContainer>
</template>
