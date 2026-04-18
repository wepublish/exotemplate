import { InvalidPayloadError } from '@directus/errors'
import axios, { AxiosInstance } from 'axios'
import {
  BOARD_NOT_FOUND_ERROR,
  WORKFLOW_SCHEME_NOT_FOUND_ERROR
} from '../errors'

const JIRA_DOMAIN = 'wepublish.atlassian.net'

// Roles managed by Atlassian itself — never surfaced or modified.
const EXCLUDED_ROLES = new Set(['atlassian-addons-project-access'])

export interface JiraRole {
  name: string
  id: string
  url: string
}

export interface JiraProject {
  id: string
  key: string
  name: string
  self: string
}

export interface JiraWorkflowScheme {
  id: number
  name: string
}

export interface JiraBoard {
  id: number
  name: string
}

export interface JiraUserSummary {
  accountId: string
  displayName: string
  emailAddress: string | null
}

export interface JiraProjectMember {
  accountId: string
  displayName: string
  avatarUrl: string | null
  roles: string[]
}

export interface CustomerInviteResult {
  added: number
  invited: { email: string; accountId: string }[]
  errors: { email: string; error: string }[]
}

export class JiraService {
  private readonly http: AxiosInstance

  constructor(email: string, apiKey: string) {
    this.http = axios.create({
      baseURL: `https://${JIRA_DOMAIN}`,
      auth: { username: email, password: apiKey }
    })
  }

  // Creates a company-managed Scrum project.
  async createProject(params: {
    name: string
    key: string
    leadAccountId: string
    description?: string
  }): Promise<JiraProject> {
    const { data } = await this.http.post('/rest/api/3/project', {
      name: params.name,
      key: params.key.toUpperCase(),
      projectTypeKey: 'software',
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-scrum-template',
      description: params.description ?? '',
      leadAccountId: params.leadAccountId,
      assigneeType: 'UNASSIGNED'
    })
    return data as JiraProject
  }

  async findWorkflowScheme(name: string): Promise<JiraWorkflowScheme> {
    const { data } = await this.http.get('/rest/api/3/workflowscheme', {
      params: { maxResults: 200 }
    })
    const schemes: any[] = Array.isArray(data) ? data : (data.values ?? [])
    const scheme = schemes.find((s: any) => s.name === name)
    if (!scheme) throw new WORKFLOW_SCHEME_NOT_FOUND_ERROR()
    return { id: scheme.id, name: scheme.name }
  }

  async assignWorkflowScheme(
    projectId: string,
    workflowSchemeId: number
  ): Promise<void> {
    await this.http.put('/rest/api/3/workflowscheme/project', {
      projectId,
      workflowSchemeId
    })
  }

  async getProjectBoard(projectKey: string): Promise<JiraBoard> {
    const { data } = await this.http.get('/rest/agile/1.0/board', {
      params: { projectKeyOrId: projectKey, type: 'scrum' }
    })
    const board = (data.values as any[])?.[0]
    if (!board) throw new BOARD_NOT_FOUND_ERROR()
    return { id: board.id, name: board.name }
  }

  async listActiveUsers(): Promise<JiraUserSummary[]> {
    // accountType 'atlassian' filters out service accounts and Connect apps.
    const { data } = await this.http.get('/rest/api/3/users/search', {
      params: {
        query: '',
        maxResults: 200,
        includeActive: true,
        includeInactive: false
      }
    })
    return (data as any[])
      .filter((u) => u.accountType === 'atlassian' && u.active === true)
      .map((u) => ({
        accountId: u.accountId as string,
        displayName: u.displayName as string,
        emailAddress: (u.emailAddress as string | undefined) ?? null
      }))
  }

  async getProjectRoles(projectKey: string): Promise<JiraRole[]> {
    const { data } = await this.http.get(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}/role`
    )
    return Object.entries(data as Record<string, string>)
      .filter(([name]) => !EXCLUDED_ROLES.has(name))
      .map(([name, url]) => ({
        name,
        id: /\/role\/(\d+)/.exec(url)?.[1] ?? '',
        url
      }))
      .filter((r) => r.id)
  }

  async resolveProjectRole(
    projectKey: string,
    roleName: string
  ): Promise<JiraRole> {
    const roles = await this.getProjectRoles(projectKey)
    const role = roles.find((r) => r.name === roleName)
    if (!role) {
      throw new InvalidPayloadError({
        reason: `Role "${roleName}" not found on project "${projectKey}"`
      })
    }
    return role
  }

  async findUserByEmail(email: string): Promise<JiraUserSummary | null> {
    const { data } = await this.http.get('/rest/api/3/user/search', {
      params: { query: email }
    })
    const match = (data as any[]).find(
      (u) => u.emailAddress?.toLowerCase() === email.toLowerCase()
    )
    if (!match) return null
    return {
      accountId: match.accountId,
      displayName: match.displayName,
      emailAddress: match.emailAddress ?? null
    }
  }

  // Invites a new user to the Atlassian site; the invite email is sent by
  // Atlassian. Returns the accountId, or null if the invite fails.
  async inviteNewUser(email: string): Promise<string | null> {
    try {
      const { data } = await this.http.post('/rest/api/3/user', {
        emailAddress: email,
        products: ['jira-software']
      })
      return (data as any).accountId ?? null
    } catch {
      return null
    }
  }

  async addAccountsToRole(
    projectKey: string,
    roleId: string,
    accountIds: string[]
  ): Promise<void> {
    if (accountIds.length === 0) return
    await this.http.post(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}/role/${roleId}`,
      { user: accountIds }
    )
  }

  // Resolves each email to a Jira account (creating one when missing), then
  // assigns the collected accounts to the role in a single API call.
  async inviteCustomersToRole(
    projectKey: string,
    roleName: string,
    emails: string[]
  ): Promise<CustomerInviteResult & { roleName: string }> {
    const role = await this.resolveProjectRole(projectKey, roleName)

    const invited: CustomerInviteResult['invited'] = []
    const errors: CustomerInviteResult['errors'] = []
    const accountIds: string[] = []

    for (const email of emails) {
      try {
        const existing = await this.findUserByEmail(email)
        if (existing) {
          accountIds.push(existing.accountId)
          continue
        }
        const newAccountId = await this.inviteNewUser(email)
        if (newAccountId) {
          accountIds.push(newAccountId)
          invited.push({ email, accountId: newAccountId })
        } else {
          errors.push({
            email,
            error: 'Einladung konnte nicht versendet werden'
          })
        }
      } catch (err: any) {
        errors.push({
          email,
          error: err?.response?.data?.errorMessages?.[0] ?? err.message
        })
      }
    }

    await this.addAccountsToRole(projectKey, role.id, accountIds)

    return {
      roleName: role.name,
      added: accountIds.length,
      invited,
      errors
    }
  }

  async addAccountsToRoleByName(
    projectKey: string,
    roleName: string,
    accountIds: string[]
  ): Promise<{ roleName: string; added: number }> {
    const role = await this.resolveProjectRole(projectKey, roleName)
    await this.addAccountsToRole(projectKey, role.id, accountIds)
    return { roleName: role.name, added: accountIds.length }
  }

  // Aggregates all role memberships for a project into a single per-user view.
  async getProjectMembers(projectKey: string): Promise<JiraProjectMember[]> {
    const roles = await this.getProjectRoles(projectKey)
    const members: Record<string, JiraProjectMember> = {}

    await Promise.all(
      roles.map(async (role) => {
        try {
          const { data } = await this.http.get(role.url)
          for (const actor of (data.actors as any[]) ?? []) {
            if (actor.type !== 'atlassian-user-role-actor') continue
            const accountId = actor.actorUser?.accountId
            if (!accountId) continue

            if (!members[accountId]) {
              members[accountId] = {
                accountId,
                displayName: actor.displayName ?? '',
                avatarUrl: actor.avatarUrl ?? null,
                roles: []
              }
            }
            if (!members[accountId].roles.includes(role.name)) {
              members[accountId].roles.push(role.name)
            }
          }
        } catch {
          // Roles the API user can't read are silently skipped.
        }
      })
    )

    return Object.values(members).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    )
  }
}
