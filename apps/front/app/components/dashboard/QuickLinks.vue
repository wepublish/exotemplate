<script lang="ts" setup>
  /**
   * Full-width dashboard tile with quick-access links to the tools a client
   * uses day to day: dedicated Slack channel, network-wide #we-share, editor,
   * Jira, website, the We.Publish docs, plus any user-defined custom links.
   * The resolved set (which built-ins are shown, with which URLs) is computed by
   * the pure `buildDashboardLinks` helper. Each link is a card with a short
   * description and opens in a new tab.
   */
  import type { Client, ClientLink } from '~~/types/DirectusTypes'

  const props = defineProps<{
    client: Client
    weShareChannelId: string | null
    customLinks: ClientLink[]
  }>()

  const { t } = useI18n()

  const links = computed(() =>
    buildDashboardLinks(props.client, props.weShareChannelId, props.customLinks)
  )
</script>

<template>
  <UPageCard>
    <template #header>
      <div class="flex items-center gap-3 min-w-0">
        <UIcon name="lucide:link" class="text-2xl shrink-0 text-muted" />
        <p class="font-semibold truncate">{{ t('dashboard.links.title') }}</p>
      </div>
    </template>

    <div
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 auto-rows-fr"
    >
      <NuxtLink
        v-for="link in links"
        :key="link.key"
        :to="link.url"
        target="_blank"
        rel="noopener noreferrer"
        class="group block rounded-lg border border-default p-4 bg-elevated/30 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon :name="link.icon" class="text-primary text-xl shrink-0" />
            <span class="font-medium truncate group-hover:text-primary">
              {{ link.label ?? t(link.labelKey as string) }}
            </span>
          </div>
          <UIcon
            name="lucide:external-link"
            class="text-muted shrink-0 group-hover:text-primary"
          />
        </div>
        <p
          v-if="link.description || link.descriptionKey"
          class="text-xs text-muted leading-snug mt-2"
        >
          {{ link.description ?? t(link.descriptionKey as string) }}
        </p>
      </NuxtLink>
    </div>
  </UPageCard>
</template>
