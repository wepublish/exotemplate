import { InvalidPayloadError } from '@directus/errors'
import {
  asyncHandler,
  requireAdmin,
  requireBodyParams,
  requireEnv
} from '../guards'
import { JiraService } from '../services/JiraService'
import { BaseController } from './BaseController'

const JIRA_ENV_KEYS = ['JIRA_EMAIL', 'JIRA_API_KEY'] as const

// Role name used to grant full project admin access (team members).
const ADMIN_ROLE_NAME = 'Administrators'

// Role name used to grant external customers access. Matches Jira Service
// Management's default customer role — matched by name so it works across
// projects regardless of numeric role IDs.
const CUSTOMER_ROLE_NAME = 'Service Desk Customers'

const DEFAULT_MEDIA_WORKFLOW_SCHEME_NAME = 'Default Media Workflow'

export class JiraController extends BaseController {
  register(router: any): void {
    router.post('/create-jira-project', asyncHandler(this.createProject))
    router.get('/jira-users', asyncHandler(this.listUsers))
    router.post('/jira-invite-admins', asyncHandler(this.inviteAdmins))
    router.post('/jira-invite-customers', asyncHandler(this.inviteCustomers))
    router.get('/jira-project-members', asyncHandler(this.listProjectMembers))
  }

  // Every endpoint in this controller is admin-only and needs Jira creds.
  // Returns a ready-to-use service, or null if the request was rejected.
  private buildService(req: any, next: any): JiraService | null {
    if (!requireAdmin(req, next)) return null
    const env = requireEnv(this.ctx.env, JIRA_ENV_KEYS, next)
    if (!env) return null
    return new JiraService(env.JIRA_EMAIL, env.JIRA_API_KEY)
  }

  private createProject = async (req: any, res: any, next: any) => {
    const jira = this.buildService(req, next)
    if (!jira) return

    const params = requireBodyParams(
      req.body,
      ['projectName', 'projectKey', 'leadAccountId'],
      next
    )
    if (!params) return

    const project = await jira.createProject({
      name: params.projectName,
      key: params.projectKey,
      leadAccountId: params.leadAccountId,
      description: req.body?.description
    })

    const workflowScheme = await jira.findWorkflowScheme(
      DEFAULT_MEDIA_WORKFLOW_SCHEME_NAME
    )
    await jira.assignWorkflowScheme(project.id, workflowScheme.id)
    const board = await jira.getProjectBoard(project.key)

    return res.json({
      success: true,
      project,
      workflowScheme,
      board
    })
  }

  private listUsers = async (req: any, res: any, next: any) => {
    const jira = this.buildService(req, next)
    if (!jira) return

    const users = await jira.listActiveUsers()
    return res.json({ users })
  }

  private inviteAdmins = async (req: any, res: any, next: any) => {
    const ctx = this.requireProjectContext(req, next)
    if (!ctx) return

    const accountIds = Array.isArray(req.body?.accountIds)
      ? req.body.accountIds
      : []
    if (accountIds.length === 0) {
      return next(new InvalidPayloadError({ reason: 'No accountIds provided' }))
    }

    const result = await ctx.jira.addAccountsToRoleByName(
      ctx.projectKey,
      ADMIN_ROLE_NAME,
      accountIds
    )
    return res.json({ success: true, ...result })
  }

  private inviteCustomers = async (req: any, res: any, next: any) => {
    const ctx = this.requireProjectContext(req, next)
    if (!ctx) return

    const emails = Array.isArray(req.body?.emails) ? req.body.emails : []
    if (emails.length === 0) {
      return next(new InvalidPayloadError({ reason: 'No emails provided' }))
    }

    const result = await ctx.jira.inviteCustomersToRole(
      ctx.projectKey,
      CUSTOMER_ROLE_NAME,
      emails
    )
    return res.json({ success: true, ...result })
  }

  private listProjectMembers = async (req: any, res: any, next: any) => {
    const ctx = this.requireProjectContext(req, next)
    if (!ctx) return

    const members = await ctx.jira.getProjectMembers(ctx.projectKey)
    return res.json({ members })
  }

  // Shared guard for the three endpoints that act on a specific project.
  private requireProjectContext(
    req: any,
    next: any
  ): { jira: JiraService; projectKey: string } | null {
    const jira = this.buildService(req, next)
    if (!jira) return null

    const projectKey = req.body?.projectKey ?? req.query?.projectKey
    if (!projectKey || typeof projectKey !== 'string') {
      next(
        new InvalidPayloadError({
          reason: 'Missing required param: projectKey'
        })
      )
      return null
    }
    return { jira, projectKey }
  }
}
