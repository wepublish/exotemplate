<script lang="ts" setup>
  import {
    createItem,
    createUser,
    readRoles,
    type DirectusRole
  } from '@directus/sdk'
  import {
    ONBOARDING_DATA_KEY,
    ADVANCE_STEP_KEY,
    createEmptyUser,
    type OnboardingUser
  } from '~~/types/OnboardingTypes'

  const data = inject(ONBOARDING_DATA_KEY)!
  const advanceStep = inject(ADVANCE_STEP_KEY)!
  const directusStore = useDirectus()
  const toast = useToast()

  const loading = ref(false)
  const completed = ref(data.clientId !== null)
  const executionError = ref<string | null>(null)

  // Role selection
  const roles = ref<Array<{ id: string; name: string }>>([])
  const rolesLoading = ref(false)
  const rolesLoadFailed = ref(false)

  onMounted(async () => {
    rolesLoading.value = true
    try {
      const result =
        await directusStore.directus.request(readRoles<DirectusRole<any>>())
      roles.value = (result as DirectusRole<any>[])
        .filter((r) => !r.admin_access)
        .map((r) => ({ id: r.id as string, name: (r.name as string) ?? r.id }))
    } catch {
      rolesLoadFailed.value = true
    } finally {
      rolesLoading.value = false
    }

    // Auto-generate passwords for users that don't have one yet
    data.users.forEach((user) => {
      if (!user.password) {
        user.password = generatePassword()
      }
    })
  })

  function generatePassword(): string {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%'
    return Array.from(
      { length: 16 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join('')
  }

  function addUser() {
    const user = createEmptyUser()
    user.password = generatePassword()
    data.users.push(user)
  }

  function removeUser(index: number) {
    data.users.splice(index, 1)
  }

  function refreshPassword(user: OnboardingUser) {
    user.password = generatePassword()
  }

  async function execute() {
    if (!data.clientName.trim()) {
      executionError.value = 'Bitte einen Client-Namen eingeben.'
      return
    }

    loading.value = true
    executionError.value = null

    try {
      // 1. Create the Directus client
      const createdClient = await directusStore.directus.request(
        createItem('Clients', {
          name: data.clientName.trim(),
          status: 'published'
        })
      )
      data.clientId = createdClient.id as string

      // 2. Create each user and link to client via junction table
      for (const user of data.users) {
        if (!user.email.trim()) continue

        const createdUser = await directusStore.directus.request(
          createUser({
            first_name: user.firstName || undefined,
            last_name: user.lastName || undefined,
            email: user.email.trim(),
            password: user.password,
            ...(data.selectedRoleId ? { role: data.selectedRoleId } : {})
          })
        )
        user.directusUserId = createdUser.id as string

        // 3. Link user to client
        await directusStore.directus.request(
          createItem('Clients_directus_users', {
            Clients_id: data.clientId,
            directus_users_id: user.directusUserId
          })
        )
      }

      completed.value = true
      toast.add({
        color: 'success',
        title: 'Client und Benutzer erfolgreich angelegt!'
      })
      await advanceStep()
    } catch (e: any) {
      const msg = e?.errors?.[0]?.message ?? e?.message ?? 'Unbekannter Fehler'
      executionError.value = msg
      toast.add({ color: 'error', title: 'Fehler', description: msg })
    } finally {
      loading.value = false
    }
  }

  const passwordVisible = ref<Record<string, boolean>>({})
  function togglePasswordVisibility(userId: string) {
    passwordVisible.value[userId] = !passwordVisible.value[userId]
  }
</script>

<template>
  <!-- Already completed -->
  <div v-if="completed" class="flex flex-col gap-4">
    <UAlert
      color="success"
      variant="soft"
      icon="material-symbols:check-circle-rounded"
    >
      <template #title>Client erfolgreich angelegt</template>
      <template #description>
        Directus Client-ID:
        <span class="font-mono font-bold">{{ data.clientId }}</span>
      </template>
    </UAlert>

    <div class="grid grid-cols-12 gap-3">
      <div
        v-for="user in data.users.filter((u) => u.directusUserId)"
        :key="user.id"
        class="col-span-12 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 flex items-center justify-between"
      >
        <div class="flex items-center gap-2">
          <UIcon name="material-symbols:person-rounded" class="text-success" />
          <span class="font-medium"
            >{{ user.firstName }} {{ user.lastName }}</span
          >
          <span class="text-muted text-sm">{{ user.email }}</span>
        </div>
        <UBadge variant="soft" color="success" size="sm">
          {{ user.directusUserId }}
        </UBadge>
      </div>
    </div>
  </div>

  <!-- Form -->
  <div v-else class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UAlert color="info" variant="soft" icon="material-symbols:info-rounded">
        <template #description>
          Einen neuen Client-Eintrag und ein oder mehrere Benutzerkonten in
          Directus anlegen.
        </template>
      </UAlert>
    </div>

    <!-- Client name -->
    <UFormField
      label="Client-Name"
      name="clientName"
      required
      class="col-span-6"
    >
      <UInput
        v-model="data.clientName"
        placeholder="z.B. Muster AG"
        class="w-full"
      />
    </UFormField>

    <!-- Role selection -->
    <UFormField label="Benutzer-Rolle" name="role" class="col-span-6">
      <USkeleton v-if="rolesLoading" class="h-8 w-full" />
      <USelectMenu
        v-else-if="roles.length"
        v-model="data.selectedRoleId"
        :items="roles"
        value-key="id"
        label-key="name"
        placeholder="Rolle auswählen (optional)"
        class="w-full"
      />
      <UInput
        v-else
        v-model="data.selectedRoleId"
        placeholder="Rollen-UUID (konnte nicht geladen werden)"
        class="w-full"
      />
    </UFormField>

    <!-- Users -->
    <div class="col-span-12 flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold">Benutzer ({{ data.users.length }})</p>
        <UButton
          size="xs"
          variant="outline"
          icon="material-symbols:person-add-rounded"
          @click="addUser"
        >
          Benutzer hinzufügen
        </UButton>
      </div>

      <div
        v-for="(user, index) in data.users"
        :key="user.id"
        class="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <div class="flex items-center justify-between mb-3">
          <p class="text-sm font-medium text-muted">Benutzer {{ index + 1 }}</p>
          <UButton
            v-if="data.users.length > 1"
            size="xs"
            variant="ghost"
            color="error"
            icon="material-symbols:delete-rounded"
            @click="removeUser(index)"
          />
        </div>

        <div class="grid grid-cols-12 gap-3">
          <UFormField label="Vorname" class="col-span-6">
            <UInput v-model="user.firstName" placeholder="Max" class="w-full" />
          </UFormField>
          <UFormField label="Nachname" class="col-span-6">
            <UInput
              v-model="user.lastName"
              placeholder="Mustermann"
              class="w-full"
            />
          </UFormField>
          <UFormField label="E-Mail" required class="col-span-6">
            <UInput
              v-model="user.email"
              placeholder="max@muster-ag.ch"
              type="email"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Passwort" class="col-span-6">
            <div class="flex gap-1.5">
              <UInput
                v-model="user.password"
                :type="passwordVisible[user.id] ? 'text' : 'password'"
                class="w-full font-mono"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                :icon="
                  passwordVisible[user.id]
                    ? 'material-symbols:visibility-off-rounded'
                    : 'material-symbols:visibility-rounded'
                "
                @click="togglePasswordVisibility(user.id)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="material-symbols:refresh-rounded"
                @click="refreshPassword(user)"
              />
            </div>
          </UFormField>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-if="executionError" class="col-span-12">
      <UAlert
        color="error"
        variant="soft"
        icon="material-symbols:error-rounded"
      >
        <template #title>Fehler beim Anlegen</template>
        <template #description>{{ executionError }}</template>
      </UAlert>
    </div>

    <!-- Execute -->
    <div class="col-span-12 flex justify-end pt-2">
      <UButton
        icon="material-symbols:play-circle-rounded"
        :loading="loading"
        @click="execute"
      >
        In Directus anlegen
      </UButton>
    </div>
  </div>
</template>
