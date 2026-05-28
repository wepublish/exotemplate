<script lang="ts" setup>
  import type { BillingMode, Client } from '~~/types/DirectusTypes'

  const userStore = useUserStore()
  const toast = useToast()
  const { setPause, setWeeklyReportPause, setBillingMode } = useJiraWarnings()

  const BILLING_MODE_OPTIONS: {
    value: BillingMode
    label: string
  }[] = [
    { value: 'prepaid', label: 'Prepaid (Top-Ups)' },
    { value: 'monthly', label: 'Monatsrechnung' }
  ]

  function billingModeLabel(mode: BillingMode | null | undefined): string {
    return (
      BILLING_MODE_OPTIONS.find((o) => o.value === mode)?.label ??
      'Prepaid (Top-Ups)'
    )
  }

  // Local mirror of the user's clients so we can update toggles
  // optimistically without re-fetching the global user store.
  const clients = ref<Client[]>(
    [...(userStore.clients as Client[])].sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  )

  const search = ref('')
  const pendingClientIds = ref<Set<string>>(new Set())

  const filteredClients = computed<Client[]>(() => {
    const query = search.value.trim().toLowerCase()
    if (!query) return clients.value
    return clients.value.filter((client) =>
      client.name.toLowerCase().includes(query)
    )
  })

  function patchClient(clientId: string, patch: Partial<Client>): void {
    const index = clients.value.findIndex((c) => c.id === clientId)
    if (index === -1) return
    clients.value[index] = { ...clients.value[index], ...patch } as Client
  }

  async function withPending<T>(
    clientId: string,
    op: () => Promise<T>
  ): Promise<T | undefined> {
    pendingClientIds.value.add(clientId)
    try {
      return await op()
    } finally {
      pendingClientIds.value.delete(clientId)
    }
  }

  async function onToggleSlack(
    client: Client,
    enabled: boolean
  ): Promise<void> {
    const paused = !enabled
    await withPending(client.id, async () => {
      try {
        await setPause(client.id, paused)
        patchClient(client.id, { notifications_paused: paused })
        toast.add({
          title: paused
            ? `Jira-Schwellenwarnungen für ${client.name} stummgeschaltet.`
            : `Jira-Schwellenwarnungen für ${client.name} aktiviert.`,
          color: 'success'
        })
      } catch (err) {
        toast.add({
          title: 'Aktion fehlgeschlagen.',
          description: err instanceof Error ? err.message : undefined,
          color: 'error'
        })
      }
    })
  }

  async function onToggleWeekly(
    client: Client,
    enabled: boolean
  ): Promise<void> {
    const paused = !enabled
    await withPending(client.id, async () => {
      try {
        await setWeeklyReportPause(client.id, paused)
        patchClient(client.id, { weekly_report_paused: paused })
        toast.add({
          title: paused
            ? `Wochenbericht für ${client.name} stummgeschaltet.`
            : `Wochenbericht für ${client.name} aktiviert.`,
          color: 'success'
        })
      } catch (err) {
        toast.add({
          title: 'Aktion fehlgeschlagen.',
          description: err instanceof Error ? err.message : undefined,
          color: 'error'
        })
      }
    })
  }

  async function onChangeBillingMode(
    client: Client,
    mode: BillingMode
  ): Promise<void> {
    await withPending(client.id, async () => {
      try {
        await setBillingMode(client.id, mode)
        patchClient(client.id, { billing_mode: mode })
        toast.add({
          title: `Abrechnungsmodell für ${client.name} aktualisiert.`,
          description: billingModeLabel(mode),
          color: 'success'
        })
      } catch (err) {
        toast.add({
          title: 'Aktion fehlgeschlagen.',
          description: err instanceof Error ? err.message : undefined,
          color: 'error'
        })
      }
    })
  }
</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <div class="flex items-start justify-between gap-4 flex-wrap mb-2">
        <div>
          <h1 class="text-2xl font-bold">Einstellungen</h1>
          <p class="text-muted text-sm">
            Steuere pro Kunde, welche Slack-Benachrichtigungen verschickt
            werden. Die Schalter wirken sofort — solange ein Schalter
            ausgeschaltet ist, gehen für diesen Kunden keine entsprechenden
            Slack-Meldungen mehr raus.
          </p>
        </div>
        <UInput
          v-model="search"
          placeholder="Kunde suchen…"
          icon="material-symbols:search-rounded"
          class="min-w-60"
        />
      </div>
    </div>

    <div v-if="!filteredClients.length" class="col-span-12">
      <UPageCard>
        <template #body>
          <div class="flex items-center gap-3 text-sm text-muted">
            <UIcon
              name="material-symbols:info-rounded"
              class="text-2xl text-muted"
            />
            Keine Kunden entsprechen dem Filter.
          </div>
        </template>
      </UPageCard>
    </div>

    <div v-for="client in filteredClients" :key="client.id" class="col-span-12">
      <UPageCard>
        <template #header>
          <div class="flex items-center gap-3 min-w-0">
            <UIcon
              name="material-symbols:apartment-rounded"
              class="text-2xl shrink-0 text-muted"
            />
            <p class="font-semibold truncate">{{ client.name }}</p>
          </div>
        </template>

        <ul class="divide-y">
          <li class="py-3 flex items-start justify-between gap-4 flex-wrap">
            <div class="min-w-0">
              <p class="font-medium">Abrechnungsmodell</p>
              <p class="text-xs text-muted">
                Prepaid = niedrigerer Stundensatz, im Voraus bezahlte Top-Ups.
                Monatsrechnung = höherer Stundensatz, monatliche Abrechnung nach
                Aufwand. Nur Administrator:innen können dieses Modell ändern.
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <USelectMenu
                v-if="userStore.amIAdministrator()"
                :model-value="client.billing_mode ?? 'prepaid'"
                :items="BILLING_MODE_OPTIONS"
                value-key="value"
                label-key="label"
                :loading="pendingClientIds.has(client.id)"
                class="min-w-52"
                @update:model-value="
                  (value: BillingMode) => onChangeBillingMode(client, value)
                "
              />
              <UBadge
                v-else
                :color="
                  (client.billing_mode ?? 'prepaid') === 'monthly'
                    ? 'warning'
                    : 'primary'
                "
                variant="subtle"
              >
                {{ billingModeLabel(client.billing_mode) }}
              </UBadge>
            </div>
          </li>

          <li class="py-3 flex items-start justify-between gap-4 flex-wrap">
            <div class="min-w-0">
              <p class="font-medium">Jira-Schwellenwarnungen</p>
              <p class="text-xs text-muted">
                Wenn ein Jira-Ticket eine konfigurierte Schwelle überschreitet,
                geht eine Slack-Meldung an den Kanal des Kunden. Wird hier
                ausgeschaltet, bleibt der Kanal für diese Warnungen still.
              </p>
              <UButton
                to="/info/thresholds"
                variant="outline"
                color="neutral"
                size="sm"
                icon="material-symbols:info-rounded"
                class="mt-2"
              >
                Wie funktionieren Schwellenwerte?
              </UButton>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <USwitch
                :model-value="!client.notifications_paused"
                :loading="pendingClientIds.has(client.id)"
                @update:model-value="
                  (value: boolean) => onToggleSlack(client, value)
                "
              />
              <span class="text-xs text-muted">
                {{ client.notifications_paused ? 'Aus' : 'An' }}
              </span>
            </div>
          </li>

          <li class="py-3 flex items-start justify-between gap-4 flex-wrap">
            <div class="min-w-0">
              <p class="font-medium">Wochenbericht</p>
              <p class="text-xs text-muted">
                Wöchentliche Zusammenfassung pro Kunden-Slack-Kanal. Ausschalten
                unterdrückt die nächste und alle weiteren Wochenberichte für
                diesen Kunden, bis der Schalter wieder aktiviert wird.
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <USwitch
                :model-value="!client.weekly_report_paused"
                :loading="pendingClientIds.has(client.id)"
                @update:model-value="
                  (value: boolean) => onToggleWeekly(client, value)
                "
              />
              <span class="text-xs text-muted">
                {{ client.weekly_report_paused ? 'Aus' : 'An' }}
              </span>
            </div>
          </li>
        </ul>
      </UPageCard>
    </div>
  </div>
</template>
