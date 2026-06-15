/**
 * Applies the user's preferred language on the client:
 *  1. Immediately restore the last-used locale from localStorage so a reload
 *     doesn't flash German before the user record loads.
 *  2. Once the Directus user is (re)loaded, apply the authoritative
 *     `directus_users.language` value.
 */
export default defineNuxtPlugin(async () => {
  const { applyStoredLocale, syncLocaleFromUser } = useAppLocale()
  const userStore = useUserStore()

  await applyStoredLocale()

  watch(
    () => userStore.user?.language,
    () => {
      void syncLocaleFromUser()
    },
    { immediate: true }
  )
})
