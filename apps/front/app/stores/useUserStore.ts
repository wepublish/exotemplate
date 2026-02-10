import {
  type ClientDirectusUser,
  type CustomDirectusUser,
  type Client
} from '@/../types/DirectusTypes'
import { readMe, type DirectusRole } from '@directus/sdk'

export const useUserStore = defineStore('useUserStore', () => {
  const { directus } = useDirectus()
  const toast = useToast()
  const route = useRoute()
  const router = useRouter()

  const user = ref<CustomDirectusUser | undefined>(undefined)

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
        title: 'Erfolgreich eingeloggt.'
      })

      // redirect to app in case we are logged-in but initially called a auth/-component
      if (route.path.startsWith('/auth/')) {
        await router.push('/')
      }
    } catch (e) {
      console.log(e)
      toast.add({
        color: 'error',
        title: 'Ein unerwarteter Fehler ist aufgetreten',
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
          },
          {
            accessToClients: [
              {
                Clients_id: [
                  '*',
                  {
                    periods: [
                      '*',
                      {
                        Periods_id: ['*']
                      },
                      {
                        topUps: ['*']
                      },
                      {
                        manualWorkEntries: ['*']
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      })
    )
  }

  async function logout() {
    try {
      await directus.logout()
      user.value = undefined
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

  const clients = computed<Client[]>(() => {
    const clientUsers = (user.value?.accessToClients ||
      []) as ClientDirectusUser[]
    return clientUsers.map((clientUser) => clientUser.Clients_id as Client)
  })

  function amIAdministrator(): boolean {
    return (user.value?.role as DirectusRole)?.name === 'Administrator'
  }

  return {
    loggedIn,
    login,
    logout,
    user,
    clients,
    loadUserData,
    amIAdministrator
  }
})
