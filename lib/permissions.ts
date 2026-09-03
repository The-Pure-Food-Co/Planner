'use client'
import { usePlannerStore } from '@/store/plannerStore'
import type { Member, Role } from '@/lib/types'

// Single source of truth for what the current user may do. Mirrors the RLS policies
// in supabase/migrations/006_roles.sql so the UI stays consistent with the database.
//
// Local/seed mode (no Supabase backend, `live === false`) grants full access — there is
// no server to enforce against and it keeps offline/dev use unchanged.

function resolveRole(
  live: boolean,
  isAppAdmin: boolean,
  memberships: { workspaceId: string; userId: string; role: Role }[],
  meId: string | null,
  workspaceId: string | null,
): Role | null {
  if (!live) return 'admin'
  if (isAppAdmin) return 'admin'
  if (!workspaceId || !meId) return null
  return memberships.find(m => m.workspaceId === workspaceId && m.userId === meId)?.role ?? null
}

/** Current user's role in a workspace (reactive). `admin` in local/seed mode. */
export function useMyRole(workspaceId: string | null): Role | null {
  return usePlannerStore(s => {
    const isAppAdmin = !!s.data.members.find(m => m.id === s.meId)?.isAppAdmin
    return resolveRole(s.live, isAppAdmin, s.data.memberships, s.meId, workspaceId)
  })
}

/** Reactive: is the current user an app-wide admin (or local mode)? */
export function useIsAppAdmin(): boolean {
  return usePlannerStore(s => !s.live || !!s.data.members.find(m => m.id === s.meId)?.isAppAdmin)
}

/** Non-reactive read for use inside event handlers / store logic. */
export function myRole(workspaceId: string | null): Role | null {
  const s = usePlannerStore.getState()
  const isAppAdmin = !!s.data.members.find(m => m.id === s.meId)?.isAppAdmin
  return resolveRole(s.live, isAppAdmin, s.data.memberships, s.meId, workspaceId)
}

export const canWrite = (role: Role | null): boolean => role === 'admin' || role === 'member'
export const canAdmin = (role: Role | null): boolean => role === 'admin'

// App is scoped to the NZ Team for now (see components/AuthGate.tsx, which gates
// sign-in itself). This filters roster/picker display names to match: a name is
// shown only if it resolves to a signed-in member who is confirmed NZ Team.
// Unlinked names (legacy owner strings, pre-provisioned people who haven't signed
// in) are hidden by default — the app should show NZ Team only, not "everyone we
// can't rule out."
export const isNzTeamName = (name: string, members: Member[]): boolean => {
  const m = members.find(m => m.displayName === name)
  return !!m && m.isNzTeam
}

/** Filters a list of display names down to NZ Team members (see isNzTeamName). */
export const filterNzTeamNames = (names: string[], members: Member[]): string[] =>
  names.filter(n => isNzTeamName(n, members))

/** Filters Member objects down to NZ Team (or unlinked-region-unknown — none here). */
export const filterNzTeamMembers = (members: Member[]): Member[] =>
  members.filter(m => m.isNzTeam)

/** Convenience reactive hooks for the common gates. */
export const useCanWrite = (workspaceId: string | null): boolean => canWrite(useMyRole(workspaceId))
export const useCanAdmin = (workspaceId: string | null): boolean => canAdmin(useMyRole(workspaceId))
