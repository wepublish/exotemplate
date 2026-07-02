/**
 * Builds an in-app link that carries the current `/:clientPeriodId` path prefix
 * — like i18n's `localePath`, but for our client/period selection. Use it for
 * every internal link to a client-scoped page so the selection rides along.
 *
 * Falls back to `/` (the redirect-to-default root) when the current route has
 * no period in its path (the bare root or `/auth/*`).
 *
 *   const link = useClientPeriodLink()
 *   link('/team')        // -> '/42/team'
 *   link('/dashboard')   // -> '/42/dashboard'
 */
export function useClientPeriodLink(): (subPath?: string) => string {
  const route = useRoute()
  return (subPath = ''): string => {
    const id = route.params.clientPeriodId
    return id ? `/${id}${subPath}` : '/'
  }
}
