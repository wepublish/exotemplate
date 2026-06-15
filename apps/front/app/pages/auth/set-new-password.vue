<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import { passwordReset } from '@directus/sdk'

  // Target of the password-reset email link: `/auth/set-new-password?token=…`.
  // Submits the new password against Directus' native reset endpoint.

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
      await directus.request(passwordReset(token.value, state.password))
      toast.add({
        color: 'success',
        title: 'Passwort gesetzt',
        description: 'Du kannst dich jetzt mit deinem neuen Passwort anmelden.'
      })
      await router.push('/auth/login')
    } catch {
      toast.add({
        color: 'error',
        title: 'Link ungültig oder abgelaufen',
        description:
          'Bitte fordere einen neuen Link über „Passwort vergessen“ an.'
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
          <UIcon name="lucide:key-round" class="text-2xl text-primary" />
          <h1 class="text-xl font-bold">Neues Passwort festlegen</h1>
        </div>
        <p class="text-sm text-muted">
          Wähle ein neues Passwort für dein We.Publish ONE Konto.
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
          Dieser Link enthält kein Token. Bitte fordere über
          <ULink to="/auth/forgot-password" class="text-primary"
            >Passwort vergessen</ULink
          >
          einen neuen an.
        </template>
      </UAlert>

      <UForm
        v-else
        :schema="schema"
        :state="state"
        class="flex flex-col gap-4"
        @submit="onSubmit"
      >
        <UFormField label="Neues Passwort" name="password" required>
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
          Passwort speichern
        </UButton>
      </UForm>

      <div class="mt-6 text-center">
        <ULink
          to="/auth/login"
          class="text-sm text-muted hover:text-primary inline-flex items-center gap-1"
        >
          <UIcon name="lucide:arrow-left" />
          Zurück zum Login
        </ULink>
      </div>
    </UPageCard>
  </div>
</template>
