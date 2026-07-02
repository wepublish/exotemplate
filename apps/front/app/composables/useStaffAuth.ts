/**
 * GitHub staff login availability + entry URL. The button is only shown when
 * the backend reports the feature configured (all GitHub env vars set), so
 * normal deployments without it see just the standard email/password form.
 */
export function useStaffAuth() {
  const { API_URL } = useDirectus()

  const enabled = ref(false)

  const loginUrl = computed(() => `${API_URL()}/staff-auth/github/login`)

  async function check(): Promise<void> {
    try {
      const res = await $fetch<{ enabled: boolean }>(
        `${API_URL()}/staff-auth/github/status`
      )
      enabled.value = !!res?.enabled
    } catch {
      enabled.value = false
    }
  }

  return { enabled, loginUrl, check }
}
