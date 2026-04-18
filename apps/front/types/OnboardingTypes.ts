import type { InjectionKey } from 'vue'
import type { Client } from './DirectusTypes'

export interface OnboardingUser {
  id: string
  firstName: string
  lastName: string
  email: string
  password: string
  directusUserId: string | null
}

export interface JiraProjectResult {
  id: string
  key: string
  name: string
  self: string
}

export interface SlackResult {
  channel: { id: string; name: string }
}

export interface InfrastructurePrResult {
  pr_number: number
  pr_url: string
  branch: string
}

export interface InfrastructureResult {
  config_pr: InfrastructurePrResult
  website_pr: InfrastructurePrResult
}

export interface OnboardingData {
  // Step 1: Directus
  clientName: string
  clientId: string | null
  users: OnboardingUser[]
  selectedRoleId: string | null

  // Step 2: Jira
  jiraProjectName: string
  jiraProjectKey: string
  jiraLeadAccountId: string
  jiraDescription: string
  jiraResult: JiraProjectResult | null
  jiraTeamAccountIds: string[]
  jiraClientEmails: string[]

  // Step 3: Slack
  slackChannel: string
  slackDescription: string
  slackResult: SlackResult | null

  // Step 4: Bexio
  bexioCompany: string
  bexioEmail: string
  bexioStreet: string
  bexioStreetNumber: string
  bexioZip: string
  bexioCity: string
  bexioContactId: number | null

  // Step 5: Clockodo
  clockodoId: string | null

  // Step 6: Infrastructure
  infraMediumName: string
  infraHasStaging: boolean
  infraWebsiteEnabled: boolean
  infraCustomHostnames: string[]
  infraResult: InfrastructureResult | null

  // Step 7: Manual tasks
  // Step 8: Invoices (reuses manualChecklist via TASK_ID)
  manualChecklist: string[]

  // Step 9: Email
  emailTo: string
  emailSubject: string
}

export const ONBOARDING_DATA_KEY: InjectionKey<OnboardingData> =
  Symbol('onboardingData')

export interface AdvanceStepOptions {
  /** When false, only persists the patch without bumping the current step. */
  bumpStep?: boolean
  /** Explicit value to write into onboarding_current_step (overrides default). */
  targetStep?: number
}

export const ADVANCE_STEP_KEY: InjectionKey<
  (patch?: Partial<Client>, options?: AdvanceStepOptions) => Promise<void>
> = Symbol('advanceStep')

let _userCounter = 0

export function createEmptyUser(): OnboardingUser {
  return {
    id: String(++_userCounter),
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    directusUserId: null
  }
}

export function createEmptyOnboardingData(): OnboardingData {
  _userCounter = 0
  return {
    clientName: '',
    clientId: null,
    users: [createEmptyUser()],
    selectedRoleId: null,
    jiraProjectName: '',
    jiraProjectKey: '',
    jiraLeadAccountId: '',
    jiraDescription: '',
    jiraResult: null,
    jiraTeamAccountIds: [],
    jiraClientEmails: [],
    slackChannel: '',
    slackDescription: '',
    slackResult: null,
    bexioCompany: '',
    bexioEmail: '',
    bexioStreet: '',
    bexioStreetNumber: '',
    bexioZip: '',
    bexioCity: '',
    bexioContactId: null,
    clockodoId: null,
    infraMediumName: '',
    infraHasStaging: false,
    infraWebsiteEnabled: true,
    infraCustomHostnames: [],
    infraResult: null,
    manualChecklist: [],
    emailTo: '',
    emailSubject: 'Willkommen bei We.Publish – deine wichtigsten Links'
  }
}
