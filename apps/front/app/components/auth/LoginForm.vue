<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui'

  const userStore = useUserStore()
  const { t } = useI18n()

  const loading = ref<boolean>(true)

  const fields = computed<AuthFormField[]>(() => [
    {
      name: 'email',
      type: 'email',
      label: t('auth.email'),
      placeholder: t('auth.emailPlaceholder'),
      required: true
    },
    {
      name: 'password',
      label: t('auth.password'),
      type: 'password',
      placeholder: t('auth.passwordPlaceholder'),
      required: true
    }
  ])

  type Schema = { email: string; password: string }

  const schema = computed(() =>
    z.object({
      email: z.email(t('auth.validation.invalidEmail')),
      password: z
        .string(t('auth.validation.passwordRequired'))
        .min(8, t('auth.validation.passwordMin'))
    })
  )

  async function onSubmit(payload: FormSubmitEvent<Schema>) {
    const result = schema.value.safeParse(payload.data)
    if (!result.success) {
      return
    }

    await userStore.login({
      email: payload.data.email,
      password: payload.data.password
    })
  }

  onMounted(async () => {
    await userStore.login({})
    loading.value = false
  })
</script>

<template>
  <div class="flex flex-col items-center justify-center pt-24">
    <UPageCard class="w-full max-w-md">
      <UAuthForm
        :loading="loading"
        :schema="schema"
        :title="t('auth.title')"
        :description="t('auth.description')"
        icon="lucide:user"
        :fields="fields"
        @submit="onSubmit"
      />
      <div class="mt-4 text-center">
        <ULink
          to="/auth/forgot-password"
          class="text-sm text-muted hover:text-primary"
        >
          Passwort vergessen?
        </ULink>
      </div>
    </UPageCard>
  </div>
</template>
