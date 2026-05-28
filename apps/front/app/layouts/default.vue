<script lang="ts" setup>
  import type { NavigationMenuItem } from '@nuxt/ui'

  const userStore = useUserStore()
  const route = useRoute()

  const showLoginForm = computed<boolean>(() => {
    return !userStore.loggedIn && !route.fullPath.startsWith('/auth/login')
  })

  /**
   * Nav items shaped for `UNavigationMenu`. The array-of-arrays layout
   * separates the general entries from the admin-only ones with a visible
   * divider in vertical orientation.
   */
  const navItems = computed<NavigationMenuItem[][]>(() => {
    const general: NavigationMenuItem[] = [
      {
        label: 'Dashboard',
        icon: 'material-symbols:home-rounded',
        to: '/'
      },
      {
        label: 'Einstellungen',
        icon: 'material-symbols:settings-rounded',
        to: '/settings'
      }
    ]

    const groups: NavigationMenuItem[][] = [general]

    if (userStore.amIAdministrator()) {
      groups.push([
        {
          label: 'Projektübersicht',
          icon: 'material-symbols:grid-view-rounded',
          to: '/overview'
        },
        {
          label: 'Übersicht Zeiterfassung',
          icon: 'material-symbols:monitoring',
          to: '/time-tracking'
        },
        {
          label: 'Onboarding',
          icon: 'material-symbols:person-add-rounded',
          to: '/onboarding'
        }
      ])
    }

    return groups
  })
</script>

<template>
  <UApp>
    <div class="flex min-h-screen">
      <!--
        Left sidebar — hosts logo, nav, and the per-user controls. Hidden on
        very small screens so phone users still see the main content; a proper
        slide-out drawer can come later.
      -->
      <aside
        class="hidden md:flex w-72 shrink-0 flex-col gap-6 border-r border-default bg-elevated p-4"
      >
        <NuxtLink
          to="/"
          class="flex min-w-0 items-center gap-2 hover:opacity-80 transition-opacity"
          aria-label="Zum Dashboard"
        >
          <img
            src="@/assets/images/wep-logo.png"
            alt="Logo"
            class="h-7 w-auto max-w-32 shrink"
          />
          <p class="text-xl text-primary font-bold shrink-0">ONE</p>
        </NuxtLink>

        <UNavigationMenu
          v-if="userStore.loggedIn"
          orientation="vertical"
          :items="navItems"
          class="-mx-1 flex-1"
        />

        <div
          v-if="userStore.loggedIn"
          class="mt-auto flex items-center justify-between border-t border-default pt-3"
        >
          <UColorModeButton />
          <UButton
            icon="i-material-symbols:logout"
            aria-label="Abmelden"
            color="neutral"
            variant="ghost"
            @click="userStore.logout()"
          >
            Abmelden
          </UButton>
        </div>
      </aside>

      <!--
        Mobile-only top bar: small surface with just the logo and the most
        critical actions so the page is still usable below md.
      -->
      <header
        v-if="userStore.loggedIn"
        class="md:hidden fixed top-0 inset-x-0 z-40 flex items-center justify-between border-b border-default bg-default p-3"
      >
        <NuxtLink
          to="/"
          class="flex items-center gap-2"
          aria-label="Zum Dashboard"
        >
          <img
            src="@/assets/images/wep-logo.png"
            alt="Logo"
            class="h-7 w-auto"
          />
          <span class="text-xl text-primary font-bold">ONE</span>
        </NuxtLink>
        <div class="flex items-center gap-1">
          <UColorModeButton />
          <UButton
            icon="i-material-symbols:logout"
            aria-label="Abmelden"
            color="neutral"
            variant="ghost"
            @click="userStore.logout()"
          />
        </div>
      </header>

      <div class="flex-1 flex flex-col min-w-0">
        <UMain class="flex-1 md:pt-0 pt-16">
          <UContainer class="pt-8 pb-8">
            <AuthLoginForm v-if="showLoginForm" />
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
      </div>
    </div>
  </UApp>
</template>
