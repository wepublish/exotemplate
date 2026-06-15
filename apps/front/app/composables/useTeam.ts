import { readItems, deleteItem } from '@directus/sdk'

// Team access management.
//
// Listing members and revoking access go **directly** through the
// `@directus/sdk` against the `Clients_directus_users` junction — the Client
// policy's row-level permissions scope them to "clients I belong to". Only the
// invite/grant path needs the custom backend `/team/invite` endpoint, because
// it has to look up users by email and create/invite them with elevated rights.

export interface TeamMember {
  /** `Clients_directus_users.id` — the junction row, used to revoke access. */
  linkId: number
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  status: string
}

// Mirrors the backend InviteAction: a brand-new invite, a re-sent invite to an
// already-invited user, or pure access-grant to an existing account.
export type InviteResultStatus = 'invite' | 'reinvite' | 'grant'

export interface InviteResult {
  status: InviteResultStatus
  userId: string
  grantedClientIds: string[]
  /** Present only when requested (returnInviteUrl) and the user is invited. */
  acceptInviteUrl?: string
}

export function useTeam() {
  const { directus, postCustomEndpoint } = useDirectus()

  function acceptInviteUrl(): string {
    return `${window.location.origin}/auth/accept-invite`
  }

  async function invite(params: {
    email: string
    firstName?: string
    lastName?: string
    clientIds: string[]
    sendInvite?: boolean
    returnInviteUrl?: boolean
  }): Promise<InviteResult> {
    const res = await postCustomEndpoint('team/invite', {
      email: params.email,
      ...(params.firstName ? { firstName: params.firstName } : {}),
      ...(params.lastName ? { lastName: params.lastName } : {}),
      clientIds: params.clientIds,
      inviteUrl: acceptInviteUrl(),
      ...(params.sendInvite === false ? { sendInvite: false } : {}),
      ...(params.returnInviteUrl ? { returnInviteUrl: true } : {})
    })
    return res.data as InviteResult
  }

  // Native SDK read — scoped by the Client policy's row-level read permission.
  async function listMembers(clientId: string): Promise<TeamMember[]> {
    const rows = (await directus.request(
      readItems('Clients_directus_users', {
        filter: { Clients_id: { _eq: clientId } },
        fields: [
          'id',
          {
            directus_users_id: [
              'id',
              'first_name',
              'last_name',
              'email',
              'status'
            ]
          }
        ],
        limit: -1
      })
    )) as Array<{ id: number; directus_users_id: any }>

    return rows
      .filter((r) => r.directus_users_id && typeof r.directus_users_id === 'object')
      .map((r) => {
        const u = r.directus_users_id
        return {
          linkId: r.id,
          id: u.id as string,
          first_name: (u.first_name ?? null) as string | null,
          last_name: (u.last_name ?? null) as string | null,
          email: u.email as string,
          status: u.status as string
        }
      })
  }

  // Native SDK delete of the junction row — scoped by the Client policy's
  // row-level delete permission.
  async function removeMember(linkId: number): Promise<void> {
    await directus.request(deleteItem('Clients_directus_users', linkId))
  }

  return { invite, listMembers, removeMember }
}
