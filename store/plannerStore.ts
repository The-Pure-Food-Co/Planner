'use client'
import { create } from 'zustand'
import { toast as sonnerToast } from 'sonner'
import type { PlannerData, UiState, Task, Lane, Workspace, KpiGroup, LaneTemplate, TemplateTask, PrimaryTab, Role, SavedView, Member, ActivityLogEntry, ActivityAction, AppNotification, NotificationPrefs, RecurrenceRule } from '@/lib/types'
import { SEED } from '@/lib/seed'
import { LANE_PRESETS } from '@/lib/lanePresets'
import { uuid, fd, todayD, addDays, pd, fmtShort, wsStatuses, taskStatusId, cascadeTaskMove, recurrenceOccurrences, downscaleImage, diffChecklistMsgs, diffMilestoneMsgs, diffAttachmentMsgs, diffLinkMsgs } from '@/lib/utils'
import { buildTaskNotifications } from '@/lib/notify'
import { supabase, loadAll, subscribeToChanges, subscribeToNotifications, subscribeToPresence, db, fireAndForget, fetchMsPhoto, rowToWorkspaceMeta, rowToLane, rowToTask, rowToKpiGroup, rowToLaneTemplate, rowToMember, rowToMembership, rowToView } from '@/lib/supabase'

const LS_UI   = 'purefoods-planner-ui'
const LS_SAVED = 'purefoods-planner-savedAt'

const DEFAULT_UI: UiState = {
  page: 'home', tab: 'teams', primaryTab: 'mywork', ws: null, wsView: 'gantt',
  person: '', stream: '', zoom: 'weeks', collapsed: [], me: '',
  todayOnly: false, taskFilter: 'active', search: '',
}

function loadUi(): UiState {
  if (typeof window === 'undefined') return DEFAULT_UI
  try {
    const raw = localStorage.getItem(LS_UI)
    return raw ? { ...DEFAULT_UI, ...JSON.parse(raw) } : { ...DEFAULT_UI }
  } catch { return { ...DEFAULT_UI } }
}

// Instantiate a workstream template (built-in preset or user-saved) into a fresh
// lane + tasks. Task dates are laid out relative to today via dayOffset/durDays;
// dependencies (referenced by `key`) are remapped to the freshly-generated ids.
function buildLaneFromTemplate(
  tpl: { label: string; color: string; tasks: TemplateTask[] },
  sortIndex: number,
  reporterId?: string,
): { lane: Lane; tasks: Task[] } {
  const lane: Lane = { id: uuid(), label: tpl.label, color: tpl.color, sortIndex }
  const today = todayD()
  const keyToId = new Map(tpl.tasks.map(pt => [pt.key, uuid()]))
  const tasks: Task[] = tpl.tasks.map((pt, i) => {
    const start = addDays(today, pt.dayOffset)
    return {
      id: keyToId.get(pt.key)!, name: pt.name, lane: lane.id, owner: '', assignees: [],
      reporterId, watchers: [],
      start: fd(start), end: fd(addDays(start, pt.durDays)), pct: 0,
      notes: '', sortIndex: i, boardBucket: null,
      dependencies: (pt.dependsOn ?? []).map(k => keyToId.get(k)).filter(Boolean) as string[],
      checklist: [], milestones: [],
    }
  })
  return { lane, tasks }
}

// Module-level: keep one active realtime subscription
let unsubRealtime: (() => void) | null = null
let unsubNotifications: (() => void) | null = null
let unsubPresence: (() => void) | null = null
// Window listeners (tab refocus / back-online refetch) are installed once.
let windowHooksInstalled = false

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))])

// Newest-first union of the fetched inbox and anything realtime delivered while
// the fetch was in flight — a plain replace would drop those live arrivals.
const mergeNotifications = (existing: AppNotification[], incoming: AppNotification[]): AppNotification[] => {
  const ids = new Set(incoming.map(n => n.id))
  return [...incoming, ...existing.filter(n => !ids.has(n.id))]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

interface SnapshotEntry { snapshot: string; label: string }

// ── Activity log entries ────────────────────────────────────────────────────
// Builds a diff of prevTask → task into one log entry per changed field, so
// entries read like "Alice changed status from Not started to Done", plus one
// entry per added/removed/changed checklist item, milestone, attachment, or
// link. Reordering and comment edits aren't tracked, to keep the log readable.

const memberName = (members: Member[], id?: string | null): string =>
  id ? (members.find(m => m.id === id)?.displayName ?? id) : 'Unassigned'

function diffAssigneesMsg(prev: string[] = [], next: string[] = [], members: Member[]): string | null {
  const added = next.filter(id => !prev.includes(id)).map(id => memberName(members, id))
  const removed = prev.filter(id => !next.includes(id)).map(id => memberName(members, id))
  const parts: string[] = []
  if (added.length) parts.push(`assigned ${added.join(', ')}`)
  if (removed.length) parts.push(`unassigned ${removed.join(', ')}`)
  return parts.length ? parts.join('; ') : null
}

function buildTaskActivityEntries(
  ws: Workspace, members: Member[], prevTask: Task | undefined, task: Task,
  actorId: string, actorName: string, action: ActivityAction,
): Omit<ActivityLogEntry, 'id' | 'createdAt'>[] {
  const base = { workspaceId: ws.id, taskId: task.id, taskName: task.name, actorId, actorName }
  if (action === 'created') return [{ ...base, action, message: 'created this task' }]
  if (action === 'deleted') return [{ ...base, action, message: 'deleted this task' }]
  if (!prevTask) return []

  const entries: Omit<ActivityLogEntry, 'id' | 'createdAt'>[] = []
  const push = (field: string, oldValue: string, newValue: string, message: string) =>
    entries.push({ ...base, action, field, oldValue, newValue, message })

  if (prevTask.name !== task.name) {
    push('name', prevTask.name, task.name, `renamed this task from "${prevTask.name}" to "${task.name}"`)
  }
  if (prevTask.lane !== task.lane) {
    const laneLabel = (id: string) => ws.lanes.find(l => l.id === id)?.label ?? '—'
    push('lane', prevTask.lane, task.lane, `moved from "${laneLabel(prevTask.lane)}" to "${laneLabel(task.lane)}"`)
  }
  const prevStatus = taskStatusId(prevTask)
  const nextStatus = taskStatusId(task)
  if (prevStatus !== nextStatus) {
    const statusLabel = (id: string) => wsStatuses(ws).find(s => s.id === id)?.label ?? id
    push('status', prevStatus, nextStatus, `changed status from "${statusLabel(prevStatus)}" to "${statusLabel(nextStatus)}"`)
  }
  if (prevTask.start !== task.start || prevTask.end !== task.end) {
    push('dates', `${prevTask.start} → ${prevTask.end}`, `${task.start} → ${task.end}`,
      `changed dates from ${fmtShort(prevTask.start)} → ${fmtShort(prevTask.end)} to ${fmtShort(task.start)} → ${fmtShort(task.end)}`)
  }
  if (prevTask.pct !== task.pct) {
    push('pct', String(prevTask.pct), String(task.pct), `updated progress from ${prevTask.pct}% to ${task.pct}%`)
  }
  const assigneeMsg = diffAssigneesMsg(prevTask.assignees, task.assignees, members)
  if (assigneeMsg) entries.push({ ...base, action, field: 'assignees', message: assigneeMsg })
  if ((prevTask.estimate ?? null) !== (task.estimate ?? null)) {
    push('estimate', String(prevTask.estimate ?? '—'), String(task.estimate ?? '—'),
      `changed estimate from ${prevTask.estimate ?? '—'} to ${task.estimate ?? '—'}`)
  }
  diffChecklistMsgs(prevTask.checklist, task.checklist)
    .forEach(message => entries.push({ ...base, action, field: 'checklist', message }))
  diffMilestoneMsgs(prevTask.milestones, task.milestones)
    .forEach(message => entries.push({ ...base, action, field: 'milestones', message }))
  diffAttachmentMsgs(prevTask.attachments, task.attachments)
    .forEach(message => entries.push({ ...base, action, field: 'attachments', message }))
  diffLinkMsgs(prevTask.links, task.links)
    .forEach(message => entries.push({ ...base, action, field: 'links', message }))
  return entries
}

type DbResult = PromiseLike<{ error: any }> | undefined

// Replace-or-append by id — the merge shape every realtime upsert handler needs.
const upsertById = <T extends { id: string }>(arr: T[], item: T): T[] =>
  arr.some(x => x.id === item.id) ? arr.map(x => x.id === item.id ? item : x) : [...arr, item]

interface PlannerStore {
  data: PlannerData
  ui: UiState
  undoStack: SnapshotEntry[]
  savedAt: string | null
  loading: boolean
  live: boolean
  initError: string | null   // fatal load failure — page shows a retry screen instead of data
  focusTaskId: string | null
  meId: string | null   // current user's profiles.id (null in local/seed mode)
  notifications: AppNotification[]   // the signed-in user's inbox, newest first
  notificationsExhausted: boolean    // no older rows left to page in
  onlineIds: string[]   // profiles.id of everyone currently on the presence channel

  init: () => Promise<void>
  refreshFromRemote: () => Promise<void>
  commit: () => void
  saveUi: () => void

  setUi: (patch: Partial<UiState>) => void
  goHome: (tab?: UiState['tab']) => void
  openWs: (id: string, view?: 'gantt' | 'board') => void
  jumpToTask: (wsId: string, taskId: string) => void
  clearFocusTask: () => void

  toast: (msg: string, opts?: { action?: string; onAction?: () => void }) => void

  destructive: (label: string, storeFn: () => void, dbFn: () => DbResult) => void
  optimistic: (
    apply: () => void,
    dbFn: () => DbResult | DbResult[],
    opts?: { failMsg?: string; onRollback?: () => void; onSuccess?: () => void },
  ) => void

  exportJson: () => void
  importData: (obj: PlannerData, sourceName?: string) => void

  addWorkspace: () => void
  createWorkspace: (config: { name: string; color: string; icon?: string }) => void
  updateWorkspace: (ws: Workspace) => void
  deleteWorkspace: (id: string) => void

  addLane: (wsId: string, lane: Lane) => void
  // Clone a lane and all its tasks (fresh ids, remapped dependencies) as a new
  // workstream appended to the workspace.
  duplicateLane: (wsId: string, laneId: string) => void
  // Add a workstream from a built-in preset template (canned lane + tasks).
  addLaneFromPreset: (wsId: string, presetId: string) => void
  // Add a workstream from a user-defined (Supabase-persisted) template.
  addLaneFromTemplate: (wsId: string, templateId: string) => void
  // Capture an existing lane (its label/colour + tasks as relative offsets) as a
  // shared template, persisted to Supabase so it appears in the "From template"
  // list for everyone.
  saveLaneAsTemplate: (wsId: string, laneId: string, opts?: { label?: string; description?: string }) => void
  deleteLaneTemplate: (templateId: string) => void
  updateLane: (wsId: string, lane: Lane) => void
  deleteLane: (wsId: string, laneId: string) => void
  reorderLanes: (wsId: string, lanes: Lane[]) => void

  addTask: (wsId: string, laneId: string, startDate?: string, initialOwner?: string) => Task
  updateTask: (wsId: string, task: Task, undoToast?: string) => void
  // Reschedule a task by a day offset and cascade the same shift onto every
  // downstream task that (transitively) depends on it, in one optimistic write.
  moveTaskWithDependents: (wsId: string, taskId: string, deltaDays: number) => void
  deleteTask: (wsId: string, taskId: string) => void
  // Clone a task (fresh id, "(copy)" suffix) directly below the original in the
  // same lane; returns the new task's id. Dependencies are copied as-is.
  duplicateTask: (wsId: string, taskId: string) => string | undefined
  // Set (or clear) a task's recurrence and (re)generate its occurrences. Passing
  // rule=null clears recurrence and deletes any generated occurrences. When the
  // caller has already persisted the template row (updateTask), pass
  // opts.templateAlreadyWritten so we only touch the occurrences, not re-upsert
  // the template.
  applyRecurrence: (wsId: string, taskId: string, rule: RecurrenceRule | null, opts?: { templateAlreadyWritten?: boolean }) => void
  // Propagate a recurring template's edits onto its existing occurrences in
  // place: re-project their dates from the template's new dates, and copy the
  // shared display fields — while preserving each occurrence's own progress,
  // status, board bucket and comments.
  syncOccurrences: (wsId: string, templateId: string, prevTemplate: Task, newTemplate: Task) => void
  cancelNewTask: (wsId: string, taskId: string) => void
  reorderTasks: (wsId: string, laneId: string, orderedIds: string[]) => void
  moveToBoardStatus: (wsId: string, statusId: string, taskId: string, markDone?: boolean) => void

  updateKpiGroups: (groups: KpiGroup[]) => void
  setUserList: (users: string[]) => void
  addPerson: (email: string, displayName: string) => Promise<boolean>

  setMembership: (workspaceId: string, userId: string, role: Role) => void
  removeMembership: (workspaceId: string, userId: string) => void
  setAppAdmin: (userId: string, isAppAdmin: boolean) => void

  saveView: (name: string) => void
  applyView: (id: string) => void
  deleteView: (id: string) => void

  markNotificationRead: (id: string) => void
  markAllNotificationsRead: () => void
  loadMoreNotifications: () => Promise<void>

  updateMyAvatar: (file: File) => Promise<void>
  updateMyNotificationPrefs: (prefs: NotificationPrefs) => void
}

export const usePlannerStore = create<PlannerStore>((set, get) => ({
  data: JSON.parse(JSON.stringify(SEED)),
  ui: { ...DEFAULT_UI },
  undoStack: [],
  savedAt: null,
  loading: true,
  live: false,
  initError: null,
  focusTaskId: null,
  meId: null,
  notifications: [],
  notificationsExhausted: false,
  onlineIds: [],

  init: async () => {
    const localUi = loadUi()
    set({ loading: true, initError: null })
    let myEmail: string | null = null
    let myName: string | null = null
    let data: PlannerData
    let live = false
    try {
      // Await session to handle PKCE OAuth callback — ensures the code is exchanged
      // before loadAll() fires, otherwise RLS rejects the read.
      if (supabase) {
        const { data: { session } } = await withTimeout(supabase.auth.getSession(), 15000)
        const u = session?.user
        if (u?.email) {
          myEmail = u.email.toLowerCase()
          myName = (u.user_metadata?.full_name || u.user_metadata?.name || u.email) as string
          // Own profile photo. Azure OIDC doesn't return a picture claim, so we pull it
          // from Graph with the delegated provider_token — only present right after the
          // OAuth redirect, so photos are captured/refreshed on fresh sign-in.
          let myAvatar = (u.user_metadata?.avatar_url || u.user_metadata?.picture || '') as string
          const providerToken = session?.provider_token
          if (providerToken) {
            const photo = await withTimeout(fetchMsPhoto(providerToken), 10000).catch(() => '')
            if (photo) myAvatar = photo
          }
          // Just-in-time provisioning: link (or create) this user's own profile so real
          // identity + roles resolve. The roster is everyone who's signed in plus anyone
          // pre-provisioned via addPerson — no Microsoft Graph directory sync. avatarUrl
          // is omitted when empty so a tokenless reload never wipes a stored photo.
          await db.linkOwnProfile({
            authId: u.id,
            email: u.email,
            displayName: myName,
            avatarUrl: myAvatar || undefined,
          })
        }
      }
      // SEED is a local-mode convenience only. It must never be written into a
      // configured Supabase DB — an empty remote is a legitimate clean slate, and
      // a failed read is an error to surface, not a cue to show demo data.
      const remoteData = supabase ? await withTimeout(loadAll(), 15000) : null
      if (supabase && !remoteData) throw new Error('load failed')
      data = remoteData ?? (JSON.parse(JSON.stringify(SEED)) as PlannerData)
      live = !!remoteData
    } catch {
      set({ loading: false, initError: 'Could not load the planner — the server may be unreachable.' })
      return
    }
    // Mirror the signed-in user into the legacy display-name roster the pickers read,
    // so people appear as they log in (replacing the old bulk "Sync from Microsoft").
    if (myName && !data.userList.includes(myName)) {
      data.userList = [...data.userList, myName]
      fireAndForget(db.saveUserList(data.userList), 'roster mirror write')
    }
    const ui = { ...localUi }
    if (ui.page === 'ws' && !data.workspaces.find((w: Workspace) => w.id === ui.ws)) {
      ui.page = 'home'
    }
    const meId = myEmail ? (data.members.find((m: PlannerData['members'][number]) => m.email.toLowerCase() === myEmail)?.id ?? null) : null
    set({ data, ui, loading: false, live, meId })

    // Notification inbox: load recent history, then follow inserts live. Toast
    // only rows we haven't seen — a realtime re-delivery must not re-toast.
    if (unsubNotifications) { unsubNotifications(); unsubNotifications = null }
    if (meId) {
      const pullInbox = () =>
        db.fetchMyNotifications(meId).then(list =>
          set(s => ({
            notifications: mergeNotifications(s.notifications, list),
            notificationsExhausted: list.length < 50,
          })))
      void pullInbox()
      unsubNotifications = subscribeToNotifications(meId, n => {
        if (get().notifications.some(x => x.id === n.id)) return
        set(s => ({ notifications: [n, ...s.notifications] }))
        get().toast(
          `${n.actorName} ${n.message}`,
          n.workspaceId && n.taskId
            ? { action: 'View', onAction: () => get().jumpToTask(n.workspaceId!, n.taskId!) }
            : undefined,
        )
      }, () => void pullInbox())
    }

    // Presence: join the shared channel so everyone sees who's online right now.
    if (unsubPresence) { unsubPresence(); unsubPresence = null }
    if (meId && live) {
      unsubPresence = subscribeToPresence(meId, ids => set({ onlineIds: ids }))
    }

    // Realtime doesn't replay events missed while disconnected, so any gap in
    // coverage (channel drop, long-hidden tab, offline spell) ends with a full
    // re-pull — otherwise this client silently diverges from everyone else.
    if (!windowHooksInstalled && typeof window !== 'undefined' && supabase) {
      windowHooksInstalled = true
      let hiddenAt: number | null = null
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
        if (hiddenAt && Date.now() - hiddenAt > 30_000) void get().refreshFromRemote()
        hiddenAt = null
      })
      window.addEventListener('online', () => { void get().refreshFromRemote() })
    }

    if (unsubRealtime) unsubRealtime()
    unsubRealtime = subscribeToChanges({
      onWorkspace: (event, row) => {
        set(s => {
          if (event === 'DELETE') {
            return { data: { ...s.data, workspaces: s.data.workspaces.filter(w => w.id !== row.id) } }
          }
          const meta = rowToWorkspaceMeta(row)
          const exists = s.data.workspaces.some(w => w.id === row.id)
          return {
            data: {
              ...s.data,
              workspaces: exists
                ? s.data.workspaces.map(w => w.id === row.id ? { ...w, ...meta } : w)
                : [...s.data.workspaces, { ...meta, lanes: [], tasks: [] }],
            },
          }
        })
      },
      onLane: (event, row) => {
        set(s => ({
          data: {
            ...s.data,
            workspaces: s.data.workspaces.map(w => {
              if (w.id !== row.workspace_id) return w
              if (event === 'DELETE') {
                return {
                  ...w,
                  lanes: w.lanes.filter(l => l.id !== row.id),
                  tasks: w.tasks.filter(t => t.lane !== row.id),
                }
              }
              const lanes = upsertById(w.lanes, rowToLane(row))
              return { ...w, lanes: lanes.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0)) }
            }),
          },
        }))
      },
      onTask: (event, row) => {
        set(s => ({
          data: {
            ...s.data,
            workspaces: s.data.workspaces.map(w => {
              if (w.id !== row.workspace_id) return w
              if (event === 'DELETE') return { ...w, tasks: w.tasks.filter(t => t.id !== row.id) }
              return { ...w, tasks: upsertById(w.tasks, rowToTask(row)) }
            }),
          },
        }))
      },
      onKpiGroup: (event, row) => {
        set(s => ({
          data: {
            ...s.data,
            kpiGroups: event === 'DELETE'
              ? s.data.kpiGroups.filter(g => g.id !== row.id)
              : upsertById(s.data.kpiGroups, rowToKpiGroup(row)),
          },
        }))
      },
      onLaneTemplate: (event, row) => {
        set(s => ({
          data: {
            ...s.data,
            laneTemplates: event === 'DELETE'
              ? s.data.laneTemplates.filter(t => t.id !== row.id)
              : upsertById(s.data.laneTemplates, rowToLaneTemplate(row)),
          },
        }))
      },
      onUserList: users => {
        set(s => ({ data: { ...s.data, userList: users } }))
      },
      onProfile: (event, row) => {
        set(s => ({
          data: {
            ...s.data,
            members: event === 'DELETE'
              ? s.data.members.filter(m => m.id !== row.id)
              : upsertById(s.data.members, rowToMember(row)),
          },
        }))
      },
      onMembership: (event, row) => {
        set(s => {
          const key = (m: { workspaceId: string; userId: string }) =>
            m.workspaceId === row.workspace_id && m.userId === row.user_id
          if (event === 'DELETE') {
            return { data: { ...s.data, memberships: s.data.memberships.filter(m => !key(m)) } }
          }
          const membership = rowToMembership(row)
          const exists = s.data.memberships.some(key)
          return {
            data: {
              ...s.data,
              memberships: exists
                ? s.data.memberships.map(m => key(m) ? membership : m)
                : [...s.data.memberships, membership],
            },
          }
        })
      },
      onView: (event, row) => {
        set(s => ({
          data: {
            ...s.data,
            savedViews: event === 'DELETE'
              ? s.data.savedViews.filter(v => v.id !== row.id)
              : upsertById(s.data.savedViews, rowToView(row)),
          },
        }))
      },
    }, () => void get().refreshFromRemote())
  },

  // Re-pull everything from the DB after a gap in realtime coverage. The realtime
  // handlers replace rows by id and an in-flight optimistic write still lands via
  // its own upsert + echo, so a full replace here is safe.
  refreshFromRemote: async () => {
    if (!supabase || !get().live) return
    const remote = await loadAll().catch(() => null)
    if (!remote) return
    set(s => {
      const ui = { ...s.ui }
      if (ui.page === 'ws' && !remote.workspaces.find(w => w.id === ui.ws)) ui.page = 'home'
      return { data: remote, ui }
    })
    const meId = get().meId
    if (meId) {
      const list = await db.fetchMyNotifications(meId)
      set(s => ({ notifications: mergeNotifications(s.notifications, list) }))
    }
  },

  commit: () => {
    const now = new Date().toISOString()
    if (typeof window !== 'undefined') localStorage.setItem(LS_SAVED, now)
    set({ savedAt: now })
  },

  saveUi: () => {
    const { ui } = get()
    // search is session-only — persisting it would resurrect a stale filter on reload
    if (typeof window !== 'undefined') localStorage.setItem(LS_UI, JSON.stringify({ ...ui, search: '' }))
  },

  setUi: patch => set(s => ({ ui: { ...s.ui, ...patch } })),

  goHome: tab => {
    set(s => ({ ui: { ...s.ui, page: 'home', tab: tab ?? s.ui.tab } }))
    get().saveUi()
  },

  openWs: (id, view) => {
    // Preserve whichever workspace-scoped tab (timeline/board/calendar/table)
    // the user is already on — jumping between workspaces from the header's
    // workspace switcher should keep you on the same view, not bounce back to
    // Timeline. Only default to Timeline when coming from a non-workspace tab
    // (My work, Workspaces) where there's no view to carry over.
    const WS_TABS: PrimaryTab[] = ['timeline', 'board', 'calendar', 'table']
    set(s => ({
      ui: {
        ...s.ui,
        page: 'ws',
        ws: id,
        wsView: view ?? s.ui.wsView,
        stream: '',
        primaryTab: WS_TABS.includes(s.ui.primaryTab) ? s.ui.primaryTab : ('timeline' as PrimaryTab),
      },
    }))
    get().saveUi()
  },

  jumpToTask: (wsId, taskId) => {
    set({ focusTaskId: taskId })
    get().openWs(wsId)
  },

  clearFocusTask: () => set({ focusTaskId: null }),

  toast: (msg, opts) => {
    if (opts?.action) {
      sonnerToast(msg, {
        duration: 7000,
        action: { label: opts.action, onClick: () => opts.onAction?.() },
      })
    } else {
      sonnerToast(msg)
    }
  },

  // Optimistic delete: applies the store change immediately, then confirms with the DB.
  // Undo toast is shown only on success; on failure the change is silently reverted.
  destructive: (label, storeFn, dbFn) => {
    const snapshot = JSON.parse(JSON.stringify(get().data)) as PlannerData
    storeFn()
    get().commit()
    void Promise.resolve(dbFn() ?? Promise.resolve({ error: null })).then(({ error }) => {
      if (error) {
        set({ data: snapshot })
        get().commit()
        get().toast('Delete failed — change reverted')
        return
      }
      get().toast(label, {
        action: 'Undo',
        onAction: async () => {
          set({ data: snapshot })
          get().commit()
          await db.syncAll(snapshot)
          get().toast('Restored')
        },
      })
    })
  },

  // Optimistic write: apply the local change, fire the DB call(s), and restore
  // the pre-change data (+ toast) if any fail. dbFn runs after apply, so it can
  // read post-change state (the reorders do). onRollback restores anything the
  // data snapshot doesn't cover (e.g. ui); onSuccess runs follow-up writes that
  // need the first one to have landed.
  optimistic: (apply, dbFn, opts) => {
    const prev = get().data
    apply()
    get().commit()
    const raw = dbFn()
    const calls = (Array.isArray(raw) ? raw : [raw]).map(c => Promise.resolve(c ?? { error: null }))
    void Promise.all(calls).then(results => {
      if (results.some(r => r.error)) {
        set({ data: prev })
        get().commit()
        opts?.onRollback?.()
        get().toast(opts?.failMsg ?? 'Save failed — change reverted')
      } else {
        opts?.onSuccess?.()
      }
    })
  },

  exportJson: () => {
    const out = { ...JSON.parse(JSON.stringify(get().data)), version: 2, exportedAt: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `purefoods-backup-${fd(new Date())}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    get().toast('Backup downloaded')
  },

  importData: async (obj, sourceName) => {
    if (!obj || !Array.isArray(obj.workspaces)) {
      alert('Not a valid backup file (missing "workspaces").')
      return
    }
    const snapshot = JSON.parse(JSON.stringify(get().data)) as PlannerData
    const newData: PlannerData = Object.assign(
      { version: 2, exportedAt: null, userList: [], members: [], memberships: [], savedViews: [], kpiGroups: [], laneTemplates: [], workspaces: [] }, obj
    )
    set(s => {
      const ui = { ...s.ui }
      if (ui.page === 'ws' && !newData.workspaces.find((w: Workspace) => w.id === ui.ws)) ui.page = 'home'
      return { data: newData, ui }
    })
    get().saveUi()
    get().commit()
    await db.syncAll(newData)
    get().toast(
      `Imported ${sourceName || 'backup'} — ${obj.workspaces.length} workspace(s), ${obj.workspaces.reduce((n: number, w: Workspace) => n + w.tasks.length, 0)} task(s)`,
      {
        action: 'Undo',
        onAction: async () => {
          set({ data: snapshot })
          get().commit()
          await db.syncAll(snapshot)
          get().toast('Previous data restored')
        },
      }
    )
  },

  addWorkspace: () => {
    const n = prompt('New workspace name:')
    if (!n) return
    const idx = get().data.workspaces.length
    const w: Workspace = { id: uuid(), name: n, color: '#C63663', members: [], customBuckets: [], lanes: [], tasks: [] }
    get().optimistic(
      () => {
        set(s => ({ data: { ...s.data, workspaces: [...s.data.workspaces, w] } }))
        get().openWs(w.id)
      },
      () => db.upsertWorkspace(w, idx),
      { onRollback: () => { set(s => ({ ui: { ...s.ui, page: 'home' } })); get().saveUi() } },
    )
  },

  createWorkspace: config => {
    const idx = get().data.workspaces.length
    const w: Workspace = { id: uuid(), name: config.name, color: config.color, icon: config.icon, members: [], customBuckets: [], lanes: [], tasks: [] }
    const lane: Lane = { id: uuid(), label: 'General', color: config.color ?? '#C63663', sortIndex: 0 }
    const start = fd(todayD())
    const task: Task = {
      id: uuid(), name: 'New task', lane: lane.id, owner: '', start,
      end: fd(addDays(pd(start), 7)), pct: 0, notes: '',
      sortIndex: 0, boardBucket: null, checklist: [], milestones: [],
    }
    const wsWithDefaults: Workspace = { ...w, lanes: [lane], tasks: [task] }
    get().optimistic(
      () => {
        set(s => ({ data: { ...s.data, workspaces: [...s.data.workspaces, wsWithDefaults] } }))
        get().openWs(w.id)
      },
      () => db.upsertWorkspace(wsWithDefaults, idx),
      {
        onRollback: () => { set(s => ({ ui: { ...s.ui, page: 'home' } })); get().saveUi() },
        onSuccess: () => { db.upsertLane(w.id, lane, 0); db.upsertTask(w.id, task) },
      },
    )
  },

  updateWorkspace: ws => {
    const i = get().data.workspaces.findIndex(w => w.id === ws.id)
    get().optimistic(
      () => set(s => ({ data: { ...s.data, workspaces: s.data.workspaces.map(w => w.id === ws.id ? ws : w) } })),
      () => db.upsertWorkspace(ws, i >= 0 ? i : 0),
    )
  },

  deleteWorkspace: id => {
    get().destructive(
      'Deleted workspace',
      () => {
        set(s => {
          const ui = { ...s.ui }
          if (ui.ws === id) ui.page = 'home'
          return { data: { ...s.data, workspaces: s.data.workspaces.filter(w => w.id !== id) }, ui }
        })
        get().saveUi()
      },
      () => db.deleteWorkspace(id),
    )
  },

  addLane: (wsId, lane) => {
    const sortIndex = get().data.workspaces.find(x => x.id === wsId)?.lanes.length ?? 0
    get().optimistic(
      () => set(s => ({
        data: { ...s.data, workspaces: s.data.workspaces.map(w => w.id === wsId ? { ...w, lanes: [...w.lanes, lane] } : w) },
      })),
      () => db.upsertLane(wsId, lane, sortIndex),
    )
  },

  duplicateLane: (wsId, laneId) => {
    const prev = get().data
    const ws = prev.workspaces.find(w => w.id === wsId)
    const lane = ws?.lanes.find(l => l.id === laneId)
    if (!ws || !lane) return
    const newLane: Lane = { ...lane, id: uuid(), label: `${lane.label} (copy)`, sortIndex: ws.lanes.length }
    // Clone each task with a fresh id; remap dependencies through the old→new id map.
    const srcTasks = ws.tasks.filter(t => t.lane === laneId)
    const idMap = new Map(srcTasks.map(t => [t.id, uuid()]))
    const newTasks: Task[] = srcTasks.map(t => ({
      ...JSON.parse(JSON.stringify(t)),
      id: idMap.get(t.id)!,
      lane: newLane.id,
      dependencies: (t.dependencies ?? []).map(d => idMap.get(d)).filter(Boolean) as string[],
    }))
    get().optimistic(
      () => set(s => ({
        data: {
          ...s.data,
          workspaces: s.data.workspaces.map(w =>
            w.id === wsId ? { ...w, lanes: [...w.lanes, newLane], tasks: [...w.tasks, ...newTasks] } : w
          ),
        },
      })),
      () => [db.upsertLane(wsId, newLane, newLane.sortIndex ?? 0), ...newTasks.map(t => db.upsertTask(wsId, t))],
    )
    get().toast(`Duplicated "${lane.label}"${newTasks.length ? ` with ${newTasks.length} task${newTasks.length > 1 ? 's' : ''}` : ''}`)
  },

  addLaneFromPreset: (wsId, presetId) => {
    const ws = get().data.workspaces.find(w => w.id === wsId)
    const preset = LANE_PRESETS.find(p => p.id === presetId)
    if (!ws || !preset) return
    const { lane: newLane, tasks: newTasks } = buildLaneFromTemplate(preset, ws.lanes.length, get().meId ?? undefined)
    get().optimistic(
      () => set(s => ({
        data: {
          ...s.data,
          workspaces: s.data.workspaces.map(w =>
            w.id === wsId ? { ...w, lanes: [...w.lanes, newLane], tasks: [...w.tasks, ...newTasks] } : w
          ),
        },
      })),
      () => [db.upsertLane(wsId, newLane, newLane.sortIndex ?? 0), ...newTasks.map(t => db.upsertTask(wsId, t))],
    )
    get().toast(`Added "${preset.label}" workstream`)
  },

  addLaneFromTemplate: (wsId, templateId) => {
    const ws = get().data.workspaces.find(w => w.id === wsId)
    const tpl = get().data.laneTemplates.find(t => t.id === templateId)
    if (!ws || !tpl) return
    const { lane: newLane, tasks: newTasks } = buildLaneFromTemplate(tpl, ws.lanes.length, get().meId ?? undefined)
    get().optimistic(
      () => set(s => ({
        data: {
          ...s.data,
          workspaces: s.data.workspaces.map(w =>
            w.id === wsId ? { ...w, lanes: [...w.lanes, newLane], tasks: [...w.tasks, ...newTasks] } : w
          ),
        },
      })),
      () => [db.upsertLane(wsId, newLane, newLane.sortIndex ?? 0), ...newTasks.map(t => db.upsertTask(wsId, t))],
    )
    get().toast(`Added "${tpl.label}" workstream`)
  },

  saveLaneAsTemplate: (wsId, laneId, opts) => {
    const ws = get().data.workspaces.find(w => w.id === wsId)
    const lane = ws?.lanes.find(l => l.id === laneId)
    if (!ws || !lane) return
    // Snapshot the lane's tasks as relative offsets from the earliest start so the
    // template lays out sensibly wherever it's later instantiated ("today"-based).
    const laneTasks = ws.tasks
      .filter(t => t.lane === laneId && !t.noDate)
      .sort((a, b) => a.sortIndex - b.sortIndex)
    const base = laneTasks.reduce<number | null>((min, t) => {
      const s = pd(t.start).getTime()
      return min === null || s < min ? s : min
    }, null)
    const DAY = 86_400_000
    const tasks: TemplateTask[] = laneTasks.map(t => {
      const start = pd(t.start).getTime()
      const end = pd(t.end).getTime()
      return {
        key: t.id, // reuse the source id as a stable key for dependency remapping
        name: t.name,
        dayOffset: base === null ? 0 : Math.round((start - base) / DAY),
        durDays: Math.max(0, Math.round((end - start) / DAY)),
        dependsOn: (t.dependencies ?? []).filter(d => laneTasks.some(x => x.id === d)),
      }
    })
    const tpl: LaneTemplate = {
      id: uuid(),
      label: opts?.label?.trim() || lane.label,
      color: lane.color,
      description: opts?.description?.trim() || `Saved from "${lane.label}".`,
      tasks,
      createdBy: get().meId ?? undefined,
      sortIndex: get().data.laneTemplates.length,
    }
    get().optimistic(
      () => set(s => ({ data: { ...s.data, laneTemplates: [...s.data.laneTemplates, tpl] } })),
      () => db.upsertLaneTemplate(tpl, tpl.sortIndex ?? 0),
    )
    get().toast(`Saved "${tpl.label}" as a template`)
  },

  deleteLaneTemplate: (templateId) => {
    const tpl = get().data.laneTemplates.find(t => t.id === templateId)
    if (!tpl) return
    get().destructive(
      'Deleted template',
      () => set(s => ({ data: { ...s.data, laneTemplates: s.data.laneTemplates.filter(t => t.id !== templateId) } })),
      () => db.deleteLaneTemplate(templateId),
    )
  },

  updateLane: (wsId, lane) => {
    const sortIndex = get().data.workspaces.find(x => x.id === wsId)?.lanes.findIndex(l => l.id === lane.id) ?? 0
    get().optimistic(
      () => set(s => ({
        data: { ...s.data, workspaces: s.data.workspaces.map(w => w.id === wsId ? { ...w, lanes: w.lanes.map(l => l.id === lane.id ? lane : l) } : w) },
      })),
      () => db.upsertLane(wsId, lane, sortIndex >= 0 ? sortIndex : 0),
    )
  },

  deleteLane: (wsId, laneId) => {
    get().destructive(
      'Deleted workstream',
      () => {
        set(s => ({
          data: {
            ...s.data,
            workspaces: s.data.workspaces.map(w =>
              w.id === wsId
                ? { ...w, lanes: w.lanes.filter(l => l.id !== laneId), tasks: w.tasks.filter(t => t.lane !== laneId) }
                : w
            ),
          },
        }))
      },
      () => db.deleteLane(laneId),
    )
  },

  reorderLanes: (wsId, lanes) => {
    get().optimistic(
      () => set(s => ({
        data: { ...s.data, workspaces: s.data.workspaces.map(w => w.id === wsId ? { ...w, lanes } : w) },
      })),
      () => lanes.map((l, i) => db.upsertLane(wsId, l, i)),
      { failMsg: 'Reorder failed — change reverted' },
    )
  },

  addTask: (wsId, laneId, startDate, initialOwner) => {
    const prev = get().data
    const start = startDate ?? fd(todayD())
    const meId = get().meId
    // Defaults the new task to whoever's creating it — an explicit
    // initialOwner (e.g. "add task for this person" from the People view)
    // still wins over that default.
    const owner = initialOwner ?? (meId ? memberName(prev.members, meId) : '')
    const assignees = initialOwner ? [] : meId ? [meId] : []
    const t: Task = {
      id: uuid(), name: 'New task', lane: laneId, owner, assignees,
      reporterId: meId ?? undefined, watchers: [], start,
      end: fd(addDays(pd(start), 7)), pct: 0, notes: '',
      sortIndex: prev.workspaces.find(w => w.id === wsId)?.tasks.filter(x => x.lane === laneId).length ?? 0,
      boardBucket: null, checklist: [], milestones: [],
    }
    get().optimistic(
      () => set(s => ({
        data: { ...s.data, workspaces: s.data.workspaces.map(w => w.id === wsId ? { ...w, tasks: [...w.tasks, t] } : w) },
      })),
      () => db.upsertTask(wsId, t),
      {
        // Activity log has an FK on task_id — only write it once the task
        // insert has actually landed, or it can race ahead of (or survive
        // the rollback of) the task row and violate the constraint.
        onSuccess: () => {
          const ws = prev.workspaces.find(w => w.id === wsId)
          if (!ws) return
          const actorId = get().meId ?? ''
          const actorName = memberName(prev.members, actorId)
          db.logActivity(buildTaskActivityEntries(ws, prev.members, undefined, t, actorId, actorName, 'created'))
        },
      },
    )
    return t
  },

  duplicateTask: (wsId, taskId) => {
    const prev = get().data
    const ws = prev.workspaces.find(w => w.id === wsId)
    const src = ws?.tasks.find(t => t.id === taskId)
    if (!ws || !src) return undefined
    const copy: Task = {
      ...JSON.parse(JSON.stringify(src)),
      id: uuid(),
      name: `${src.name} (copy)`,
      // Fresh social/audit state — comments and activity belong to the original.
      comments: [],
      reporterId: get().meId ?? undefined,
      // Sit just after the original in the same lane; siblings below it shift down.
      sortIndex: (src.sortIndex ?? 0) + 1,
    }
    const bumped = ws.tasks.map(t =>
      t.lane === src.lane && (t.sortIndex ?? 0) > (src.sortIndex ?? 0)
        ? { ...t, sortIndex: (t.sortIndex ?? 0) + 1 }
        : t
    )
    get().optimistic(
      () => set(s => ({
        data: {
          ...s.data,
          workspaces: s.data.workspaces.map(w =>
            w.id === wsId ? { ...w, tasks: [...bumped, copy] } : w
          ),
        },
      })),
      () => [db.upsertTask(wsId, copy), ...bumped.filter(t => t.id !== src.id).map(t => db.upsertTask(wsId, t))],
      {
        onSuccess: () => {
          const actorId = get().meId ?? ''
          const actorName = memberName(prev.members, actorId)
          db.logActivity(buildTaskActivityEntries(ws, prev.members, undefined, copy, actorId, actorName, 'created'))
        },
      },
    )
    get().toast(`Duplicated "${src.name}"`, {
      action: 'Undo',
      onAction: () => {
        set(s => ({
          data: {
            ...s.data,
            workspaces: s.data.workspaces.map(w =>
              w.id === wsId ? { ...w, tasks: w.tasks.filter(t => t.id !== copy.id) } : w
            ),
          },
        }))
        get().commit()
        fireAndForget(db.deleteTask(copy.id), 'undo duplicate')
        get().toast('Duplicate removed')
      },
    })
    return copy.id
  },

  applyRecurrence: (wsId, taskId, rule, opts) => {
    const prev = get().data
    const ws = prev.workspaces.find(w => w.id === wsId)
    const template = ws?.tasks.find(t => t.id === taskId)
    if (!ws || !template) return
    // A recurring template must have real dates to project from.
    if (rule && template.noDate) {
      get().toast('Give the task dates before making it repeat')
      return
    }

    // Remove any previously-generated occurrences for this template; we always
    // regenerate from scratch so changing the rule stays consistent.
    const existingChildIds = ws.tasks.filter(t => t.recurrenceParentId === taskId).map(t => t.id)
    const existingChildSet = new Set(existingChildIds)

    // Clamp the count centrally (2–52) so every caller — editor, row menu,
    // future/imported rules — is bounded, not just the editor input.
    const safeRule: RecurrenceRule | null = rule
      ? { freq: rule.freq, count: Math.max(2, Math.min(52, Math.round(rule.count) || 2)) }
      : null
    // Build the new template (rule set/cleared) and the fresh occurrences.
    const newTemplate: Task = { ...template, recurrence: safeRule ?? undefined }
    const occurrences: Task[] = safeRule
      ? recurrenceOccurrences(template.start, template.end, safeRule.freq, safeRule.count).map((o, i) => ({
          ...JSON.parse(JSON.stringify(template)),
          id: uuid(),
          start: o.start,
          end: o.end,
          pct: 0,
          statusId: undefined,
          boardBucket: null,
          comments: [],
          recurrence: undefined,
          recurrenceParentId: taskId,
          sortIndex: (template.sortIndex ?? 0) + i + 1,
        }))
      : []

    get().optimistic(
      () => set(s => ({
        data: {
          ...s.data,
          workspaces: s.data.workspaces.map(w =>
            w.id === wsId
              ? {
                  ...w,
                  tasks: [
                    ...w.tasks
                      .filter(t => !existingChildSet.has(t.id))
                      .map(t => t.id === taskId ? newTemplate : t),
                    ...occurrences,
                  ],
                }
              : w
          ),
        },
      })),
      () => [
        // The template row is skipped when updateTask already persisted it.
        ...(opts?.templateAlreadyWritten ? [] : [db.upsertTask(wsId, newTemplate)]),
        ...occurrences.map(t => db.upsertTask(wsId, t)),
        ...existingChildIds.map(id => db.deleteTask(id) ?? Promise.resolve({ error: null })),
      ],
    )

    // updateTask owns the toast when it drives the sync; only toast on a direct
    // recurrence change (e.g. the Gantt row menu).
    if (opts?.templateAlreadyWritten) return
    if (safeRule) {
      get().toast(`Repeats ${safeRule.freq} · ${occurrences.length} more occurrence${occurrences.length === 1 ? '' : 's'} added`)
    } else {
      get().toast('Recurrence removed')
    }
  },

  syncOccurrences: (wsId, templateId, prevTemplate, newTemplate) => {
    const prev = get().data
    const ws = prev.workspaces.find(w => w.id === wsId)
    if (!ws || !newTemplate.recurrence) return
    // Occurrences in their generated order (by sortIndex, then start).
    const children = ws.tasks
      .filter(t => t.recurrenceParentId === templateId)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0) || a.start.localeCompare(b.start))
    if (!children.length) return

    // Did the template's dates change? If so, re-project each occurrence's dates.
    const datesChanged = prevTemplate.start !== newTemplate.start || prevTemplate.end !== newTemplate.end
    const projected = datesChanged
      ? recurrenceOccurrences(newTemplate.start, newTemplate.end, newTemplate.recurrence.freq, children.length + 1)
      : null

    // Shared display fields copied onto every occurrence (progress/status/
    // comments stay per-occurrence).
    const shared = {
      name: newTemplate.name,
      owner: newTemplate.owner,
      assignees: newTemplate.assignees,
      lane: newTemplate.lane,
      notes: newTemplate.notes,
      icon: newTemplate.icon,
      iconColor: newTemplate.iconColor,
    }
    const updated = children.map((c, i) => ({
      ...c,
      ...shared,
      ...(projected && projected[i] ? { start: projected[i].start, end: projected[i].end, noDate: false } : {}),
    }))

    get().optimistic(
      () => set(s => ({
        data: {
          ...s.data,
          workspaces: s.data.workspaces.map(w =>
            w.id === wsId
              ? { ...w, tasks: w.tasks.map(t => updated.find(u => u.id === t.id) ?? t) }
              : w
          ),
        },
      })),
      () => updated.map(t => db.upsertTask(wsId, t)),
    )
  },

  updateTask: (wsId, task, undoToast) => {
    const prev = get().data
    const ws = prev.workspaces.find(w => w.id === wsId)
    const prevTask = ws?.tasks.find(t => t.id === task.id)
    get().optimistic(
      () => set(s => ({
        data: {
          ...s.data,
          workspaces: s.data.workspaces.map(w =>
            w.id === wsId ? { ...w, tasks: w.tasks.map(t => t.id === task.id ? task : t) } : w
          ),
        },
      })),
      () => db.upsertTask(wsId, task),
    )
    if (ws && prevTask) {
      const actorId = get().meId ?? ''
      const actorName = memberName(prev.members, actorId)
      const entries = buildTaskActivityEntries(ws, prev.members, prevTask, task, actorId, actorName, 'updated')
      if (entries.length) db.logActivity(entries)
      if (actorId) db.insertNotifications(buildTaskNotifications(ws, prev.members, prevTask, task, actorId, actorName))
    }
    // Keep generated occurrences in sync with the template. Owned here (not in
    // the UI) so every caller stays consistent — but never on a generated
    // occurrence itself.
    if (prevTask && !task.recurrenceParentId) {
      const ruleChanged =
        JSON.stringify(prevTask.recurrence ?? null) !== JSON.stringify(task.recurrence ?? null)
      if (ruleChanged) {
        // Rule added/removed/retimed → regenerate occurrences from scratch.
        get().applyRecurrence(wsId, task.id, task.recurrence ?? null, { templateAlreadyWritten: true })
      } else if (task.recurrence) {
        // Same rule, but the template's dates or shared fields may have changed —
        // propagate them onto the existing occurrences in place.
        get().syncOccurrences(wsId, task.id, prevTask, task)
      }
    }
    // Optional undoable toast (used by drag-resize) — restores the prior task.
    if (undoToast && prevTask) {
      const restore = prevTask
      get().toast(undoToast, {
        action: 'Undo',
        onAction: () => {
          set(s => ({
            data: {
              ...s.data,
              workspaces: s.data.workspaces.map(w =>
                w.id === wsId ? { ...w, tasks: w.tasks.map(t => t.id === restore.id ? restore : t) } : w
              ),
            },
          }))
          get().commit()
          fireAndForget(db.upsertTask(wsId, restore), 'undo resize')
          get().toast('Change undone')
        },
      })
    }
  },

  moveTaskWithDependents: (wsId, taskId, deltaDays) => {
    const prev = get().data
    const ws = prev.workspaces.find(w => w.id === wsId)
    if (!ws || !deltaDays) return

    // Compute the new dates for the moved task + every transitive dependent,
    // capturing each original (for undo) in the same pass.
    const byId = new Map(ws.tasks.map(t => [t.id, t]))
    const moves = cascadeTaskMove(ws.tasks, taskId, deltaDays)
    const prevTasks: Task[] = []
    const shifted: Task[] = []
    for (const m of moves) {
      const t = byId.get(m.id)
      if (!t) continue
      prevTasks.push(t)
      shifted.push({ ...t, start: m.start, end: m.end, noDate: m.noDate })
    }
    if (!shifted.length) return

    const shiftedById = new Map(shifted.map(t => [t.id, t]))
    get().optimistic(
      () => set(s => ({
        data: {
          ...s.data,
          workspaces: s.data.workspaces.map(w =>
            w.id === wsId
              ? { ...w, tasks: w.tasks.map(t => shiftedById.get(t.id) ?? t) }
              : w
          ),
        },
      })),
      () => shifted.map(t => db.upsertTask(wsId, t)),
    )

    // Log/notify each moved task, mirroring updateTask's per-task bookkeeping.
    const actorId = get().meId ?? ''
    const actorName = memberName(prev.members, actorId)
    for (let i = 0; i < shifted.length; i++) {
      const t = shifted[i]
      const prevTask = prevTasks[i]
      if (!prevTask) continue
      const entries = buildTaskActivityEntries(ws, prev.members, prevTask, t, actorId, actorName, 'updated')
      if (entries.length) db.logActivity(entries)
      if (actorId) db.insertNotifications(buildTaskNotifications(ws, prev.members, prevTask, t, actorId, actorName))
      // If a moved task is a recurrence template, re-project its occurrences to
      // follow — but not the occurrences themselves (they're moved individually).
      if (t.recurrence && !t.recurrenceParentId) {
        get().syncOccurrences(wsId, t.id, prevTask, t)
      }
    }

    // One toast for the whole move, with Undo restoring the prior dates.
    const dragged = shiftedById.get(taskId)
    const cascaded = shifted.length - 1
    const msg = dragged
      ? `Rescheduled "${dragged.name}"${cascaded > 0 ? ` · ${cascaded} linked task${cascaded > 1 ? 's' : ''} moved` : ''}`
      : `Moved ${shifted.length} task${shifted.length > 1 ? 's' : ''}`
    get().toast(msg, {
      action: 'Undo',
      onAction: () => {
        const undoById = new Map(prevTasks.map(t => [t.id, t]))
        set(s => ({
          data: {
            ...s.data,
            workspaces: s.data.workspaces.map(w =>
              w.id === wsId
                ? { ...w, tasks: w.tasks.map(t => undoById.get(t.id) ?? t) }
                : w
            ),
          },
        }))
        get().commit()
        prevTasks.forEach(t => fireAndForget(db.upsertTask(wsId, t), 'undo move'))
        get().toast('Move undone')
      },
    })
  },

  deleteTask: (wsId, taskId) => {
    const prev = get().data
    const ws = prev.workspaces.find(w => w.id === wsId)
    const prevTask = ws?.tasks.find(t => t.id === taskId)
    // Siblings that list the doomed task as a predecessor — their dependency
    // arrays must lose the dangling id (locally and in the DB).
    const dependents = (ws?.tasks ?? []).filter(t => (t.dependencies ?? []).includes(taskId))
    // Deleting a recurrence template also removes its generated occurrences —
    // they're just projections of the series and are meaningless without it.
    const recurrenceChildIds = (ws?.tasks ?? [])
      .filter(t => t.recurrenceParentId === taskId)
      .map(t => t.id)
    const removedIds = new Set<string>([taskId, ...recurrenceChildIds])
    get().destructive(
      recurrenceChildIds.length ? `Deleted task + ${recurrenceChildIds.length} occurrence${recurrenceChildIds.length > 1 ? 's' : ''}` : 'Deleted task',
      () => {
        set(s => ({
          data: {
            ...s.data,
            workspaces: s.data.workspaces.map(w =>
              w.id === wsId
                ? {
                    ...w,
                    tasks: w.tasks
                      .filter(t => !removedIds.has(t.id))
                      .map(t =>
                        (t.dependencies ?? []).includes(taskId)
                          ? { ...t, dependencies: t.dependencies!.filter(d => d !== taskId) }
                          : t
                      ),
                  }
                : w
            ),
          },
        }))
      },
      async () => {
        if (ws && prevTask) {
          const actorId = get().meId ?? ''
          const actorName = memberName(prev.members, actorId)
          // Must land before the delete below, or the FK on activity_log.task_id
          // can point at a task_id that's already gone.
          await db.insertActivityLog(buildTaskActivityEntries(ws, prev.members, undefined, prevTask, actorId, actorName, 'deleted'))
        }
        // Persist the pruned dependency arrays on affected siblings.
        for (const dep of dependents) {
          fireAndForget(db.upsertTask(wsId, { ...dep, dependencies: (dep.dependencies ?? []).filter(d => d !== taskId) }), 'prune dependency')
        }
        // Delete generated occurrences alongside the template.
        for (const childId of recurrenceChildIds) {
          fireAndForget(db.deleteTask(childId) ?? Promise.resolve({ error: null }), 'delete recurrence child')
        }
        return db.deleteTask(taskId) ?? Promise.resolve({ error: null })
      },
    )
  },

  cancelNewTask: (wsId, taskId) => {
    set(s => ({
      data: {
        ...s.data,
        workspaces: s.data.workspaces.map(w =>
          w.id === wsId
            ? { ...w, tasks: w.tasks.filter(t => t.id !== taskId) }
            : w
        ),
      },
    }))
    get().commit()
    fireAndForget(db.deleteTask(taskId), 'draft task delete')
  },

  reorderTasks: (wsId, laneId, orderedIds) => {
    get().optimistic(
      () => set(s => ({
        data: {
          ...s.data,
          workspaces: s.data.workspaces.map(w => {
            if (w.id !== wsId) return w
            const tasks = w.tasks.map(t => {
              if (t.lane !== laneId) return t
              const idx = orderedIds.indexOf(t.id)
              return idx >= 0 ? { ...t, sortIndex: idx } : t
            })
            return { ...w, tasks }
          }),
        },
      })),
      () => (get().data.workspaces.find(x => x.id === wsId)?.tasks.filter(t => t.lane === laneId) ?? [])
        .map(t => db.upsertTask(wsId, t)),
      { failMsg: 'Reorder failed — change reverted' },
    )
  },

  // Board drag-between-columns: moves one card into `statusId`. Board columns
  // are always sorted by end date (not manually orderable), so there's no
  // ordering to persist here — just the status change. Pass `markDone` to also
  // mark it 100% complete when the target column is a done state.
  moveToBoardStatus: (wsId, statusId, taskId, markDone) => {
    const prev = get().data
    let updated: Task | undefined
    get().optimistic(
      () => set(s => ({
        data: {
          ...s.data,
          workspaces: s.data.workspaces.map(w => {
            if (w.id !== wsId) return w
            const tasks = w.tasks.map(t => {
              if (t.id !== taskId) return t
              updated = { ...t, statusId, boardBucket: null, ...(markDone ? { pct: 100 } : {}) }
              return updated
            })
            return { ...w, tasks }
          }),
        },
      })),
      () => (updated ? [db.upsertTask(wsId, updated)] : []),
      { failMsg: 'Move failed — change reverted' },
    )
    const ws = prev.workspaces.find(x => x.id === wsId)
    const before = ws?.tasks.find(x => x.id === taskId)
    if (ws && before && updated && taskStatusId(before) !== statusId) {
      const actorId = get().meId ?? ''
      const actorName = memberName(prev.members, actorId)
      const entries = buildTaskActivityEntries(ws, prev.members, before, updated, actorId, actorName, 'updated')
      if (entries.length) db.logActivity(entries)
      if (actorId) db.insertNotifications(buildTaskNotifications(ws, prev.members, before, updated, actorId, actorName))
    }
  },

  updateKpiGroups: groups => {
    const deletedIds = get().data.kpiGroups.map(g => g.id).filter(id => !groups.some(g => g.id === id))
    get().optimistic(
      () => set(s => ({ data: { ...s.data, kpiGroups: groups } })),
      () => [
        ...deletedIds.map(id => db.deleteKpiGroup(id)),
        ...groups.map((g, i) => db.upsertKpiGroup(g, i)),
      ],
    )
  },

  setUserList: users => {
    get().optimistic(
      () => set(s => ({ data: { ...s.data, userList: users } })),
      () => db.saveUserList(users),
    )
  },

  // Pre-provision someone who hasn't signed in yet so work can be assigned and
  // roles granted ahead of their first login; linkOwnProfile claims the profiles
  // row by email when they do sign in.
  addPerson: async (email, displayName) => {
    const name = displayName.trim()
    const mail = email.trim().toLowerCase()
    if (!name || !mail) return false
    if (!supabase) {
      // Local/seed mode has no profiles table — the legacy name roster is enough.
      if (!get().data.userList.includes(name)) get().setUserList([...get().data.userList, name])
      return true
    }
    const { member, error } = await db.addProfile(mail, name)
    if (error || !member) {
      get().toast(error?.code === '23505'
        ? 'That email is already on the roster'
        : 'Could not add person — try again')
      return false
    }
    // Realtime will also deliver this profiles row; the exists-check keeps it deduped.
    set(s => ({
      data: {
        ...s.data,
        members: s.data.members.some(m => m.id === member.id) ? s.data.members : [...s.data.members, member],
      },
    }))
    if (!get().data.userList.includes(name)) get().setUserList([...get().data.userList, name])
    get().toast(`${name} added — they can be assigned work now and will link up on first sign-in`)
    return true
  },

  setMembership: (workspaceId, userId, role) => {
    get().optimistic(
      () => set(s => {
        const others = s.data.memberships.filter(m => !(m.workspaceId === workspaceId && m.userId === userId))
        return { data: { ...s.data, memberships: [...others, { workspaceId, userId, role }] } }
      }),
      () => db.setMembership(workspaceId, userId, role),
      { failMsg: 'Role change failed — reverted' },
    )
  },

  removeMembership: (workspaceId, userId) => {
    get().optimistic(
      () => set(s => ({
        data: { ...s.data, memberships: s.data.memberships.filter(m => !(m.workspaceId === workspaceId && m.userId === userId)) },
      })),
      () => db.removeMembership(workspaceId, userId),
      { failMsg: 'Remove failed — reverted' },
    )
  },

  setAppAdmin: (userId, isAppAdmin) => {
    get().optimistic(
      () => set(s => ({
        data: { ...s.data, members: s.data.members.map(m => m.id === userId ? { ...m, isAppAdmin } : m) },
      })),
      () => db.setAppAdmin(userId, isAppAdmin),
      { failMsg: 'Save failed — reverted' },
    )
  },

  saveView: name => {
    const { ui, meId } = get()
    const wsId = ui.ws
    if (!wsId) return
    // Snapshot the parts of UiState that define "the current view".
    const config: Partial<UiState> = {
      primaryTab: ui.primaryTab, person: ui.person, stream: ui.stream,
      zoom: ui.zoom, todayOnly: ui.todayOnly, taskFilter: ui.taskFilter, collapsed: ui.collapsed,
    }
    const view: SavedView = { id: uuid(), workspaceId: wsId, name, config, ownerId: meId ?? undefined }
    get().optimistic(
      () => set(s => ({ data: { ...s.data, savedViews: [...s.data.savedViews, view] } })),
      () => db.upsertView(view),
      { failMsg: 'Save failed — reverted' },
    )
    get().toast(`Saved view "${name}"`)
  },

  applyView: id => {
    const view = get().data.savedViews.find(v => v.id === id)
    if (!view) return
    set(s => ({ ui: { ...s.ui, ...view.config } }))
    get().saveUi()
  },

  deleteView: id => {
    get().destructive(
      'Deleted view',
      () => set(s => ({ data: { ...s.data, savedViews: s.data.savedViews.filter(v => v.id !== id) } })),
      () => db.deleteView(id),
    )
  },

  // Read-marking is optimistic and fire-and-forget: a lost update just means the
  // dot comes back on next load, which isn't worth a rollback toast.
  markNotificationRead: id => {
    const now = new Date().toISOString()
    set(s => ({
      notifications: s.notifications.map(n => n.id === id && !n.readAt ? { ...n, readAt: now } : n),
    }))
    fireAndForget(db.markNotificationRead(id), 'notification read-mark')
  },

  markAllNotificationsRead: () => {
    const { meId } = get()
    const now = new Date().toISOString()
    set(s => ({ notifications: s.notifications.map(n => n.readAt ? n : { ...n, readAt: now }) }))
    if (meId) fireAndForget(db.markAllNotificationsRead(meId), 'notification read-all')
  },

  // Upload a (downscaled) profile photo and point my profiles row at it. The
  // member row is updated optimistically so the new photo shows everywhere at
  // once; realtime delivers the same change to other clients via onProfile.
  updateMyAvatar: async file => {
    const { meId } = get()
    if (!meId) return
    const blob = await downscaleImage(file, 128)
    const url = await db.uploadAvatar(meId, blob)
    if (!url) {
      get().toast('Photo upload failed — try again')
      return
    }
    get().optimistic(
      () => set(s => ({
        data: { ...s.data, members: s.data.members.map(m => m.id === meId ? { ...m, avatarUrl: url } : m) },
      })),
      () => db.updateAvatarUrl(meId, url),
      { onSuccess: () => get().toast('Profile photo updated') },
    )
  },

  // Mute settings apply from the next save that fans out (lib/notify.ts reads
  // them off the members roster) and to the next DB-side due run.
  updateMyNotificationPrefs: prefs => {
    const { meId } = get()
    if (!meId) return
    get().optimistic(
      () => set(s => ({
        data: { ...s.data, members: s.data.members.map(m => m.id === meId ? { ...m, notificationPrefs: prefs } : m) },
      })),
      () => db.updateNotificationPrefs(meId, prefs),
    )
  },

  // Page the next 50 older rows past the current inbox tail ("Show older").
  loadMoreNotifications: async () => {
    const { meId, notifications } = get()
    if (!meId || !notifications.length) return
    const before = notifications[notifications.length - 1].createdAt
    const older = await db.fetchMyNotifications(meId, { before })
    set(s => ({
      notifications: mergeNotifications(s.notifications, older),
      notificationsExhausted: older.length < 50,
    }))
  },
}))
