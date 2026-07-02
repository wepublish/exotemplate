<script lang="ts" setup>
  import type { ReviewInstance } from '~/composables/useReviewBuilds'

  const props = defineProps<{ instance: ReviewInstance }>()

  const { t } = useI18n()
  const { formatDateTime } = useFormatters()

  const stateColor = computed<'success' | 'neutral'>(() =>
    props.instance.pr_state === 'open' ? 'success' : 'neutral'
  )
  const stateLabel = computed(() =>
    props.instance.pr_state === 'open'
      ? t('reviewBuilds.state.open')
      : t('reviewBuilds.state.closed')
  )
</script>

<template>
  <div class="rounded-lg border border-default p-4 bg-elevated/30">
    <!-- Header: slot + PR (title linked) + state -->
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <UBadge color="primary" variant="subtle" size="sm">
            {{ t('reviewBuilds.slot', { slot: instance.review_slot }) }}
          </UBadge>
          <UBadge :color="stateColor" variant="subtle" size="sm">
            {{ stateLabel }}
          </UBadge>
        </div>
        <a
          :href="instance.link_to_pr"
          target="_blank"
          rel="noopener"
          class="mt-2 inline-flex items-center gap-1.5 font-medium text-primary hover:underline break-words"
        >
          <UIcon name="lucide:git-pull-request" class="shrink-0" />
          <span>{{ instance.name_of_pr }}</span>
          <span class="text-muted">#{{ instance.pr_number }}</span>
        </a>
      </div>
    </div>

    <!-- Branch -->
    <div class="mt-2 flex items-center gap-1.5 text-xs text-muted">
      <UIcon name="lucide:git-branch" class="shrink-0" />
      <span class="font-mono truncate">{{ instance.branch_name }}</span>
    </div>

    <!-- Preview URLs -->
    <div class="mt-3 flex flex-wrap gap-2">
      <UButton
        :to="instance.editor_url"
        target="_blank"
        icon="lucide:pencil-line"
        variant="outline"
        color="neutral"
        size="xs"
      >
        {{ t('reviewBuilds.preview.editor') }}
      </UButton>
      <UButton
        :to="instance.website_url"
        target="_blank"
        icon="lucide:globe"
        variant="outline"
        color="neutral"
        size="xs"
      >
        {{ t('reviewBuilds.preview.website') }}
      </UButton>
    </div>

    <!-- Last DB sync -->
    <div class="mt-3 flex items-start gap-1.5 text-xs">
      <UIcon name="lucide:database" class="shrink-0 mt-0.5 text-muted" />
      <div class="text-muted">
        <template v-if="instance.last_db_sync">
          {{
            t('reviewBuilds.dbSync.syncedBy', {
              time: formatDateTime(instance.last_db_sync.synced_at),
              user: instance.last_db_sync.triggered_by
            })
          }}
          <a
            :href="instance.last_db_sync.run_url"
            target="_blank"
            rel="noopener"
            class="text-primary hover:underline ms-1 whitespace-nowrap"
          >
            {{ t('reviewBuilds.dbSync.viewRun') }}
          </a>
        </template>
        <template v-else>
          {{ t('reviewBuilds.dbSync.never') }}
        </template>
      </div>
    </div>
  </div>
</template>
