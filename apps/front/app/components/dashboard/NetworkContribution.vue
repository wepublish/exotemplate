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
        firstError?.message || err?.message || 'Unbekannter Fehler'
      )
    }
  })

  const formattedPeriod = computed(() => {
    if (!props.periodFrom || !props.periodTo) return ''
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString('de-CH', { dateStyle: 'medium' })
    return `${fmt(props.periodFrom)} – ${fmt(props.periodTo)}`
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
        label: 'Entwicklung & Wartung',
        hours: toFullHours(c.weShare.engineering),
        icon: 'material-symbols:code-rounded',
        description:
          'Neue Features, Software-Wartung, Deployments, Reviews und Bugfixes — out of the box für alle.'
      },
      {
        key: 'hosting',
        label: 'Hosting & Infrastruktur',
        hours: toFullHours(c.weShare.hosting),
        icon: 'material-symbols:cloud-outline',
        description:
          'Schnelles, europäisches Hosting, Monitoring und schnelle Reaktion bei Ausfällen.'
      },
      {
        key: 'acquisition',
        label: 'Akquise',
        hours: toFullHours(c.weShare.acquisition),
        icon: 'material-symbols:handshake-outline-rounded',
        description:
          'Neue Medien fürs Netzwerk gewinnen — und so die Gesamtkosten auf mehr Schultern verteilen.'
      },
      {
        key: 'weshare-other',
        label: 'Weiteres aus We.Share',
        hours: toFullHours(c.weShare.other),
        icon: 'material-symbols:more-horiz',
        description:
          'Übrige we.share-Arbeiten — z. B. Austausch mit den Medien, automatisierte Testings verbessern usw.'
      },
      {
        key: 'wepublish-internal',
        label: 'We.Publish intern',
        hours: toFullHours(c.wepublishInternal.hours),
        icon: 'material-symbols:account-balance-outline-rounded',
        description:
          'Interne Arbeit der Stiftung — Finanzen, HR, Fundraising, Administration, Kommunikation, Marketing, Entwicklung neuer Produkte (z.B. FaaS, Co-Journalist), Netzwerkpflege usw.'
      },
      {
        key: 'other-media',
        label: 'Andere Medien im Netzwerk',
        hours: toFullHours(c.otherClients.hours),
        icon: 'material-symbols:groups-outline-rounded',
        description: `Was wir für ${c.otherClients.clientCount} andere Medien bauen, hilft auch dir: neue Features, Designs und Verbesserungen fliessen ins ganze Netzwerk zurück.`
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
            :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="text-xl shrink-0 group-hover:text-primary transition-colors"
          />
          <div class="min-w-0">
            <div class="font-bold group-hover:text-primary transition-colors">
              Wir entwickeln gemeinsam den Journalismus der Zukunft!
            </div>
            <div v-if="formattedPeriod" class="text-xs text-muted mt-0.5">
              {{ formattedPeriod }}
            </div>
          </div>
        </button>
        <div class="font-bold text-4xl text-primary whitespace-nowrap">
          {{ grandTotalHours }} h
        </div>
      </div>

      <div class="flex justify-between gap-8">
        <div class="w-1/2 text-sm">
          <!-- Short benefits-focused intro -->
          <p>
            We.Publish ist weit mehr als eine technische Lösung.
            <b
              >Zusammen bilden wir das stärkste Netzwerk unabhängiger und
              innovativer Medien.</b
            >
          </p>
          <p class="pt-2">
            Mit deiner Investition in We.Publish wirst Du Teil eines Netzwerks,
            das gemeinsam in Innovation, Wissenstransfer und die
            Weiterentwicklung des Journalismus investiert.
          </p>
          <p class="pt-2">
            Davon profitiert auch dein Medium direkt: durch laufend verbesserte
            Infrastruktur, neue Features, Austausch mit anderen Publishern sowie
            ein wachsendes und resilientes Medien-Ökosystem.
          </p>
          <p class="text-sm pt-2">
            Gemeinsam getragen von allen Medien im Netzwerk und von der Stiftung
            We.Publish, die sämtliche Stiftungsfördermittel direkt an alle
            Netzwerk-Mitglieder weitergibt.
          </p>
        </div>

        <div v-if="contribution" class="w-1/2">
          <!-- Client share vs. rest of the network -->
          <div
            v-if="networkPlusClientTotal > 0"
            class="rounded-lg border border-default p-3 mb-3 bg-elevated/30"
          >
            <div class="flex justify-between text-sm mb-1">
              <span>
                <span class="font-medium">Dein Beitrag an We.Publish</span>
                <span class="text-muted">
                  · {{ clientHours }} h ({{ clientSharePercent }} %)
                </span>
              </span>
              <span class="text-muted">
                Übriges Netzwerk · {{ grandTotalHours }} h ({{
                  100 - clientSharePercent
                }}
                %)
              </span>
            </div>
            <UProgress
              :model-value="clientSharePercent"
              size="xl"
              color="primary"
            />
            <p class="text-xs text-muted mt-2 leading-snug">
              So viel von der gesamten We.Publish-Arbeit hast du in dieser
              Periode beigetragen — und so viel kommt dir zusätzlich aus dem
              Netzwerk zugute.
            </p>
          </div>
        </div>
      </div>

      <USkeleton v-if="pending && !hasData" class="h-32" />

      <UAlert
        v-else-if="error"
        title="Beim Abrufen der Netzwerk-Daten ist ein Fehler aufgetreten."
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
                {{ tile.hours }} h
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
            expanded ? 'Details ausblenden' : 'Details anzeigen'
          }}</span>
          <UIcon
            :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="ml-1"
          />
        </button>
      </template>
    </template>
  </UPageCard>
</template>
