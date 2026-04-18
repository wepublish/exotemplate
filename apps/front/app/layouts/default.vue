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
        <img src="@/assets/images/wep-logo.png" alt="Logo" class="h-8 w-auto" />
        <p class="text-2xl text-primary font-bold">ONE</p>

        <template v-if="userStore.loggedIn">
          <div class="w-px h-6 bg-neutral-200 dark:bg-neutral-700 mx-2" />
          <nav class="flex items-center gap-1">
            <UButton
              to="/"
              variant="ghost"
              color="neutral"
              size="sm"
              icon="material-symbols:home-rounded"
            >
              Dashboard
            </UButton>
            <UButton
              v-if="userStore.amIAdministrator()"
              to="/onboarding"
              variant="ghost"
              color="neutral"
              size="sm"
              icon="material-symbols:person-add-rounded"
            >
              Onboarding
            </UButton>
          </nav>
        </template>
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
      <UContainer class="pt-8 pb-8">
        <!-- not logged-in -->
        <AuthLoginForm v-if="showLoginForm" />

        <!-- logged-in -->
        <slot v-else />
      </UContainer>
    </UMain>

    <USeparator />

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
