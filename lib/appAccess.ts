// Per-feature access control, layered on top of proxy.ts's hub-redirect
// session check. proxy.ts only proves "this is a signed-in org user" — it
// doesn't know anything about which internal apps/features that user should
// be able to open. This table answers that second question, keyed by
// app_key ('planner' for this app's own gate, matching its hub_apps.id). A
// missing row for a key means unrestricted (visible/usable by everyone
// signed in); a row means only the listed profile ids may open it. See
// components/AppAccessGate.tsx for enforcement. Rows are managed from the
// hub's own "Manage apps" modal — this app has no admin UI of its own for it.
import { getSupabaseBrowserClient } from './supabase/browser-singleton'

const supabase = getSupabaseBrowserClient()

export type Member = {
  id: string
  email: string
  displayName: string
  avatarUrl: string
  isAppAdmin: boolean
}

export type AccessRule = { appKey: string; profileIds: string[] }

/** Access key for a hub group tile (apps just use their hub_apps.id). */
export const groupAccessKey = (groupKey: string) => `group:${groupKey}`

export function rowToAccessRule(r: Record<string, any>): AccessRule {
  return { appKey: r.app_key, profileIds: r.profile_ids ?? [] }
}

export async function loadAppAccess(): Promise<{ members: Member[]; rules: AccessRule[] }> {
  if (!supabase) return { members: [], rules: [] }
  const [profRes, accessRes] = await Promise.all([
    supabase.from('profiles').select('*').order('display_name'),
    supabase.from('app_access').select('*'),
  ])
  return {
    members: (profRes.data ?? []).map((r: Record<string, any>) => ({
      id: r.id, email: r.email ?? '', displayName: r.display_name ?? r.email ?? '',
      avatarUrl: r.avatar_url ?? '', isAppAdmin: r.is_app_admin ?? false,
    })),
    rules: (accessRes.data ?? []).map(rowToAccessRule),
  }
}

export const appAccessDb = {
  setAccess: async (appKey: string, profileIds: string[]): Promise<{ error: { message: string } | null }> => {
    if (!supabase) return { error: null }
    const res = profileIds.length === 0
      ? await supabase.from('app_access').delete().eq('app_key', appKey)
      : await supabase.from('app_access').upsert(
          { app_key: appKey, profile_ids: profileIds, updated_at: new Date().toISOString() },
          { onConflict: 'app_key' }
        )
    if (res.error) console.error(`[appAccess] setAccess(${appKey}) failed:`, res.error)
    return { error: res.error }
  },
}

export function subscribeToAppAccess(onChange: (event: string, row: Record<string, any>) => void): () => void {
  if (!supabase) return () => {}
  const channel = supabase
    .channel('app-access-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_access' },
        p => onChange(p.eventType, p.eventType === 'DELETE' ? p.old : p.new))
    .subscribe()
  return () => { supabase!.removeChannel(channel) }
}
