<script lang="ts" setup>
  import {
    ghcrPackageUrl,
    imageTagOf,
    orderedComponentKeys,
    parseImageTag,
    shortSha,
    type InfraEnvironmentConfig,
    type InfraProviderRef
  } from '~/utils/infraConfig'

  const props = defineProps<{ env: InfraEnvironmentConfig }>()

  const { t } = useI18n()
  const { formatDateTime } = useFormatters()

  const urls = computed(() => {
    const u = props.env.urls ?? {}
    return [
      { key: 'api', label: t('infrastructure.urls.api'), url: u.api },
      { key: 'editor', label: t('infrastructure.urls.editor'), url: u.editor },
      {
        key: 'website',
        label: t('infrastructure.urls.website'),
        url: u.website
      },
      {
        key: 'mediaServer',
        label: t('infrastructure.urls.mediaServer'),
        url: u.media_server
      }
    ].filter((r) => !!r.url)
  })

  const componentKeys = computed(() =>
    orderedComponentKeys(props.env.components)
  )

  function componentLabel(key: string): string {
    const known = ['api', 'editor', 'website', 'media', 'migration']
    return known.includes(key) ? t(`infrastructure.components.${key}`) : key
  }

  function imageOf(key: string): string {
    return props.env.components?.[key]?.image ?? ''
  }

  function parsedFor(key: string) {
    return parseImageTag(imageTagOf(imageOf(key)))
  }

  function packageUrlFor(key: string): string | null {
    return ghcrPackageUrl(imageOf(key))
  }

  // Integrations flattened into labelled chip groups.
  function providerLabel(p: InfraProviderRef | undefined): string | null {
    if (!p) return null
    return p.id && p.id !== p.type
      ? `${p.type} · ${p.id}`
      : (p.type ?? p.id ?? null)
  }

  const cfg = computed(() => props.env.config ?? {})
  const paymentChips = computed(() =>
    (cfg.value.paymentProviders ?? [])
      .map((p) => providerLabel(p))
      .filter((x): x is string => !!x)
  )
  const trackingChips = computed(() =>
    (cfg.value.trackingPixelProviders ?? [])
      .map((p) => providerLabel(p))
      .filter((x): x is string => !!x)
  )
  const mediaServerLabel = computed(() => {
    const m = cfg.value.mediaServer
    if (!m?.type) return null
    return m.quality != null ? `${m.type} · Q${m.quality}` : m.type
  })
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
    <!-- URLs -->
    <UPageCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="lucide:link" class="text-primary text-lg" />
          <span class="font-semibold">{{
            t('infrastructure.cards.urls')
          }}</span>
        </div>
      </template>
      <ul class="divide-y">
        <li
          v-for="r in urls"
          :key="r.key"
          class="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
        >
          <span class="text-sm text-muted shrink-0">{{ r.label }}</span>
          <a
            :href="r.url"
            target="_blank"
            rel="noopener"
            class="text-sm text-primary hover:underline truncate"
          >
            {{ r.url }}
          </a>
        </li>
      </ul>
    </UPageCard>

    <!-- Deployed versions -->
    <UPageCard>
      <template #header>
        <div class="flex items-center justify-between w-full gap-2">
          <div class="flex items-center gap-2">
            <UIcon
              name="lucide:git-commit-horizontal"
              class="text-primary text-lg"
            />
            <span class="font-semibold">
              {{ t('infrastructure.cards.versions') }}
            </span>
          </div>
          <UBadge
            v-if="env.helm_chart_version"
            color="neutral"
            variant="subtle"
            size="sm"
          >
            {{ t('infrastructure.versions.chartVersion') }}
            {{ env.helm_chart_version }}
          </UBadge>
        </div>
      </template>
      <ul class="divide-y">
        <li
          v-for="key in componentKeys"
          :key="key"
          class="py-2 first:pt-0 last:pb-0"
        >
          <div class="flex items-start justify-between gap-3">
            <span class="text-sm font-medium shrink-0">
              {{ componentLabel(key) }}
            </span>
            <div class="text-right min-w-0">
              <div class="text-sm tabular-nums">
                <span v-if="parsedFor(key).releasedAt">
                  {{ formatDateTime(parsedFor(key).releasedAt) }}
                </span>
                <span v-else class="text-muted">
                  {{ t('infrastructure.versions.unknown') }}
                </span>
              </div>
              <div class="text-xs text-muted truncate">
                {{ parsedFor(key).channel
                }}<template v-if="shortSha(parsedFor(key).sha)">
                  · {{ shortSha(parsedFor(key).sha) }}</template
                >
              </div>
            </div>
          </div>
          <!-- Deployed image reference, linked to its GHCR package page. -->
          <a
            v-if="packageUrlFor(key)"
            :href="packageUrlFor(key)!"
            target="_blank"
            rel="noopener"
            class="mt-1 block text-xs font-mono text-primary hover:underline truncate"
            :title="imageOf(key)"
          >
            {{ imageOf(key) }}
          </a>
          <span
            v-else
            class="mt-1 block text-xs font-mono text-muted truncate"
            :title="imageOf(key)"
          >
            {{ imageOf(key) }}
          </span>
        </li>
      </ul>
    </UPageCard>

    <!-- Resources -->
    <UPageCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="lucide:cpu" class="text-primary text-lg" />
          <span class="font-semibold">
            {{ t('infrastructure.cards.resources') }}
          </span>
        </div>
      </template>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-xs text-muted text-left">
              <th class="py-1 pe-3 font-medium">
                {{ t('infrastructure.resources.component') }}
              </th>
              <th class="py-1 pe-3 font-medium">
                {{ t('infrastructure.resources.cpu') }}
              </th>
              <th class="py-1 font-medium">
                {{ t('infrastructure.resources.memory') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr v-for="key in componentKeys" :key="key">
              <td class="py-2 pe-3 font-medium">{{ componentLabel(key) }}</td>
              <td class="py-2 pe-3 tabular-nums whitespace-nowrap">
                {{ env.components?.[key]?.resources?.requests?.cpu ?? '–' }}
                <span class="text-muted">/</span>
                {{ env.components?.[key]?.resources?.limits?.cpu ?? '–' }}
              </td>
              <td class="py-2 tabular-nums whitespace-nowrap">
                {{ env.components?.[key]?.resources?.requests?.memory ?? '–' }}
                <span class="text-muted">/</span>
                {{ env.components?.[key]?.resources?.limits?.memory ?? '–' }}
              </td>
            </tr>
          </tbody>
        </table>
        <p class="text-xs text-muted mt-2">
          {{ t('infrastructure.resources.requests') }} /
          {{ t('infrastructure.resources.limits') }}
        </p>
      </div>
    </UPageCard>

    <!-- Integrations -->
    <UPageCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="lucide:plug" class="text-primary text-lg" />
          <span class="font-semibold">
            {{ t('infrastructure.cards.integrations') }}
          </span>
        </div>
      </template>
      <dl class="flex flex-col gap-3 text-sm">
        <div class="flex items-start justify-between gap-3">
          <dt class="text-muted shrink-0">
            {{ t('infrastructure.integrations.mail') }}
          </dt>
          <dd>
            <UBadge
              v-if="providerLabel(cfg.mailProvider)"
              color="neutral"
              variant="subtle"
              size="sm"
            >
              {{ providerLabel(cfg.mailProvider) }}
            </UBadge>
            <span v-else class="text-muted">
              {{ t('infrastructure.integrations.none') }}
            </span>
          </dd>
        </div>

        <div class="flex items-start justify-between gap-3">
          <dt class="text-muted shrink-0">
            {{ t('infrastructure.integrations.payments') }}
          </dt>
          <dd class="flex flex-wrap gap-1 justify-end">
            <UBadge
              v-for="p in paymentChips"
              :key="p"
              color="neutral"
              variant="subtle"
              size="sm"
            >
              {{ p }}
            </UBadge>
            <span v-if="!paymentChips.length" class="text-muted">
              {{ t('infrastructure.integrations.none') }}
            </span>
          </dd>
        </div>

        <div class="flex items-start justify-between gap-3">
          <dt class="text-muted shrink-0">
            {{ t('infrastructure.integrations.challenge') }}
          </dt>
          <dd>
            <UBadge
              v-if="providerLabel(cfg.challenge)"
              color="neutral"
              variant="subtle"
              size="sm"
            >
              {{ providerLabel(cfg.challenge) }}
            </UBadge>
            <span v-else class="text-muted">
              {{ t('infrastructure.integrations.none') }}
            </span>
          </dd>
        </div>

        <div class="flex items-start justify-between gap-3">
          <dt class="text-muted shrink-0">
            {{ t('infrastructure.integrations.tracking') }}
          </dt>
          <dd class="flex flex-wrap gap-1 justify-end">
            <UBadge
              v-for="p in trackingChips"
              :key="p"
              color="neutral"
              variant="subtle"
              size="sm"
            >
              {{ p }}
            </UBadge>
            <span v-if="!trackingChips.length" class="text-muted">
              {{ t('infrastructure.integrations.none') }}
            </span>
          </dd>
        </div>

        <div class="flex items-start justify-between gap-3">
          <dt class="text-muted shrink-0">
            {{ t('infrastructure.integrations.ai') }}
          </dt>
          <dd>
            <UBadge
              v-if="providerLabel(cfg.aiProvider)"
              color="neutral"
              variant="subtle"
              size="sm"
            >
              {{ providerLabel(cfg.aiProvider) }}
            </UBadge>
            <span v-else class="text-muted">
              {{ t('infrastructure.integrations.none') }}
            </span>
          </dd>
        </div>

        <div class="flex items-start justify-between gap-3">
          <dt class="text-muted shrink-0">
            {{ t('infrastructure.integrations.mediaServer') }}
          </dt>
          <dd>
            <UBadge
              v-if="mediaServerLabel"
              color="neutral"
              variant="subtle"
              size="sm"
            >
              {{ mediaServerLabel }}
            </UBadge>
            <span v-else class="text-muted">
              {{ t('infrastructure.integrations.none') }}
            </span>
          </dd>
        </div>
      </dl>
    </UPageCard>
  </div>
</template>
