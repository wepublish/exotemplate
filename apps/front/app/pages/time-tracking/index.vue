<script lang="ts" setup>
  import { createItem, deleteItem } from '@directus/sdk'
  import {
    useTimeTracking,
    type CaptureUserRow
  } from '~/composables/useTimeTracking'

  const userStore = useUserStore()
  const { directus } = useDirectus()
  const toast = useToast()

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
        title: 'Ungültiger Zeitraum',
        description: '"Von" muss vor "Bis" liegen.'
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
        title: 'Daten neu geladen',
        description: 'Frisch von Clockodo geholt.'
      })
    } catch (err: any) {
      toast.add({
        color: 'error',
        title: 'Aktualisieren fehlgeschlagen',
        description:
          err?.response?.data?.errors?.[0]?.message ||
          err?.message ||
          'Unbekannter Fehler'
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
          title: `${row.name} wird wieder benachrichtigt`
        })
      } else if (!row.ignored) {
        await directus.request(
          createItem('CaptureIgnoredUsers', { users_id: row.id })
        )
        toast.add({
          color: 'success',
          title: `${row.name} wird ab sofort ignoriert`
        })
      }
      await refresh()
    } catch (err: any) {
      toast.add({
        color: 'error',
        title: 'Ändern fehlgeschlagen',
        description:
          err?.errors?.[0]?.message || err?.message || 'Unbekannter Fehler'
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
          <UIcon
            name="material-symbols:lock-rounded"
            class="text-3xl text-error"
          />
          <div>
            <p class="font-bold text-lg">Kein Zugriff</p>
            <p class="text-sm text-muted">Unzureichende Berechtigungen</p>
          </div>
        </div>
      </template>

      <UAlert
        color="error"
        variant="soft"
        icon="material-symbols:no-accounts-rounded"
      >
        <template #title>Nur für Administratoren</template>
        <template #description>
          Diese Seite ist ausschliesslich für Administratoren zugänglich.
        </template>
      </UAlert>

      <div class="pt-4">
        <UButton
          to="/"
          icon="material-symbols:arrow-back-ios-rounded"
          variant="ghost"
          color="neutral"
        >
          Zurück zum Dashboard
        </UButton>
      </div>
    </UPageCard>
  </div>

  <!-- Admin view -->
  <div v-else>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold">Übersicht Zeiterfassung</h1>
        <p class="text-muted">
          Wer hat seine Stunden bereits erfasst? Wochenenden, Feiertage,
          Abwesenheiten und vertraglich freie Tage werden nicht als fehlend
          gewertet. Über das Glocken-Symbol kannst Du einzelne Personen aus den
          täglichen Slack-Erinnerungen ausschliessen.
        </p>
      </div>
      <UBadge
        color="primary"
        variant="soft"
        icon="material-symbols:admin-panel-settings-rounded"
      >
        Admin
      </UBadge>
    </div>

    <div class="flex flex-col gap-6">
      <UPageCard>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Von" name="from">
            <UInput
              v-model="fromInput"
              type="date"
              :max="toInput || isoToday()"
            />
          </UFormField>
          <UFormField label="Bis" name="to">
            <UInput
              v-model="toInput"
              type="date"
              :min="fromInput"
              :max="isoToday()"
            />
          </UFormField>
          <UButton
            color="primary"
            icon="i-lucide-search"
            :loading="pending"
            @click="applyRange"
          >
            Anwenden
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="refreshing"
            @click="onRefreshClick"
          >
            Neu laden
          </UButton>
        </div>
      </UPageCard>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="material-symbols:error-outline"
        :title="error.message || 'Daten konnten nicht geladen werden'"
      />

      <UPageCard>
        <template #header>
          <div class="flex flex-wrap items-center gap-3 text-xs text-muted">
            <span class="inline-flex items-center gap-2">
              <span class="inline-block w-3 h-3 rounded-full bg-success" />
              Erfasst
            </span>
            <span class="inline-flex items-center gap-2">
              <span class="inline-block w-3 h-3 rounded-full bg-warning" />
              Teilweise
            </span>
            <span class="inline-flex items-center gap-2">
              <span class="inline-block w-3 h-3 rounded-full bg-error" />
              Fehlt
            </span>
            <span class="inline-flex items-center gap-2">
              <span
                class="inline-block w-3 h-3 rounded-full bg-blue-300 dark:bg-blue-700"
              />
              Feiertag
            </span>
            <span class="inline-flex items-center gap-2">
              <span
                class="inline-block w-3 h-3 rounded-full bg-neutral-300 dark:bg-neutral-600"
              />
              Abwesend
            </span>
            <span class="inline-flex items-center gap-2">
              <span
                class="inline-block w-3 h-3 rounded-full border border-dashed border-muted"
              />
              Frei (laut Vertrag)
            </span>
            <span class="inline-flex items-center gap-2">
              <span
                class="inline-block w-3 h-3 rounded-full border border-default"
              />
              Wochenende
            </span>
          </div>
        </template>

        <div v-if="pending && !data.length" class="text-sm text-muted py-6">
          Lade Daten von Clockodo…
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
