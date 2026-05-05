<script lang="ts" setup>
  import type { Client, ClientPeriod, Period } from '~~/types/DirectusTypes'

  const route = useRoute()
  const userStore = useUserStore()
  const topUpsComp = useTopUps()

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

  const dashboardLink = computed(() => ({
    path: '/',
    query: {
      ...(resolved.value?.client?.id
        ? { clientId: resolved.value.client.id }
        : {}),
      ...(clientPeriodId.value
        ? { clientPeriodId: String(clientPeriodId.value) }
        : {})
    }
  }))

  const formattedPeriod = computed(() => {
    const p = resolved.value?.period
    if (!p?.from || !p?.to) return ''
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString('de-CH', { dateStyle: 'medium' })
    return `${fmt(p.from)} – ${fmt(p.to)}`
  })

  const topUpsForTable = computed(() =>
    sums.value?.computedTopUps.map((topUp) => ({
      Datum: new Date(topUp.date_created as string).toLocaleDateString('de', {
        dateStyle: 'medium'
      }),
      Notiz: topUp.note || ' - ',
      Betrag: `CHF ${topUp.amount}`,
      Satz: `${topUp.hourlyRate} chf / h`,
      Total: `${topUp.paidHours} h`,
      WePublish: `${topUp.wepHours} h`,
      Medium: `${topUp.clientHours} h`,
      Bexio: topUp.bexioInvoiceId
    }))
  )
</script>

<template>
  <div>
    <UButton
      :to="dashboardLink"
      icon="material-symbols:arrow-back-ios"
      variant="ghost"
      size="sm"
      class="mb-4"
    >
      Zurück zum Dashboard
    </UButton>

    <UPageCard>
      <template #default>
        <div class="flex justify-between items-start w-full">
          <div>
            <div class="font-bold text-xl">
              {{ resolved?.client?.name || 'Projekt' }} · Zahlungen / Top-Ups
            </div>
            <div v-if="formattedPeriod" class="text-xs text-muted mt-0.5">
              {{ formattedPeriod }}
            </div>
          </div>
          <div class="font-bold text-4xl text-primary whitespace-nowrap">
            {{ sums?.totalTopUps ?? 0 }} h
          </div>
        </div>

        <USkeleton v-if="pending" class="h-32 mt-6" />

        <UAlert
          v-else-if="error"
          class="mt-6"
          color="error"
          variant="soft"
          icon="i-heroicons-exclamation-triangle"
          title="Beim Abrufen der Daten ist ein Fehler aufgetreten."
          :description="error.message"
        />

        <div v-else class="mt-6">
          <UTable :data="topUpsForTable">
            <template #Bexio-cell="{ row }">
              <UButton
                v-if="row.original.Bexio"
                :href="topUpsComp.getBexioInvoiceUrl(row.original.Bexio)"
                target="_blank"
                trailing-icon="material-symbols:open-in-new-rounded"
                variant="link"
              >
                Nr. {{ row.original.Bexio }}
              </UButton>
            </template>
          </UTable>

          <div
            v-if="userStore.amIAdministrator() && clientPeriodId"
            class="flex justify-center w-full pt-6"
          >
            <UButton
              :to="`/${clientPeriodId}/create-bexio-invoice?amount=0`"
              variant="outline"
              icon="material-symbols:add-notes"
            >
              Bexio-Rechnung generieren
            </UButton>
          </div>
        </div>
      </template>
    </UPageCard>
  </div>
</template>
