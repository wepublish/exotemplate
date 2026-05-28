<script lang="ts" setup>
  import type { Client, ClientPeriod, Period } from '~~/types/DirectusTypes'

  const route = useRoute()
  const userStore = useUserStore()
  const { compute, statusColor, statusHeadline, statusBody, statusIcon } =
    useWeeklyReportProgress()

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

  const progress = computed(() =>
    compute({
      totalUsedHours: sums.value?.totalUsedHours,
      totalTopUps: sums.value?.totalTopUps,
      periodFrom: resolved.value?.period?.from,
      periodTo: resolved.value?.period?.to
    })
  )

  const isMonthlyBilling = computed(
    () => (resolved.value?.client?.billing_mode ?? 'prepaid') === 'monthly'
  )

  const pageTitleSuffix = computed(() =>
    isMonthlyBilling.value
      ? 'Aktuell zu verrechnen'
      : 'Verfügbare Arbeitsstunden'
  )

  // For monthly clients the "Aktuell zu verrechnen" headline carries the
  // positive amount that still needs to land on the next invoice. Mirrors
  // the dashboard tile + the weekly Slack report's `remainingToBillHours`.
  const headlineValue = computed<number>(() => {
    const available = sums.value?.totalAvailableHours ?? 0
    return isMonthlyBilling.value ? Math.max(0, -available) : available
  })

  const budgetColor = computed<
    'primary' | 'success' | 'warning' | 'error' | 'info'
  >(() => {
    const used = sums.value?.totalUsedPercentage || 0
    if (used >= 90) return 'error'
    if (used >= 75) return 'warning'
    return 'primary'
  })

  const summaryColor = computed(() =>
    progress.value ? statusColor(progress.value.status) : budgetColor.value
  )

  const summaryIcon = computed(() =>
    progress.value
      ? statusIcon(progress.value.status)
      : 'material-symbols:trending-flat-rounded'
  )

  const summaryHeadline = computed(() =>
    progress.value ? statusHeadline(progress.value.status) : ''
  )

  const summaryBody = computed(() =>
    progress.value ? statusBody(progress.value) : ''
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
              {{ resolved?.client?.name || 'Projekt' }} · {{ pageTitleSuffix }}
            </div>
            <div v-if="formattedPeriod" class="text-xs text-muted mt-0.5">
              {{ formattedPeriod }}
            </div>
          </div>
          <div
            class="font-bold text-4xl whitespace-nowrap"
            :class="isMonthlyBilling ? 'text-primary' : `text-${budgetColor}`"
          >
            {{ headlineValue }} h
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

        <template v-else-if="sums">
          <UAlert
            v-if="progress && !isMonthlyBilling"
            class="mt-6"
            :color="summaryColor"
            variant="soft"
            :icon="summaryIcon"
            :title="summaryHeadline"
            :description="summaryBody"
          />

          <div v-if="!isMonthlyBilling" class="mt-6 space-y-3">
            <div v-if="progress?.status !== 'no_budget'">
              <div class="flex justify-between text-xs mb-1">
                <span class="font-medium">Budget verbraucht</span>
                <span :class="`text-${budgetColor} font-medium`">
                  {{ sums.totalUsedPercentage }} %
                  <span class="text-muted font-normal">
                    ({{ sums.totalUsedHours }} h / {{ sums.totalTopUps }} h)
                  </span>
                </span>
              </div>
              <UProgress
                :model-value="Math.min(100, sums.totalUsedPercentage)"
                size="lg"
                :color="budgetColor"
              />
            </div>

            <div v-else>
              <div class="flex justify-between text-xs mb-1">
                <span class="font-medium">Verbrauchte Stunden</span>
                <span class="text-warning font-medium">
                  {{ sums.totalUsedHours }} h
                  <span class="text-muted font-normal">
                    (werden separat verrechnet)
                  </span>
                </span>
              </div>
            </div>

            <div v-if="progress">
              <div class="flex justify-between text-xs mb-1">
                <span class="font-medium">Zeit vergangen</span>
                <span class="font-medium text-muted">
                  {{ Math.round(progress.timeElapsedPercent) }} %
                  <span class="ml-1">
                    ({{ progress.daysElapsed }} /
                    {{ progress.periodDurationDays }} Tagen)
                  </span>
                </span>
              </div>
              <UProgress
                :model-value="Math.round(progress.timeElapsedPercent)"
                size="lg"
                color="neutral"
              />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
            <div>
              <div class="font-bold pb-2">
                {{
                  isMonthlyBilling
                    ? 'Berechnung Aktuell zu verrechnen'
                    : 'Berechnung Verfügbares Budget'
                }}
              </div>
              <div class="flex text-sm">
                <div class="flex-1">
                  <p>Zahlungen / Top-Ups</p>
                  <p>Arbeitsprotokoll</p>
                  <p class="border-b">Manuelle Korrekturen</p>
                  <p class="font-bold pt-1">
                    {{ isMonthlyBilling ? 'Saldo' : 'Verfügbar' }}
                  </p>
                </div>
                <div class="text-right">
                  <p>{{ sums.totalTopUps }} h</p>
                  <p>- {{ sums.billableHours }} h</p>
                  <p class="border-b">
                    {{
                      sums.totalManualWorkHours < 0
                        ? `+ ${sums.totalManualWorkHours * -1}`
                        : `- ${sums.totalManualWorkHours}`
                    }}
                    h
                  </p>
                  <p class="font-bold pt-1">{{ sums.totalAvailableHours }} h</p>
                </div>
              </div>
            </div>

            <div v-if="progress && !isMonthlyBilling">
              <div class="font-bold pb-2">Budget vs. Zeit</div>
              <div class="flex text-sm">
                <div class="flex-1">
                  <p>Budget verbraucht</p>
                  <p>Zeit vergangen</p>
                  <p class="border-b">Differenz</p>
                  <p>Verbleibende Tage</p>
                </div>
                <div class="text-right">
                  <p>{{ Math.round(progress.budgetUsedPercent) }} %</p>
                  <p>{{ Math.round(progress.timeElapsedPercent) }} %</p>
                  <p class="border-b">
                    {{ progress.deltaPercent > 0 ? '+' : ''
                    }}{{ Math.round(progress.deltaPercent) }} %
                  </p>
                  <p>
                    {{ progress.daysRemaining }} /
                    {{ progress.periodDurationDays }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="userStore.amIAdministrator() && clientPeriodId"
            class="flex justify-center w-full pt-8"
          >
            <UButton
              :to="`/${clientPeriodId}/create-bexio-invoice?hours=${(sums.totalAvailableHours || 0) * -1}`"
              variant="outline"
              icon="material-symbols:add-notes"
            >
              Bexio-Rechnung generieren
            </UButton>
          </div>
        </template>
      </template>
    </UPageCard>
  </div>
</template>
