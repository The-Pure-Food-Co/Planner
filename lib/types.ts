export type RagStatus = 'none' | 'green' | 'amber' | 'red'
export type Role = 'admin' | 'member' | 'viewer'
export type ZoomLevel = 'days' | 'weeks' | 'months'
export type HomeTab = 'teams' | 'projects' | 'milestones' | 'kpis' | 'people'
export type WsView = 'gantt' | 'board'
export type PrimaryTab = 'timeline' | 'board' | 'calendar' | 'table' | 'people' | 'teams' | 'kpis' | 'mywork'

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface TaskMilestone {
  id: string
  label: string
  date: string
}

export interface TaskComment {
  id: string
  authorId: string        // profiles.id ('' when unknown)
  authorName: string      // display-name snapshot at post time
  text: string
  createdAt: string       // ISO timestamp
}

export interface TaskAttachment {
  id: string
  name: string            // original filename
  url: string             // public URL (Supabase Storage), or data URL in no-backend mode
  path?: string           // storage object path, used to delete the file
  size?: number           // bytes
  type?: string           // MIME type
}

export interface TaskLink {
  id: string
  label: string
  url: string
}

export type NotificationType = 'mention' | 'assigned' | 'comment' | 'status' | 'due' | 'update'

// Per-user notification muting. Absent/empty lists mean "deliver everything";
// a muted workspace silences ALL its notifications, including mentions.
export interface NotificationPrefs {
  mutedTypes?: NotificationType[]
  mutedWorkspaces?: string[]   // workspace ids
}

export interface AppNotification {
  id: string
  recipientId: string      // profiles.id of who gets notified
  actorId: string | null   // profiles.id of who did it
  actorName: string        // display-name snapshot at event time
  type: NotificationType
  workspaceId: string | null
  taskId: string | null    // nulled if the task is later deleted
  taskName: string         // snapshot, survives task deletion
  message: string          // human-readable, e.g. `mentioned you in a comment: "…"`
  readAt: string | null
  createdAt: string
}

// Personal scratch to-do on the "My work" page — one row per item, owned by a
// single profile, not shared with or visible to anyone else.
export interface Todo {
  id: string
  text: string
  done: boolean
  sortIndex: number
  dueDate: string | null
  important: boolean
  completedAt: string | null   // set when done flips true; used to sort the Completed view by week
}

export type ActivityAction = 'created' | 'updated' | 'deleted'

export interface ActivityLogEntry {
  id: string
  workspaceId: string
  taskId: string | null
  taskName: string
  actorId: string
  actorName: string
  action: ActivityAction
  field?: string
  oldValue?: string
  newValue?: string
  message: string        // human-readable summary, e.g. "changed status from Not started to Done"
  createdAt: string       // ISO timestamp
}

export type RecurrenceFreq = 'weekly' | 'fortnightly' | 'monthly'

// Recurrence rule stored on the FIRST occurrence (the template). Setting it
// auto-generates `count` further occurrences, each a normal task tagged with
// recurrenceParentId pointing back at the template.
export interface RecurrenceRule {
  freq: RecurrenceFreq
  count: number            // how many occurrences total (including the template)
}

export interface Task {
  id: string
  name: string
  lane: string
  owner: string              // legacy display-name; kept in sync with the primary assignee
  assignees?: string[]       // profiles.id of assigned members (falls back to owner name)
  reporterId?: string        // profiles.id of whoever created the task
  watchers?: string[]        // profiles.id of watchers
  start: string
  end: string
  noDate?: boolean
  pct: number
  notes: string
  sortIndex: number
  boardBucket: string | null
  statusId?: string           // workflow state id (falls back to statusOf(pct) if unset)
  icon?: string               // chosen Phosphor icon id (lib/taskIcons); falls back to a deterministic pick
  iconColor?: string          // icon colour (hex or css var); defaults to white on the bar
  dependencies?: string[]     // ids of predecessor tasks this one depends on (must finish first)
  recurrence?: RecurrenceRule // set on the template occurrence; drives auto-generation
  recurrenceParentId?: string // set on generated occurrences → the template task's id
  estimate?: number | null    // effort estimate (unit-agnostic, e.g. days/points)
  checklist: ChecklistItem[]
  milestones: TaskMilestone[]
  comments?: TaskComment[]
  attachments?: TaskAttachment[]
  links?: TaskLink[]
}

export interface Lane {
  id: string
  label: string
  color: string
  sortIndex?: number
  icon?: string
  iconColor?: string
}

// A single task inside a workstream template, laid out relative to "today":
// start = today + dayOffset, end = start + durDays. Tasks reference each other by
// `key` for dependencies; the store maps those to fresh ids on instantiation.
// The built-in presets (lib/lanePresets.ts) use this same shape.
export interface TemplateTask {
  key: string
  name: string
  dayOffset: number
  durDays: number
  dependsOn?: string[]   // keys of predecessor TemplateTasks
}

// A reusable workstream template. Built-ins are hardcoded (lib/lanePresets.ts);
// user-defined ones are saved via "Save as template" and persisted in Supabase
// (lane_templates table) so they appear in the "From template" list for everyone.
export interface LaneTemplate {
  id: string
  label: string
  color: string
  description: string
  tasks: TemplateTask[]
  createdBy?: string     // profiles.id of the author
  sortIndex?: number
}

export interface WorkflowState {
  id: string
  label: string
  color: string
  order: number
  isDone: boolean
}

export interface Workspace {
  id: string
  name: string
  color: string
  icon?: string
  members: string[]
  customBuckets: string[]
  statuses?: WorkflowState[]   // per-workspace workflow states (falls back to defaults)
  lanes: Lane[]
  tasks: Task[]
}

export interface Member {
  id: string          // stable profiles.id (uuid); used by assignments/roles
  email: string
  displayName: string
  avatarUrl: string
  isAppAdmin: boolean
  isNzTeam: boolean   // Entra ID "NZ Team" group membership; written by the shared Auth Hub app (Gantt), not this repo
  notificationPrefs?: NotificationPrefs
}

export interface WorkspaceMembership {
  workspaceId: string
  userId: string      // profiles.id
  role: Role
}

export interface SavedView {
  id: string
  workspaceId: string
  name: string
  config: Partial<UiState>   // filter/layout/zoom bundle
  ownerId?: string
}

export interface KpiEntry {
  week: string
  value: number | null
  rag: RagStatus
  notes: string
}

export interface Kpi {
  id: string
  name: string
  unit: string
  target: number | null
  direction: 'higher_better' | 'lower_better'
  rag: RagStatus
  entries: KpiEntry[]
}

export interface KpiGroup {
  id: string
  name: string
  kpis: Kpi[]
}

export interface PlannerData {
  version: number
  exportedAt: string | null
  userList: string[]      // legacy display-name roster (kept until owner→assignees migration)
  members: Member[]       // real accounts, keyed by profiles.id
  memberships: WorkspaceMembership[]  // who has which role in which workspace
  savedViews: SavedView[]
  kpiGroups: KpiGroup[]
  laneTemplates: LaneTemplate[]   // user-defined workstream templates (shared)
  workspaces: Workspace[]
}

export interface UiState {
  page: 'home' | 'ws'
  tab: HomeTab
  primaryTab: PrimaryTab
  ws: string | null
  wsView: WsView
  person: string
  stream: string
  zoom: ZoomLevel
  collapsed: string[]
  me: string
  todayOnly: boolean
  taskFilter: 'all' | 'active' | 'done'
  search: string              // client-side task filter; session-only, never persisted
}

export interface ToastItem {
  id: string
  msg: string
  action?: string
  onAction?: () => void
}
