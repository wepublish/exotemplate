<script lang="ts" setup>
  import {
    ONBOARDING_DATA_KEY,
    ADVANCE_STEP_KEY
  } from '~~/types/OnboardingTypes'

  interface ManualTask {
    id: string
    title: string
    description?: string
    docsUrl?: string
    icon: string
  }

  const { t } = useI18n()

  const tasks = computed<ManualTask[]>(() => [
    {
      id: 'jira-board-setup',
      title: t('onboarding.steps.manualTasks.tasks.jiraBoardSetup.title'),
      description: t(
        'onboarding.steps.manualTasks.tasks.jiraBoardSetup.description'
      ),
      docsUrl:
        'https://app.gitbook.com/o/YHqG3oopwvkm2NZlFuQH/s/KOvNQoZd9FglYBQaFQAf/manuelle-onboarding-schritte#jira-board-einrichten',
      icon: 'lucide:square-kanban'
    },
    {
      id: 'slack-invites',
      title: t('onboarding.steps.manualTasks.tasks.slackInvites.title'),
      description: t(
        'onboarding.steps.manualTasks.tasks.slackInvites.description'
      ),
      icon: 'lucide:slack'
    }
  ])

  const data = inject(ONBOARDING_DATA_KEY)!
  const advanceStep = inject(ADVANCE_STEP_KEY)!

  function isChecked(taskId: string) {
    return data.manualChecklist.includes(taskId)
  }

  async function toggle(taskId: string) {
    const idx = data.manualChecklist.indexOf(taskId)
    if (idx === -1) {
      data.manualChecklist.push(taskId)
    } else {
      data.manualChecklist.splice(idx, 1)
    }
    if (data.clientId) {
      await advanceStep(
        { onboarding_manual_checklist: [...data.manualChecklist] },
        { bumpStep: false }
      )
    }
  }

  const completedCount = computed(
    () => tasks.value.filter((task) => isChecked(task.id)).length
  )

  const allDone = computed(() => completedCount.value === tasks.value.length)
</script>

<template>
  <div class="flex flex-col gap-4">
    <UAlert color="info" variant="soft" icon="lucide:info">
      <template #description>
        {{ t('onboarding.steps.manualTasks.intro') }}
      </template>
    </UAlert>

    <!-- Progress -->
    <div class="flex items-center gap-3">
      <UProgress
        :model-value="Math.round((completedCount / tasks.length) * 100)"
        size="sm"
        :color="allDone ? 'success' : 'primary'"
        class="flex-1"
      />
      <span class="text-xs text-muted whitespace-nowrap">
        {{
          t('onboarding.steps.manualTasks.doneCount', {
            completed: completedCount,
            total: tasks.length
          })
        }}
      </span>
    </div>

    <!-- Checklist -->
    <div class="flex flex-col gap-2">
      <div
        v-for="task in tasks"
        :key="task.id"
        class="flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer"
        :class="
          isChecked(task.id)
            ? 'border-success/40 bg-success/5'
            : 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'
        "
        @click="toggle(task.id)"
      >
        <UCheckbox
          :model-value="isChecked(task.id)"
          class="mt-0.5"
          @update:model-value="toggle(task.id)"
          @click.stop
        />

        <UIcon
          :name="task.icon"
          class="text-lg shrink-0 mt-0.5"
          :class="isChecked(task.id) ? 'text-success' : 'text-muted'"
        />

        <div class="flex-1 min-w-0">
          <p
            class="text-sm font-medium"
            :class="isChecked(task.id) ? 'line-through text-muted' : ''"
          >
            {{ task.title }}
          </p>
          <p v-if="task.description" class="text-xs text-muted mt-0.5">
            {{ task.description }}
          </p>
        </div>

        <a
          v-if="task.docsUrl"
          :href="task.docsUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="shrink-0 mt-0.5"
          @click.stop
        >
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="lucide:external-link"
            tabindex="-1"
          >
            {{ t('onboarding.steps.manualTasks.docs') }}
          </UButton>
        </a>
      </div>
    </div>

    <!-- All done hint -->
    <UAlert
      v-if="allDone"
      color="success"
      variant="soft"
      icon="lucide:circle-check"
    >
      <template #description>
        {{ t('onboarding.steps.manualTasks.allDone') }}
      </template>
    </UAlert>
  </div>
</template>
