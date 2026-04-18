<script lang="ts" setup>
  import { ONBOARDING_DATA_KEY } from '~~/types/OnboardingTypes'

  defineProps<{
    editorUrl: string
    websiteUrl: string
    apiUrl: string
  }>()

  const data = inject(ONBOARDING_DATA_KEY)!
</script>

<template>
  <div v-if="data.infraResult" class="flex flex-col gap-4">
    <UAlert
      color="success"
      variant="soft"
      icon="material-symbols:check-circle-rounded"
    >
      <template #title>Infrastruktur-PRs erfolgreich erstellt</template>
      <template #description>
        Pull Requests wurden auf beiden Repositories eröffnet und warten auf
        Review.
      </template>
    </UAlert>

    <div class="grid grid-cols-2 gap-4">
      <div
        class="flex flex-col gap-2 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <div class="flex items-center gap-2">
          <UIcon
            name="material-symbols:settings-rounded"
            class="text-lg text-primary"
          />
          <span class="text-sm font-semibold">Konfigurations-PR</span>
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
          <UIcon name="material-symbols:open-in-new-rounded" class="text-sm" />
          PR #{{ data.infraResult.config_pr.pr_number }} ansehen
        </a>
      </div>

      <div
        class="flex flex-col gap-2 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <div class="flex items-center gap-2">
          <UIcon
            name="material-symbols:language-rounded"
            class="text-lg text-primary"
          />
          <span class="text-sm font-semibold">Website-PR</span>
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
          <UIcon name="material-symbols:open-in-new-rounded" class="text-sm" />
          PR #{{ data.infraResult.website_pr.pr_number }} ansehen
        </a>
      </div>
    </div>

    <div
      class="grid grid-cols-2 gap-3 p-4 rounded-lg bg-neutral-50 dark:bg-neutral-800/50"
    >
      <div class="flex items-center gap-2">
        <UIcon
          name="material-symbols:edit-square-rounded"
          class="text-muted text-lg"
        />
        <div>
          <p class="text-xs text-muted">Editor-URL</p>
          <p class="text-sm font-mono">{{ editorUrl }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UIcon
          name="material-symbols:language-rounded"
          class="text-muted text-lg"
        />
        <div>
          <p class="text-xs text-muted">Website-URL</p>
          <p class="text-sm font-mono">{{ websiteUrl }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UIcon name="material-symbols:api-rounded" class="text-muted text-lg" />
        <div>
          <p class="text-xs text-muted">API-URL</p>
          <p class="text-sm font-mono">{{ apiUrl }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UIcon
          name="material-symbols:deployed-code-rounded"
          class="text-muted text-lg"
        />
        <div>
          <p class="text-xs text-muted">Staging</p>
          <p class="text-sm">{{ data.infraHasStaging ? 'Ja' : 'Nein' }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UIcon
          name="material-symbols:code-rounded"
          class="text-muted text-lg"
        />
        <div>
          <p class="text-xs text-muted">Medium-Name</p>
          <p class="text-sm font-mono">{{ data.infraMediumName }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
