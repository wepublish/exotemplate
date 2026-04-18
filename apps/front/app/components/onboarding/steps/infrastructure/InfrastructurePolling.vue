<script lang="ts" setup>
  defineProps<{
    status: string | null
  }>()
</script>

<template>
  <div class="flex flex-col gap-4">
    <UAlert
      color="info"
      variant="soft"
      icon="material-symbols:hourglass-top-rounded"
    >
      <template #title>Infrastruktur wird erstellt</template>
      <template #description>
        Pull Requests werden auf GitHub erstellt. Dies kann einen Moment
        dauern...
      </template>
    </UAlert>

    <div class="flex flex-col items-center gap-3 py-6">
      <UIcon
        name="material-symbols:sync-rounded"
        class="text-4xl text-primary animate-spin"
      />
      <p class="text-sm text-muted">{{ status }}</p>
    </div>
  </div>
</template>
