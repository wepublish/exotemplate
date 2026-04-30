<script lang="ts" setup>
  import type { JiraWarning } from '~~/types/DirectusTypes'

  defineProps<{
    warning: JiraWarning | null
  }>()

  const emit = defineEmits<{
    confirm: []
    cancel: []
  }>()
</script>

<template>
  <UModal
    :open="warning !== null"
    @update:open="
      (v: boolean) => {
        if (!v) emit('cancel')
      }
    "
  >
    <template #content>
      <div class="p-6 space-y-4">
        <div class="flex items-center gap-3">
          <UIcon
            name="material-symbols:stop-circle-rounded"
            class="text-3xl text-error"
          />
          <h3 class="text-lg font-bold">Arbeit an Ticket stoppen?</h3>
        </div>
        <p class="text-sm">
          Du bist dabei, einen Arbeitsstopp für
          <span class="font-mono font-semibold">{{
            warning?.jira_issue_key
          }}</span>
          anzufordern.
        </p>
        <div class="text-sm space-y-2 border-l-4 border-error-500 pl-3">
          <p>
            <strong>Was passiert jetzt:</strong> Im Slack-Kanal Deines Projekts
            erscheint eine Stopp-Meldung mit Deinem Namen. Das Team wird
            aufgefordert, die Arbeit an diesem Ticket sofort einzustellen.
          </p>
          <p>
            <strong>Bis wann gilt das:</strong> Der Stopp bleibt so lange aktiv,
            bis Du ihn im Dashboard wieder aufhebst. Erst dann darf
            weitergearbeitet werden.
          </p>
          <p class="text-muted">
            Nutze diese Funktion, wenn Du Rücksprache halten willst, bevor
            zusätzliche Stunden verrechnet werden. Für Tickets, die Dich einfach
            nicht mehr interessieren, nutze stattdessen „Stummschalten".
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="emit('cancel')">
            Abbrechen
          </UButton>
          <UButton
            color="error"
            variant="solid"
            icon="material-symbols:stop-circle-rounded"
            @click="emit('confirm')"
          >
            Arbeit stoppen &amp; Kanal informieren
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
