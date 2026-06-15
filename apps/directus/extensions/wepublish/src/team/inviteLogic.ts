// Pure, dependency-free decision helpers for the /team endpoint.
//
// The endpoint (./index.ts) wires these into Directus' UsersService /
// ItemsService. Keeping the branching logic here means the security-relevant
// decisions (who is authorized, invite vs. grant, which junction rows are
// missing) are unit-testable without a running Directus.

export type UserStatus =
  | 'active'
  | 'invited'
  | 'draft'
  | 'suspended'
  | 'archived'
  | (string & {})

export interface ExistingUser {
  id: string
  status: UserStatus
  email: string
}

// What the endpoint should do for a given (email, sendInvite) request.
//   invite   — user does not exist yet: create it (status 'invited')
//   reinvite — user exists but hasn't set a password yet (status 'invited')
//   grant    — user already exists & is usable: only add client access
export type InviteAction = 'invite' | 'reinvite' | 'grant'

// Which mail (if any) the endpoint should send.
//   invite — Directus' native user-invitation mail (password-setup link)
//   notify — a plain "you now have access" notice for already-active users
//   none   — no mail (e.g. the onboarding "create now, mail later" step)
export type EmailKind = 'invite' | 'notify' | 'none'

export interface InviteDecision {
  action: InviteAction
  emailKind: EmailKind
}

// Decide the action + which mail to send.
//
// `sendInvite` is the caller's intent to email right now. The onboarding
// "create users" step passes false (users are created but mailed only in the
// final step); the self-service team invite and the final onboarding step
// pass true.
export function decideInviteAction(
  existing: ExistingUser | null,
  sendInvite: boolean
): InviteDecision {
  if (!existing) {
    return { action: 'invite', emailKind: sendInvite ? 'invite' : 'none' }
  }

  if (existing.status === 'invited') {
    // Re-sending an invite is the only way an invited user can (re)obtain a
    // password-setup link; Directus' inviteUser re-sends for invited users.
    return { action: 'reinvite', emailKind: sendInvite ? 'invite' : 'none' }
  }

  // Already-existing usable account → never re-invite (inviteUser is a silent
  // no-op for active users anyway). Just grant access; optionally notify, but
  // only active users can act on the notice.
  return {
    action: 'grant',
    emailKind: sendInvite && existing.status === 'active' ? 'notify' : 'none'
  }
}

// Returns the requested client ids the caller is NOT allowed to grant access
// to. Empty array ⇒ fully authorized. Admins are authorized for everything.
//
// `accessibleClientIds` must come from a trusted source (a DB read keyed on the
// verified JWT user id), never from the request body.
export function unauthorizedClientIds(
  requestedClientIds: string[],
  accessibleClientIds: string[],
  isAdmin: boolean
): string[] {
  if (isAdmin) return []
  const accessible = new Set(accessibleClientIds.map(String))
  return uniqueStrings(requestedClientIds).filter((id) => !accessible.has(id))
}

// Which of the requested client ids still need a junction row created
// (idempotency: never create a duplicate link).
export function missingClientLinks(
  requestedClientIds: string[],
  alreadyLinkedClientIds: string[]
): string[] {
  const linked = new Set(alreadyLinkedClientIds.map(String))
  return uniqueStrings(requestedClientIds).filter((id) => !linked.has(id))
}

export function normalizeEmail(email: unknown): string {
  return String(email ?? '')
    .trim()
    .toLowerCase()
}

// Permissive RFC-ish check — Directus does the authoritative validation; this
// just rejects obviously bad input early with a clear message.
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Coerce a request-body value into a clean, de-duplicated string[] of client
// ids. Accepts a single id or an array; ignores empty entries.
export function normalizeClientIds(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : input == null ? [] : [input]
  return uniqueStrings(
    arr.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0)
  )
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(String))]
}
