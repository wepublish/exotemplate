<script lang="ts" setup>
  import { readItems } from '@directus/sdk'
  import type {
    Announcement,
    AnnouncementClient,
    AnnouncementSeverity,
    AnnouncementTranslation,
    Client
  } from '~~/types/DirectusTypes'
  import type { TranslationDraft } from '~/composables/useAnnouncementsAdmin'

  const userStore = useUserStore()
  const { t } = useI18n()
  const { formatDateTime } = useFormatters()
  const toast = useToast()
  const { directus } = useDirectus()
  const admin = useAnnouncementsAdmin()

  const isAdmin = userStore.amIAdministrator()

  const items = ref<Announcement[]>([])
  const clients = ref<Client[]>([])
  const pending = ref(true)
  const loadError = ref<string | null>(null)

  const LOCALES = ['de', 'fr', 'en'] as const
  const SEVERITIES: AnnouncementSeverity[] = ['info', 'warning', 'critical']
  const STATUSES = ['published', 'draft', 'archived'] as const

  async function load(): Promise<void> {
    if (!isAdmin) return
    pending.value = true
    loadError.value = null
    try {
      items.value = await admin.list()
      clients.value = (await directus.request(
        readItems('Clients', {
          fields: ['id', 'name', 'medium_name'],
          sort: ['name'],
          limit: -1
        })
      )) as Client[]
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : String(e)
    } finally {
      pending.value = false
    }
  }
  onMounted(load)

  // ── Edit modal state ────────────────────────────────────────────────────────
  const open = ref(false)
  const saving = ref(false)
  const editingId = ref<number | null>(null)
  const originalTranslations = ref<AnnouncementTranslation[]>([])

  const blankForm = () => ({
    status: 'draft' as (typeof STATUSES)[number],
    severity: 'info' as AnnouncementSeverity,
    title: '',
    body: '',
    link_label: '',
    link_url: '',
    starts_at: '',
    ends_at: '',
    dismissible: true
  })
  const form = reactive(blankForm())
  const translations = ref<TranslationDraft[]>([])

  // Target media (M2M): allMedia = general; otherwise the checked client ids.
  const allMedia = ref(true)
  const clientIds = ref<string[]>([])
  const originalClients = ref<AnnouncementClient[]>([])
  const clientSearch = ref('')
  const filteredClients = computed(() => {
    const q = clientSearch.value.trim().toLowerCase()
    return q
      ? clients.value.filter((c) => c.name.toLowerCase().includes(q))
      : clients.value
  })
  function selectAllFiltered(): void {
    clientIds.value = [
      ...new Set([
        ...clientIds.value,
        ...filteredClients.value.map((c) => c.id)
      ])
    ]
  }

  // datetime-local (local wall time) ↔ ISO (UTC) conversion.
  const toLocalInput = (iso: string | null): string => {
    if (!iso) return ''
    const d = new Date(iso)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16)
  }
  const fromLocalInput = (v: string): string | null =>
    v ? new Date(v).toISOString() : null

  function resetForm(): void {
    Object.assign(form, blankForm())
    translations.value = []
    originalTranslations.value = []
    allMedia.value = true
    clientIds.value = []
    originalClients.value = []
    clientSearch.value = ''
    editingId.value = null
  }

  function openCreate(): void {
    resetForm()
    open.value = true
  }

  function openEdit(a: Announcement): void {
    editingId.value = a.id
    form.status = a.status
    form.severity = a.severity
    form.title = a.title
    form.body = a.body ?? ''
    form.link_label = a.link_label ?? ''
    form.link_url = a.link_url ?? ''
    form.starts_at = toLocalInput(a.starts_at)
    form.ends_at = toLocalInput(a.ends_at)
    form.dismissible = a.dismissible
    originalClients.value = a.clients ?? []
    clientIds.value = (a.clients ?? [])
      .map((c) =>
        typeof c.clients_id === 'object' ? c.clients_id?.id : c.clients_id
      )
      .filter((id): id is string => !!id)
    allMedia.value = clientIds.value.length === 0
    clientSearch.value = ''
    originalTranslations.value = a.translations ?? []
    translations.value = (a.translations ?? []).map((tr) => ({
      id: tr.id,
      locale: tr.locale,
      title: tr.title ?? '',
      body: tr.body ?? '',
      link_label: tr.link_label ?? ''
    }))
    open.value = true
  }

  const usedLocales = computed(() => translations.value.map((tr) => tr.locale))
  const freeLocales = computed(() =>
    LOCALES.filter((l) => !usedLocales.value.includes(l))
  )

  function addTranslation(): void {
    const locale = freeLocales.value[0]
    if (!locale) return
    translations.value.push({ locale, title: '', body: '', link_label: '' })
  }
  function removeTranslation(i: number): void {
    translations.value.splice(i, 1)
  }

  async function save(): Promise<void> {
    if (!form.title.trim()) {
      toast.add({ title: t('messages.titleRequired'), color: 'error' })
      return
    }
    if (!allMedia.value && !clientIds.value.length) {
      toast.add({ title: t('messages.pickAtLeastOne'), color: 'error' })
      return
    }
    saving.value = true
    try {
      const payload = {
        status: form.status,
        severity: form.severity,
        title: form.title.trim(),
        body: form.body.trim() || null,
        link_label: form.link_label.trim() || null,
        link_url: form.link_url.trim() || null,
        starts_at: fromLocalInput(form.starts_at),
        ends_at: fromLocalInput(form.ends_at),
        dismissible: form.dismissible
      }
      const id = editingId.value
        ? (await admin.update(editingId.value, payload), editingId.value)
        : (await admin.create(payload)).id
      await admin.saveTranslations(
        id,
        originalTranslations.value,
        translations.value
      )
      await admin.setClients(
        id,
        originalClients.value,
        allMedia.value ? [] : clientIds.value
      )
      await admin.invalidateCache()
      toast.add({ title: t('messages.saved'), color: 'success' })
      open.value = false
      await load()
    } catch (e) {
      toast.add({
        title: t('common.actionFailed'),
        description: e instanceof Error ? e.message : undefined,
        color: 'error'
      })
    } finally {
      saving.value = false
    }
  }

  async function remove(a: Announcement): Promise<void> {
    if (!confirm(t('messages.deleteConfirm', { title: a.title }))) return
    try {
      await admin.remove(a.id)
      await admin.invalidateCache()
      await load()
      toast.add({ title: t('messages.deleted'), color: 'success' })
    } catch (e) {
      toast.add({
        title: t('common.actionFailed'),
        description: e instanceof Error ? e.message : undefined,
        color: 'error'
      })
    }
  }

  const severityColor = (s: AnnouncementSeverity) =>
    s === 'critical' ? 'error' : s === 'warning' ? 'warning' : 'info'
  const targetLabel = (a: Announcement): string => {
    const cs = a.clients ?? []
    if (!cs.length) return t('messages.general')
    return cs
      .map((c) =>
        typeof c.clients_id === 'object'
          ? (c.clients_id?.name ?? '—')
          : (clients.value.find((x) => x.id === c.clients_id)?.name ?? '—')
      )
      .join(', ')
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
      <div class="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 class="text-2xl font-bold">{{ t('messages.title') }}</h1>
          <p class="text-muted text-sm">{{ t('messages.subtitle') }}</p>
        </div>
        <UButton icon="lucide:plus" @click="openCreate">
          {{ t('messages.new') }}
        </UButton>
      </div>

      <div v-if="pending" class="flex flex-col gap-3">
        <USkeleton class="h-16 w-full" />
        <USkeleton class="h-16 w-full" />
      </div>

      <UAlert
        v-else-if="loadError"
        color="error"
        variant="soft"
        icon="lucide:triangle-alert"
        :title="t('messages.loadError')"
        :description="loadError"
      />

      <UAlert
        v-else-if="!items.length"
        color="info"
        variant="soft"
        icon="lucide:info"
        :title="t('messages.empty')"
      />

      <div v-else class="flex flex-col gap-2">
        <div
          v-for="a in items"
          :key="a.id"
          class="rounded-lg border border-default p-3 flex items-center gap-3"
        >
          <UBadge :color="severityColor(a.severity)" variant="subtle" size="sm">
            {{ t(`messages.severity.${a.severity}`) }}
          </UBadge>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 min-w-0">
              <span class="font-medium truncate">{{ a.title }}</span>
              <UBadge
                v-if="a.status !== 'published'"
                color="neutral"
                variant="soft"
                size="sm"
                >{{ t(`messages.status.${a.status}`) }}</UBadge
              >
            </div>
            <p class="text-xs text-muted truncate">
              <UIcon
                :name="
                  a.clients && a.clients.length
                    ? 'lucide:target'
                    : 'lucide:globe'
                "
                class="align-text-bottom"
              />
              {{ targetLabel(a) }}
              <template v-if="a.starts_at || a.ends_at">
                ·
                {{ a.starts_at ? formatDateTime(a.starts_at) : '…' }}
                –
                {{ a.ends_at ? formatDateTime(a.ends_at) : '…' }}
              </template>
              <template v-if="a.translations && a.translations.length">
                · {{ a.translations.map((x) => x.locale).join(', ') }}
              </template>
            </p>
          </div>
          <UButton
            icon="lucide:pencil"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="t('messages.edit')"
            @click="openEdit(a)"
          />
          <UButton
            icon="lucide:trash-2"
            color="error"
            variant="ghost"
            size="sm"
            :aria-label="t('messages.delete')"
            @click="remove(a)"
          />
        </div>
      </div>

      <!-- Create / edit modal -->
      <UModal
        v-model:open="open"
        :title="t('messages.new')"
        :ui="{ content: 'sm:max-w-3xl' }"
      >
        <template #body>
          <div class="flex flex-col gap-3">
            <UFormField :label="t('messages.fieldTitle')" required>
              <UInput v-model="form.title" class="w-full" />
            </UFormField>
            <UFormField :label="t('messages.fieldBody')">
              <UTextarea v-model="form.body" :rows="3" class="w-full" />
            </UFormField>

            <div class="grid grid-cols-2 gap-3">
              <UFormField :label="t('messages.fieldSeverity')">
                <select
                  v-model="form.severity"
                  class="w-full rounded-md border border-default bg-default px-2.5 py-1.5 text-sm"
                >
                  <option v-for="s in SEVERITIES" :key="s" :value="s">
                    {{ t(`messages.severity.${s}`) }}
                  </option>
                </select>
              </UFormField>
              <UFormField :label="t('messages.fieldStatus')">
                <select
                  v-model="form.status"
                  class="w-full rounded-md border border-default bg-default px-2.5 py-1.5 text-sm"
                >
                  <option v-for="s in STATUSES" :key="s" :value="s">
                    {{ t(`messages.status.${s}`) }}
                  </option>
                </select>
              </UFormField>
            </div>

            <UFormField :label="t('messages.fieldClient')">
              <UCheckbox v-model="allMedia" :label="t('messages.allMedia')" />
              <div
                v-if="!allMedia"
                class="mt-2 rounded-lg border border-default p-2 flex flex-col gap-2"
              >
                <div class="flex items-center gap-2">
                  <UInput
                    v-model="clientSearch"
                    icon="lucide:search"
                    :placeholder="t('messages.searchMedia')"
                    size="sm"
                    class="flex-1"
                  />
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    @click="selectAllFiltered"
                  >
                    {{ t('messages.selectAll') }}
                  </UButton>
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    @click="clientIds = []"
                  >
                    {{ t('messages.selectNone') }}
                  </UButton>
                </div>
                <div class="max-h-40 overflow-y-auto flex flex-col gap-1 pe-1">
                  <label
                    v-for="c in filteredClients"
                    :key="c.id"
                    class="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      v-model="clientIds"
                      type="checkbox"
                      :value="c.id"
                      class="accent-primary"
                    />
                    <span class="truncate">{{ c.name }}</span>
                  </label>
                </div>
                <p v-if="!clientIds.length" class="text-xs text-warning">
                  {{ t('messages.pickAtLeastOne') }}
                </p>
                <p v-else class="text-xs text-muted">
                  {{ t('messages.selectedCount', { count: clientIds.length }) }}
                </p>
              </div>
            </UFormField>

            <div class="grid grid-cols-2 gap-3">
              <UFormField :label="t('messages.fieldStartsAt')">
                <UInput
                  v-model="form.starts_at"
                  type="datetime-local"
                  class="w-full"
                />
              </UFormField>
              <UFormField :label="t('messages.fieldEndsAt')">
                <UInput
                  v-model="form.ends_at"
                  type="datetime-local"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <UFormField :label="t('messages.fieldLinkLabel')">
                <UInput v-model="form.link_label" class="w-full" />
              </UFormField>
              <UFormField :label="t('messages.fieldLinkUrl')">
                <UInput
                  v-model="form.link_url"
                  placeholder="https://…"
                  class="w-full"
                />
              </UFormField>
            </div>

            <UFormField>
              <UCheckbox
                v-model="form.dismissible"
                :label="t('messages.fieldDismissible')"
              />
            </UFormField>

            <!-- Optional per-locale translations -->
            <div class="border-t border-default pt-3">
              <div class="flex items-center justify-between mb-2">
                <p class="font-medium text-sm">
                  {{ t('messages.translations') }}
                </p>
                <UButton
                  icon="lucide:plus"
                  variant="outline"
                  color="neutral"
                  size="xs"
                  :disabled="!freeLocales.length"
                  @click="addTranslation"
                >
                  {{ t('messages.addTranslation') }}
                </UButton>
              </div>
              <p v-if="!translations.length" class="text-xs text-muted">
                {{ t('messages.translationsHint') }}
              </p>
              <div
                v-for="(tr, i) in translations"
                :key="i"
                class="rounded-lg border border-default p-2 flex flex-col gap-2 mb-2"
              >
                <div class="flex items-center gap-2">
                  <select
                    v-model="tr.locale"
                    class="rounded-md border border-default bg-default px-2 py-1 text-sm"
                  >
                    <option
                      v-for="l in LOCALES"
                      :key="l"
                      :value="l"
                      :disabled="l !== tr.locale && usedLocales.includes(l)"
                    >
                      {{ l.toUpperCase() }}
                    </option>
                  </select>
                  <UInput
                    v-model="tr.title"
                    :placeholder="t('messages.fieldTitle')"
                    class="flex-1"
                  />
                  <UButton
                    icon="lucide:x"
                    color="error"
                    variant="ghost"
                    size="xs"
                    @click="removeTranslation(i)"
                  />
                </div>
                <UTextarea
                  v-model="tr.body"
                  :rows="2"
                  :placeholder="t('messages.fieldBody')"
                  class="w-full"
                />
                <UInput
                  v-model="tr.link_label"
                  :placeholder="t('messages.fieldLinkLabel')"
                  class="w-full"
                />
              </div>
            </div>
          </div>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2 w-full">
            <UButton color="neutral" variant="ghost" @click="open = false">
              {{ t('common.cancel') }}
            </UButton>
            <UButton icon="lucide:save" :loading="saving" @click="save">
              {{ t('common.save') }}
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
