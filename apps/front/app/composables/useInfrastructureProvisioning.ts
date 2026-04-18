import {
  ONBOARDING_DATA_KEY,
  ADVANCE_STEP_KEY,
  type InfrastructureResult
} from '~~/types/OnboardingTypes'

interface PendingPr {
  repo: string
  number: number
  title: string
  medium: string
  branch: string
  created_at: string
  url: string
}

export function useInfrastructureProvisioning() {
  const data = inject(ONBOARDING_DATA_KEY)!
  const advanceStep = inject(ADVANCE_STEP_KEY)!
  const directusStore = useDirectus()
  const userStore = useUserStore()
  const toast = useToast()

  const loading = ref(false)
  const polling = ref(false)
  const cancelling = ref(false)
  const checkingPending = ref(false)
  const completed = ref(data.infraResult !== null)
  const executionError = ref<string | null>(null)
  const pollStatus = ref<string | null>(null)

  const editorUrl = computed(
    () => `editor.${data.infraMediumName || '...'}.wepublish.cloud`
  )
  const websiteUrl = computed(() =>
    data.infraCustomHostnames.length
      ? `https://${data.infraCustomHostnames[0]}`
      : `${data.infraMediumName || '...'}.wepublish.cloud`
  )
  const apiUrl = computed(
    () => `https://api.${data.infraMediumName}.wepublish.cloud`
  )

  const mediumNameValid = computed(() =>
    /^[a-z][a-z0-9_]*$/.test(data.infraMediumName)
  )

  async function execute() {
    if (!userStore.amIAdministrator()) {
      executionError.value =
        'Nur Administratoren können diesen Schritt ausführen.'
      return
    }

    if (!mediumNameValid.value) {
      executionError.value =
        'Ungültiger Medium-Name. Nur Kleinbuchstaben, Ziffern und Unterstriche erlaubt (muss mit Buchstabe beginnen).'
      return
    }

    loading.value = true
    executionError.value = null

    try {
      await directusStore.postCustomEndpoint(
        'client-onboarding/create-medium',
        {
          medium_name: data.infraMediumName,
          has_staging: data.infraHasStaging,
          website_enabled: data.infraWebsiteEnabled,
          custom_website_hostnames: data.infraCustomHostnames.length
            ? data.infraCustomHostnames
            : undefined
        }
      )

      loading.value = false
      await pollForCompletion()
    } catch (e: any) {
      loading.value = false
      const msg =
        e?.response?.data?.message ??
        e?.response?.data?.errors?.[0]?.message ??
        e?.message ??
        'Unbekannter Fehler'
      executionError.value = msg
      toast.add({ color: 'error', title: 'Fehler', description: msg })
    }
  }

  async function pollForCompletion() {
    polling.value = true
    pollStatus.value = 'Infrastruktur wird erstellt...'

    const maxAttempts = 60
    const intervalMs = 3000

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await directusStore.getCustomEndpoint(
          `client-onboarding/infra-status/${encodeURIComponent(data.infraMediumName)}`,
          {}
        )

        const job = response.data

        if (job.status === 'completed') {
          data.infraResult = job.result as InfrastructureResult
          completed.value = true
          polling.value = false
          pollStatus.value = null

          toast.add({
            color: 'success',
            title: 'Infrastruktur-PRs erfolgreich erstellt!'
          })
          await advanceStep({ apiUrl: apiUrl.value })
          return
        }

        if (job.status === 'failed') {
          polling.value = false
          pollStatus.value = null
          executionError.value = job.error ?? 'PR-Erstellung fehlgeschlagen'
          toast.add({
            color: 'error',
            title: 'Fehler',
            description: job.error
          })
          return
        }

        pollStatus.value = `Infrastruktur wird erstellt... (${i + 1}/${maxAttempts})`
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
      } catch (e: any) {
        polling.value = false
        pollStatus.value = null
        executionError.value =
          e?.response?.data?.message ??
          e?.message ??
          'Statusabfrage fehlgeschlagen'
        return
      }
    }

    polling.value = false
    pollStatus.value = null
    executionError.value = 'Zeitüberschreitung bei der Infrastruktur-Erstellung'
  }

  async function checkPendingPRs() {
    if (completed.value || !data.infraMediumName) return

    checkingPending.value = true
    try {
      const response = await directusStore.getCustomEndpoint(
        'client-onboarding/infra-pending-prs',
        {}
      )

      const pendingForMedium: PendingPr[] =
        response.data?.pending?.[data.infraMediumName] ?? []

      if (pendingForMedium.length === 0) return

      const configPr = pendingForMedium.find((pr) =>
        pr.repo.endsWith('/application-configuration')
      )
      const websitePr = pendingForMedium.find((pr) =>
        pr.repo.endsWith('/wepublish')
      )

      if (configPr && websitePr) {
        data.infraResult = {
          config_pr: {
            pr_number: configPr.number,
            pr_url: configPr.url,
            branch: configPr.branch
          },
          website_pr: {
            pr_number: websitePr.number,
            pr_url: websitePr.url,
            branch: websitePr.branch
          }
        }
        completed.value = true
        await advanceStep({ apiUrl: apiUrl.value })
      }
    } catch {
      // Silent failure — user can still attempt to create
    } finally {
      checkingPending.value = false
    }
  }

  async function cancelOnboarding() {
    if (!data.infraMediumName) return

    cancelling.value = true
    try {
      await directusStore.deleteCustomEndpoint(
        `client-onboarding/cancel-medium/${encodeURIComponent(data.infraMediumName)}`
      )

      data.infraResult = null
      completed.value = false
      toast.add({
        color: 'info',
        title: 'Infrastruktur-PRs abgebrochen'
      })
      await advanceStep({ apiUrl: null }, { bumpStep: false })
    } catch (e: any) {
      const msg =
        e?.response?.data?.message ?? e?.message ?? 'Abbruch fehlgeschlagen'
      toast.add({ color: 'error', title: 'Fehler', description: msg })
    } finally {
      cancelling.value = false
    }
  }

  return {
    loading,
    polling,
    cancelling,
    checkingPending,
    completed,
    executionError,
    pollStatus,
    editorUrl,
    websiteUrl,
    apiUrl,
    mediumNameValid,
    execute,
    checkPendingPRs,
    cancelOnboarding
  }
}
