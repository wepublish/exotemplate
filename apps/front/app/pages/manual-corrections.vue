<script lang="ts" setup>
  import type { Client, ClientPeriod, Period } from '~~/types/DirectusTypes'
  import ManualWorkEntries from '~/components/dashboard/ManualWorkEntries.vue'

  const route = useRoute()
  const userStore = useUserStore()
  const { t } = useI18n()

  const clientPeriodId = computed<number | undefined>(() => {
    const raw = route.params?.clientPeriodId
    if (!raw) return
    return Number(raw)
  })

  const {
    data: entryGroups,
    pending,
    error
  } = await useAggregatedHours(clientPeriodId)

  const sums = computed(() => entryGroups.value?.sums)

  const resolved = computed<{ client: Client; period: Period } | undefined>(
    () => {
      const id = clientPeriodId.value
      if (!id) return undefined
      for (const client of userStore.clients) {
        const periods = (client.periods || []) as ClientPeriod[]
        const match = periods.find((cp) => cp.id === id)
        if (match) return { client, period: match.Periods_id as Period }
      }
      return undefined
    }
  )

  const dashboardLink = computed(() =>
    clientPeriodId.value ? `/${clientPeriodId.value}/dashboard` : '/'
  )
</script>

<template>
  <div>
    <UButton
      :to="dashboardLink"
      icon="lucide:chevron-left"
      variant="ghost"
      size="sm"
      class="mb-4"
    >
      {{ t('billing.backToDashboard') }}
    </UButton>

    <USkeleton v-if="pending" class="h-32" />

    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      icon="i-heroicons-exclamation-triangle"
      :title="t('billing.loadError')"
      :description="error.message"
    />

    <ManualWorkEntries v-else :client-period-id="clientPeriodId" :sums="sums" />
  </div>
</template>
