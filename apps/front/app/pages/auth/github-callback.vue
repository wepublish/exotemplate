<script lang="ts" setup>
  import { LOCAL_STORAGE_KEY } from '~/stores/useDirectus'

  const { t } = useI18n()

  // The backend redirects here with the issued session tokens in the URL
  // fragment (kept out of server logs). We write them into the same localStorage
  // slot the Directus SDK uses, then hard-reload so the app boots authenticated.
  onMounted(() => {
    const raw = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : ''
    const params = new URLSearchParams(raw)
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const expires = Number(params.get('expires'))

    if (accessToken && refreshToken) {
      const data = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires: Number.isFinite(expires) ? expires : null,
        expires_at: Number.isFinite(expires) ? Date.now() + expires : null
      }
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data))
      window.location.replace('/')
    } else {
      window.location.replace('/auth/login?staff_error=callback')
    }
  })
</script>

<template>
  <div class="flex flex-col items-center justify-center pt-24 gap-3">
    <UIcon
      name="lucide:loader-circle"
      class="text-3xl text-muted animate-spin"
    />
    <p class="text-sm text-muted">{{ t('auth.staff.completing') }}</p>
  </div>
</template>
