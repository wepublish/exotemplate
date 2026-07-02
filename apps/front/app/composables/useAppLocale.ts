import { updateMe } from '@directus/sdk'
import type { AppLocale } from '~~/types/DirectusTypes'

export const SUPPORTED_LOCALES: AppLocale[] = ['de', 'fr', 'en']

const LOCALE_STORAGE_KEY = 'wep_locale'

/**
 * Map a stored language value to a supported app locale. The Directus user's
 * `language` field may hold a bare code (`de`) or a legacy admin locale tag
 * (`de-DE`, `fr-FR`), so we match on the prefix and fall back to German.
 */
export function resolveLocale(stored: string | null | undefined): AppLocale {
  const value = (stored ?? '').toLowerCase()
  if (value.startsWith('fr')) return 'fr'
  if (value.startsWith('en')) return 'en'
  return 'de'
}

/**
 * Locale control for the dashboard. The active language is a per-user
 * preference persisted on the Directus user (`directus_users.language`) and
 * mirrored to localStorage so a reload restores it instantly, before the user
 * record has been re-fetched. `setLocale` is used (not `locale.value =`) so the
 * lazily-loaded message catalog for the target locale is fetched first.
 *
 * Named `useAppLocale` (not `useLocale`) to avoid colliding with the
 * auto-imported `useLocale` shipped by `@nuxt/ui`.
 */
export function useAppLocale() {
  const { $i18n } = useNuxtApp()
  const directusStore = useDirectus()
  const userStore = useUserStore()

  function currentLocale(): AppLocale {
    return resolveLocale($i18n.locale.value)
  }

  async function applyLocale(code: AppLocale): Promise<void> {
    await $i18n.setLocale(code)
    if (import.meta.client) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, code)
    }
  }

  /** Restore the last-used locale from localStorage (client, pre-auth). */
  async function applyStoredLocale(): Promise<void> {
    if (!import.meta.client) return
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored) await $i18n.setLocale(resolveLocale(stored))
  }

  /** Apply the locale stored on the currently loaded Directus user. */
  async function syncLocaleFromUser(): Promise<void> {
    const lang = userStore.user?.language
    if (!lang) return
    await applyLocale(resolveLocale(lang))
  }

  /** User-initiated language change: apply, persist to Directus, confirm. */
  async function setUserLanguage(code: AppLocale): Promise<void> {
    const toast = useToast()
    await applyLocale(code)
    try {
      await directusStore.directus.request(updateMe({ language: code }))
      if (userStore.user) userStore.user.language = code
      toast.add({
        color: 'success',
        title: $i18n.t('settings.language.updated')
      })
    } catch (e) {
      toast.add({
        color: 'error',
        title: $i18n.t('common.unexpectedError'),
        description: e as string
      })
    }
  }

  return {
    SUPPORTED_LOCALES,
    currentLocale,
    applyLocale,
    applyStoredLocale,
    syncLocaleFromUser,
    setUserLanguage
  }
}
