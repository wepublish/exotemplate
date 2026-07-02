<script lang="ts" setup>
  const userStore = useUserStore()
  const { t } = useI18n()
  const { formatDateTime } = useFormatters()

  const isAdmin = userStore.amIAdministrator()
  const overview = isAdmin ? await useReviewBuildsOverview() : null

  const media = computed<string[]>(() => overview?.media.value ?? [])
  const instances = computed(() => overview?.instances.value ?? {})
  const pending = computed<boolean>(() => !!overview?.pending.value)
  const error = computed<Error | null>(
    () => (overview?.error.value as Error | null) ?? null
  )
  const fetchedAt = computed<string | null>(
    () => overview?.fetchedAt.value ?? null
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
      <div class="mb-4">
        <h1 class="text-2xl font-bold">{{ t('reviewBuilds.title') }}</h1>
        <p class="text-muted text-sm">{{ t('reviewBuilds.subtitle') }}</p>
        <p v-if="fetchedAt" class="text-xs text-muted mt-0.5">
          {{
            t('infrastructure.fetchedAt', { time: formatDateTime(fetchedAt) })
          }}
        </p>
      </div>

      <div v-if="pending" class="flex flex-col gap-3">
        <USkeleton class="h-6 w-40" />
        <USkeleton class="h-24 w-full" />
      </div>

      <UAlert
        v-else-if="error"
        color="error"
        variant="soft"
        icon="lucide:triangle-alert"
        :title="t('reviewBuilds.loadError')"
        :description="error.message"
      />

      <UAlert
        v-else-if="!media.length"
        color="info"
        variant="soft"
        icon="lucide:info"
        :title="t('reviewBuilds.empty')"
      />

      <div v-else class="flex flex-col gap-6">
        <section v-for="medium in media" :key="medium">
          <h2 class="flex items-center gap-2 text-lg font-semibold mb-2">
            <UIcon name="lucide:layers" class="text-muted shrink-0" />
            {{ medium }}
          </h2>
          <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            <ReviewBuildsInstanceCard
              v-for="inst in instances[medium]"
              :key="`${inst.review_slot}-${inst.pr_number}`"
              :instance="inst"
            />
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
