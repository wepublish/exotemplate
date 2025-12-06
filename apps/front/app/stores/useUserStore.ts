import {type CustomDirectusUser} from '@/../types/DirectusTypes'
import { readMe } from '@directus/sdk'

export const useUserStore = defineStore('useUserStore', () => {
  const directus = useDirectus()
  const toast = useToast()
  const route = useRoute()
  const router = useRouter()

  const user = ref<CustomDirectusUser | undefined>(undefined)
  
  async function login({ email, password }: { email?: string, password?: string }) {
    try {
      // manual login with credentials
      if (email && password) {
        await directus.login({ email, password })
      }

      if (!directus.getToken()) {
        toast.add({
          color: 'error',
          title: 'Missing Access Token'
        })
        return
      }

      // load user
      user.value = await directus.request<CustomDirectusUser>(readMe({
        fields: ['*']
      }))

      toast.add({
        color: 'success',
        title: 'Erfolgreich eingeloggt.'
      })

      // redirect to app in case we are logged in but initially called a auth/-component
      if (route.path.startsWith('/auth/')) {
        await router.push('/index')
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

  return {
    login
  }
})