<script lang="ts" setup>
  import type {
    InfraEnvironmentKey,
    InfraMediumConfig
  } from '~/utils/infraConfig'

  const userStore = useUserStore()
  const { t } = useI18n()
  const { formatDateTime } = useFormatters()
  const link = useClientPeriodLink()

  const isAdmin = userStore.amIAdministrator()
  const config = isAdmin ? await useInfrastructureConfig() : null

  const mediumNames = computed<string[]>(() => config?.mediumNames.value ?? [])
  const media = computed<Record<string, InfraMediumConfig>>(
    () => config?.media.value ?? {}
  )
  const pending = computed<boolean>(() => !!config?.pending.value)
  const error = computed<Error | null>(
    () => (config?.error.value as Error | null) ?? null
  )
  const fetchedAt = computed<string | null>(
    () => config?.fetchedAt.value ?? null
  )

  // Default the medium to the currently-selected client's medium_name when it's
  // among the configured media, otherwise the first medium.
  const selection = useClientSelection()
  const { selectedClient } = storeToRefs(selection)

  const selectedMedium = ref<string>('')
  watch(
    [mediumNames, selectedClient],
    () => {
      if (
        selectedMedium.value &&
        mediumNames.value.includes(selectedMedium.value)
      ) {
        return
      }
      const preferred = selectedClient.value?.medium_name ?? ''
      selectedMedium.value = mediumNames.value.includes(preferred)
        ? preferred
        : (mediumNames.value[0] ?? '')
    },
    { immediate: true }
  )

  const mediumOptions = computed(() =>
    mediumNames.value.map((m) => ({ value: m, label: m }))
  )

  const currentMedium = computed<InfraMediumConfig | undefined>(
    () => media.value[selectedMedium.value]
  )

  const availableEnvs = computed<InfraEnvironmentKey[]>(() => {
    const envs: InfraEnvironmentKey[] = []
    if (currentMedium.value?.production) envs.push('production')
    if (currentMedium.value?.staging) envs.push('staging')
    return envs
  })

  const selectedEnv = ref<InfraEnvironmentKey>('production')
  watch(
    availableEnvs,
    (envs) => {
      if (!envs.includes(selectedEnv.value)) {
        selectedEnv.value = envs[0] ?? 'production'
      }
    },
    { immediate: true }
  )

  const currentEnvConfig = computed(
    () => currentMedium.value?.[selectedEnv.value]
  )
</script>

<template>
  <div class="p-4 sm:p-6">
    <!-- Access denied for non-admins -->
    <div v-if="!isAdmin" class="flex justify-center pt-16">
      <UPageCard class="max-w-md w-full">
        <template #header>
          <div class="flex items-center gap-3">
            <UIcon name="lucide:lock" class="text-3xl text-error" />
            <p class="font-bold text-lg">
              {{ t('common.accessDenied.title') }}
            </p>
          </div>
        </template>
        <UAlert
          color="error"
          variant="soft"
          icon="lucide:user-x"
          :title="t('common.accessDenied.title')"
          :description="t('common.accessDenied.body')"
        />
      </UPageCard>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <h1 class="text-2xl font-bold">{{ t('infrastructure.title') }}</h1>
          <p class="text-muted text-sm">{{ t('infrastructure.subtitle') }}</p>
          <p v-if="fetchedAt" class="text-xs text-muted mt-0.5">
            {{
              t('infrastructure.fetchedAt', { time: formatDateTime(fetchedAt) })
            }}
          </p>
        </div>
        <div class="flex items-end gap-2">
          <USelectMenu
            v-model="selectedMedium"
            :items="mediumOptions"
            value-key="value"
            label-key="label"
            :search-input="{ placeholder: t('infrastructure.mediumLabel') }"
            class="w-56"
          />
          <UButton
            v-if="selectedMedium"
            :to="link(`/infrastructure/raw?medium=${selectedMedium}`)"
            icon="lucide:code"
            variant="outline"
            color="neutral"
          >
            {{ t('infrastructure.rawButton') }}
          </UButton>
        </div>
      </div>

      <USkeleton v-if="pending" class="h-64" />

      <UAlert
        v-else-if="error"
        color="error"
        variant="soft"
        icon="lucide:triangle-alert"
        :title="t('infrastructure.loadError')"
        :description="error.message"
      />

      <UAlert
        v-else-if="!mediumNames.length"
        color="info"
        variant="soft"
        icon="lucide:info"
        :title="t('infrastructure.empty')"
      />

      <template v-else>
        <!-- Environment switch (only envs that exist for this medium) -->
        <div v-if="availableEnvs.length" class="flex gap-2 mb-4">
          <UButton
            v-for="envKey in availableEnvs"
            :key="envKey"
            :variant="selectedEnv === envKey ? 'solid' : 'outline'"
            :color="selectedEnv === envKey ? 'primary' : 'neutral'"
            size="sm"
            @click="selectedEnv = envKey"
          >
            {{ t(`monitoring.environment.${envKey}`) }}
          </UButton>
        </div>

        <InfrastructureConfigView
          v-if="currentEnvConfig"
          :env="currentEnvConfig"
        />
        <UAlert
          v-else
          color="info"
          variant="soft"
          icon="lucide:info"
          :title="t('infrastructure.noEnvironment')"
        />
      </template>
    </template>
  </div>
</template>
