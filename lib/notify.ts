import type { Task, Workspace, Member, AppNotification, NotificationType } from './types'
import { extractMentionNames } from './mentions'
import { taskStatusId, wsStatuses, diffChecklistMsgs, diffMilestoneMsgs, diffAttachmentMsgs, diffLinkMsgs } from './utils'

// Builds the notification fan-out for one task mutation, by diffing the task
// before/after the change (same client-side diff point as the activity log).
// One row per recipient; when several events hit the same person in one save
// (e.g. a comment that @-mentions them), only the most specific one is kept:
// mention > assigned > comment > update/status. The actor never notifies themselves.

export type NotificationInsert = Omit<AppNotification, 'id' | 'createdAt' | 'readAt'>

// 'due' is never produced here — it comes from the DB-side scheduler
// (supabase/migrations/016_due_notifications.sql) — but the type map stays total.
const PRIORITY: Record<NotificationType, number> = { mention: 3, assigned: 2, comment: 1, update: 0, status: 0, due: 0 }

const excerpt = (text: string, max = 120): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

/** Everyone with a stake in a task: assignees, watchers, reporter. */
const involvedIds = (t: Task): string[] =>
  Array.from(new Set([...(t.assignees ?? []), ...(t.watchers ?? []), ...(t.reporterId ? [t.reporterId] : [])]))

/** Map @-mentioned display names in `text` to profile ids. */
function mentionedIds(text: string, members: Member[]): string[] {
  const names = extractMentionNames(text, members.map(m => m.displayName))
  return members.filter(m => names.includes(m.displayName)).map(m => m.id)
}

export function buildTaskNotifications(
  ws: Workspace, members: Member[], prevTask: Task, task: Task,
  actorId: string, actorName: string,
): NotificationInsert[] {
  const byRecipient = new Map<string, NotificationInsert>()
  const memberIds = new Set(members.map(m => m.id))
  const prefsById = new Map(members.map(m => [m.id, m.notificationPrefs]))
  const muted = (recipientId: string, type: NotificationType): boolean => {
    const p = prefsById.get(recipientId)
    return !!p && (!!p.mutedTypes?.includes(type) || !!p.mutedWorkspaces?.includes(ws.id))
  }
  const add = (recipientId: string, type: NotificationType, message: string) => {
    if (!recipientId || recipientId === actorId || !memberIds.has(recipientId)) return
    if (muted(recipientId, type)) return
    const existing = byRecipient.get(recipientId)
    if (existing && PRIORITY[existing.type] >= PRIORITY[type]) return
    byRecipient.set(recipientId, {
      recipientId, actorId: actorId || null, actorName, type,
      workspaceId: ws.id, taskId: task.id, taskName: task.name, message,
    })
  }

  // Status change — lowest priority, so add first gets overridden.
  const prevStatus = taskStatusId(prevTask)
  const nextStatus = taskStatusId(task)
  if (prevStatus !== nextStatus) {
    const label = wsStatuses(ws).find(s => s.id === nextStatus)?.label ?? nextStatus
    involvedIds(task).forEach(id => add(id, 'status', `moved "${task.name}" to ${label}`))
  }
  // Checklist / milestone / attachment / link changes — same tier as status,
  // collapsed into one notification per recipient per save.
  const extraMsgs = [
    ...diffChecklistMsgs(prevTask.checklist, task.checklist),
    ...diffMilestoneMsgs(prevTask.milestones, task.milestones),
    ...diffAttachmentMsgs(prevTask.attachments, task.attachments),
    ...diffLinkMsgs(prevTask.links, task.links),
  ]
  if (extraMsgs.length) {
    const summary = excerpt(extraMsgs.join('; '), 200)
    involvedIds(task).forEach(id => add(id, 'update', `${summary} on "${task.name}"`))
  }

  // New comments → involved people; @-mentions inside them upgrade to 'mention'.
  const prevCommentIds = new Set((prevTask.comments ?? []).map(c => c.id))
  for (const c of (task.comments ?? []).filter(c => !prevCommentIds.has(c.id))) {
    involvedIds(task).forEach(id => add(id, 'comment', `commented on "${task.name}": "${excerpt(c.text)}"`))
    mentionedIds(c.text, members).forEach(id =>
      add(id, 'mention', `mentioned you in a comment on "${task.name}": "${excerpt(c.text)}"`))
  }

  // Newly @-mentioned in the notes.
  const prevNoteMentions = new Set(mentionedIds(prevTask.notes ?? '', members))
  mentionedIds(task.notes ?? '', members)
    .filter(id => !prevNoteMentions.has(id))
    .forEach(id => add(id, 'mention', `mentioned you in the notes of "${task.name}"`))

  // Newly assigned — beats comment/status but not an explicit mention.
  const prevAssignees = new Set(prevTask.assignees ?? [])
  ;(task.assignees ?? [])
    .filter(id => !prevAssignees.has(id))
    .forEach(id => add(id, 'assigned', `assigned you to "${task.name}"`))

  return Array.from(byRecipient.values())
}
