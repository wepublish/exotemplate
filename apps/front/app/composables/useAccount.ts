import {
  authentication,
  createDirectus,
  rest,
  updateMe
} from '@directus/sdk'
import type { Schema } from '~~/types/DirectusTypes'

export function useAccount() {
  const { directus, API_URL } = useDirectus()
  const userStore = useUserStore()

  function currentEmail(): string {
    // CustomDirectusUser is a trimmed wrapper; email is present at runtime
    // (readMe fetches '*') but not on the interface — same cast pattern the
    // store uses for `role`.
    const email = (userStore.user as { email?: string } | undefined)?.email
    if (!email) throw new Error('Nicht angemeldet.')
    return email
  }

  /**
   * Change the logged-in user's password. The current password is verified
   * first via a throwaway Directus client that uses the default in-memory
   * storage — so the verification login never writes to localStorage and the
   * real session/tokens are untouched. On success the change is applied with
   * the existing authenticated client via `updateMe`.
   *
   * Throws a German error message on a wrong current password or a failed
   * update so the form can surface it directly.
   */
  async function changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const email = currentEmail()

    const verifier = createDirectus<Schema>(API_URL())
      .with(authentication('json'))
      .with(rest())
    try {
      await verifier.login({ email, password: currentPassword })
    } catch {
      throw new Error('Das aktuelle Passwort ist nicht korrekt.')
    }

    await directus.request(updateMe({ password: newPassword }))
  }

  return { changePassword }
}
