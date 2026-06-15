<script lang="ts" setup>
  import {
    ONBOARDING_DATA_KEY,
    ADVANCE_STEP_KEY
  } from '~~/types/OnboardingTypes'

  const data = inject(ONBOARDING_DATA_KEY)!
  const advanceStep = inject(ADVANCE_STEP_KEY)!
  const directusStore = useDirectus()
  const userStore = useUserStore()
  const toast = useToast()
  const { t } = useI18n()

  const loading = ref(false)
  const completed = ref(data.slackResult !== null)
  const executionError = ref<string | null>(null)

  // ── Channel name ──────────────────────────────────────────────────────────

  // Pre-fill channel name as wep-[client-name] when client name is set
  watch(
    () => data.clientName,
    (name) => {
      if (name && !data.slackChannel) {
        data.slackChannel = `wep-${name
          ?.toLowerCase()
          ?.replace(/[^a-z0-9]/g, '-')
          ?.replace(/-+/g, '-')
          ?.replace(/^-|-$/g, '')}`
      }
    },
    { immediate: true }
  )

  // Enforce Slack channel name rules on every keystroke
  function normalizeChannelName(value: string) {
    data.slackChannel = value
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80)
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  async function execute() {
    if (!userStore.amIAdministrator()) {
      executionError.value = t('onboarding.steps.slack.adminOnly')
      return
    }

    if (!data.slackChannel.trim()) {
      executionError.value = t('onboarding.steps.slack.channelRequired')
      return
    }

    loading.value = true
    executionError.value = null

    try {
      const result = await directusStore.postCustomEndpoint(
        'client-onboarding/create-slack-channel',
        {
          channelName: data.slackChannel.trim(),
          description: data.slackDescription.trim()
        }
      )

      data.slackResult = result.data

      completed.value = true
      toast.add({
        color: 'success',
        title: t('onboarding.steps.slack.successToast', {
          channel: result.data.channel.name
        })
      })
      await advanceStep({ slack_channel_id: result.data.channel.id })
    } catch (e: any) {
      const msg =
        e?.response?.data?.errors?.[0]?.message ??
        e?.message ??
        t('common.unexpectedError')
      executionError.value = msg
      toast.add({
        color: 'error',
        title: t('onboarding.infrastructure.provisioning.errorTitle'),
        description: msg
      })
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <!-- ── Completed view ──────────────────────────────────────────────────── -->
  <div v-if="completed && data.slackResult" class="flex flex-col gap-4">
    <UAlert color="success" variant="soft" icon="lucide:circle-check">
      <template #title>{{
        t('onboarding.steps.slack.completedTitle')
      }}</template>
      <template #description>
        <template v-if="data.slackResult.channel.name">
          <span class="font-mono font-bold"
            >#{{ data.slackResult.channel.name }}</span
          >
          —
        </template>
        {{ t('onboarding.steps.slack.completedId') }}
        <span class="font-mono">{{ data.slackResult.channel.id }}</span>
      </template>
    </UAlert>

    <a
      :href="composeSlackChannelUrl(data.slackResult.channel.id)"
      target="_blank"
      rel="noopener"
      class="inline-flex items-center gap-2 text-sm text-primary hover:underline"
    >
      <UIcon name="lucide:slack" class="text-base" />
      {{ t('onboarding.steps.slack.openChannel') }}
      <UIcon name="lucide:external-link" class="text-sm" />
    </a>
  </div>

  <!-- ── Form ───────────────────────────────────────────────────────────── -->
  <div v-else class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UAlert color="info" variant="soft" icon="lucide:info">
        <template #description>
          {{ t('onboarding.steps.slack.intro') }}
        </template>
      </UAlert>
    </div>

    <!-- Channel name -->
    <UFormField
      :label="t('onboarding.steps.slack.channelName')"
      name="slackChannel"
      required
      class="col-span-6"
      :hint="t('onboarding.steps.slack.channelNameHint')"
    >
      <UInput
        :model-value="data.slackChannel"
        :placeholder="t('onboarding.steps.slack.channelNamePlaceholder')"
        class="w-full font-mono"
        @update:model-value="normalizeChannelName($event as string)"
      />
    </UFormField>

    <!-- Description -->
    <UFormField
      :label="t('onboarding.steps.slack.descriptionLabel')"
      name="slackDescription"
      class="col-span-6 self-end"
    >
      <UInput
        v-model="data.slackDescription"
        :placeholder="t('onboarding.steps.slack.descriptionPlaceholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Error -->
    <div v-if="executionError" class="col-span-12">
      <UAlert color="error" variant="soft" icon="lucide:circle-alert">
        <template #title>{{
          t('onboarding.infrastructure.provisioning.errorTitle')
        }}</template>
        <template #description>{{ executionError }}</template>
      </UAlert>
    </div>

    <!-- Execute -->
    <div class="col-span-12 flex justify-end pt-2">
      <UButton
        icon="lucide:slack"
        :loading="loading"
        :disabled="!data.slackChannel.trim()"
        @click="execute"
      >
        {{ t('onboarding.steps.slack.execute') }}
      </UButton>
    </div>
  </div>
</template>
