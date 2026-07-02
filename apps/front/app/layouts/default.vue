<script lang="ts" setup>
  import type { NavigationMenuItem } from '@nuxt/ui'

  const userStore = useUserStore()
  const selection = useClientSelection()
  const route = useRoute()
  const router = useRouter()
  const { t } = useI18n()
  const link = useClientPeriodLink()

  // Any /auth/* route renders its own content (login, forgot/reset password,
  // accept invite) — these must be reachable while logged out. Every other
  // route falls back to the login form when unauthenticated.
  const showLoginForm = computed<boolean>(() => {
    return !userStore.loggedIn && !route.fullPath.startsWith('/auth/')
  })

  // The selection lives in the `/:clientPeriodId` path prefix, so the selector
  // shows on every app route (admin included) and is hidden only on the bare
  // `/` redirect and `/auth/*`. Because every app route carries it, the nav
  // never jumps between pages.
  const showSelector = computed<boolean>(
    () => userStore.loggedIn && !!route.params.clientPeriodId
  )

  // Guard against a stale / unknown period in the path (deleted period, a link
  // to a client the user can no longer see): send them to their default once
  // the client list has loaded.
  watch(
    [() => selection.selectedClientPeriodId, () => selection.clients.length],
    () => {
      if (!userStore.loggedIn) return
      if (!selection.selectedClientPeriodId || !selection.clients.length) return
      if (!selection.selectedClient) {
        const fallback = selection.defaultClientPeriodId()
        if (fallback) router.replace(`/${fallback}/dashboard`)
      }
    },
    { immediate: true }
  )

  /**
   * Nav items shaped for `UNavigationMenu`. The array-of-arrays layout
   * separates the general entries from the admin-only ones with a visible
   * divider in vertical orientation.
   */
  const navItems = computed<NavigationMenuItem[][]>(() => {
    // Every entry keeps the current `/:clientPeriodId` prefix via `link()`, so
    // the selection is preserved when moving between pages — including the
    // admin entries (so it isn't lost hopping admin ↔ client pages).
    const general: NavigationMenuItem[] = [
      {
        label: t('nav.dashboard'),
        icon: 'lucide:house',
        to: link('/dashboard')
      },
      {
        label: t('nav.invoices'),
        icon: 'lucide:receipt-text',
        to: link('/top-ups')
      },
      {
        label: 'Team',
        icon: 'lucide:users',
        to: link('/team')
      },
      {
        label: t('nav.settings'),
        icon: 'lucide:settings',
        to: link('/settings')
      }
    ]

    const groups: NavigationMenuItem[][] = [general]

    if (userStore.amIAdministrator()) {
      groups.push([
        {
          label: t('nav.projectOverview'),
          icon: 'lucide:layout-grid',
          to: link('/overview')
        },
        {
          label: t('nav.timeTrackingOverview'),
          icon: 'lucide:activity',
          to: link('/time-tracking')
        },
        {
          label: t('nav.monitoring'),
          icon: 'lucide:radio-tower',
          to: link('/monitoring')
        },
        {
          label: t('nav.infrastructure'),
          icon: 'lucide:server-cog',
          to: link('/infrastructure')
        },
        {
          label: t('nav.onboarding'),
          icon: 'lucide:user-plus',
          to: link('/onboarding')
        }
      ])

      // External admin tools — their own group so the nav renders a gap that
      // sets them apart from the internal pages. Open in a new tab; not
      // client-scoped, so they use absolute URLs (no `link()` prefix).
      groups.push([
        {
          label: t('nav.infraGateway'),
          icon: 'lucide:shield-check',
          to: 'https://gateway.wepublish.cloud/',
          target: '_blank'
        },
        {
          label: t('nav.redirectService'),
          icon: 'lucide:signpost',
          to: 'https://redirect.wepublish.cloud/login',
          target: '_blank'
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
        class="hidden md:flex sticky top-0 h-screen w-72 shrink-0 flex-col gap-6 border-r border-default bg-elevated p-4"
      >
        <NuxtLink
          :to="link('/dashboard')"
          class="flex min-w-0 shrink-0 items-center gap-2 hover:opacity-80 transition-opacity"
          :aria-label="t('nav.toDashboard')"
        >
          <img
            src="@/assets/images/wep-logo.png"
            alt="Logo"
            class="h-7 w-auto max-w-32 shrink"
          />
          <p class="text-xl text-primary font-bold shrink-0">ONE</p>
        </NuxtLink>

        <ClientPeriodSelector v-if="showSelector" class="shrink-0" />

        <UNavigationMenu
          v-if="userStore.loggedIn"
          orientation="vertical"
          :items="navItems"
          class="-mx-1 min-h-0 flex-1 overflow-y-auto"
        />

        <div
          v-if="userStore.loggedIn"
          class="mt-auto flex shrink-0 items-center justify-between border-t border-default pt-3"
        >
          <div class="flex items-center gap-1">
            <UColorModeButton />
            <LanguageSwitcher />
          </div>
          <UButton
            icon="lucide:log-out"
            :aria-label="t('nav.logout')"
            color="neutral"
            variant="ghost"
            @click="userStore.logout()"
          >
            {{ t('nav.logout') }}
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
          :to="link('/dashboard')"
          class="flex items-center gap-2"
          :aria-label="t('nav.toDashboard')"
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
          <LanguageSwitcher />
          <UButton
            icon="lucide:log-out"
            :aria-label="t('nav.logout')"
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
            <template v-else>
              <!-- Mobile fallback: the sidebar selector is hidden below md. -->
              <ClientPeriodSelector
                v-if="showSelector"
                class="md:hidden mb-6"
              />
              <slot />
            </template>
          </UContainer>
        </UMain>

        <USeparator />

        <UFooter>
          <template #left>
            <p class="text-sm text-muted">
              {{ t('nav.footer', { year: new Date().getFullYear() }) }}
            </p>
          </template>

          <template #right>
            <UButton
              to="https://github.com/wepublish/wepublish"
              target="_blank"
              icon="lucide:github"
              :aria-label="t('nav.github')"
              color="neutral"
              variant="ghost"
            />
          </template>
        </UFooter>
      </div>
    </div>
  </UApp>
</template>
