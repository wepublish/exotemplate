<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'

  // "Mein Konto" password change for the logged-in user. The current password
  // is verified before the change (see useAccount.changePassword).

  const { changePassword } = useAccount()
  const toast = useToast()

  const schema = z
    .object({
      current: z.string().min(1, 'Bitte gib dein aktuelles Passwort ein.'),
      password: z.string().min(8, 'Mindestens 8 Zeichen.'),
      confirm: z.string()
    })
    .refine((d) => d.password === d.confirm, {
      message: 'Die Passwörter stimmen nicht überein.',
      path: ['confirm']
    })
  type Schema = z.output<typeof schema>

  const state = reactive({ current: '', password: '', confirm: '' })
  const loading = ref(false)
  const showPassword = ref(false)
  const showConfirm = ref(false)

  async function onSubmit(_payload: FormSubmitEvent<Schema>) {
    loading.value = true
    try {
      await changePassword(state.current, state.password)
      toast.add({ color: 'success', title: 'Passwort geändert.' })
      state.current = ''
      state.password = ''
      state.confirm = ''
    } catch (e) {
      toast.add({
        color: 'error',
        title: 'Passwort konnte nicht geändert werden',
        description: e instanceof Error ? e.message : undefined
      })
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <UForm
    :schema="schema"
    :state="state"
    class="grid grid-cols-12 gap-3"
    @submit="onSubmit"
  >
    <UFormField
      label="Aktuelles Passwort"
      name="current"
      required
      class="col-span-12"
    >
      <UInput
        v-model="state.current"
        type="password"
        autocomplete="current-password"
        class="w-full md:max-w-sm"
      />
    </UFormField>
    <UFormField
      label="Neues Passwort"
      name="password"
      required
      class="col-span-12 md:col-span-6"
    >
      <UInput
        v-model="state.password"
        :type="showPassword ? 'text' : 'password'"
        placeholder="Mindestens 8 Zeichen"
        autocomplete="new-password"
        class="w-full"
        :ui="{ trailing: 'pe-1' }"
      >
        <template #trailing>
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            tabindex="-1"
            :icon="showPassword ? 'lucide:eye-off' : 'lucide:eye'"
            :aria-label="
              showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'
            "
            :aria-pressed="showPassword"
            @click="showPassword = !showPassword"
          />
        </template>
      </UInput>
    </UFormField>
    <UFormField
      label="Neues Passwort bestätigen"
      name="confirm"
      required
      class="col-span-12 md:col-span-6"
    >
      <UInput
        v-model="state.confirm"
        :type="showConfirm ? 'text' : 'password'"
        autocomplete="new-password"
        class="w-full"
        :ui="{ trailing: 'pe-1' }"
      >
        <template #trailing>
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            tabindex="-1"
            :icon="showConfirm ? 'lucide:eye-off' : 'lucide:eye'"
            :aria-label="
              showConfirm ? 'Passwort verbergen' : 'Passwort anzeigen'
            "
            :aria-pressed="showConfirm"
            @click="showConfirm = !showConfirm"
          />
        </template>
      </UInput>
    </UFormField>
    <div class="col-span-12">
      <UButton type="submit" :loading="loading" icon="lucide:lock">
        Passwort ändern
      </UButton>
    </div>
  </UForm>
</template>
