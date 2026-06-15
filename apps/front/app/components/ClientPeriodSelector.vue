<script lang="ts" setup>
  // Always-visible client + period selector. The selection lives in the URL
  // path (`/:clientPeriodId/…`) and the store derives from it, so changing a
  // dropdown here navigates to the same page for the newly selected
  // client/period rather than mutating any state directly.
  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const selection = useClientSelection()
  const { selectedClientId, selectedClientPeriodId, clients, clientPeriods } =
    storeToRefs(selection)

  // Swap the leading `/:clientPeriodId` segment, keeping the rest of the route
  // so switching client/period stays on the same page.
  function targetForPeriod(periodId: number): string {
    const segments = route.path.split('/').filter(Boolean)
    if (segments.length) {
      segments[0] = String(periodId)
      return '/' + segments.join('/')
    }
    return `/${periodId}/dashboard`
  }

  function onClientChange(id: string): void {
    // Switching client moves to that client's newest period.
    const periodId = selection.newestPeriodIdForClient(id)
    if (periodId) router.push(targetForPeriod(periodId))
  }

  function onPeriodChange(id: number): void {
    router.push(targetForPeriod(id))
  }
</script>

<template>
  <div v-if="clients.length" class="space-y-2">
    <USelectMenu
      :model-value="selectedClientId"
      :items="clients"
      value-key="id"
      label-key="name"
      icon="lucide:building-2"
      :placeholder="t('nav.selector.project')"
      class="w-full"
      @update:model-value="onClientChange"
    />

    <USelectMenu
      :model-value="selectedClientPeriodId"
      :disabled="!selectedClientId"
      :items="clientPeriods"
      value-key="id"
      label-key="periodName"
      icon="lucide:calendar"
      :placeholder="t('nav.selector.period')"
      class="w-full"
      @update:model-value="onPeriodChange"
    />
  </div>
</template>
