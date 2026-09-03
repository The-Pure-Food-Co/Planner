import { getSupabaseBrowserClient } from './supabase/browser-singleton'
import type { PlannerData, Workspace, Lane, Task, KpiGroup, LaneTemplate, Member, WorkspaceMembership, Role, SavedView, UiState, ActivityLogEntry, AppNotification, NotificationType, NotificationPrefs, Todo } from './types'

// A single shared client, created via @supabase/ssr's createBrowserClient (see
// ./supabase/client.ts) so this app's data layer and its proxy.ts/auth-callback
// session handling read/write the exact same GoTrueClient instance and storage
// key — two separate clients on the same key ("Multiple GoTrueClient instances
// detected") silently race and can make a just-established session invisible
// to this module.
export const supabase = getSupabaseBrowserClient()

// supabase-js builders are lazy — the request is only sent once the builder is
// awaited/then'd, so a discarded builder is a silent no-op. Fire-and-forget
// writes must go through here: it forces execution and logs (never surfaces)
// failures.
export function fireAndForget(q: PromiseLike<{ error: unknown }> | undefined, label: string): void {
  void Promise.resolve(q).then(r => {
    const error = r?.error as { message?: string } | null | undefined
    if (error) console.error(`[planner] ${label} failed:`, error.message ?? error)
  })
}

// ── Auth ─────────────────────────────────────────────────────────────────────
// Sign-in itself happens on the shared Auth Hub (proxy.ts redirects there when
// there's no session) — this app never runs its own OAuth flow.

// Fetch the signed-in user's own Microsoft profile photo as a base64 data URL.
// Uses the delegated OAuth access token (session.provider_token), which Supabase only
// exposes right after the OAuth redirect — so photos are captured on fresh sign-in.
// Needs only User.Read (self); returns '' if no photo is set or the call fails.
export async function fetchMsPhoto(providerToken: string): Promise<string> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/photos/48x48/$value', {
      headers: { Authorization: `Bearer ${providerToken}` },
    })
    if (!res.ok) return ''
    const blob = await res.blob()
    return await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}

export async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
}

// ── Row mappers (exported so store can use them in realtime handlers) ─────────

export function rowToWorkspaceMeta(r: Record<string, any>): Omit<Workspace, 'lanes' | 'tasks'> {
  return {
    id: r.id, name: r.name, color: r.color, icon: r.icon ?? undefined,
    members: r.members ?? [], customBuckets: r.custom_buckets ?? [],
    statuses: r.statuses ?? undefined,
  }
}

export function rowToLane(r: Record<string, any>): Lane & { workspaceId: string } {
  return {
    id: r.id, workspaceId: r.workspace_id, label: r.label, color: r.color,
    sortIndex: r.sort_index ?? 0,
    icon: r.icon ?? undefined, iconColor: r.icon_color ?? undefined,
  }
}

export function rowToTask(r: Record<string, any>): Task & { workspaceId: string } {
  return {
    id: r.id, workspaceId: r.workspace_id, lane: r.lane_id ?? '', name: r.name,
    owner: r.owner ?? '', assignees: r.assignee_ids ?? [], reporterId: r.reporter_id ?? undefined,
    watchers: r.watcher_ids ?? [], start: r.start_date, end: r.end_date, noDate: r.no_date ?? false,
    pct: r.pct ?? 0, notes: r.notes ?? '',
    sortIndex: r.sort_index ?? 0, boardBucket: r.board_bucket ?? null,
    statusId: r.status_id ?? undefined,
    icon: r.icon ?? undefined, iconColor: r.icon_color ?? undefined,
    dependencies: r.dependencies ?? [],
    recurrence: r.recurrence ?? undefined, recurrenceParentId: r.recurrence_parent_id ?? undefined,
    estimate: r.estimate ?? null,
    checklist: r.checklist ?? [], milestones: r.milestones ?? [],
    comments: r.comments ?? [], attachments: r.attachments ?? [], links: r.links ?? [],
  }
}

export function rowToKpiGroup(r: Record<string, any>): KpiGroup {
  return { id: r.id, name: r.name, kpis: r.kpis ?? [] }
}

export function rowToLaneTemplate(r: Record<string, any>): LaneTemplate {
  return {
    id: r.id, label: r.label, color: r.color ?? '#C63663',
    description: r.description ?? '', tasks: r.tasks ?? [],
    createdBy: r.created_by ?? undefined, sortIndex: r.sort_index ?? 0,
  }
}

export function rowToMember(r: Record<string, any>): Member {
  return {
    id: r.id,
    email: r.email ?? '',
    displayName: r.display_name ?? r.email ?? '',
    avatarUrl: r.avatar_url ?? '',
    isAppAdmin: r.is_app_admin ?? false,
    isNzTeam: r.is_nz_team ?? false,
    notificationPrefs: r.notification_prefs ?? undefined,
  }
}

export function rowToMembership(r: Record<string, any>): WorkspaceMembership {
  return { workspaceId: r.workspace_id, userId: r.user_id, role: (r.role ?? 'member') as Role }
}

export function rowToView(r: Record<string, any>): SavedView {
  return {
    id: r.id, workspaceId: r.workspace_id, name: r.name,
    config: (r.config ?? {}) as Partial<UiState>, ownerId: r.owner_id ?? undefined,
  }
}

export function rowToActivity(r: Record<string, any>): ActivityLogEntry {
  return {
    id: r.id, workspaceId: r.workspace_id, taskId: r.task_id ?? null,
    taskName: r.task_name ?? '', actorId: r.actor_id ?? '', actorName: r.actor_name ?? 'Someone',
    action: r.action, field: r.field ?? undefined, oldValue: r.old_value ?? undefined,
    newValue: r.new_value ?? undefined, message: r.message, createdAt: r.created_at,
  }
}

export function rowToTodo(r: Record<string, any>): Todo {
  return {
    id: r.id, text: r.text, done: r.done ?? false, sortIndex: r.sort_index ?? 0,
    dueDate: r.due_date ?? null, important: r.important ?? false,
    completedAt: r.completed_at ?? null,
  }
}

export function rowToNotification(r: Record<string, any>): AppNotification {
  return {
    id: r.id, recipientId: r.recipient_id, actorId: r.actor_id ?? null,
    actorName: r.actor_name ?? 'Someone', type: (r.type ?? 'status') as NotificationType,
    workspaceId: r.workspace_id ?? null, taskId: r.task_id ?? null, taskName: r.task_name ?? '',
    message: r.message, readAt: r.read_at ?? null, createdAt: r.created_at,
  }
}

// ── DB serialisers ────────────────────────────────────────────────────────────

function wsToDb(w: Workspace, i: number) {
  return {
    id: w.id, name: w.name, color: w.color, icon: w.icon ?? null,
    members: w.members, custom_buckets: w.customBuckets,
    statuses: w.statuses ?? [],
    sort_index: i, updated_at: new Date().toISOString(),
  }
}

function laneToDb(wsId: string, l: Lane, i: number) {
  return {
    id: l.id, workspace_id: wsId, label: l.label, color: l.color,
    sort_index: i, icon: l.icon ?? null, icon_color: l.iconColor ?? null,
    updated_at: new Date().toISOString(),
  }
}

// Exported for the mapper round-trip tests (tests/mappers.test.ts).
export function taskToDb(wsId: string, t: Task) {
  return {
    id: t.id, workspace_id: wsId, lane_id: t.lane || null, name: t.name, owner: t.owner,
    assignee_ids: t.assignees ?? [], reporter_id: t.reporterId ?? null, watcher_ids: t.watchers ?? [],
    start_date: t.start, end_date: t.end, no_date: t.noDate ?? false,
    pct: t.pct,
    notes: t.notes, sort_index: t.sortIndex, board_bucket: t.boardBucket,
    status_id: t.statusId ?? null,
    icon: t.icon ?? null, icon_color: t.iconColor ?? null,
    dependencies: t.dependencies ?? [],
    recurrence: t.recurrence ?? null, recurrence_parent_id: t.recurrenceParentId ?? null,
    estimate: t.estimate ?? null,
    checklist: t.checklist, milestones: t.milestones,
    comments: t.comments ?? [], attachments: t.attachments ?? [], links: t.links ?? [],
    updated_at: new Date().toISOString(),
  }
}

// ── Load all data ─────────────────────────────────────────────────────────────

export async function loadAll(): Promise<PlannerData | null> {
  if (!supabase) return null
  const [wsRes, laneRes, taskRes, kpiRes, cfgRes, profRes, wmRes, viewsRes, tplRes] = await Promise.all([
    supabase.from('workspaces').select('*').order('sort_index'),
    supabase.from('lanes').select('*').order('sort_index'),
    supabase.from('tasks').select('*').order('sort_index'),
    supabase.from('kpi_groups').select('*').order('sort_index'),
    supabase.from('app_config').select('value').eq('key', 'userList').maybeSingle(),
    supabase.from('profiles').select('*').order('display_name'),
    supabase.from('workspace_members').select('*'),
    supabase.from('views').select('*'),
    supabase.from('lane_templates').select('*').order('sort_index'),
  ])
  if (wsRes.error) return null
  const workspaces: Workspace[] = (wsRes.data ?? []).map(wRow => ({
    ...rowToWorkspaceMeta(wRow),
    lanes: (laneRes.data ?? []).filter(l => l.workspace_id === wRow.id).map(rowToLane),
    tasks: (taskRes.data ?? []).filter(t => t.workspace_id === wRow.id).map(rowToTask),
  }))
  return {
    version: 2, exportedAt: null,
    userList: (cfgRes.data?.value as string[]) ?? [],
    members: (profRes.data ?? []).map(rowToMember),
    memberships: (wmRes.data ?? []).map(rowToMembership),
    savedViews: (viewsRes.data ?? []).map(rowToView),
    kpiGroups: (kpiRes.data ?? []).map(rowToKpiGroup),
    laneTemplates: (tplRes.data ?? []).map(rowToLaneTemplate),
    workspaces,
  }
}

// ── Granular CRUD ─────────────────────────────────────────────────────────────

export const db = {
  upsertWorkspace: (w: Workspace, i: number) =>
    supabase?.from('workspaces').upsert(wsToDb(w, i)),

  deleteWorkspace: (id: string) =>
    supabase?.from('workspaces').delete().eq('id', id),

  upsertLane: (wsId: string, l: Lane, i: number) =>
    supabase?.from('lanes').upsert(laneToDb(wsId, l, i)),

  deleteLane: (id: string) =>
    supabase?.from('lanes').delete().eq('id', id),

  upsertTask: (wsId: string, t: Task) =>
    supabase?.from('tasks').upsert(taskToDb(wsId, t)),

  deleteTask: (id: string) =>
    supabase?.from('tasks').delete().eq('id', id),

  // Upload a file to the `attachments` bucket; returns its public URL + storage
  // path (used later for deletion), or null if Supabase isn't configured / the
  // upload fails.
  uploadAttachment: async (
    taskId: string,
    attachmentId: string,
    file: File
  ): Promise<{ url: string; path: string } | null> => {
    if (!supabase) return null
    const safeName = file.name.replace(/[^\w.\-]+/g, '_')
    const path = `${taskId}/${attachmentId}-${safeName}`
    const { error } = await supabase.storage
      .from('attachments')
      .upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (error) return null
    const { data } = supabase.storage.from('attachments').getPublicUrl(path)
    return { url: data.publicUrl, path }
  },

  deleteAttachment: (path: string) =>
    supabase?.storage.from('attachments').remove([path]),

  // Profile photos live in the existing public `attachments` bucket under avatars/…
  // (migration 013's policies already cover it, so no new bucket is needed).
  // upsert replaces the previous photo in place; the ?v= cache-buster makes the
  // CDN serve the new file instead of the cached old one at the same path.
  uploadAvatar: async (profileId: string, blob: Blob): Promise<string | null> => {
    if (!supabase) return null
    const path = `avatars/${profileId}.jpg`
    const { error } = await supabase.storage
      .from('attachments')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
    if (error) return null
    const { data } = supabase.storage.from('attachments').getPublicUrl(path)
    return `${data.publicUrl}?v=${Date.now()}`
  },

  updateAvatarUrl: (profileId: string, url: string) =>
    supabase?.from('profiles').update({ avatar_url: url }).eq('id', profileId),

  updateNotificationPrefs: (profileId: string, prefs: NotificationPrefs) =>
    supabase?.from('profiles').update({ notification_prefs: prefs }).eq('id', profileId),

  upsertKpiGroup: (g: KpiGroup, i: number) =>
    supabase?.from('kpi_groups').upsert({ id: g.id, name: g.name, kpis: g.kpis, sort_index: i, updated_at: new Date().toISOString() }),

  deleteKpiGroup: (id: string) =>
    supabase?.from('kpi_groups').delete().eq('id', id),

  upsertLaneTemplate: (t: LaneTemplate, i: number) =>
    supabase?.from('lane_templates').upsert({
      id: t.id, label: t.label, color: t.color, description: t.description,
      tasks: t.tasks, created_by: t.createdBy ?? null, sort_index: i,
      updated_at: new Date().toISOString(),
    }),

  deleteLaneTemplate: (id: string) =>
    supabase?.from('lane_templates').delete().eq('id', id),

  saveUserList: (users: string[]) =>
    supabase?.from('app_config').upsert({ key: 'userList', value: users }),

  // Link (or create) the signed-in user's own profile, matched by login email.
  // Only the provided columns are written, so is_app_admin / role seeds are preserved.
  // avatar_url is written only when we actually have one this session, so a normal
  // reload (no provider_token → no fresh photo) never clobbers a stored photo.
  // is_nz_team is written separately by AuthGate.tsx, not here.
  linkOwnProfile: (p: { authId: string; email: string; displayName: string; avatarUrl?: string }) =>
    supabase?.from('profiles').upsert(
      {
        auth_id: p.authId, email: p.email, display_name: p.displayName,
        ...(p.avatarUrl ? { avatar_url: p.avatarUrl } : {}),
      },
      { onConflict: 'email' }
    ),

  setAppAdmin: (profileId: string, isAppAdmin: boolean) =>
    supabase?.from('profiles').update({ is_app_admin: isAppAdmin }).eq('id', profileId),

  // Pre-provision a roster entry before the person's first sign-in (they link to
  // it by email via linkOwnProfile when they do). Insert — never upsert — so an
  // existing profile can't be overwritten; a duplicate email surfaces as 23505.
  addProfile: async (email: string, displayName: string): Promise<{ member: Member | null; error: { code?: string; message: string } | null }> => {
    if (!supabase) return { member: null, error: { message: 'Not connected' } }
    const { data, error } = await supabase
      .from('profiles')
      .insert({ email: email.toLowerCase(), display_name: displayName })
      .select()
      .single()
    return { member: data ? rowToMember(data) : null, error }
  },

  // Workspace membership / role management (workspace admins + app admins per RLS).
  setMembership: (workspaceId: string, userId: string, role: Role) =>
    supabase?.from('workspace_members').upsert(
      { workspace_id: workspaceId, user_id: userId, role },
      { onConflict: 'workspace_id,user_id' }
    ),

  removeMembership: (workspaceId: string, userId: string) =>
    supabase?.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', userId),

  // Awaitable insert — used where the caller must sequence this write against
  // another one (e.g. deleteTask logs the "deleted" entry before the task_id
  // it references stops existing, since activity_log_task_id_fkey can't point
  // at a row that's already gone).
  insertActivityLog: (entries: Omit<ActivityLogEntry, 'id' | 'createdAt'>[]) => {
    if (!supabase || !entries.length) return Promise.resolve({ error: null })
    return supabase.from('activity_log').insert(
      entries.map(e => ({
        workspace_id: e.workspaceId, task_id: e.taskId, task_name: e.taskName,
        actor_id: e.actorId || null, actor_name: e.actorName,
        action: e.action, field: e.field ?? null, old_value: e.oldValue ?? null,
        new_value: e.newValue ?? null, message: e.message,
      }))
    )
  },

  // Fire-and-forget audit trail entries — never blocks or rolls back the mutation
  // they describe, so failures are swallowed rather than surfaced as a toast.
  logActivity: (entries: Omit<ActivityLogEntry, 'id' | 'createdAt'>[]) => {
    fireAndForget(db.insertActivityLog(entries), 'activity log write')
  },

  fetchTaskActivity: async (taskId: string): Promise<ActivityLogEntry[]> => {
    if (!supabase) return []
    const { data, error } = await supabase
      .from('activity_log')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
    if (error || !data) return []
    return data.map(rowToActivity)
  },

  // A person's most recent actions across every workspace (People view card),
  // reusing the same activity_log rows written for the per-task feed above —
  // no separate per-user activity table needed, just a different filter.
  fetchMemberActivity: async (actorId: string, limit = 5): Promise<ActivityLogEntry[]> => {
    if (!supabase || !actorId) return []
    const { data, error } = await supabase
      .from('activity_log')
      .select('*')
      .eq('actor_id', actorId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error || !data) return []
    return data.map(rowToActivity)
  },

  // A workspace's most recent activity across all its tasks (Table view side
  // panel) — same table again, just filtered by workspace instead of actor.
  fetchWorkspaceActivity: async (workspaceId: string, limit = 10): Promise<ActivityLogEntry[]> => {
    if (!supabase || !workspaceId) return []
    const { data, error } = await supabase
      .from('activity_log')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error || !data) return []
    return data.map(rowToActivity)
  },

  // Fire-and-forget like logActivity: notifying others must never block or roll
  // back the mutation that triggered it.
  insertNotifications: (rows: Omit<AppNotification, 'id' | 'createdAt' | 'readAt'>[]) => {
    if (!supabase || !rows.length) return
    fireAndForget(supabase.from('notifications').insert(
      rows.map(n => ({
        recipient_id: n.recipientId, actor_id: n.actorId, actor_name: n.actorName,
        type: n.type, workspace_id: n.workspaceId, task_id: n.taskId,
        task_name: n.taskName, message: n.message,
      }))
    ), 'notification write')
  },

  // Newest page by default; pass `before` (a created_at cursor) to page further
  // back through the inbox ("Show older").
  fetchMyNotifications: async (recipientId: string, opts: { before?: string; limit?: number } = {}): Promise<AppNotification[]> => {
    if (!supabase) return []
    let q = supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', recipientId)
    if (opts.before) q = q.lt('created_at', opts.before)
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? 50)
    if (error || !data) return []
    return data.map(rowToNotification)
  },

  markNotificationRead: (id: string) =>
    supabase?.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id),

  markAllNotificationsRead: (recipientId: string) =>
    supabase?.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('recipient_id', recipientId).is('read_at', null),

  fetchMyTodos: async (ownerId: string): Promise<Todo[]> => {
    if (!supabase) return []
    const { data, error } = await supabase
      .from('todos')
      .select('*')
      .eq('owner_id', ownerId)
      .order('sort_index')
    if (error || !data) return []
    return data.map(rowToTodo)
  },

  addTodo: async (
    ownerId: string,
    text: string,
    sortIndex: number,
    dueDate: string | null = null,
    important = false,
  ): Promise<Todo | null> => {
    if (!supabase) return null
    const { data, error } = await supabase
      .from('todos')
      .insert({ owner_id: ownerId, text, sort_index: sortIndex, due_date: dueDate, important })
      .select()
      .single()
    return error || !data ? null : rowToTodo(data)
  },

  setTodoDone: (id: string, done: boolean, completedAt: string | null) =>
    supabase?.from('todos').update({ done, completed_at: completedAt }).eq('id', id),

  setTodoText: (id: string, text: string) =>
    supabase?.from('todos').update({ text }).eq('id', id),

  setTodoDueDate: (id: string, dueDate: string | null) =>
    supabase?.from('todos').update({ due_date: dueDate }).eq('id', id),

  setTodoImportant: (id: string, important: boolean) =>
    supabase?.from('todos').update({ important }).eq('id', id),

  setTodoSortIndex: (id: string, sortIndex: number) =>
    supabase?.from('todos').update({ sort_index: sortIndex }).eq('id', id),

  deleteTodo: (id: string) =>
    supabase?.from('todos').delete().eq('id', id),

  // Re-inserts a previously deleted row with its original id/fields, for the
  // "Undo" toast after a delete — upsert so a double-click can't error out.
  restoreTodo: (ownerId: string, t: Todo) =>
    supabase?.from('todos').upsert({
      id: t.id, owner_id: ownerId, text: t.text, done: t.done, sort_index: t.sortIndex,
      due_date: t.dueDate, important: t.important, completed_at: t.completedAt,
    }),

  clearCompletedTodos: (ownerId: string) =>
    supabase?.from('todos').delete().eq('owner_id', ownerId).eq('done', true),

  upsertView: (v: SavedView) =>
    supabase?.from('views').upsert({
      id: v.id, workspace_id: v.workspaceId, name: v.name, config: v.config, owner_id: v.ownerId ?? null,
    }),

  deleteView: (id: string) =>
    supabase?.from('views').delete().eq('id', id),

  // Full re-sync: used after undo/import to restore deleted rows
  syncAll: async (data: PlannerData) => {
    if (!supabase) return
    await Promise.all([
      ...data.workspaces.map((w, i) => supabase!.from('workspaces').upsert(wsToDb(w, i))),
      ...data.workspaces.flatMap(w => [
        ...w.lanes.map((l, j) => supabase!.from('lanes').upsert(laneToDb(w.id, l, j))),
        ...w.tasks.map(t => supabase!.from('tasks').upsert(taskToDb(w.id, t))),
      ]),
      ...data.kpiGroups.map((g, i) => supabase!.from('kpi_groups').upsert(
        { id: g.id, name: g.name, kpis: g.kpis, sort_index: i, updated_at: new Date().toISOString() }
      )),
      ...data.laneTemplates.map((t, i) => supabase!.from('lane_templates').upsert({
        id: t.id, label: t.label, color: t.color, description: t.description,
        tasks: t.tasks, created_by: t.createdBy ?? null, sort_index: i,
        updated_at: new Date().toISOString(),
      })),
      supabase!.from('app_config').upsert({ key: 'userList', value: data.userList }),
    ])
  },
}

// ── Realtime ──────────────────────────────────────────────────────────────────

export type RealtimeHandlers = {
  onWorkspace: (event: string, row: Record<string, any>) => void
  onLane:      (event: string, row: Record<string, any>) => void
  onTask:      (event: string, row: Record<string, any>) => void
  onKpiGroup:  (event: string, row: Record<string, any>) => void
  onLaneTemplate: (event: string, row: Record<string, any>) => void
  onUserList:  (users: string[]) => void
  onProfile:   (event: string, row: Record<string, any>) => void
  onMembership:(event: string, row: Record<string, any>) => void
  onView:      (event: string, row: Record<string, any>) => void
}

// `onReconnect` fires when the channel re-establishes after a drop (laptop sleep,
// wifi blip). Realtime does not replay missed events, so the caller must re-pull
// state from the DB at that point or clients silently diverge.
export function subscribeToChanges(handlers: RealtimeHandlers, onReconnect?: () => void): () => void {
  if (!supabase) return () => {}
  let hadDrop = false
  const channel = supabase
    .channel('planner-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'workspaces' },
        p => handlers.onWorkspace(p.eventType, p.eventType === 'DELETE' ? p.old : p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lanes' },
        p => handlers.onLane(p.eventType, p.eventType === 'DELETE' ? p.old : p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' },
        p => handlers.onTask(p.eventType, p.eventType === 'DELETE' ? p.old : p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kpi_groups' },
        p => handlers.onKpiGroup(p.eventType, p.eventType === 'DELETE' ? p.old : p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lane_templates' },
        p => handlers.onLaneTemplate(p.eventType, p.eventType === 'DELETE' ? p.old : p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_config' },
        p => { if ((p.new as any)?.key === 'userList') handlers.onUserList((p.new as any).value) })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' },
        p => handlers.onProfile(p.eventType, p.eventType === 'DELETE' ? p.old : p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_members' },
        p => handlers.onMembership(p.eventType, p.eventType === 'DELETE' ? p.old : p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'views' },
        p => handlers.onView(p.eventType, p.eventType === 'DELETE' ? p.old : p.new))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        if (hadDrop) { hadDrop = false; onReconnect?.() }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        hadDrop = true
      }
    })
  return () => { supabase!.removeChannel(channel) }
}

// Lightweight presence: every signed-in client joins one shared channel keyed by
// its profiles.id. `sync` fires with the full roster on every join/leave, so the
// callback always receives the complete set of online profile ids.
export function subscribeToPresence(meId: string, onSync: (onlineIds: string[]) => void): () => void {
  if (!supabase) return () => {}
  const channel = supabase.channel('planner-presence', { config: { presence: { key: meId } } })
  channel
    .on('presence', { event: 'sync' }, () => onSync(Object.keys(channel.presenceState())))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') void channel.track({ online: true })
    })
  return () => {
    onSync([])
    supabase!.removeChannel(channel)
  }
}

// Separate per-user channel (created once meId is known). RLS already limits
// delivery to the recipient's own rows; the filter just avoids waking every
// client for every insert.
export function subscribeToNotifications(
  recipientId: string,
  onInsert: (n: AppNotification) => void,
  onReconnect?: () => void,
): () => void {
  if (!supabase) return () => {}
  let hadDrop = false
  const channel = supabase
    .channel(`notifications-${recipientId}`)
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${recipientId}` },
        p => onInsert(rowToNotification(p.new)))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        if (hadDrop) { hadDrop = false; onReconnect?.() }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        hadDrop = true
      }
    })
  return () => { supabase!.removeChannel(channel) }
}
