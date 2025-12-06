<script lang="ts" setup>
  const userStore = useUserStore()
</script>

<template>
  <UContainer>
    <UHeader>Dashboard</UHeader>

    <UPageCard>
      User:
      {{ userStore.user }}
    </UPageCard>
  </UContainer>
</template>

<style>

</style>