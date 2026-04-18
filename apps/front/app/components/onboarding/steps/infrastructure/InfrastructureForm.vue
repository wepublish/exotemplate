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

  const clientSlug = computed(() =>
    data.clientName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
  )

  watch(
    clientSlug,
    (slug) => {
      if (slug && !data.infraMediumName) {
        data.infraMediumName = slug
      }
    },
    { immediate: true }
  )

  function normalizeMediumName(value: string) {
    data.infraMediumName = value
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[^a-z]+/, '')
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
      <UAlert color="info" variant="soft" icon="material-symbols:info-rounded">
        <template #description>
          Erstellt automatisch Pull Requests auf den Repositories
          <span class="font-mono font-semibold">application-configuration</span>
          und
          <span class="font-mono font-semibold">wepublish</span>, um die
          Terraform-Konfiguration und Website-App für das neue Medium
          einzurichten.
        </template>
      </UAlert>
    </div>

    <UFormField
      label="Medium-Name"
      name="infraMediumName"
      required
      class="col-span-6"
      hint="Terraform-Bezeichner: Kleinbuchstaben, Ziffern, Unterstriche"
    >
      <UInput
        :model-value="data.infraMediumName"
        placeholder="muster_ag"
        class="w-full font-mono"
        :color="data.infraMediumName && !mediumNameValid ? 'error' : undefined"
        @update:model-value="normalizeMediumName($event as string)"
      />
    </UFormField>

    <div class="col-span-6 flex flex-col justify-center gap-1">
      <p class="text-xs text-muted">
        <UIcon
          name="material-symbols:edit-square-rounded"
          class="text-sm align-text-bottom"
        />
        Editor:
        <span class="font-mono">{{ editorUrl }}</span>
      </p>
      <p class="text-xs text-muted">
        <UIcon
          name="material-symbols:language-rounded"
          class="text-sm align-text-bottom"
        />
        Website:
        <span class="font-mono">{{ websiteUrl }}</span>
      </p>
    </div>

    <div class="col-span-6">
      <div
        class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <USwitch
          v-model="data.infraWebsiteEnabled"
          label="Website aktivieren"
          description="Website-App für das Medium erstellen"
        />
      </div>
    </div>

    <div class="col-span-6">
      <div
        class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <USwitch
          v-model="data.infraHasStaging"
          label="Staging-Umgebung"
          description="Zusätzliche Staging-Umgebung einrichten"
        />
      </div>
    </div>

    <div class="col-span-12">
      <p class="text-sm font-medium mb-2">
        Benutzerdefinierte Hostnamen (optional)
      </p>
      <div class="flex gap-2 mb-2">
        <UInput
          v-model="newHostname"
          placeholder="www.muster-ag.ch"
          class="flex-1 font-mono"
          @keydown.enter.prevent="addHostname"
        />
        <UButton
          icon="material-symbols:add-rounded"
          variant="outline"
          color="neutral"
          :disabled="!newHostname.trim()"
          @click="addHostname"
        >
          Hinzufügen
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
            <UIcon name="material-symbols:close-rounded" class="text-sm" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="col-span-12">
      <UAlert
        color="error"
        variant="soft"
        icon="material-symbols:error-rounded"
      >
        <template #title>Fehler</template>
        <template #description>{{ error }}</template>
      </UAlert>
    </div>

    <div class="col-span-12 flex justify-end pt-2">
      <UButton
        icon="material-symbols:cloud-upload-rounded"
        :loading="loading"
        :disabled="!mediumNameValid"
        @click="$emit('execute')"
      >
        Infrastruktur erstellen
      </UButton>
    </div>
  </div>
</template>
