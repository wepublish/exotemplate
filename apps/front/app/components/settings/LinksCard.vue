<script lang="ts" setup>
  /**
   * Per-client "Links" settings card: editor/website override URLs (empty =
   * derived from apiUrl) and the custom quick-access links from the `ClientLinks`
   * collection. Editable by both client and admin users. The persisted rows are
   * loaded on mount; on save the editor/website overrides are written to the
   * client and the link drafts are reconciled (create/update/delete) against the
   * loaded rows. The parent keys this card by client id, so it remounts when the
   * selected client changes.
   */
  import type { Client, ClientLink } from '~~/types/DirectusTypes'
  import type { ClientLinkDraft } from '~/utils/clientLinks'

  const props = defineProps<{ client: Client }>()

  const { t } = useI18n()
  const toast = useToast()
  const { listForClient, saveOverrides, persistCustomLinks } = useClientLinks()

  // Normalize `description` to a string so the UInput v-model always binds a
  // string (the stored value may be null), and keep the row id for the diff.
  function toDrafts(links: ClientLink[]): ClientLinkDraft[] {
    return links.map((l) => ({
      id: l.id,
      label: l.label,
      url: l.url,
      description: l.description ?? ''
    }))
  }

  const editorUrl = ref(props.client.editor_url ?? '')
  const websiteUrl = ref(props.client.website_url ?? '')
  const original = ref<ClientLink[]>([])
  const customLinks = ref<ClientLinkDraft[]>([])
  const loading = ref(true)
  const saving = ref(false)

  onMounted(async () => {
    try {
      original.value = await listForClient(props.client.id)
      customLinks.value = toDrafts(original.value)
    } catch {
      original.value = []
      customLinks.value = []
    } finally {
      loading.value = false
    }
  })

  // Derived values shown as placeholders so users see what the link resolves to
  // when they leave the override empty. Falls back to a generic hint when apiUrl
  // can't produce one.
  const editorPlaceholder = computed(
    () =>
      composeEditorUrl(props.client.apiUrl, null) ??
      t('settings.links.derivedUnavailable')
  )
  const websitePlaceholder = computed(
    () =>
      composeWebsiteUrl(props.client.apiUrl, null) ??
      t('settings.links.derivedUnavailable')
  )

  function addLink(): void {
    customLinks.value.push({ label: '', url: '', description: '' })
  }

  function removeLink(index: number): void {
    customLinks.value.splice(index, 1)
  }

  async function save(): Promise<void> {
    saving.value = true
    try {
      await saveOverrides(props.client.id, {
        editorUrl: editorUrl.value,
        websiteUrl: websiteUrl.value
      })
      // Reconcile drafts with the persisted rows; re-seed from the fresh list
      // (drops blank rows, picks up new ids).
      original.value = await persistCustomLinks(
        props.client.id,
        original.value,
        customLinks.value
      )
      customLinks.value = toDrafts(original.value)
      toast.add({
        title: t('settings.links.saved', { client: props.client.name }),
        color: 'success'
      })
    } catch (err) {
      toast.add({
        title: t('common.actionFailed'),
        description: err instanceof Error ? err.message : undefined,
        color: 'error'
      })
    } finally {
      saving.value = false
    }
  }
</script>

<template>
  <UPageCard>
    <template #header>
      <div class="flex items-center gap-3 min-w-0">
        <UIcon name="lucide:link" class="text-2xl shrink-0 text-muted" />
        <p class="font-semibold truncate">{{ t('settings.links.label') }}</p>
      </div>
    </template>

    <div class="flex flex-col gap-4">
      <p class="text-sm text-muted">{{ t('settings.links.description') }}</p>

      <UFormField
        :label="t('settings.links.editorUrl')"
        :help="t('settings.links.overrideHelp')"
      >
        <UInput
          v-model="editorUrl"
          :placeholder="editorPlaceholder"
          class="w-full"
        />
      </UFormField>

      <UFormField
        :label="t('settings.links.websiteUrl')"
        :help="t('settings.links.overrideHelp')"
      >
        <UInput
          v-model="websiteUrl"
          :placeholder="websitePlaceholder"
          class="w-full"
        />
      </UFormField>

      <div class="flex flex-col gap-2">
        <p class="font-medium text-sm">{{ t('settings.links.custom') }}</p>
        <USkeleton v-if="loading" class="h-10 w-full" />
        <p v-else-if="!customLinks.length" class="text-xs text-muted">
          {{ t('settings.links.customEmpty') }}
        </p>
        <div
          v-for="(linkRow, index) in customLinks"
          :key="index"
          class="rounded-lg border border-default p-3 flex flex-col gap-2"
        >
          <div class="flex items-start gap-2">
            <UInput
              v-model="linkRow.label"
              :placeholder="t('settings.links.customLabelPlaceholder')"
              class="flex-1 min-w-0"
            />
            <UInput
              v-model="linkRow.url"
              :placeholder="t('settings.links.customUrlPlaceholder')"
              class="flex-1 min-w-0"
            />
            <UButton
              icon="lucide:trash-2"
              color="error"
              variant="ghost"
              :aria-label="t('settings.links.removeLink')"
              @click="removeLink(index)"
            />
          </div>
          <UInput
            v-model="linkRow.description"
            :placeholder="t('settings.links.customDescriptionPlaceholder')"
            class="w-full"
          />
        </div>
        <div>
          <UButton
            icon="lucide:plus"
            variant="outline"
            color="neutral"
            size="sm"
            :disabled="loading"
            @click="addLink"
          >
            {{ t('settings.links.addLink') }}
          </UButton>
        </div>
      </div>

      <div>
        <UButton
          icon="lucide:save"
          color="primary"
          :loading="saving"
          :disabled="loading"
          @click="save"
        >
          {{ t('common.save') }}
        </UButton>
      </div>
    </div>
  </UPageCard>
</template>
