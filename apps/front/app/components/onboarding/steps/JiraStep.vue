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

  // ── Jira users (shared: lead picker + team member multi-select) ──────────

  interface JiraUser {
    accountId: string
    displayName: string
    emailAddress: string | null
  }

  interface JiraUserOption extends JiraUser {
    label: string
  }

  const jiraUsers = ref<JiraUser[]>([])
  const loadingUsers = ref(false)
  const usersError = ref<string | null>(null)

  const userOptions = computed<JiraUserOption[]>(() =>
    jiraUsers.value.map((u) => ({
      ...u,
      label: u.emailAddress
        ? `${u.displayName} — ${u.emailAddress}`
        : u.displayName
    }))
  )

  // Map accountId → JiraUser for O(1) lookup (used to enrich project members)
  const usersByAccountId = computed(
    () =>
      new Map(
        jiraUsers.value.map((u) => [u.accountId, u] as [string, JiraUser])
      )
  )

  async function fetchJiraUsers() {
    if (!userStore.amIAdministrator()) return

    loadingUsers.value = true
    usersError.value = null

    try {
      const result = await directusStore.getCustomEndpoint(
        'client-onboarding/jira-users',
        {}
      )
      jiraUsers.value = result.data.users
    } catch (e: any) {
      usersError.value =
        e?.response?.data?.errors?.[0]?.message ??
        e?.message ??
        'Jira-Benutzer konnten nicht geladen werden.'
    } finally {
      loadingUsers.value = false
    }
  }

  // ── Project creation ─────────────────────────────────────────────────────

  const loading = ref(false)
  const completed = ref(data.jiraResult !== null)
  const executionError = ref<string | null>(null)

  watch(
    () => data.clientName,
    (name) => {
      if (name && !data.jiraProjectName) {
        data.jiraProjectName = name
      }
      if (name && !data.jiraProjectKey) {
        data.jiraProjectKey = name
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 10)
      }
    },
    { immediate: true }
  )

  async function execute() {
    if (!data.jiraProjectName.trim() || !data.jiraProjectKey.trim()) {
      executionError.value = 'Projektname und Projektkürzel sind erforderlich.'
      return
    }
    if (!data.jiraLeadAccountId.trim()) {
      executionError.value = 'Bitte einen Projektverantwortlichen auswählen.'
      return
    }

    loading.value = true
    executionError.value = null

    try {
      const result = await directusStore.postCustomEndpoint(
        'client-onboarding/create-jira-project',
        {
          projectName: data.jiraProjectName.trim(),
          projectKey: data.jiraProjectKey.trim().toUpperCase(),
          leadAccountId: data.jiraLeadAccountId.trim(),
          description: data.jiraDescription.trim()
        }
      )

      data.jiraResult = result.data.project

      completed.value = true
      toast.add({
        color: 'success',
        title: 'Jira-Projekt erfolgreich erstellt!'
      })
      await advanceStep({ jira_short_code: result.data.project.key })
      await fetchProjectMembers()
    } catch (e: any) {
      const msg =
        e?.response?.data?.errors?.[0]?.message ??
        e?.message ??
        'Unbekannter Fehler'
      executionError.value = msg
      toast.add({ color: 'error', title: 'Fehler', description: msg })
    } finally {
      loading.value = false
    }
  }

  // ── Invitations & members ────────────────────────────────────────────────

  interface ProjectMember {
    accountId: string
    displayName: string
    avatarUrl: string | null
    roles: string[]
  }

  const projectMembers = ref<ProjectMember[]>([])
  const loadingMembers = ref(false)
  const invitingAdmins = ref(false)
  const invitingCustomers = ref(false)
  const adminError = ref<string | null>(null)
  const customerError = ref<string | null>(null)
  const newClientEmail = ref('')

  function addClientEmail() {
    const email = newClientEmail.value.trim().toLowerCase()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.add({ color: 'warning', title: 'Ungültige E-Mail-Adresse' })
      return
    }
    if (!data.jiraClientEmails.includes(email)) {
      data.jiraClientEmails.push(email)
    }
    newClientEmail.value = ''
  }

  function removeClientEmail(index: number) {
    data.jiraClientEmails.splice(index, 1)
  }

  async function fetchProjectMembers() {
    if (!data.jiraResult?.key) return
    loadingMembers.value = true
    try {
      const result = await directusStore.getCustomEndpoint(
        'client-onboarding/jira-project-members',
        { projectKey: data.jiraResult.key }
      )
      projectMembers.value = result.data.members ?? []
    } catch {
      projectMembers.value = []
    } finally {
      loadingMembers.value = false
    }
  }

  function extractErrorMessage(e: any, fallback: string): string {
    return e?.response?.data?.errors?.[0]?.message ?? e?.message ?? fallback
  }

  async function inviteAdmins() {
    if (!data.jiraResult?.key) return
    if (data.jiraTeamAccountIds.length === 0) {
      adminError.value = 'Bitte mindestens einen Team-Benutzer auswählen.'
      return
    }

    invitingAdmins.value = true
    adminError.value = null

    try {
      const result = await directusStore.postCustomEndpoint(
        'client-onboarding/jira-invite-admins',
        {
          projectKey: data.jiraResult.key,
          accountIds: data.jiraTeamAccountIds
        }
      )
      toast.add({
        color: 'success',
        title: `${result.data.added} Benutzer zu "${result.data.roleName}" hinzugefügt`
      })
      await fetchProjectMembers()
    } catch (e: any) {
      const msg = extractErrorMessage(e, 'Einladung fehlgeschlagen')
      adminError.value = msg
      toast.add({ color: 'error', title: 'Fehler', description: msg })
    } finally {
      invitingAdmins.value = false
    }
  }

  async function inviteCustomers() {
    if (!data.jiraResult?.key) return
    if (data.jiraClientEmails.length === 0) {
      customerError.value = 'Bitte mindestens eine Kunden-E-Mail eingeben.'
      return
    }

    invitingCustomers.value = true
    customerError.value = null

    try {
      const result = await directusStore.postCustomEndpoint(
        'client-onboarding/jira-invite-customers',
        {
          projectKey: data.jiraResult.key,
          emails: data.jiraClientEmails
        }
      )

      const { added = 0, invited = [], errors = [], roleName } = result.data

      // Always clear emails after sending — nothing is persisted.
      data.jiraClientEmails = []

      if (errors.length === 0) {
        toast.add({
          color: 'success',
          title: `${added} Kunden zu "${roleName}" hinzugefügt`,
          description: invited.length
            ? `${invited.length} neu eingeladen`
            : undefined
        })
      } else {
        toast.add({
          color: 'warning',
          title: `${added} erfolgreich, ${errors.length} Fehler`,
          description: errors
            .map(
              (e: { email: string; error: string }) => `${e.email}: ${e.error}`
            )
            .join('\n')
        })
      }
      await fetchProjectMembers()
    } catch (e: any) {
      const msg = extractErrorMessage(e, 'Einladung fehlgeschlagen')
      customerError.value = msg
      toast.add({ color: 'error', title: 'Fehler', description: msg })
    } finally {
      invitingCustomers.value = false
    }
  }

  // Client emails are transient — always start empty, even on session resume
  // or hot reload (any stale saved value is discarded here).
  data.jiraClientEmails = []

  onMounted(async () => {
    await fetchJiraUsers()
    if (completed.value && data.jiraResult?.key) {
      await fetchProjectMembers()
    }
  })
</script>

<template>
  <!-- Already completed -->
  <div v-if="completed && data.jiraResult" class="flex flex-col gap-4">
    <UAlert
      color="success"
      variant="soft"
      icon="material-symbols:check-circle-rounded"
    >
      <template #title>Jira-Projekt erfolgreich erstellt</template>
      <template #description>
        Projekt-Key:
        <span class="font-mono font-bold">{{ data.jiraResult.key }}</span>
        <template v-if="data.jiraResult.id">
          — ID: {{ data.jiraResult.id }}</template
        >
      </template>
    </UAlert>

    <div class="grid grid-cols-12 gap-3">
      <div
        class="col-span-6 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <p class="text-xs text-muted">Projektname</p>
        <p class="font-medium">{{ data.clientName }}</p>
      </div>
      <div
        class="col-span-6 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <p class="text-xs text-muted">Projektkürzel</p>
        <p class="font-mono font-bold">{{ data.jiraResult.key }}</p>
      </div>
    </div>

    <a
      :href="composeJiraProjectUrl(data.jiraResult.key)"
      target="_blank"
      rel="noopener"
      class="inline-flex items-center gap-2 text-sm text-primary hover:underline"
    >
      <UIcon name="simple-icons:jira" class="text-base" />
      Projekt in Jira öffnen
      <UIcon name="material-symbols:open-in-new-rounded" class="text-sm" />
    </a>

    <!-- ── User invitations ─────────────────────────────────────────────── -->
    <div class="flex flex-col gap-3 mt-2">
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold">Benutzer einladen</p>
        <UBadge variant="subtle" color="neutral">
          {{ projectMembers.length }} Mitglied(er)
        </UBadge>
      </div>

      <!-- Team members: multi-select from existing Jira users -->
      <div
        class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 flex flex-col gap-2"
      >
        <p class="text-xs font-semibold text-muted uppercase tracking-wider">
          Team-Mitglieder (Administratoren-Zugriff)
        </p>
        <p class="text-xs text-muted">
          Bestehende Jira-Benutzer auswählen — sie erhalten vollen Admin-Zugriff
          auf das Projekt.
        </p>
        <USkeleton v-if="loadingUsers" class="h-8 w-full" />
        <USelectMenu
          v-else
          v-model="data.jiraTeamAccountIds"
          multiple
          :items="userOptions"
          value-key="accountId"
          label-key="label"
          searchable
          :search-attributes="['label']"
          placeholder="Team-Mitglieder auswählen…"
          class="w-full"
        />

        <UAlert
          v-if="adminError"
          color="error"
          variant="soft"
          icon="material-symbols:error-rounded"
        >
          <template #description>{{ adminError }}</template>
        </UAlert>

        <div class="flex justify-end">
          <UButton
            icon="material-symbols:shield-person-rounded"
            :loading="invitingAdmins"
            :disabled="data.jiraTeamAccountIds.length === 0"
            @click="inviteAdmins"
          >
            Administratoren hinzufügen
          </UButton>
        </div>
      </div>

      <!-- Client emails -->
      <div
        class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 flex flex-col gap-2"
      >
        <p class="text-xs font-semibold text-muted uppercase tracking-wider">
          Kunden-E-Mails (Kunden-Rolle)
        </p>
        <p class="text-xs text-muted">
          Externe Kunden: Falls noch kein Jira-Account existiert, wird eine
          Einladung per E-Mail versendet.
        </p>
        <div class="flex gap-2">
          <UInput
            v-model="newClientEmail"
            type="email"
            placeholder="kunde@beispiel.ch"
            class="flex-1"
            @keydown.enter.prevent="addClientEmail"
          />
          <UButton
            icon="material-symbols:add-rounded"
            variant="outline"
            color="neutral"
            :disabled="!newClientEmail.trim()"
            @click="addClientEmail"
          >
            Hinzufügen
          </UButton>
        </div>

        <div v-if="data.jiraClientEmails.length" class="flex flex-wrap gap-1.5">
          <div
            v-for="(email, index) in data.jiraClientEmails"
            :key="email"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono"
          >
            {{ email }}
            <button
              class="hover:text-error transition-colors"
              @click="removeClientEmail(index)"
            >
              <UIcon name="material-symbols:close-rounded" class="text-sm" />
            </button>
          </div>
        </div>

        <UAlert
          v-if="customerError"
          color="error"
          variant="soft"
          icon="material-symbols:error-rounded"
        >
          <template #description>{{ customerError }}</template>
        </UAlert>

        <div class="flex justify-end">
          <UButton
            icon="material-symbols:mail-rounded"
            :loading="invitingCustomers"
            :disabled="data.jiraClientEmails.length === 0"
            @click="inviteCustomers"
          >
            Kunden einladen
          </UButton>
        </div>
      </div>

      <!-- Current members -->
      <div
        class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 flex flex-col gap-2 mt-2"
      >
        <div class="flex items-center justify-between">
          <p class="text-xs font-semibold text-muted uppercase tracking-wider">
            Aktuelle Projekt-Mitglieder
          </p>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="material-symbols:refresh-rounded"
            :loading="loadingMembers"
            @click="fetchProjectMembers"
          >
            Aktualisieren
          </UButton>
        </div>

        <USkeleton v-if="loadingMembers" class="h-16 w-full" />

        <p
          v-else-if="projectMembers.length === 0"
          class="text-sm text-muted italic"
        >
          Keine Mitglieder gefunden.
        </p>

        <div v-else class="flex flex-col gap-1.5">
          <div
            v-for="member in projectMembers"
            :key="member.accountId"
            class="flex items-center gap-3 py-1"
          >
            <img
              v-if="member.avatarUrl"
              :src="member.avatarUrl"
              class="w-7 h-7 rounded-full"
              alt=""
            />
            <div
              v-else
              class="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold"
            >
              {{ member.displayName.charAt(0) }}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">
                {{ member.displayName }}
              </p>
              <p
                v-if="usersByAccountId.get(member.accountId)?.emailAddress"
                class="text-xs text-muted font-mono truncate"
              >
                {{ usersByAccountId.get(member.accountId)?.emailAddress }}
              </p>
            </div>
            <div class="flex flex-wrap gap-1">
              <UBadge
                v-for="role in member.roles"
                :key="role"
                size="xs"
                variant="subtle"
                color="neutral"
              >
                {{ role }}
              </UBadge>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Form -->
  <div v-else class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UAlert color="info" variant="soft" icon="material-symbols:info-rounded">
        <template #description>
          Ein neues Jira-Projekt mit dem Workflow-Schema «Default Media
          Workflow» anlegen und das Board konfigurieren.
        </template>
      </UAlert>
    </div>

    <div v-if="!data.clientId" class="col-span-12">
      <UAlert
        color="warning"
        variant="soft"
        icon="material-symbols:warning-rounded"
      >
        <template #description>
          Schritt 1 (Directus) muss zuerst abgeschlossen werden, damit der
          Client-Eintrag nach der Projekterstellung aktualisiert werden kann.
        </template>
      </UAlert>
    </div>

    <UFormField
      label="Projektname"
      name="jiraProjectName"
      required
      class="col-span-6"
    >
      <UInput
        v-model="data.jiraProjectName"
        placeholder="z.B. Muster AG"
        class="w-full"
      />
    </UFormField>

    <UFormField
      label="Projektkürzel (Key)"
      name="jiraProjectKey"
      required
      class="col-span-6"
      hint="Max. 10 Zeichen, nur Grossbuchstaben und Zahlen"
    >
      <UInput
        v-model="data.jiraProjectKey"
        placeholder="z.B. MUSTERAG"
        class="w-full font-mono"
        @input="
          data.jiraProjectKey = data.jiraProjectKey
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 10)
        "
      />
    </UFormField>

    <UFormField
      label="Projektverantwortliche/r (Lead)"
      name="jiraLeadAccountId"
      required
      class="col-span-12"
      hint="Jira-Account-ID wird automatisch gesetzt"
    >
      <USkeleton v-if="loadingUsers" class="h-8 w-full" />

      <div v-else-if="usersError" class="flex flex-col gap-2">
        <UAlert
          color="warning"
          variant="soft"
          icon="material-symbols:warning-rounded"
          class="text-sm"
        >
          <template #description>
            {{ usersError }} — Account-ID manuell eingeben:
          </template>
        </UAlert>
        <div class="flex gap-2">
          <UInput
            v-model="data.jiraLeadAccountId"
            placeholder="z.B. 5b10a2844c20165700ede21g"
            class="w-full font-mono"
          />
          <UButton
            size="sm"
            variant="outline"
            icon="material-symbols:refresh-rounded"
            :loading="loadingUsers"
            @click="fetchJiraUsers"
          >
            Erneut laden
          </UButton>
        </div>
      </div>

      <template v-else>
        <USelectMenu
          v-model="data.jiraLeadAccountId"
          :items="userOptions"
          value-key="accountId"
          label-key="label"
          searchable
          :search-attributes="['label']"
          placeholder="Jira-Benutzer suchen…"
          class="w-full"
        />
        <p
          v-if="data.jiraLeadAccountId"
          class="text-xs text-muted mt-1 font-mono"
        >
          Account-ID: {{ data.jiraLeadAccountId }}
        </p>
      </template>
    </UFormField>

    <UFormField
      label="Beschreibung (optional)"
      name="jiraDescription"
      class="col-span-12"
    >
      <UTextarea
        v-model="data.jiraDescription"
        placeholder="Kurze Beschreibung des Projekts..."
        :rows="2"
        class="w-full"
      />
    </UFormField>

    <div v-if="executionError" class="col-span-12">
      <UAlert
        color="error"
        variant="soft"
        icon="material-symbols:error-rounded"
      >
        <template #title>Fehler beim Erstellen</template>
        <template #description>{{ executionError }}</template>
      </UAlert>
    </div>

    <div class="col-span-12 flex justify-end pt-2">
      <UButton icon="simple-icons:jira" :loading="loading" @click="execute">
        Jira-Projekt erstellen
      </UButton>
    </div>
  </div>
</template>
