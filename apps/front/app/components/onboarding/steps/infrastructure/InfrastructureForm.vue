<script lang="ts" setup>
  import { ONBOARDING_DATA_KEY } from '~~/types/OnboardingTypes'

  defineProps<{
    loading: boolean
    error: string | null
    editorUrl: string
    websiteUrl: string
    mediumNameValid: boolean
  }>()

  defineEmits<{
    (e: 'execute'): void
  }>()

  const data = inject(ONBOARDING_DATA_KEY)!
  const { t } = useI18n()

  // Repo names rendered with monospace styling; kept as literals (not
  // translatable) and injected into the intro message via v-html.
  const repoSpan = (name: string) =>
    `<span class="font-mono font-semibold">${name}</span>`

  const introHtml = computed(() =>
    t('onboarding.infrastructure.form.intro', {
      configRepo: repoSpan('application-configuration'),
      websiteRepo: repoSpan('wepublish')
    })
  )

  // Auto-derived default: lowercase letters and digits only, no separators
  // (matches the backend `slugifyMediumName`). Hyphens are valid in the field
  // but only ever added by hand — we never insert them here.
  const clientSlug = computed(() => {
    const base = data.clientName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip diacritics (ü → u)
      .replace(/[^a-z0-9]+/g, '') // drop everything that isn't a letter or digit
    if (base === '') return ''
    // A domain label can't start with a digit → prefix a letter when it does.
    return /^[a-z]/.test(base) ? base : `m${base}`
  })

  watch(
    clientSlug,
    (slug) => {
      if (slug && !data.infraMediumName) {
        data.infraMediumName = slug
      }
    },
    { immediate: true }
  )

  // Manual edits: keep lowercase letters, digits and any hyphens the user types
  // (Kubernetes / Terraform compatible); silently drop anything else — so a
  // space or underscore just disappears rather than becoming a separator.
  function normalizeMediumName(value: string) {
    data.infraMediumName = value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '') // drop everything except letters, digits, hyphens
      .replace(/^[^a-z]+/, '') // must start with a letter
  }

  const newHostname = ref('')

  function addHostname() {
    const hostname = newHostname.value.trim().toLowerCase()
    if (hostname && !data.infraCustomHostnames.includes(hostname)) {
      data.infraCustomHostnames.push(hostname)
      newHostname.value = ''
    }
  }

  function removeHostname(index: number) {
    data.infraCustomHostnames.splice(index, 1)
  }
</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UAlert color="info" variant="soft" icon="lucide:info">
        <template #description>
          <span v-html="introHtml" />
        </template>
      </UAlert>
    </div>

    <UFormField
      :label="t('onboarding.infrastructure.form.mediumName')"
      name="infraMediumName"
      required
      class="col-span-6"
      :hint="t('onboarding.infrastructure.form.mediumNameHint')"
    >
      <UInput
        :model-value="data.infraMediumName"
        :placeholder="t('onboarding.infrastructure.form.mediumNamePlaceholder')"
        class="w-full font-mono"
        :color="data.infraMediumName && !mediumNameValid ? 'error' : undefined"
        @update:model-value="normalizeMediumName($event as string)"
      />
    </UFormField>

    <div class="col-span-6 flex flex-col justify-center gap-1">
      <p class="text-xs text-muted">
        <UIcon name="lucide:square-pen" class="text-sm align-text-bottom" />
        {{ t('onboarding.infrastructure.form.editor') }}
        <span class="font-mono">{{ editorUrl }}</span>
      </p>
      <p class="text-xs text-muted">
        <UIcon name="lucide:languages" class="text-sm align-text-bottom" />
        {{ t('onboarding.infrastructure.form.website') }}
        <span class="font-mono">{{ websiteUrl }}</span>
      </p>
    </div>

    <div class="col-span-6">
      <div
        class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <USwitch
          v-model="data.infraWebsiteEnabled"
          :label="t('onboarding.infrastructure.form.websiteEnabled')"
          :description="
            t('onboarding.infrastructure.form.websiteEnabledDescription')
          "
        />
      </div>
    </div>

    <div class="col-span-6">
      <div
        class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <USwitch
          v-model="data.infraHasStaging"
          :label="t('onboarding.infrastructure.form.staging')"
          :description="t('onboarding.infrastructure.form.stagingDescription')"
        />
      </div>
    </div>

    <div class="col-span-12">
      <p class="text-sm font-medium mb-2">
        {{ t('onboarding.infrastructure.form.customHostnames') }}
      </p>
      <div class="flex gap-2 mb-2">
        <UInput
          v-model="newHostname"
          :placeholder="t('onboarding.infrastructure.form.hostnamePlaceholder')"
          class="flex-1 font-mono"
          @keydown.enter.prevent="addHostname"
        />
        <UButton
          icon="lucide:plus"
          variant="outline"
          color="neutral"
          :disabled="!newHostname.trim()"
          @click="addHostname"
        >
          {{ t('onboarding.infrastructure.form.add') }}
        </UButton>
      </div>

      <div v-if="data.infraCustomHostnames.length" class="flex flex-wrap gap-2">
        <div
          v-for="(hostname, index) in data.infraCustomHostnames"
          :key="hostname"
          class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-sm font-mono"
        >
          {{ hostname }}
          <button
            class="hover:text-error transition-colors"
            @click="removeHostname(index)"
          >
            <UIcon name="lucide:x" class="text-sm" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="col-span-12">
      <UAlert color="error" variant="soft" icon="lucide:circle-alert">
        <template #title>{{
          t('onboarding.infrastructure.form.errorTitle')
        }}</template>
        <template #description>{{ error }}</template>
      </UAlert>
    </div>

    <div class="col-span-12 flex justify-end pt-2">
      <UButton
        icon="lucide:cloud-upload"
        :loading="loading"
        :disabled="!mediumNameValid"
        @click="$emit('execute')"
      >
        {{ t('onboarding.infrastructure.form.execute') }}
      </UButton>
    </div>
  </div>
</template>
