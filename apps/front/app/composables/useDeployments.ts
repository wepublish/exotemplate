export interface DeploymentActor {
  name: string
  email: string
  login: string | null
}

/**
 * The latest production deployment of a single medium — which wepublish commit
 * (and the PR / branch it came from) is tagged and running in production.
 * Mirrors the infrastructure-configurator `Deployment` shape.
 */
export interface Deployment {
  media: string
  tag_name: string
  deployed_at: string
  commit_sha: string
  commit_url: string
  commit_message: string
  commit_date: string
  author: DeploymentActor
  committer: DeploymentActor
  // Branch(es) whose tip is the tagged commit — the branch the deploy tag was
  // cut from. Empty when the branch has moved past the tagged commit.
  branches: string[]
  pr_number: number | null
  pr_title: string | null
  head_branch: string | null
  base_branch: string | null
}

export type DeploymentsByMedium = Record<string, Deployment>

interface OverviewResponse {
  data: { deployments: DeploymentsByMedium; fetchedAt: string | null }
}

/**
 * Admin-only: the latest production deployment per medium (via
 * `/monitoring/deployments`). Lazy — never blocks rendering.
 */
export async function useDeploymentsOverview() {
  const { getCustomEndpoint } = useDirectus()
  const { $i18n } = useNuxtApp()

  const { data, pending, error, refresh } = await useAsyncData(
    'deployments-overview',
    async () => {
      try {
        const response = await getCustomEndpoint('monitoring/deployments', {})
        return (response.data as OverviewResponse).data
      } catch (err: any) {
        const firstError = err.response?.data?.errors?.[0]
        throw new Error(
          firstError?.message ||
            err?.message ||
            $i18n.t('common.unexpectedError')
        )
      }
    },
    { lazy: true }
  )

  const deployments = computed<DeploymentsByMedium>(
    () => data.value?.deployments ?? {}
  )
  // Most recently deployed medium first; ties broken by name.
  const media = computed<string[]>(() =>
    Object.keys(deployments.value).sort((a, b) => {
      const da = deployments.value[a]?.deployed_at ?? ''
      const db = deployments.value[b]?.deployed_at ?? ''
      return db.localeCompare(da) || a.localeCompare(b)
    })
  )
  const fetchedAt = computed<string | null>(() => data.value?.fetchedAt ?? null)

  return { deployments, media, fetchedAt, pending, error, refresh }
}
