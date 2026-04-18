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

  const tasks: ManualTask[] = [
    {
      id: 'jira-board-setup',
      title: 'Jira Board einrichten',
      description:
        'Benutzerdefinierte Spalten zum Jira Board hinzufügen und den entsprechenden Task-States zuweisen.',
      docsUrl:
        'https://app.gitbook.com/o/YHqG3oopwvkm2NZlFuQH/s/KOvNQoZd9FglYBQaFQAf/manuelle-onboarding-schritte#jira-board-einrichten',
      icon: 'simple-icons:jira'
    },
    {
      id: 'slack-invites',
      title: 'Slack-Einladungen',
      description:
        'Benutzer in den dedizierten Slack-Kanal und #we-share einladen.',
      icon: 'simple-icons:slack'
    },
    {
      id: 'hosting-and-onboarding-invoice',
      title: 'Rechnung für Hosting- und Onboarding erstellen',
      description:
        'Erstelle eine Rechnung für das Hosting (vom Zeitpunkt des Entwicklungsbegins) und für das Onboarding.',
      icon: 'material-symbols:receipt-long-rounded'
    }
  ]

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
    () => tasks.filter((t) => isChecked(t.id)).length
  )

  const allDone = computed(() => completedCount.value === tasks.length)
</script>

<template>
  <div class="flex flex-col gap-4">
    <UAlert color="info" variant="soft" icon="material-symbols:info-rounded">
      <template #description>
        Die folgenden Aufgaben müssen manuell erledigt werden. Hake jede Aufgabe
        ab, sobald sie abgeschlossen ist. Die verlinkte Anleitung beschreibt die
        einzelnen Schritte im Detail.
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
        {{ completedCount }}/{{ tasks.length }} erledigt
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
            icon="material-symbols:open-in-new-rounded"
            tabindex="-1"
          >
            Anleitung
          </UButton>
        </a>
      </div>
    </div>

    <!-- All done hint -->
    <UAlert
      v-if="allDone"
      color="success"
      variant="soft"
      icon="material-symbols:check-circle-rounded"
    >
      <template #description>
        Alle manuellen Aufgaben sind erledigt. Du kannst den Schritt
        abschliessen.
      </template>
    </UAlert>
  </div>
</template>
