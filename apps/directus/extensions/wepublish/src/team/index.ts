import { defineEndpoint } from '@directus/extensions-sdk'
import { ForbiddenError, InvalidPayloadError, createError } from '@directus/errors'
import { asyncHandler } from '../client-onboarding/guards'
import {
  decideInviteAction,
  isValidEmail,
  missingClientLinks,
  normalizeClientIds,
  normalizeEmail,
  unauthorizedClientIds,
  type ExistingUser
} from './inviteLogic'

// Endpoint that provisions client access from the frontend, so clients never
// touch the Directus admin app. The single route here, POST /invite, is the
// part that genuinely needs server-side elevation:
//   - it looks an email up across ALL users (a client can't, and shouldn't be
//     able to, read users they don't already share a client with)
//   - it creates/invites users and forces the Client role
//   - it links users to clients after authorizing the caller
//
// Listing members and revoking access are NOT here — they are done directly
// from the frontend with the @directus/sdk against `Clients_directus_users`,
// governed by the Client policy's row-level permissions (read/delete filtered
// to "clients the current user belongs to").
//
// Privileged writes run with a *system* service (no accountability ⇒
// unrestricted) — but only after we authorize the caller against their own,
// JWT-verified access. The Client role keeps invited users out of the admin
// app (app_access: false) while still letting them log in via the API.

const JUNCTION = 'Clients_directus_users'
const CLIENT_ROLE_NAME = 'Client'
const INVITE_SUBJECT = 'Willkommen bei We.Publish ONE – Konto aktivieren'

const ClientRoleMissingError = createError(
  'CLIENT_ROLE_MISSING',
  `The "${CLIENT_ROLE_NAME}" role does not exist; cannot provision client users.`,
  500
)

export default defineEndpoint((router, context) => {
  const { services, getSchema } = context

  // ── helpers ───────────────────────────────────────────────────────────────

  // Foreign-key values come back either as a bare id or an expanded object.
  const fkId = (value: any): string =>
    value && typeof value === 'object' ? String(value.id) : String(value)

  // Client ids the caller actually holds, among the requested ones. Read with a
  // system service but filtered on the verified JWT user id, so it does not
  // depend on the Client policy granting read access to the junction table.
  async function accessibleClientIds(
    schema: any,
    callerUserId: string,
    clientIds: string[]
  ): Promise<string[]> {
    const junction = new services.ItemsService(JUNCTION, { schema })
    const rows = await junction.readByQuery({
      filter: {
        directus_users_id: { _eq: callerUserId },
        Clients_id: { _in: clientIds }
      },
      fields: ['Clients_id'],
      limit: -1
    })
    return rows.map((r: any) => fkId(r.Clients_id))
  }

  // Shared gate for every route. Throws ForbiddenError / InvalidPayloadError.
  async function authorize(
    req: any,
    clientIds: string[],
    schema: any
  ): Promise<{ isAdmin: boolean; userId: string }> {
    const accountability = req.accountability
    if (!accountability?.user) throw new ForbiddenError()
    if (!clientIds.length) {
      throw new InvalidPayloadError({ reason: 'clientIds must not be empty' })
    }
    const isAdmin = accountability.admin === true
    if (!isAdmin) {
      const accessible = await accessibleClientIds(
        schema,
        accountability.user,
        clientIds
      )
      if (unauthorizedClientIds(clientIds, accessible, false).length) {
        throw new ForbiddenError()
      }
    }
    return { isAdmin, userId: accountability.user }
  }

  async function resolveClientRoleId(schema: any): Promise<string> {
    const roles = new services.ItemsService('directus_roles', { schema })
    const found = await roles.readByQuery({
      filter: { name: { _eq: CLIENT_ROLE_NAME } },
      fields: ['id'],
      limit: 1
    })
    if (!found?.length) throw new ClientRoleMissingError()
    return found[0].id
  }

  // Create only the junction rows that don't exist yet (idempotent).
  async function ensureClientLinks(
    schema: any,
    userId: string,
    clientIds: string[]
  ): Promise<string[]> {
    const junction = new services.ItemsService(JUNCTION, { schema })
    const rows = await junction.readByQuery({
      filter: {
        directus_users_id: { _eq: userId },
        Clients_id: { _in: clientIds }
      },
      fields: ['Clients_id'],
      limit: -1
    })
    const linked = rows.map((r: any) => fkId(r.Clients_id))
    const toCreate = missingClientLinks(clientIds, linked)
    if (toCreate.length) {
      await junction.createMany(
        toCreate.map((cid) => ({ Clients_id: cid, directus_users_id: userId }))
      )
    }
    return toCreate
  }

  const loginUrlFrom = (inviteUrl?: string): string | null => {
    if (!inviteUrl) return null
    try {
      return `${new URL(inviteUrl).origin}/auth/login`
    } catch {
      return null
    }
  }

  // Pick a safe base URL for a generated invite link. We only ever build the
  // link from an allow-listed URL (USER_INVITE_URL_ALLOW_LIST) — honouring the
  // caller's requested URL when it's on the list, otherwise the first entry —
  // so a caller can never make us mint a valid invite token pointing at an
  // arbitrary (phishing) URL. Returns null when nothing is allow-listed.
  const inviteBaseUrl = (requested?: string): string | null => {
    const list = String(context.env['USER_INVITE_URL_ALLOW_LIST'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!list.length) return null
    if (requested && list.includes(requested)) return requested
    return list[0]!
  }

  const escapeHtml = (s: string): string =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[c] as string
    )

  // Plain "you now have access" notice for users who already have a usable
  // account (Directus' inviteUser intentionally does nothing for them).
  async function sendAccessGrantedMail(
    schema: any,
    email: string,
    firstName: string | undefined,
    clientIds: string[],
    inviteUrl?: string
  ): Promise<void> {
    const clientsService = new services.ItemsService('Clients', { schema })
    const clients = await clientsService
      .readMany(clientIds, { fields: ['name'] })
      .catch(() => [])
    const names = (clients ?? [])
      .map((c: any) => c?.name)
      .filter((n: any): n is string => typeof n === 'string' && n.length > 0)
    const loginUrl = loginUrlFrom(inviteUrl)
    const greeting = firstName ? `Hallo ${escapeHtml(firstName)}` : 'Hallo'
    const list = names.length
      ? `<ul>${names.map((n: string) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
      : ''
    const loginLine = loginUrl
      ? `<p>Melde dich mit deinem bestehenden Konto an: <a href="${loginUrl}">${loginUrl}</a></p>`
      : '<p>Melde dich mit deinem bestehenden Konto bei We.Publish ONE an.</p>'

    const mail = new services.MailService({ schema })
    await mail.send({
      to: email,
      subject: 'Du hast Zugriff in We.Publish ONE erhalten',
      html: `<p>${greeting}</p><p>Dir wurde Zugriff auf folgende Mandate in We.Publish ONE erteilt:</p>${list}${loginLine}`
    })
  }

  // ── POST /team/invite ───────────────────────────────────────────────────
  // Invite a teammate / grant access. Used by both the self-service team page
  // and the onboarding wizard.
  router.post(
    '/invite',
    asyncHandler(async (req: any, res: any) => {
      const schema = await getSchema()

      const email = normalizeEmail(req.body?.email)
      if (!isValidEmail(email)) {
        throw new InvalidPayloadError({ reason: 'Invalid or missing email' })
      }
      const clientIds = normalizeClientIds(req.body?.clientIds)
      const firstName = req.body?.firstName
        ? String(req.body.firstName).trim()
        : undefined
      const lastName = req.body?.lastName
        ? String(req.body.lastName).trim()
        : undefined
      const inviteUrl = req.body?.inviteUrl
        ? String(req.body.inviteUrl)
        : undefined
      const sendInvite = req.body?.sendInvite !== false // default true
      // Onboarding embeds the activation link in its own welcome mail instead
      // of having Directus send a separate invite. Admin-only: handing the
      // token back to a non-admin inviter would let them activate (and set the
      // password of) the invitee's account — so non-admins always get the link
      // by email instead.
      const returnInviteUrl = req.body?.returnInviteUrl === true

      const { isAdmin } = await authorize(req, clientIds, schema)

      const usersService = new services.UsersService({ schema })
      const existing: ExistingUser | null =
        (await usersService.getUserByEmail(email)) ?? null
      const decision = decideInviteAction(existing, sendInvite)
      const clientRoleId = await resolveClientRoleId(schema)

      let userId: string
      if (decision.action === 'invite') {
        if (decision.emailKind === 'invite') {
          // Creates the user (status 'invited') AND mails the activation link;
          // throws if inviteUrl isn't in USER_INVITE_URL_ALLOW_LIST.
          await usersService.inviteUser(
            email,
            clientRoleId,
            inviteUrl,
            INVITE_SUBJECT
          )
        } else {
          // Onboarding "create now, mail later": no email yet.
          await usersService.createOne({
            email,
            role: clientRoleId,
            status: 'invited'
          })
        }
        const created = await usersService.getUserByEmail(email)
        userId = created.id
        if (firstName || lastName) {
          await usersService.updateOne(userId, {
            ...(firstName ? { first_name: firstName } : {}),
            ...(lastName ? { last_name: lastName } : {})
          })
        }
      } else {
        userId = existing!.id
        if (decision.action === 'reinvite' && decision.emailKind === 'invite') {
          await usersService.inviteUser(
            email,
            clientRoleId,
            inviteUrl,
            INVITE_SUBJECT
          )
        }
      }

      const grantedClientIds = await ensureClientLinks(schema, userId, clientIds)

      if (decision.emailKind === 'notify') {
        // Non-fatal: access is already granted even if the courtesy mail fails.
        await sendAccessGrantedMail(
          schema,
          email,
          firstName,
          clientIds,
          inviteUrl
        ).catch(() => undefined)
      }

      // For the onboarding embed flow: hand back the tokenized activation link
      // (only for invited users, only to admins) so it can be placed in the
      // welcome mail instead of Directus sending a separate invite.
      let acceptInviteUrl: string | undefined
      const userIsInvited =
        decision.action === 'invite' || decision.action === 'reinvite'
      if (returnInviteUrl && isAdmin && userIsInvited) {
        const base = inviteBaseUrl(inviteUrl)
        if (base) acceptInviteUrl = usersService.inviteUrl(email, base)
      }

      return res.json({
        status: decision.action,
        userId,
        grantedClientIds,
        ...(acceptInviteUrl ? { acceptInviteUrl } : {})
      })
    })
  )
})
