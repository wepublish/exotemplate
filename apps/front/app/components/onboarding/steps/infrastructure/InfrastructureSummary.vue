<script lang="ts" setup>
  import { ONBOARDING_DATA_KEY } from '~~/types/OnboardingTypes'

  defineProps<{
    editorUrl: string
    websiteUrl: string
    apiUrl: string
  }>()

  const data = inject(ONBOARDING_DATA_KEY)!
  const { t } = useI18n()
</script>

<template>
  <div v-if="data.infraResult" class="flex flex-col gap-4">
    <UAlert color="success" variant="soft" icon="lucide:circle-check">
      <template #title>{{
        t('onboarding.infrastructure.summary.title')
      }}</template>
      <template #description>
        {{ t('onboarding.infrastructure.summary.description') }}
      </template>
    </UAlert>

    <div class="grid grid-cols-2 gap-4">
      <div
        class="flex flex-col gap-2 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <div class="flex items-center gap-2">
          <UIcon name="lucide:settings" class="text-lg text-primary" />
          <span class="text-sm font-semibold">{{
            t('onboarding.infrastructure.summary.configPr')
          }}</span>
        </div>
        <p class="text-xs text-muted font-mono">
          {{ data.infraResult.config_pr.branch }}
        </p>
        <a
          :href="data.infraResult.config_pr.pr_url"
          target="_blank"
          rel="noopener"
          class="text-sm text-primary hover:underline flex items-center gap-1"
        >
          <UIcon name="lucide:external-link" class="text-sm" />
          {{
            t('onboarding.infrastructure.summary.viewPr', {
              number: data.infraResult.config_pr.pr_number
            })
          }}
        </a>
      </div>

      <div
        class="flex flex-col gap-2 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <div class="flex items-center gap-2">
          <UIcon name="lucide:languages" class="text-lg text-primary" />
          <span class="text-sm font-semibold">{{
            t('onboarding.infrastructure.summary.websitePr')
          }}</span>
        </div>
        <p class="text-xs text-muted font-mono">
          {{ data.infraResult.website_pr.branch }}
        </p>
        <a
          :href="data.infraResult.website_pr.pr_url"
          target="_blank"
          rel="noopener"
          class="text-sm text-primary hover:underline flex items-center gap-1"
        >
          <UIcon name="lucide:external-link" class="text-sm" />
          {{
            t('onboarding.infrastructure.summary.viewPr', {
              number: data.infraResult.website_pr.pr_number
            })
          }}
        </a>
      </div>
    </div>

    <div
      class="grid grid-cols-2 gap-3 p-4 rounded-lg bg-neutral-50 dark:bg-neutral-800/50"
    >
      <div class="flex items-center gap-2">
        <UIcon name="lucide:square-pen" class="text-muted text-lg" />
        <div>
          <p class="text-xs text-muted">
            {{ t('onboarding.infrastructure.summary.editorUrl') }}
          </p>
          <p class="text-sm font-mono">{{ editorUrl }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UIcon name="lucide:languages" class="text-muted text-lg" />
        <div>
          <p class="text-xs text-muted">
            {{ t('onboarding.infrastructure.summary.websiteUrl') }}
          </p>
          <p class="text-sm font-mono">{{ websiteUrl }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UIcon name="lucide:plug" class="text-muted text-lg" />
        <div>
          <p class="text-xs text-muted">
            {{ t('onboarding.infrastructure.summary.apiUrl') }}
          </p>
          <p class="text-sm font-mono">{{ apiUrl }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UIcon name="lucide:package" class="text-muted text-lg" />
        <div>
          <p class="text-xs text-muted">
            {{ t('onboarding.infrastructure.summary.staging') }}
          </p>
          <p class="text-sm">
            {{
              data.infraHasStaging
                ? t('onboarding.infrastructure.summary.stagingYes')
                : t('onboarding.infrastructure.summary.stagingNo')
            }}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UIcon name="lucide:code" class="text-muted text-lg" />
        <div>
          <p class="text-xs text-muted">
            {{ t('onboarding.infrastructure.summary.mediumName') }}
          </p>
          <p class="text-sm font-mono">{{ data.infraMediumName }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
