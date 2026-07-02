<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import { acceptUserInvite } from '@directus/sdk'

  // Target of the user-invitation email link: `/auth/accept-invite?token=…`.
  // The invitee sets their initial password; Directus activates the account
  // (status invited → active). The account's client access was already granted
  // by the /team endpoint at invite time.

  const { directus } = useDirectus()
  const route = useRoute()
  const router = useRouter()
  const toast = useToast()

  const token = computed<string>(() => (route.query.token as string) || '')

  const schema = z
    .object({
      password: z.string().min(8, 'Mindestens 8 Zeichen.'),
      confirm: z.string()
    })
    .refine((d) => d.password === d.confirm, {
      message: 'Die Passwörter stimmen nicht überein.',
      path: ['confirm']
    })
  type Schema = z.output<typeof schema>

  const state = reactive({ password: '', confirm: '' })
  const loading = ref(false)

  async function onSubmit(_payload: FormSubmitEvent<Schema>) {
    if (!token.value) return
    loading.value = true
    try {
      await directus.request(acceptUserInvite(token.value, state.password))
      toast.add({
        color: 'success',
        title: 'Konto aktiviert',
        description: 'Du kannst dich jetzt anmelden.'
      })
      await router.push('/auth/login')
    } catch {
      toast.add({
        color: 'error',
        title: 'Einladung ungültig oder abgelaufen',
        description:
          'Bitte wende dich an die Person, die dich eingeladen hat, für eine neue Einladung.'
      })
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <div class="flex flex-col items-center justify-center pt-24">
    <UPageCard class="w-full max-w-md">
      <div class="flex flex-col gap-1 mb-4">
        <div class="flex items-center gap-2">
          <UIcon name="lucide:hand" class="text-2xl text-primary" />
          <h1 class="text-xl font-bold">Willkommen bei We.Publish ONE</h1>
        </div>
        <p class="text-sm text-muted">
          Lege ein Passwort fest, um dein Konto zu aktivieren.
        </p>
      </div>

      <UAlert
        v-if="!token"
        color="error"
        variant="soft"
        icon="lucide:circle-alert"
      >
        <template #title>Kein gültiger Link</template>
        <template #description>
          Diese Einladung enthält kein Token. Bitte verwende den Link aus deiner
          Einladungs-E-Mail.
        </template>
      </UAlert>

      <UForm
        v-else
        :schema="schema"
        :state="state"
        class="flex flex-col gap-4"
        @submit="onSubmit"
      >
        <UFormField label="Passwort" name="password" required>
          <UInput
            v-model="state.password"
            type="password"
            placeholder="Mindestens 8 Zeichen"
            autocomplete="new-password"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Passwort bestätigen" name="confirm" required>
          <UInput
            v-model="state.confirm"
            type="password"
            autocomplete="new-password"
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          :loading="loading"
          block
          icon="lucide:circle-check"
        >
          Konto aktivieren
        </UButton>
      </UForm>
    </UPageCard>
  </div>
</template>
