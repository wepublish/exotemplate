<script lang="ts" setup>
  const userStore = useUserStore()
</script>

<template>
  <UPageCard>
      User:
      {{ userStore.user }}
    </UPageCard>
</template>