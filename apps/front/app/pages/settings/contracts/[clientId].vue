<script lang="ts" setup>
  import type { Client, Contract } from '~~/types/DirectusTypes'
  import {
    currentValidContract,
    contractNeedsSignature
  } from '~/composables/contractStatus'

  const route = useRoute()
  const userStore = useUserStore()
  const toast = useToast()
  const { t } = useI18n()
  const { formatDate } = useFormatters()
  const link = useClientPeriodLink()
  const { listForClient, uploadContract, downloadFile } = useContracts()

  const clientId = computed<string>(() => String(route.params.clientId))
  const client = computed<Client | undefined>(() =>
    userStore.clients.find((c) => c.id === clientId.value)
  )

  const {
    data: contracts,
    pending,
    error,
    refresh
  } = await useAsyncData<Contract[]>(
    () => `contracts-${clientId.value}`,
    () => listForClient(clientId.value),
    { watch: [clientId], default: () => [] }
  )

  const validContract = computed(() =>
    currentValidContract(contracts.value ?? [])
  )
  const needsSignature = computed(() =>
    contractNeedsSignature(contracts.value ?? [])
  )

  function statusColor(contract: Contract): 'success' | 'warning' | 'neutral' {
    if (contract.status === 'archived') return 'neutral'
    return contract.signed ? 'success' : 'warning'
  }

  function statusLabel(contract: Contract): string {
    if (contract.status === 'archived') return t('contracts.status.archived')
    return contract.signed
      ? t('contracts.status.signed')
      : t('contracts.status.awaitingSignature')
  }

  // ── Download ─────────────────────────────────────────────────────────────────
  const downloadingId = ref<number | null>(null)

  async function onDownload(contract: Contract): Promise<void> {
    if (!contract.file) return
    downloadingId.value = contract.id
    try {
      await downloadFile(contract.file, `Vertrag_v${contract.version}.pdf`)
    } catch (err) {
      toast.add({
        color: 'error',
        title: t('contracts.downloadFailed'),
        description: err instanceof Error ? err.message : undefined
      })
    } finally {
      downloadingId.value = null
    }
  }

  // ── Upload (new version) ─────────────────────────────────────────────────────
  const showUpload = ref(false)
  const uploading = ref(false)
  const file = ref<File | null>(null)
  const signed = ref(true)
  const notes = ref('')
  const uploadError = ref<string | null>(null)

  function openUpload(): void {
    file.value = null
    signed.value = true
    notes.value = ''
    uploadError.value = null
    showUpload.value = true
  }

  const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

  function onFileChange(event: Event): void {
    const picked = (event.target as HTMLInputElement).files?.[0] ?? null
    if (picked && picked.type && picked.type !== 'application/pdf') {
      uploadError.value = t('contracts.mustBePdf')
      file.value = null
      return
    }
    if (picked && picked.size > MAX_FILE_BYTES) {
      uploadError.value = t('contracts.fileTooLarge')
      file.value = null
      return
    }
    uploadError.value = null
    file.value = picked
  }

  async function submitUpload(): Promise<void> {
    if (!file.value) {
      uploadError.value = t('contracts.fileRequired')
      return
    }
    uploading.value = true
    uploadError.value = null
    try {
      await uploadContract(clientId.value, file.value, {
        signed: signed.value,
        notes: notes.value.trim() || undefined
      })
      toast.add({ color: 'success', title: t('contracts.uploaded') })
      showUpload.value = false
      await refresh()
    } catch (err: any) {
      uploadError.value =
        err?.response?.data?.errors?.[0]?.message ??
        (err instanceof Error ? err.message : t('common.unexpectedError'))
    } finally {
      uploading.value = false
    }
  }

  // ── Inline "upload signed version" in the timeline ───────────────────────────
  const inlineFile = ref<File | null>(null)
  const inlineUploading = ref(false)
  const inlineError = ref<string | null>(null)

  function onInlineFileChange(event: Event): void {
    const picked = (event.target as HTMLInputElement).files?.[0] ?? null
    if (picked && picked.type && picked.type !== 'application/pdf') {
      inlineError.value = t('contracts.mustBePdf')
      inlineFile.value = null
      return
    }
    if (picked && picked.size > MAX_FILE_BYTES) {
      inlineError.value = t('contracts.fileTooLarge')
      inlineFile.value = null
      return
    }
    inlineError.value = null
    inlineFile.value = picked
  }

  async function submitSigned(): Promise<void> {
    if (!inlineFile.value) {
      inlineError.value = t('contracts.fileRequired')
      return
    }
    inlineUploading.value = true
    inlineError.value = null
    try {
      await uploadContract(clientId.value, inlineFile.value, { signed: true })
      toast.add({ color: 'success', title: t('contracts.uploaded') })
      inlineFile.value = null
      await refresh()
    } catch (err: any) {
      inlineError.value =
        err?.response?.data?.errors?.[0]?.message ??
        (err instanceof Error ? err.message : t('common.unexpectedError'))
    } finally {
      inlineUploading.value = false
    }
  }
</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <!-- Header -->
    <div class="col-span-12 flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-3 min-w-0">
        <UButton
          :to="link('/settings')"
          icon="lucide:arrow-left"
          variant="ghost"
          color="neutral"
          :aria-label="t('common.back')"
        />
        <div class="min-w-0">
          <h1 class="text-2xl font-bold truncate">
            {{ t('contracts.title') }}
          </h1>
          <p class="text-muted text-sm truncate">
            {{ client?.name ?? clientId }}
          </p>
        </div>
      </div>
      <UButton v-if="client" icon="lucide:upload" @click="openUpload">
        {{ t('contracts.upload.button') }}
      </UButton>
    </div>

    <!-- Client not accessible -->
    <div v-if="!client" class="col-span-12">
      <UAlert
        color="error"
        variant="soft"
        icon="lucide:lock"
        :title="t('contracts.noAccess.title')"
        :description="t('contracts.noAccess.description')"
      />
    </div>

    <template v-else>
      <!-- Missing-signature warning: only when a contract exists but isn't signed -->
      <div v-if="!pending && needsSignature" class="col-span-12">
        <UAlert
          color="warning"
          variant="soft"
          icon="lucide:triangle-alert"
          :title="t('contracts.warning.title')"
          :description="t('contracts.warning.description')"
        />
      </div>

      <!-- Current valid (signed) contract -->
      <div v-if="validContract" class="col-span-12">
        <UPageCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="lucide:badge-check" class="text-success text-xl" />
              <p class="font-semibold">{{ t('contracts.current.title') }}</p>
            </div>
          </template>
          <div class="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p class="font-medium">
                {{ t('contracts.versionLabel', { n: validContract.version }) }}
              </p>
              <p class="text-xs text-muted">
                {{ t('contracts.signedOn') }}
                {{ formatDate(validContract.signed_at) }}
              </p>
            </div>
            <UButton
              variant="outline"
              color="neutral"
              icon="lucide:download"
              :loading="downloadingId === validContract.id"
              @click="onDownload(validContract)"
            >
              {{ t('contracts.download') }}
            </UButton>
          </div>
        </UPageCard>
      </div>

      <!-- Upload panel -->
      <div v-if="showUpload" class="col-span-12">
        <UPageCard>
          <template #header>
            <div class="flex items-center justify-between">
              <p class="font-semibold">{{ t('contracts.upload.title') }}</p>
              <UButton
                icon="lucide:x"
                variant="ghost"
                color="neutral"
                @click="showUpload = false"
              />
            </div>
          </template>

          <div class="grid grid-cols-12 gap-4">
            <UFormField
              :label="t('contracts.upload.fileLabel')"
              required
              class="col-span-12"
              :hint="t('contracts.upload.fileHint')"
            >
              <input
                type="file"
                accept="application/pdf"
                class="block w-full text-sm text-muted file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-white file:cursor-pointer hover:file:bg-primary/90"
                @change="onFileChange"
              />
            </UFormField>

            <div class="col-span-12">
              <UCheckbox
                v-model="signed"
                :label="t('contracts.upload.signedLabel')"
              />
            </div>

            <UFormField
              :label="t('contracts.upload.notesLabel')"
              class="col-span-12"
            >
              <UInput v-model="notes" class="w-full" />
            </UFormField>

            <div v-if="uploadError" class="col-span-12">
              <UAlert
                color="error"
                variant="soft"
                icon="lucide:circle-alert"
                :description="uploadError"
              />
            </div>

            <div class="col-span-12 flex justify-end">
              <UButton
                icon="lucide:upload"
                :loading="uploading"
                :disabled="!file"
                @click="submitUpload"
              >
                {{ t('contracts.upload.submit') }}
              </UButton>
            </div>
          </div>
        </UPageCard>
      </div>

      <!-- Loading / error -->
      <USkeleton v-if="pending" class="h-24 col-span-12" />
      <UAlert
        v-else-if="error"
        color="error"
        variant="soft"
        class="col-span-12"
        icon="lucide:circle-alert"
        :title="t('contracts.loadError')"
        :description="error.message"
      />

      <!-- Empty -->
      <div v-else-if="!contracts || contracts.length === 0" class="col-span-12">
        <UPageCard>
          <div class="flex items-center gap-3 text-sm text-muted">
            <UIcon name="lucide:file-text" class="text-2xl" />
            {{ t('contracts.empty') }}
          </div>
        </UPageCard>
      </div>

      <!-- Timeline -->
      <div v-else class="col-span-12">
        <p
          class="text-xs font-semibold text-muted uppercase tracking-wider mb-3"
        >
          {{ t('contracts.timeline') }}
        </p>
        <ol
          class="relative border-s border-neutral-200 dark:border-neutral-700 ps-6 space-y-4"
        >
          <li v-for="contract in contracts" :key="contract.id" class="relative">
            <span
              class="absolute -start-[31px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-default"
              :class="contract.signed ? 'bg-success' : 'bg-warning'"
            />
            <UPageCard>
              <div class="flex items-start justify-between gap-4 flex-wrap">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <p class="font-semibold">
                      {{ t('contracts.versionLabel', { n: contract.version }) }}
                    </p>
                    <UBadge
                      :color="statusColor(contract)"
                      variant="subtle"
                      size="sm"
                    >
                      {{ statusLabel(contract) }}
                    </UBadge>
                  </div>
                  <p class="text-xs text-muted mt-1">
                    {{ t('contracts.uploadedOn') }}
                    {{ formatDate(contract.date_created) }}
                  </p>
                  <p v-if="contract.notes" class="text-xs text-muted mt-1">
                    {{ contract.notes }}
                  </p>
                </div>

                <UButton
                  v-if="contract.file"
                  variant="outline"
                  :color="contract.signed ? 'success' : 'neutral'"
                  size="sm"
                  icon="lucide:download"
                  :loading="downloadingId === contract.id"
                  @click="onDownload(contract)"
                >
                  {{ t('contracts.download') }}
                </UButton>
              </div>
            </UPageCard>
          </li>

          <!-- Inline upload for the pending signature, right in the timeline -->
          <li v-if="needsSignature && !showUpload" class="relative">
            <span
              class="absolute -start-[31px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-default bg-primary"
            />
            <UPageCard class="border-dashed">
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-2">
                  <UIcon name="lucide:upload" class="text-primary" />
                  <p class="font-semibold">
                    {{ t('contracts.upload.signedTitle') }}
                  </p>
                </div>
                <p class="text-sm text-muted">
                  {{ t('contracts.upload.signedHint') }}
                </p>
                <input
                  type="file"
                  accept="application/pdf"
                  class="block w-full text-sm text-muted file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-white file:cursor-pointer hover:file:bg-primary/90"
                  @change="onInlineFileChange"
                />
                <div v-if="inlineError">
                  <UAlert
                    color="error"
                    variant="soft"
                    icon="lucide:circle-alert"
                    :description="inlineError"
                  />
                </div>
                <div class="flex justify-end">
                  <UButton
                    icon="lucide:upload"
                    :loading="inlineUploading"
                    :disabled="!inlineFile"
                    @click="submitSigned"
                  >
                    {{ t('contracts.upload.submitSigned') }}
                  </UButton>
                </div>
              </div>
            </UPageCard>
          </li>
        </ol>
      </div>
    </template>
  </div>
</template>
