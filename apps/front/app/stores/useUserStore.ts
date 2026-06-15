import { type CustomDirectusUser, type Client } from '@/../types/DirectusTypes'
import { readMe, readItems, type DirectusRole } from '@directus/sdk'

export const useUserStore = defineStore('useUserStore', () => {
  const { directus } = useDirectus()
  const toast = useToast()
  const route = useRoute()
  const router = useRouter()
  const { $i18n } = useNuxtApp()

  const user = ref<CustomDirectusUser | undefined>(undefined)
  const clientList = ref<Client[]>([])

  async function login({
    email,
    password
  }: {
    email?: string
    password?: string
  }) {
    try {
      // manual login with credentials
      if (email && password) {
        await directus.login({ email, password })
      }

      const accessToken = await directus.getToken()

      if (!accessToken) {
        return
      }

      // load user
      await loadUserData()

      toast.add({
        color: 'success',
        title: $i18n.t('auth.loginSuccess')
      })

      // redirect to app in case we are logged-in but initially called a auth/-component
      if (route.path.startsWith('/auth/')) {
        await router.push('/')
      }
    } catch (e) {
      console.log(e)
      toast.add({
        color: 'error',
        title: $i18n.t('common.unexpectedError'),
        description: e as any as string
      })
    }
  }

  async function loadUserData() {
    user.value = await directus.request<CustomDirectusUser>(
      readMe({
        fields: [
          '*',
          {
            role: ['name']
          }
        ]
      })
    )

    // The set of clients a user may see is governed entirely by Directus
    // permissions, not by an explicit allowedUsers lookup here: a Client-role
    // user gets the clients they're linked to (the Client policy's row-level
    // `allowedUsers == $CURRENT_USER` filter), while an Administrator gets every
    // client because admin_access bypasses that filter. This is why a new admin
    // user does not need to be added to each client's allowedUsers.
    clientList.value = (await directus.request(
      readItems('Clients', {
        fields: [
          '*',
          {
            periods: [
              '*',
              {
                Periods_id: ['*']
              },
              {
                manualWorkEntries: ['*']
              }
            ]
          }
        ],
        limit: -1
      })
    )) as Client[]
  }

  async function logout() {
    try {
      await directus.logout()
      user.value = undefined
      clientList.value = []
    } catch (e) {
      toast.add({
        color: 'error',
        description: e as string
      })
    }
  }

  const loggedIn = computed<boolean>(() => {
    return !!user.value
  })

  const clients = computed<Client[]>(() => clientList.value)

  function amIAdministrator(): boolean {
    return (user.value?.role as DirectusRole)?.name === 'Administrator'
  }

  /**
   * Patch a single client in the in-memory list. Used by the settings page to
   * reflect a saved change (billing mode, notification pause, language, …)
   * immediately and app-wide, without re-fetching the whole user payload.
   */
  function patchClient(id: string, patch: Partial<Client>): void {
    const index = clientList.value.findIndex((client) => client.id === id)
    if (index === -1) return
    clientList.value[index] = {
      ...clientList.value[index],
      ...patch
    } as Client
  }

  return {
    loggedIn,
    login,
    logout,
    user,
    clients,
    loadUserData,
    amIAdministrator,
    patchClient
  }
})
