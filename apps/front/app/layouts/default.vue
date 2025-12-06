<script lang="ts" setup>
  const userStore = useUserStore()
  const route = useRoute()

  const showLoginForm = computed<boolean>(() => {
    return !userStore.loggedIn && !route.fullPath.startsWith('/auth/login')
  })
</script>

<template>
  <UApp>
    <UHeader>
      <template #left>
        <img
          src="@/assets/images/wep-logo.png"
          alt="Logo"
          class="h-8 w-auto"
        >
        <p class="text-2xl text-primary font-bold">Inside</p>
      </template>

      <template #right>
        <UColorModeButton />

        <UButton
          icon="i-material-symbols:logout"
          aria-label="GitHub"
          color="neutral"
          variant="ghost"
          @click="userStore.logout()"
        />
      </template>
    </UHeader>

    <UMain>
      <UContainer class="pt-8">
        <!-- not logged-in -->
        <AuthLoginForm v-if="showLoginForm" />

        <!-- logged-in -->
        <slot v-else />
      </UContainer>
    </UMain>

    <USeparator icon="i-simple-icons-nuxtdotjs" />

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          Built with Nuxt UI • © {{ new Date().getFullYear() }}
        </p>
      </template>

      <template #right>
        <UButton
          to="https://github.com/wepublish/wepublish"
          target="_blank"
          icon="i-simple-icons-github"
          aria-label="GitHub"
          color="neutral"
          variant="ghost"
        />
      </template>
    </UFooter>
  </UApp>
</template>