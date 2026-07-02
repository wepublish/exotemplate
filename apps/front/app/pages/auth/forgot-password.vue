<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import { passwordRequest } from '@directus/sdk'

  // Forgot-password (logged out). Uses Directus' native password-reset request:
  // it emails a link to `/auth/set-new-password?token=…` (the URL must be on the
  // backend's PASSWORD_RESET_URL_ALLOW_LIST). We never reveal whether an account
  // exists — success and failure show the same neutral confirmation.

  const { directus } = useDirectus()

  const schema = z.object({
    email: z.email('Bitte eine gültige E-Mail-Adresse eingeben.')
  })
  type Schema = z.output<typeof schema>

  const state = reactive({ email: '' })
  const loading = ref(false)
  const submitted = ref(false)

  async function onSubmit(payload: FormSubmitEvent<Schema>) {
    loading.value = true
    try {
      const resetUrl = `${window.location.origin}/auth/set-new-password`
      await directus.request(passwordRequest(payload.data.email, resetUrl))
    } catch {
      // Swallow on purpose: a non-existent / inactive address must look the
      // same as a successful request (no account enumeration).
    } finally {
      loading.value = false
      submitted.value = true
    }
  }
</script>

<template>
  <div class="flex flex-col items-center justify-center pt-24">
    <UPageCard class="w-full max-w-md">
      <template v-if="!submitted">
        <div class="flex flex-col gap-1 mb-4">
          <div class="flex items-center gap-2">
            <UIcon name="lucide:key-round" class="text-2xl text-primary" />
            <h1 class="text-xl font-bold">Passwort zurücksetzen</h1>
          </div>
          <p class="text-sm text-muted">
            Gib deine E-Mail-Adresse ein. Falls ein Konto existiert, senden wir
            dir einen Link zum Zurücksetzen deines Passworts.
          </p>
        </div>

        <UForm :schema="schema" :state="state" @submit="onSubmit">
          <UFormField label="E-Mail" name="email" required>
            <UInput
              v-model="state.email"
              type="email"
              placeholder="name@medium.ch"
              autocomplete="email"
              class="w-full"
            />
          </UFormField>

          <UButton
            type="submit"
            :loading="loading"
            block
            class="mt-4"
            icon="lucide:send"
          >
            Link senden
          </UButton>
        </UForm>
      </template>

      <UAlert v-else color="success" variant="soft" icon="lucide:mail-check">
        <template #title>E-Mail unterwegs</template>
        <template #description>
          Falls ein Konto mit dieser Adresse existiert, haben wir einen Link zum
          Zurücksetzen des Passworts gesendet. Bitte prüfe dein Postfach.
        </template>
      </UAlert>

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
