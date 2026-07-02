<script lang="ts" setup>
  import type { InfraMediumConfig } from '~/utils/infraConfig'

  const userStore = useUserStore()
  const { t } = useI18n()
  const route = useRoute()
  const link = useClientPeriodLink()
  const toast = useToast()

  const isAdmin = userStore.amIAdministrator()
  const config = isAdmin ? await useInfrastructureConfig() : null

  const medium = computed<string>(() => String(route.query.medium ?? ''))
  const pending = computed<boolean>(() => !!config?.pending.value)
  const error = computed<Error | null>(
    () => (config?.error.value as Error | null) ?? null
  )
  const mediumConfig = computed<InfraMediumConfig | undefined>(
    () => config?.media.value?.[medium.value]
  )
  const json = computed<string>(() =>
    mediumConfig.value ? JSON.stringify(mediumConfig.value, null, 2) : ''
  )

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(json.value)
      toast.add({ title: t('infrastructure.raw.copied'), color: 'success' })
    } catch (err) {
      toast.add({
        title: t('common.actionFailed'),
        description: err instanceof Error ? err.message : undefined,
        color: 'error'
      })
    }
  }
</script>

<template>
  <div class="p-4 sm:p-6">
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
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 class="text-xl font-bold">
          {{ t('infrastructure.raw.title', { medium }) }}
        </h1>
        <div class="flex gap-2">
          <UButton
            :to="link('/infrastructure')"
            icon="lucide:arrow-left"
            variant="outline"
            color="neutral"
          >
            {{ t('infrastructure.raw.back') }}
          </UButton>
          <UButton v-if="json" icon="lucide:copy" color="primary" @click="copy">
            {{ t('infrastructure.raw.copy') }}
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
        v-else-if="!mediumConfig"
        color="info"
        variant="soft"
        icon="lucide:info"
        :title="t('infrastructure.empty')"
      />

      <UPageCard v-else>
        <pre
          class="text-xs overflow-x-auto whitespace-pre font-mono leading-relaxed"
          >{{ json }}</pre
        >
      </UPageCard>
    </template>
  </div>
</template>
