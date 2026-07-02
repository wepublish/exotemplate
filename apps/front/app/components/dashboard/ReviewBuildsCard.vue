<script lang="ts" setup>
  import type { ReviewInstance } from '~/composables/useReviewBuilds'

  defineProps<{
    instances: ReviewInstance[]
    pending: boolean
  }>()

  const { t } = useI18n()
</script>

<template>
  <UPageCard>
    <template #header>
      <div class="flex items-center gap-3 min-w-0">
        <UIcon
          name="lucide:flask-conical"
          class="text-2xl shrink-0 text-muted"
        />
        <p class="font-semibold truncate">{{ t('reviewBuilds.cardTitle') }}</p>
      </div>
    </template>

    <div v-if="pending" class="flex flex-col gap-2">
      <USkeleton class="h-4 w-40" />
      <USkeleton class="h-20 w-full" />
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-3 auto-rows-fr">
      <ReviewBuildsInstanceCard
        v-for="inst in instances"
        :key="`${inst.review_slot}-${inst.pr_number}`"
        :instance="inst"
      />
    </div>
  </UPageCard>
</template>
