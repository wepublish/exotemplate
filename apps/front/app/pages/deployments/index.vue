<script lang="ts" setup>
  import type { Deployment } from '~/composables/useDeployments'

  const userStore = useUserStore()
  const { t } = useI18n()
  const { formatDateTime } = useFormatters()

  const isAdmin = userStore.amIAdministrator()
  const overview = isAdmin ? await useDeploymentsOverview() : null

  const deployments = computed(() => overview?.deployments.value ?? {})
  const media = computed<string[]>(() => overview?.media.value ?? [])
  const pending = computed<boolean>(() => !!overview?.pending.value)
  const error = computed<Error | null>(
    () => (overview?.error.value as Error | null) ?? null
  )
  const fetchedAt = computed<string | null>(
    () => overview?.fetchedAt.value ?? null
  )

  const search = ref('')
  // Resolved deployment rows (media order is newest-first from the composable),
  // filtered by the search box. Built in script so the template never needs a
  // non-null assertion on the record lookup (Vue can't parse `!`).
  const rows = computed<Deployment[]>(() => {
    const q = search.value.trim().toLowerCase()
    return media.value
      .map((m) => deployments.value[m])
      .filter((d): d is Deployment => !!d)
      .filter((d) => !q || d.media.toLowerCase().includes(q))
  })

  // The branch shown per deployment, and which *kind* it is: the authoritative
  // branch the tag was cut from (tip of the tagged commit) vs. a fallback to the
  // PR's head branch. Surfaced with a distinct label so the two aren't confused
  // (the configurator only returns `branches` once redeployed; older payloads
  // only have the PR head/base branch).
  type BranchInfo = { kind: 'branch' | 'head' | 'none'; value: string }
  const branchInfo = (d: Deployment): BranchInfo => {
    if (d.branches?.length)
      return { kind: 'branch', value: d.branches.join(', ') }
    if (d.head_branch) return { kind: 'head', value: d.head_branch }
    return { kind: 'none', value: '' }
  }

  // Summary: distinct deployed branches + the most recent deploy time.
  const branchCount = computed<number>(() => {
    const set = new Set<string>()
    for (const m of media.value) {
      const d = deployments.value[m]
      if (!d) continue
      if (d.branches?.length) d.branches.forEach((b) => set.add(b))
      else if (d.head_branch) set.add(d.head_branch)
    }
    return set.size
  })
  const lastDeployAt = computed<string | null>(() => {
    let latest: string | null = null
    for (const m of media.value) {
      const d = deployments.value[m]?.deployed_at
      if (d && (!latest || d > latest)) latest = d
    }
    return latest
  })

  const shortSha = (sha: string): string => sha.slice(0, 7)
  const authorLabel = (d: Deployment): string =>
    d.author.login || d.author.name || '—'
  // PR page URL derived from the commit URL (…/commit/<sha> → …/pull/<n>).
  const prUrl = (d: Deployment): string =>
    d.commit_url.replace(/\/commit\/.*$/, `/pull/${d.pr_number}`)
</script>

<template>
  <div class="p-4 sm:p-6">
    <!-- Access denied for non-admins -->
    <div v-if="!isAdmin" class="flex justify-center pt-16">
      <UPageCard class="max-w-md w-full">
        <template #header>
          <div class="flex items-center gap-3">
            <UIcon name="lucide:lock" class="text-3xl text-error" />
            <p class="font-bold text-lg">
              {{ t('common.accessDenied.title') }}
            </p>
          </div>
        </template>
        <UAlert
          color="error"
          variant="soft"
          icon="lucide:user-x"
          :title="t('common.accessDenied.title')"
          :description="t('common.accessDenied.body')"
        />
      </UPageCard>
    </div>

    <template v-else>
      <div class="mb-4">
        <h1 class="text-2xl font-bold">{{ t('deployments.title') }}</h1>
        <p class="text-muted text-sm">{{ t('deployments.subtitle') }}</p>
        <p v-if="fetchedAt" class="text-xs text-muted mt-0.5">
          {{
            t('infrastructure.fetchedAt', { time: formatDateTime(fetchedAt) })
          }}
        </p>
      </div>

      <div v-if="pending" class="flex flex-col gap-3">
        <USkeleton class="h-6 w-40" />
        <USkeleton class="h-24 w-full" />
      </div>

      <UAlert
        v-else-if="error"
        color="error"
        variant="soft"
        icon="lucide:triangle-alert"
        :title="t('deployments.loadError')"
        :description="error.message"
      />

      <UAlert
        v-else-if="!media.length"
        color="info"
        variant="soft"
        icon="lucide:info"
        :title="t('deployments.empty')"
      />

      <div v-else class="flex flex-col gap-4">
        <!-- Summary -->
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            color="primary"
            variant="subtle"
            size="lg"
            icon="lucide:rocket"
          >
            {{
              t(
                'deployments.summary.deployed',
                { count: media.length },
                media.length
              )
            }}
          </UBadge>
          <UBadge
            color="neutral"
            variant="subtle"
            size="lg"
            icon="lucide:git-branch"
          >
            {{
              t(
                'deployments.summary.branches',
                { count: branchCount },
                branchCount
              )
            }}
          </UBadge>
          <UBadge
            v-if="lastDeployAt"
            color="neutral"
            variant="subtle"
            size="lg"
            icon="lucide:clock"
          >
            {{
              t('deployments.summary.lastDeploy', {
                time: formatDateTime(lastDeployAt)
              })
            }}
          </UBadge>
        </div>

        <UInput
          v-model="search"
          icon="lucide:search"
          :placeholder="t('deployments.searchPlaceholder')"
          class="max-w-sm"
        />

        <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          <UCard v-for="d in rows" :key="d.media" variant="subtle">
            <template #header>
              <div class="flex items-center justify-between gap-2 min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <UIcon name="lucide:box" class="text-muted shrink-0" />
                  <span class="font-semibold truncate">{{ d.media }}</span>
                </div>
                <span class="text-xs text-muted shrink-0">
                  {{ formatDateTime(d.deployed_at) }}
                </span>
              </div>
            </template>

            <div class="flex flex-col gap-2 text-sm">
              <!-- Branch: the branch the tag was cut from (tip), or the PR head
                   branch as a clearly-labelled fallback so the two aren't confused -->
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-muted w-24 shrink-0">
                  {{
                    branchInfo(d).kind === 'head'
                      ? t('deployments.card.headBranch')
                      : t('deployments.card.branch')
                  }}
                </span>
                <UBadge
                  v-if="branchInfo(d).kind !== 'none'"
                  :color="branchInfo(d).kind === 'head' ? 'warning' : 'neutral'"
                  variant="soft"
                  icon="lucide:git-branch"
                >
                  {{ branchInfo(d).value }}
                </UBadge>
                <span v-else class="text-muted text-xs">
                  {{ t('deployments.card.unknown') }}
                </span>
              </div>

              <!-- Commit -->
              <div class="flex items-start gap-2">
                <span class="text-muted w-24 shrink-0">
                  {{ t('deployments.card.commit') }}
                </span>
                <div class="min-w-0">
                  <a
                    :href="d.commit_url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-mono text-primary hover:underline"
                  >
                    {{ shortSha(d.commit_sha) }}
                  </a>
                  <span class="text-muted"> · </span>
                  <span class="break-words">{{ d.commit_message }}</span>
                </div>
              </div>

              <!-- PR -->
              <div class="flex items-start gap-2">
                <span class="text-muted w-24 shrink-0">
                  {{ t('deployments.card.pr') }}
                </span>
                <a
                  v-if="d.pr_number != null"
                  :href="prUrl(d)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-primary hover:underline min-w-0 break-words"
                >
                  #{{ d.pr_number }}
                  <span v-if="d.pr_title">— {{ d.pr_title }}</span>
                </a>
                <span v-else class="text-muted">{{
                  t('deployments.card.noPr')
                }}</span>
              </div>

              <!-- Author + tag -->
              <div
                class="flex items-center gap-2 justify-between flex-wrap pt-1"
              >
                <span class="text-xs text-muted flex items-center gap-1">
                  <UIcon name="lucide:user" class="shrink-0" />
                  {{ authorLabel(d) }}
                </span>
                <UBadge
                  color="neutral"
                  variant="outline"
                  size="sm"
                  class="font-mono"
                >
                  {{ d.tag_name }}
                </UBadge>
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </div>
</template>
