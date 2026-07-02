<script lang="ts" setup>
  /**
   * Surfaces the network-wide effort We.Publish delivers without billing it
   * directly to the selected client. Two sources, fetched from the
   * `/networkContribution` endpoint for the selected period's date range:
   *
   *  1. Hours logged on the we.share Clockodo customer — split into
   *     Akquisition / Engineering / Hosting / Weiteres so the four numbers
   *     always sum to the total.
   *  2. Hours delivered to all other media organisations in the network
   *     (excluding we.share, We.Publish Foundation, One Test).
   *
   * The component is purely informational — no inputs other than the period.
   */

  import ClientId from '~/pages/onboarding/[clientId].vue'
  import type { Sums } from '~~/types/ClockodoTypes'

  const props = defineProps<{
    clientPeriodId: number | undefined
    periodFrom: string | undefined
    periodTo: string | undefined
    /**
     * Billable totals from `aggregatedHours` for the same client+period.
     * Used to compute the client's share of the network total.
     */
    sums: Sums | undefined
  }>()

  interface WeShareBreakdown {
    acquisition: number
    engineering: number
    hosting: number
    other: number
    total: number
  }

  interface WepublishInternalBreakdown {
    hours: number
  }

  interface OtherClientsBreakdown {
    hours: number
    clientCount: number
  }

  interface NetworkContributionData {
    weShare: WeShareBreakdown
    wepublishInternal: WepublishInternalBreakdown
    otherClients: OtherClientsBreakdown
  }

  interface NetworkContributionResponse {
    data: NetworkContributionData
    cache: {
      hit: boolean
      cachedAt: number
      expiresAt: number
      ttlMs: number
    }
  }

  const { getCustomEndpoint } = useDirectus()
  const { t } = useI18n()
  const { formatHours, formatDate } = useFormatters()

  const dataLoaderKey = computed<string>(
    () => `networkContribution-${props.clientPeriodId}`
  )

  const {
    data: contribution,
    pending,
    error
  } = await useAsyncData(dataLoaderKey, async () => {
    if (!props.clientPeriodId) return undefined
    try {
      const response = await getCustomEndpoint('networkContribution', {
        clientPeriodId: props.clientPeriodId
      })
      const body = response.data as NetworkContributionResponse
      return body.data
    } catch (err: any) {
      const firstError = err?.response?.data?.errors?.[0]
      throw new Error(
        firstError?.message || err?.message || t('common.unexpectedError')
      )
    }
  })

  const formattedPeriod = computed(() => {
    if (!props.periodFrom || !props.periodTo) return ''
    return `${formatDate(props.periodFrom)} – ${formatDate(props.periodTo)}`
  })

  // Display rule: round to whole hours in the UI even though the API returns
  // quarter-hour precision. Keeps the dashboard readable and matches how the
  // user reads "Mehrwert" — they care about magnitudes, not 0.25h slivers.
  function toFullHours(hours: number | undefined): number {
    return Math.round(hours ?? 0)
  }

  // Sum of every figure shown in the panel — keeps the headline number
  // honest with the tiles below it. Includes the "Weiteres" we.share bucket
  // and the we.publish-internal tile, both of which are surfaced explicitly.
  const grandTotalHours = computed<number>(() => {
    const c = contribution.value
    if (!c) return 0
    return toFullHours(
      c.weShare.total + c.wepublishInternal.hours + c.otherClients.hours
    )
  })

  // The client's own billable hours from this period (Arbeitsprotokoll),
  // capped at the period's top-up budget. Surfaced next to the grand total
  // so the client sees what share of the team's overall output went to
  // their project — and conversely how much network/other-media work
  // co-existed with theirs.
  //
  // Why the cap: a client's contribution shouldn't exceed what they've
  // actually paid for. If billable runs over the top-ups, the surplus is
  // unbilled work and doesn't represent additional contribution to
  // We.Publish — only the budgeted portion does.
  const clientHours = computed<number>(() => {
    const billable = props.sums?.billableHours ?? 0
    const budget = props.sums?.totalTopUps ?? 0
    return toFullHours(Math.min(billable, budget))
  })

  const networkPlusClientTotal = computed<number>(
    () => grandTotalHours.value + clientHours.value
  )

  const clientSharePercent = computed<number>(() => {
    const total = networkPlusClientTotal.value
    if (total <= 0) return 0
    return Math.round((clientHours.value * 100) / total)
  })

  interface Tile {
    key: string
    label: string
    hours: number
    icon: string
    description: string
  }

  const tiles = computed<Tile[]>(() => {
    const c = contribution.value
    if (!c) return []
    return [
      {
        key: 'engineering',
        label: t('networkContribution.tiles.engineering.label'),
        hours: toFullHours(c.weShare.engineering),
        icon: 'lucide:code',
        description: t('networkContribution.tiles.engineering.description')
      },
      {
        key: 'hosting',
        label: t('networkContribution.tiles.hosting.label'),
        hours: toFullHours(c.weShare.hosting),
        icon: 'lucide:cloud',
        description: t('networkContribution.tiles.hosting.description')
      },
      {
        key: 'acquisition',
        label: t('networkContribution.tiles.acquisition.label'),
        hours: toFullHours(c.weShare.acquisition),
        icon: 'lucide:handshake',
        description: t('networkContribution.tiles.acquisition.description')
      },
      {
        key: 'weshare-other',
        label: t('networkContribution.tiles.weshareOther.label'),
        hours: toFullHours(c.weShare.other),
        icon: 'lucide:ellipsis',
        description: t('networkContribution.tiles.weshareOther.description')
      },
      {
        key: 'wepublish-internal',
        label: t('networkContribution.tiles.wepublishInternal.label'),
        hours: toFullHours(c.wepublishInternal.hours),
        icon: 'lucide:landmark',
        description: t(
          'networkContribution.tiles.wepublishInternal.description'
        )
      },
      {
        key: 'other-media',
        label: t('networkContribution.tiles.otherMedia.label'),
        hours: toFullHours(c.otherClients.hours),
        icon: 'lucide:users',
        description: t('networkContribution.tiles.otherMedia.description', {
          count: c.otherClients.clientCount
        })
      }
    ]
  })

  const hasData = computed<boolean>(() => !!contribution.value)

  // Collapsed by default — header + intro + contribution bar are visible,
  // tiles are hidden until the user expands the card.
  const expanded = ref<boolean>(false)
</script>

<template>
  <UPageCard>
    <template #default>
      <!-- Header: title + grand total + expand toggle -->
      <div class="flex justify-between items-start w-full gap-4">
        <button
          type="button"
          class="flex items-center gap-2 text-left cursor-pointer group min-w-0"
          :aria-expanded="expanded"
          aria-controls="network-contribution-tiles"
          @click="expanded = !expanded"
        >
          <UIcon
            :name="expanded ? 'lucide:chevron-up' : 'lucide:chevron-down'"
            class="text-xl shrink-0 group-hover:text-primary transition-colors"
          />
          <div class="min-w-0">
            <div class="font-bold group-hover:text-primary transition-colors">
              {{ t('networkContribution.header.title') }}
            </div>
            <div v-if="formattedPeriod" class="text-xs text-muted mt-0.5">
              {{ formattedPeriod }}
            </div>
          </div>
        </button>
        <div class="font-bold text-4xl text-primary whitespace-nowrap">
          {{ formatHours(grandTotalHours) }}
        </div>
      </div>

      <div class="flex justify-between gap-8">
        <div class="w-1/2 text-sm">
          <!-- Short benefits-focused intro -->
          <p v-html="t('networkContribution.intro.p1')" />
          <p class="pt-2">{{ t('networkContribution.intro.p2') }}</p>
          <p class="pt-2">{{ t('networkContribution.intro.p3') }}</p>
          <p class="text-sm pt-2">{{ t('networkContribution.intro.p4') }}</p>
        </div>

        <div v-if="contribution" class="w-1/2">
          <!-- Client share vs. rest of the network -->
          <div
            v-if="networkPlusClientTotal > 0"
            class="rounded-lg border border-default p-3 mb-3 bg-elevated/30"
          >
            <div class="flex justify-between text-sm mb-1">
              <span>
                <span class="font-medium">{{
                  t('networkContribution.contributionBar.label')
                }}</span>
              </span>
            </div>
            <UProgress
              :model-value="clientSharePercent"
              size="xl"
              color="primary"
            />
            <p class="text-xs text-muted mt-2 leading-snug">
              {{
                t('networkContribution.contributionBar.caption', {
                  count: contribution.otherClients.clientCount
                })
              }}
            </p>
          </div>
        </div>
      </div>

      <USkeleton v-if="pending && !hasData" class="h-32" />

      <UAlert
        v-else-if="error"
        :title="t('networkContribution.error.title')"
        :description="error.message"
        color="error"
        variant="soft"
        icon="i-heroicons-exclamation-triangle"
      />

      <template v-else-if="contribution">
        <!-- Tiles: we.share buckets, we.publish intern, andere Medien.
             Hidden until the user expands the card so the dashboard stays
             scannable; the header + contribution bar above are always
             visible. -->
        <div
          v-show="expanded"
          id="network-contribution-tiles"
          class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3 mt-10"
        >
          <div
            v-for="tile in tiles"
            :key="tile.key"
            class="rounded-lg border border-default p-4 flex flex-col gap-2 bg-elevated/30"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <UIcon :name="tile.icon" class="text-primary text-xl" />
                <div class="font-medium">{{ tile.label }}</div>
              </div>
              <div class="font-bold text-2xl text-primary whitespace-nowrap">
                {{ formatHours(tile.hours) }}
              </div>
            </div>
            <p class="text-xs text-muted leading-snug">
              {{ tile.description }}
            </p>
          </div>
        </div>

        <!-- Footer toggle: matches the "Details anzeigen" affordance on the
             SummaryCard tiles so users have a consistent expansion cue. -->
        <button
          type="button"
          class="flex justify-end items-center text-xs text-muted mt-2 w-full cursor-pointer group hover:text-primary transition-colors"
          :aria-expanded="expanded"
          aria-controls="network-contribution-tiles"
          @click="expanded = !expanded"
        >
          <span>{{
            expanded
              ? t('networkContribution.footer.hideDetails')
              : t('networkContribution.footer.showDetails')
          }}</span>
          <UIcon
            :name="expanded ? 'lucide:chevron-up' : 'lucide:chevron-down'"
            class="ml-1"
          />
        </button>
      </template>
    </template>
  </UPageCard>
</template>
