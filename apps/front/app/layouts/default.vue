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
        <NuxtLink to="/">
          <AppLogo class="w-auto h-6 shrink-0" />
        </NuxtLink>

        <TemplateMenu />
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
      <UContainer>
        <AuthLoginForm v-if="showLoginForm" />

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
          to="https://github.com/nuxt-ui-templates/starter"
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

<style>

</style>