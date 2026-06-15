<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import type { InviteResultStatus, TeamMember } from '~/composables/useTeam'

  // Self-service team management, scoped to the client currently selected in
  // the sidebar: invite teammates to it (or grant access directly if the email
  // already exists), see who has access, and revoke it. The backend /team
  // endpoint enforces that you actually hold the client; new accounts always
  // get the Client role.

  const toast = useToast()
  const userStore = useUserStore()
  const { invite, listMembers, removeMember } = useTeam()

  const selection = useClientSelection()
  const { selectedClient, clients } = storeToRefs(selection)

  const myUserId = computed<string | undefined>(
    () => (userStore.user as { id?: string } | undefined)?.id
  )

  // ── Invite form ─────────────────────────────────────────────────────────
  const schema = z.object({
    email: z.email('Bitte eine gültige E-Mail-Adresse eingeben.'),
    firstName: z.string().min(1, 'Bitte einen Vornamen eingeben.'),
    lastName: z.string().min(1, 'Bitte einen Nachnamen eingeben.')
  })
  type Schema = z.output<typeof schema>

  const form = reactive({
    email: '',
    firstName: '',
    lastName: ''
  })
  const inviting = ref(false)

  const inviteTitles: Record<InviteResultStatus, string> = {
    invite: 'Einladung gesendet.',
    reinvite: 'Einladung erneut gesendet.',
    grant: 'Zugriff erteilt (bestehendes Konto).'
  }

  function errMsg(e: unknown): string | undefined {
    const anyE = e as {
      response?: { data?: { errors?: { message?: string }[] } }
      message?: string
    }
    return anyE?.response?.data?.errors?.[0]?.message ?? anyE?.message
  }

  async function submitInvite(_event: FormSubmitEvent<Schema>): Promise<void> {
    const client = selectedClient.value
    if (!client) return
    inviting.value = true
    try {
      const res = await invite({
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        clientIds: [client.id]
      })
      toast.add({ color: 'success', title: inviteTitles[res.status] })
      form.email = ''
      form.firstName = ''
      form.lastName = ''
      await loadMembers()
    } catch (e) {
      toast.add({
        color: 'error',
        title: 'Einladung fehlgeschlagen',
        description: errMsg(e)
      })
    } finally {
      inviting.value = false
    }
  }

  // ── Member list (selected client) ────────────────────────────────────────
  const members = ref<TeamMember[]>([])
  const membersLoading = ref(false)
  // userId currently awaiting remove-confirmation
  const confirmingRemove = ref<string | null>(null)
  const removing = ref<Set<string>>(new Set())

  async function loadMembers(): Promise<void> {
    const client = selectedClient.value
    if (!client) {
      members.value = []
      return
    }
    membersLoading.value = true
    try {
      members.value = await listMembers(client.id)
    } catch (e) {
      members.value = []
      toast.add({
        color: 'error',
        title: 'Mitglieder konnten nicht geladen werden',
        description: errMsg(e)
      })
    } finally {
      membersLoading.value = false
    }
  }

  // Reload whenever the selected client changes (and once on mount). Guarded
  // to the client so the SDK call never fires during SSR (no auth token there).
  watch(
    () => selectedClient.value?.id,
    () => {
      confirmingRemove.value = null
      if (import.meta.client) loadMembers()
    },
    { immediate: true }
  )

  async function doRemove(member: TeamMember): Promise<void> {
    removing.value.add(member.id)
    try {
      await removeMember(member.linkId)
      toast.add({ color: 'success', title: 'Zugriff entfernt.' })
      await loadMembers()
    } catch (e) {
      toast.add({
        color: 'error',
        title: 'Entfernen fehlgeschlagen',
        description: errMsg(e)
      })
    } finally {
      removing.value.delete(member.id)
      confirmingRemove.value = null
    }
  }

  function memberName(m: TeamMember): string {
    const n = [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
    return n || m.email
  }

  function statusBadge(status: string): {
    color: 'success' | 'warning' | 'neutral'
    label: string
  } {
    if (status === 'active') return { color: 'success', label: 'Aktiv' }
    if (status === 'invited') return { color: 'warning', label: 'Eingeladen' }
    return { color: 'neutral', label: status }
  }
</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <h1 class="text-2xl font-bold">Team</h1>
      <p class="text-muted text-sm">
        Lade Teammitglieder zum oben gewählten Mandanten ein. Neue Personen
        erhalten eine E-Mail mit einem Link, um ihr Passwort zu setzen.
        Existiert die E-Mail-Adresse bereits, wird der Zugriff direkt erteilt.
      </p>
    </div>

    <!-- No client access -->
    <div v-if="!clients.length" class="col-span-12">
      <UAlert color="info" variant="soft" icon="lucide:info">
        <template #title>Kein Mandantenzugriff</template>
        <template #description>
          Dir ist aktuell kein Mandant zugewiesen, daher kannst du niemanden
          einladen.
        </template>
      </UAlert>
    </div>

    <template v-else-if="selectedClient">
      <!-- Invite form -->
      <div class="col-span-12">
        <UPageCard>
          <template #header>
            <div class="flex items-center gap-3 min-w-0">
              <UIcon
                name="lucide:user-plus"
                class="text-2xl shrink-0 text-muted"
              />
              <p class="font-semibold truncate">
                Teammitglied einladen — {{ selectedClient.name }}
              </p>
            </div>
          </template>

          <UForm
            :schema="schema"
            :state="form"
            class="grid grid-cols-12 gap-3"
            @submit="submitInvite"
          >
            <UFormField
              label="E-Mail"
              name="email"
              required
              class="col-span-12 md:col-span-6"
            >
              <UInput
                v-model="form.email"
                type="email"
                placeholder="name@medium.ch"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Vorname"
              name="firstName"
              required
              class="col-span-12 md:col-span-6"
            >
              <UInput v-model="form.firstName" class="w-full" />
            </UFormField>
            <UFormField
              label="Nachname"
              name="lastName"
              required
              class="col-span-12 md:col-span-6"
            >
              <UInput v-model="form.lastName" class="w-full" />
            </UFormField>

            <div class="col-span-12 flex justify-end">
              <UButton type="submit" :loading="inviting" icon="lucide:send">
                Einladen
              </UButton>
            </div>
          </UForm>
        </UPageCard>
      </div>

      <!-- Members of the selected client -->
      <div class="col-span-12">
        <UPageCard>
          <template #header>
            <div class="flex items-center gap-3 min-w-0">
              <UIcon
                name="lucide:building-2"
                class="text-2xl shrink-0 text-muted"
              />
              <p class="font-semibold truncate">{{ selectedClient.name }}</p>
              <USkeleton v-if="membersLoading" class="h-4 w-16" />
            </div>
          </template>

          <div
            v-if="!membersLoading && !members.length"
            class="text-sm text-muted"
          >
            Noch keine Mitglieder.
          </div>

          <ul v-else class="divide-y">
            <li
              v-for="member in members"
              :key="member.id"
              class="py-3 flex items-center justify-between gap-4 flex-wrap"
            >
              <div class="flex items-center gap-3 min-w-0">
                <UIcon name="lucide:user" class="text-xl shrink-0 text-muted" />
                <div class="min-w-0">
                  <p class="font-medium truncate">
                    {{ memberName(member) }}
                    <span
                      v-if="member.id === myUserId"
                      class="text-xs text-muted"
                      >(du)</span
                    >
                  </p>
                  <p class="text-xs text-muted truncate">{{ member.email }}</p>
                </div>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <UBadge
                  :color="statusBadge(member.status).color"
                  variant="subtle"
                  size="sm"
                >
                  {{ statusBadge(member.status).label }}
                </UBadge>

                <!-- inline confirm -->
                <template v-if="confirmingRemove === member.id">
                  <span class="text-xs text-muted">Entfernen?</span>
                  <UButton
                    size="xs"
                    color="error"
                    :loading="removing.has(member.id)"
                    @click="doRemove(member)"
                  >
                    Ja
                  </UButton>
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    @click="confirmingRemove = null"
                  >
                    Abbrechen
                  </UButton>
                </template>
                <UButton
                  v-else
                  size="xs"
                  variant="ghost"
                  color="error"
                  icon="lucide:user-minus"
                  :disabled="member.id === myUserId"
                  :title="
                    member.id === myUserId
                      ? 'Du kannst deinen eigenen Zugriff hier nicht entfernen.'
                      : 'Zugriff entfernen'
                  "
                  @click="confirmingRemove = member.id"
                />
              </div>
            </li>
          </ul>
        </UPageCard>
      </div>
    </template>
  </div>
</template>
