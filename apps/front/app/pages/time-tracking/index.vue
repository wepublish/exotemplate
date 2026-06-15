<script lang="ts" setup>
  import { createItem, deleteItem } from '@directus/sdk'
  import {
    useTimeTracking,
    type CaptureUserRow
  } from '~/composables/useTimeTracking'

  const userStore = useUserStore()
  const { directus } = useDirectus()
  const toast = useToast()
  const { t } = useI18n()
  const link = useClientPeriodLink()

  function isoToday(): string {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function isoDaysAgo(n: number): string {
    const d = new Date()
    d.setDate(d.getDate() - n)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  // Default range: last 7 days ending yesterday — matches the backend's default.
  const fromInput = ref<string>(isoDaysAgo(7))
  const toInput = ref<string>(isoDaysAgo(1))
  const from = ref<string>(fromInput.value)
  const to = ref<string>(toInput.value)

  const { data, pending, error, refresh, invalidate } =
    userStore.amIAdministrator()
      ? await useTimeTracking(from, to)
      : {
          data: ref([] as CaptureUserRow[]),
          pending: ref(false),
          error: ref<Error | null>(null),
          refresh: async () => {},
          invalidate: async () => {}
        }

  function applyRange() {
    if (fromInput.value > toInput.value) {
      toast.add({
        color: 'error',
        title: t('timeTracking.range.invalidTitle'),
        description: t('timeTracking.range.invalidDescription')
      })
      return
    }
    from.value = fromInput.value
    to.value = toInput.value
  }

  const refreshing = ref(false)

  async function onRefreshClick() {
    if (refreshing.value) return
    refreshing.value = true
    try {
      await invalidate()
      toast.add({
        color: 'success',
        title: t('timeTracking.refresh.successTitle'),
        description: t('timeTracking.refresh.successDescription')
      })
    } catch (err: any) {
      toast.add({
        color: 'error',
        title: t('timeTracking.refresh.errorTitle'),
        description:
          err?.response?.data?.errors?.[0]?.message ||
          err?.message ||
          t('common.unexpectedError')
      })
    } finally {
      refreshing.value = false
    }
  }

  const togglingId = ref<number | null>(null)

  /**
   * Toggle a user's ignored state via the Directus REST CRUD on
   * `CaptureIgnoredUsers`. Re-fetches the page data via `refresh()` so the
   * UI sees the new flag — note this skips the server's 15-min Clockodo
   * cache invalidation since only the join changed, not the underlying time
   * entries.
   */
  async function onToggleIgnored(row: CaptureUserRow) {
    if (togglingId.value !== null) return
    togglingId.value = row.id
    try {
      if (row.ignored && row.ignoredRecordId) {
        await directus.request(
          deleteItem('CaptureIgnoredUsers', row.ignoredRecordId)
        )
        toast.add({
          color: 'success',
          title: t('timeTracking.toggle.renotifiedTitle', { name: row.name })
        })
      } else if (!row.ignored) {
        await directus.request(
          createItem('CaptureIgnoredUsers', { users_id: row.id })
        )
        toast.add({
          color: 'success',
          title: t('timeTracking.toggle.ignoredTitle', { name: row.name })
        })
      }
      await refresh()
    } catch (err: any) {
      toast.add({
        color: 'error',
        title: t('timeTracking.toggle.errorTitle'),
        description:
          err?.errors?.[0]?.message ||
          err?.message ||
          t('common.unexpectedError')
      })
    } finally {
      togglingId.value = null
    }
  }
</script>

<template>
  <!-- Access denied for non-admins -->
  <div v-if="!userStore.amIAdministrator()" class="flex justify-center pt-16">
    <UPageCard class="max-w-md w-full">
      <template #header>
        <div class="flex items-center gap-3">
          <UIcon name="lucide:lock" class="text-3xl text-error" />
          <div>
            <p class="font-bold text-lg">
              {{ t('common.accessDenied.title') }}
            </p>
            <p class="text-sm text-muted">
              {{ t('common.accessDenied.body') }}
            </p>
          </div>
        </div>
      </template>

      <UAlert color="error" variant="soft" icon="lucide:user-x">
        <template #title>{{ t('common.accessDenied.title') }}</template>
        <template #description>
          {{ t('common.accessDenied.body') }}
        </template>
      </UAlert>

      <div class="pt-4">
        <UButton
          :to="link('/dashboard')"
          icon="lucide:chevron-left"
          variant="ghost"
          color="neutral"
        >
          {{ t('common.back') }}
        </UButton>
      </div>
    </UPageCard>
  </div>

  <!-- Admin view -->
  <div v-else>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold">{{ t('timeTracking.pageTitle') }}</h1>
        <p class="text-muted">
          {{ t('timeTracking.pageIntro') }}
        </p>
      </div>
      <UBadge color="primary" variant="soft" icon="lucide:shield-check">
        {{ t('timeTracking.adminBadge') }}
      </UBadge>
    </div>

    <div class="flex flex-col gap-6">
      <UPageCard>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField :label="t('timeTracking.range.from')" name="from">
            <UInput
              v-model="fromInput"
              type="date"
              :max="toInput || isoToday()"
            />
          </UFormField>
          <UFormField :label="t('timeTracking.range.to')" name="to">
            <UInput
              v-model="toInput"
              type="date"
              :min="fromInput"
              :max="isoToday()"
            />
          </UFormField>
          <UButton
            color="primary"
            icon="lucide:search"
            :loading="pending"
            @click="applyRange"
          >
            {{ t('timeTracking.range.apply') }}
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            icon="lucide:refresh-cw"
            :loading="refreshing"
            @click="onRefreshClick"
          >
            {{ t('common.refresh') }}
          </UButton>
        </div>
      </UPageCard>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="lucide:circle-alert"
        :title="error.message || t('timeTracking.loadError')"
      />

      <UPageCard>
        <template #header>
          <div class="flex flex-wrap items-center gap-3 text-xs text-muted">
            <span class="inline-flex items-center gap-2">
              <span class="inline-block w-3 h-3 rounded-full bg-success" />
              {{ t('timeTracking.status.captured') }}
            </span>
            <span class="inline-flex items-center gap-2">
              <span class="inline-block w-3 h-3 rounded-full bg-warning" />
              {{ t('timeTracking.status.partial') }}
            </span>
            <span class="inline-flex items-center gap-2">
              <span class="inline-block w-3 h-3 rounded-full bg-error" />
              {{ t('timeTracking.status.missing') }}
            </span>
            <span class="inline-flex items-center gap-2">
              <span
                class="inline-block w-3 h-3 rounded-full bg-blue-300 dark:bg-blue-700"
              />
              {{ t('timeTracking.status.holiday') }}
            </span>
            <span class="inline-flex items-center gap-2">
              <span
                class="inline-block w-3 h-3 rounded-full bg-neutral-300 dark:bg-neutral-600"
              />
              {{ t('timeTracking.status.absent') }}
            </span>
            <span class="inline-flex items-center gap-2">
              <span
                class="inline-block w-3 h-3 rounded-full border border-dashed border-muted"
              />
              {{ t('timeTracking.legend.off') }}
            </span>
            <span class="inline-flex items-center gap-2">
              <span
                class="inline-block w-3 h-3 rounded-full border border-default"
              />
              {{ t('timeTracking.status.weekend') }}
            </span>
          </div>
        </template>

        <div v-if="pending && !data.length" class="text-sm text-muted py-6">
          {{ t('timeTracking.loadingData') }}
        </div>

        <TimeTrackingMissingHoursList
          v-else
          :rows="data"
          :toggling-id="togglingId"
          @toggle-ignored="onToggleIgnored"
        />
      </UPageCard>
    </div>
  </div>
</template>
