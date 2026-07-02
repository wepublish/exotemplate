<script lang="ts" setup>
  import type { AppLocale, BillingMode, Client } from '~~/types/DirectusTypes'

  const userStore = useUserStore()
  const toast = useToast()
  const { t } = useI18n()
  const link = useClientPeriodLink()
  const {
    setPause,
    setWeeklyReportPause,
    setBillingMode,
    setClientLanguage,
    setMediumName
  } = useJiraWarnings()

  // Settings are per-client. The client to configure is the one in the URL
  // (`/:clientPeriodId/settings`); we render just that one (plus the user-global
  // "Mein Konto" card, which is account-wide and always shown).
  const selection = useClientSelection()
  const { selectedClient, clients } = storeToRefs(selection)

  // Global #we-share Slack channel (admin-only edit). Read on mount so the
  // admin field shows the current value; the value is shared app-wide.
  const { weShareChannelId, loadSettings, updateWeShareChannelId } =
    useSettings()
  const weShareDraft = ref('')
  const savingWeShare = ref(false)
  onMounted(() => {
    loadSettings()
  })
  watch(
    weShareChannelId,
    (value) => {
      weShareDraft.value = value ?? ''
    },
    { immediate: true }
  )

  async function onSaveWeShare(): Promise<void> {
    savingWeShare.value = true
    try {
      await updateWeShareChannelId(weShareDraft.value)
      toast.add({ title: t('settings.globalSettings.saved'), color: 'success' })
    } catch (err) {
      toast.add({
        title: t('common.actionFailed'),
        description: err instanceof Error ? err.message : undefined,
        color: 'error'
      })
    } finally {
      savingWeShare.value = false
    }
  }

  // Single-item list so the per-client card markup (and its non-null `client`)
  // stays identical to the previous multi-client layout.
  const selectedClients = computed<Client[]>(() =>
    selectedClient.value ? [selectedClient.value] : []
  )

  const BILLING_MODE_OPTIONS = computed<
    { value: BillingMode; label: string }[]
  >(() => [
    { value: 'prepaid', label: t('common.billingMode.prepaid') },
    { value: 'monthly', label: t('common.billingMode.monthly') }
  ])

  const LANGUAGE_OPTIONS = computed<{ value: AppLocale; label: string }[]>(
    () => [
      { value: 'de', label: t('nav.language.de') },
      { value: 'fr', label: t('nav.language.fr') },
      { value: 'en', label: t('nav.language.en') }
    ]
  )

  function billingModeLabel(mode: BillingMode | null | undefined): string {
    return (
      BILLING_MODE_OPTIONS.value.find((o) => o.value === mode)?.label ??
      t('common.billingMode.prepaid')
    )
  }

  const pendingClientIds = ref<Set<string>>(new Set())

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
        userStore.patchClient(client.id, { notifications_paused: paused })
        toast.add({
          title: paused
            ? t('settings.jiraWarnings.muted', { client: client.name })
            : t('settings.jiraWarnings.enabled', { client: client.name }),
          color: 'success'
        })
      } catch (err) {
        toast.add({
          title: t('common.actionFailed'),
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
        userStore.patchClient(client.id, { weekly_report_paused: paused })
        toast.add({
          title: paused
            ? t('settings.weeklyReport.muted', { client: client.name })
            : t('settings.weeklyReport.enabled', { client: client.name }),
          color: 'success'
        })
      } catch (err) {
        toast.add({
          title: t('common.actionFailed'),
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
        userStore.patchClient(client.id, { billing_mode: mode })
        toast.add({
          title: t('settings.billingMode.updated', { client: client.name }),
          description: billingModeLabel(mode),
          color: 'success'
        })
      } catch (err) {
        toast.add({
          title: t('common.actionFailed'),
          description: err instanceof Error ? err.message : undefined,
          color: 'error'
        })
      }
    })
  }

  // Draft per client for the admin-only Medium-Name field (saved explicitly via
  // a button, unlike the toggles/selects which persist on change).
  const mediumNameDrafts = ref<Record<string, string>>({})
  watch(
    selectedClients,
    (list) => {
      for (const c of list) {
        if (!(c.id in mediumNameDrafts.value)) {
          mediumNameDrafts.value[c.id] = c.medium_name ?? ''
        }
      }
    },
    { immediate: true }
  )

  async function onSaveMediumName(client: Client): Promise<void> {
    const value = (mediumNameDrafts.value[client.id] ?? '').trim()
    await withPending(client.id, async () => {
      try {
        await setMediumName(client.id, value)
        userStore.patchClient(client.id, {
          medium_name: value === '' ? null : value
        })
        toast.add({
          title: t('settings.mediumName.saved', { client: client.name }),
          color: 'success'
        })
      } catch (err) {
        toast.add({
          title: t('common.actionFailed'),
          description: err instanceof Error ? err.message : undefined,
          color: 'error'
        })
      }
    })
  }

  async function onChangeLanguage(
    client: Client,
    language: AppLocale
  ): Promise<void> {
    await withPending(client.id, async () => {
      try {
        await setClientLanguage(client.id, language)
        userStore.patchClient(client.id, { language })
        toast.add({
          title: t('settings.language.clientUpdated', { client: client.name }),
          color: 'success'
        })
      } catch (err) {
        toast.add({
          title: t('common.actionFailed'),
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
      <div class="mb-2">
        <h1 class="text-2xl font-bold">{{ t('settings.title') }}</h1>
        <p class="text-muted text-sm">
          {{ t('settings.subtitle') }}
        </p>
      </div>
    </div>

    <div class="col-span-12">
      <UPageCard>
        <template #header>
          <div class="flex items-center gap-3 min-w-0">
            <UIcon
              name="lucide:user-cog"
              class="text-2xl shrink-0 text-muted"
            />
            <div class="min-w-0">
              <p class="font-semibold">Mein Konto</p>
              <p class="text-xs text-muted">
                Ändere hier dein Passwort. Zur Sicherheit musst du dein
                aktuelles Passwort bestätigen.
              </p>
            </div>
          </div>
        </template>
        <AccountPasswordChangeForm />
      </UPageCard>
    </div>

    <!-- Global settings (admin-only): the network-wide #we-share Slack channel
         linked from every client's dashboard quick-links tile. -->
    <div v-if="userStore.amIAdministrator()" class="col-span-12">
      <UPageCard>
        <template #header>
          <div class="flex items-center gap-3 min-w-0">
            <UIcon
              name="lucide:settings-2"
              class="text-2xl shrink-0 text-muted"
            />
            <div class="min-w-0">
              <p class="font-semibold">
                {{ t('settings.globalSettings.title') }}
              </p>
              <p class="text-xs text-muted">
                {{ t('settings.globalSettings.subtitle') }}
              </p>
            </div>
          </div>
        </template>
        <div class="flex flex-col gap-3">
          <UFormField
            :label="t('settings.globalSettings.weShareLabel')"
            :help="t('settings.globalSettings.weShareDescription')"
          >
            <div class="flex items-start gap-2">
              <UInput
                v-model="weShareDraft"
                placeholder="C0AB12CD3EF"
                class="w-full sm:w-80"
              />
              <UButton
                icon="lucide:save"
                color="primary"
                :loading="savingWeShare"
                @click="onSaveWeShare"
              >
                {{ t('common.save') }}
              </UButton>
            </div>
          </UFormField>
        </div>
      </UPageCard>
    </div>

    <div v-if="!clients.length" class="col-span-12">
      <UPageCard>
        <template #body>
          <div class="flex items-center gap-3 text-sm text-muted">
            <UIcon name="lucide:info" class="text-2xl text-muted" />
            {{ t('settings.noClients') }}
          </div>
        </template>
      </UPageCard>
    </div>

    <!-- Per-client settings, grouped into topical tiles (2 columns on desktop) -->
    <template v-for="client in selectedClients" :key="client.id">
      <div class="col-span-12">
        <h2 class="flex items-center gap-2 text-lg font-semibold pt-2">
          <UIcon name="lucide:building-2" class="text-muted shrink-0" />
          {{ t('settings.forClient', { client: client.name }) }}
        </h2>
      </div>

      <div
        class="col-span-12 grid grid-cols-1 md:grid-cols-2 gap-4 items-start"
      >
        <!-- Vertrag -->
        <UPageCard>
          <template #header>
            <div class="flex items-center gap-3 min-w-0">
              <UIcon
                name="lucide:scroll-text"
                class="text-2xl shrink-0 text-muted"
              />
              <p class="font-semibold truncate">
                {{ t('settings.contract.label') }}
              </p>
            </div>
          </template>
          <div class="flex flex-col gap-3">
            <p class="text-sm text-muted">
              {{ t('settings.contract.description') }}
            </p>
            <div>
              <UButton
                :to="link(`/settings/contracts/${client.id}`)"
                icon="lucide:file-text"
                variant="outline"
                color="primary"
              >
                {{ t('settings.contract.manage') }}
              </UButton>
            </div>
          </div>
        </UPageCard>

        <!-- Abrechnung -->
        <UPageCard>
          <template #header>
            <div class="flex items-center gap-3 min-w-0">
              <UIcon
                name="lucide:receipt-text"
                class="text-2xl shrink-0 text-muted"
              />
              <p class="font-semibold truncate">
                {{ t('settings.billingMode.label') }}
              </p>
            </div>
          </template>
          <div class="flex flex-col gap-3">
            <p class="text-sm text-muted">
              {{ t('settings.billingMode.description') }}
            </p>
            <div>
              <USelectMenu
                v-if="userStore.amIAdministrator()"
                :model-value="client.billing_mode ?? 'prepaid'"
                :items="BILLING_MODE_OPTIONS"
                value-key="value"
                label-key="label"
                :loading="pendingClientIds.has(client.id)"
                class="w-full sm:w-60"
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
          </div>
        </UPageCard>

        <!-- Benachrichtigungen (Slack: Jira-Warnungen + Wochenbericht) -->
        <UPageCard>
          <template #header>
            <div class="flex items-center gap-3 min-w-0">
              <UIcon name="lucide:bell" class="text-2xl shrink-0 text-muted" />
              <p class="font-semibold truncate">
                {{ t('settings.notifications.title') }}
              </p>
            </div>
          </template>
          <ul class="divide-y">
            <li
              class="py-3 first:pt-0 flex items-start justify-between gap-4 flex-wrap"
            >
              <div class="min-w-0">
                <p class="font-medium">
                  {{ t('settings.jiraWarnings.label') }}
                </p>
                <p class="text-xs text-muted">
                  {{ t('settings.jiraWarnings.description') }}
                </p>
                <UButton
                  :to="link('/info/thresholds')"
                  variant="outline"
                  color="neutral"
                  size="sm"
                  icon="lucide:info"
                  class="mt-2"
                >
                  {{ t('settings.jiraWarnings.howThresholds') }}
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
                  {{
                    client.notifications_paused
                      ? t('common.off')
                      : t('common.on')
                  }}
                </span>
              </div>
            </li>

            <li
              class="py-3 last:pb-0 flex items-start justify-between gap-4 flex-wrap"
            >
              <div class="min-w-0">
                <p class="font-medium">
                  {{ t('settings.weeklyReport.label') }}
                </p>
                <p class="text-xs text-muted">
                  {{ t('settings.weeklyReport.description') }}
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
                  {{
                    client.weekly_report_paused
                      ? t('common.off')
                      : t('common.on')
                  }}
                </span>
              </div>
            </li>
          </ul>
        </UPageCard>

        <!-- Sprache -->
        <UPageCard>
          <template #header>
            <div class="flex items-center gap-3 min-w-0">
              <UIcon
                name="lucide:languages"
                class="text-2xl shrink-0 text-muted"
              />
              <p class="font-semibold truncate">
                {{ t('settings.language.label') }}
              </p>
            </div>
          </template>
          <div class="flex flex-col gap-3">
            <p class="text-sm text-muted">
              {{ t('settings.language.description') }}
            </p>
            <div>
              <USelectMenu
                :model-value="client.language ?? 'de'"
                :items="LANGUAGE_OPTIONS"
                value-key="value"
                label-key="label"
                :loading="pendingClientIds.has(client.id)"
                class="w-full sm:w-60"
                @update:model-value="
                  (value: AppLocale) => onChangeLanguage(client, value)
                "
              />
            </div>
          </div>
        </UPageCard>

        <!-- Medium-Name (admin-only): the Terraform identifier that maps this
             client to its uptime monitor. Guarded with a warning because a
             wrong value silently shows the wrong (or no) monitor. -->
        <UPageCard v-if="userStore.amIAdministrator()">
          <template #header>
            <div class="flex items-center gap-3 min-w-0">
              <UIcon
                name="lucide:radio-tower"
                class="text-2xl shrink-0 text-muted"
              />
              <p class="font-semibold truncate">
                {{ t('settings.mediumName.label') }}
              </p>
            </div>
          </template>
          <div class="flex flex-col gap-3">
            <p class="text-sm text-muted">
              {{ t('settings.mediumName.description') }}
            </p>
            <UAlert
              color="warning"
              variant="soft"
              icon="lucide:triangle-alert"
              :title="t('settings.mediumName.warning.title')"
              :description="t('settings.mediumName.warning.body')"
            />
            <UFormField :help="t('settings.mediumName.hint')">
              <div class="flex items-start gap-2">
                <UInput
                  v-model="mediumNameDrafts[client.id]"
                  placeholder="z. B. bajour"
                  class="w-full sm:w-60"
                />
                <UButton
                  icon="lucide:save"
                  color="primary"
                  :loading="pendingClientIds.has(client.id)"
                  @click="onSaveMediumName(client)"
                >
                  {{ t('common.save') }}
                </UButton>
              </div>
            </UFormField>
          </div>
        </UPageCard>

        <!-- Links: editor/website overrides + custom quick-access links. -->
        <SettingsLinksCard :key="client.id" :client="client" />
      </div>
    </template>
  </div>
</template>
