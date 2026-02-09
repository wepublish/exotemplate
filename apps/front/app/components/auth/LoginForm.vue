<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui'

  const userStore = useUserStore()

  const loading = ref<boolean>(true)

  const fields: AuthFormField[] = [
    {
      name: 'email',
      type: 'email',
      label: 'Email',
      placeholder: 'Email eingeben',
      required: true
    },
    {
      name: 'password',
      label: 'Passwort',
      type: 'password',
      placeholder: 'Passwort eingeben',
      required: true
    }
  ]

  const schema = z.object({
    email: z.email('Invalid email'),
    password: z
      .string('Password is required')
      .min(8, 'Must be at least 8 characters')
  })

  type Schema = z.output<typeof schema>

  async function onSubmit(payload: FormSubmitEvent<Schema>) {
    const result = schema.safeParse(payload.data)
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
        title="Login"
        description="Melde dich mit deinem Account für We.Publish ONE an."
        icon="i-lucide-user"
        :fields="fields"
        @submit="onSubmit"
      />
    </UPageCard>
  </div>
</template>
