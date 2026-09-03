'use client'
import { useEffect, useState } from 'react'
import { usePlannerStore } from '@/store/plannerStore'
import { useIsAppAdmin, filterNzTeamNames } from '@/lib/permissions'
import Avatar from '../Avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@astryxdesign/core/Card'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { List, ListItem } from '@astryxdesign/core/List'
import AddPersonDialog from '@/components/modals/AddPersonDialog'
import ActivityMessage from '@/components/ActivityMessage'
import { db } from '@/lib/supabase'
import { activityColor, activityIcon } from '@/lib/activity'
import { pd, fd, timeAgo, todayD, resolveAssignees, avatarByName, capitalize } from '@/lib/utils'
import { UserPlus } from 'lucide-react'
import type { ActivityLogEntry, Task, Workspace } from '@/lib/types'

export default function People({ onAddTask }: { onAddTask?: (owner: string) => void }) {
  const { data, ui, jumpToTask, onlineIds } = usePlannerStore()
  const isAppAdmin = useIsAppAdmin()
  const [showAdd, setShowAdd] = useState(false)

  // Each card's "Recent actions" feed — a person's own last few activity_log
  // entries (same table the per-task Activity tab reads, just filtered by
  // actor instead of task), keyed by profile id. Fetched once per profile
  // that appears on the page; roster-only names with no account yet can't
  // be an actor, so they're skipped.
  const [actions, setActions] = useState<Record<string, ActivityLogEntry[]>>({})
  const profileIds = data.members.map(m => m.id).join(',')
  useEffect(() => {
    let cancelled = false
    Promise.all(data.members.map(async m => [m.id, await db.fetchMemberActivity(m.id, 5)] as const))
      .then(pairs => { if (!cancelled) setActions(Object.fromEntries(pairs)) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileIds])

  const today = todayD()
  const spansToday = (t: Task) => t.noDate || (pd(t.start) <= today && pd(t.end) >= today)

  // A task belongs to a person if their display name is among the resolved assignees
  // (real assignees, or the legacy owner as fallback).
  const assignedTo = (t: Task, name: string) =>
    resolveAssignees(t, data.members).some(a => a.name === name)

  // People = legacy roster names ∪ real member names ∪ anyone actually assigned.
  const allNames = new Set<string>([
    ...data.userList,
    ...data.members.map(m => m.displayName),
  ])
  data.workspaces.forEach(w => {
    (w.members || []).forEach(m => allNames.add(m))
    w.tasks.forEach(t => resolveAssignees(t, data.members).forEach(a => allNames.add(a.name)))
  })

  // The whole roster gets a card — including people pre-provisioned via "Add
  // person" who have no team or tasks yet, so an add is immediately visible.
  // Scoped to the NZ Team for now (see lib/permissions.ts isNzTeamName).
  let users = filterNzTeamNames([...allNames], data.members).sort((a, b) => a.localeCompare(b))
  if (ui.person) users = users.filter(u => u === ui.person)
  if (ui.todayOnly) users = users.filter(u =>
    data.workspaces.some(w => w.tasks.some(t => assignedTo(t, u) && spansToday(t)))
  )

  return (
    <div className="page">
      {isAppAdmin && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <Button variant="outline" size="sm" onClick={() => setShowAdd(true)} title="Add someone who hasn't signed in yet">
            <UserPlus size={14} strokeWidth={1.75} /> Add person
          </Button>
        </div>
      )}
      {users.length === 0 && (
        <div data-astryx-theme="neutral" style={{ padding: '32px 0' }}>
          <EmptyState
            icon={<UserPlus size={28} strokeWidth={1.5} className="text-muted-foreground" />}
            title="No people yet"
            description={`They appear here as they sign in${isAppAdmin ? ', or add someone above' : ''}.`}
          />
        </div>
      )}
      <div className="pplgrid">
        {users.map(u => {
          const teams = data.workspaces.filter(w => (w.members || []).includes(u) || w.tasks.some(t => assignedTo(t, u)))
          const allTasks: Array<{ t: Task; w: Workspace; lane: { label: string; color: string } | undefined }> = []
          data.workspaces.forEach(w => w.tasks.forEach(t => {
            if (assignedTo(t, u)) allTasks.push({ t, w, lane: w.lanes.find(l => l.id === t.lane) })
          }))
          const effEnd = (t: Task) => t.noDate ? fd(today) : t.end
          const active = allTasks
            .filter(x => (x.t.pct || 0) < 100)
            .filter(x => !ui.todayOnly || spansToday(x.t))
            .sort((a, b) => effEnd(a.t).localeCompare(effEnd(b.t)))
          const overdue = active.filter(x => !x.t.noDate && pd(x.t.end) < today).length
          const profileId = data.members.find(m => m.displayName === u)?.id
          const recent = profileId ? (actions[profileId] ?? []) : []

          return (
            <Card key={u} padding={0} data-astryx-theme="neutral" className="pcard">
              <div className="ptop">
                <Avatar
                  name={u}
                  src={avatarByName(data.members, u)}
                  size={38}
                  online={onlineIds.includes(data.members.find(m => m.displayName === u)?.id ?? '')}
                />
                <div>
                  <div className="pnm">{u}</div>
                  <div className="pteams">{teams.length ? teams.map(w => w.name).join(' · ') : 'No team assigned'}</div>
                </div>
                <div className="pstat">
                  <b style={{ color: overdue ? 'var(--raspberry)' : undefined }}>{active.length}</b>
                  <span>active{overdue ? ` · ${overdue} late` : ''}</span>
                </div>
                {onAddTask && (
                  <Button variant="outline" size="sm" onClick={() => onAddTask(u)} title="Add task for this person">+ Task</Button>
                )}
              </div>
              {!profileId ? (
                <div className="pempty">No account yet — actions show up here after first sign-in</div>
              ) : recent.length === 0 ? (
                <div className="pempty">No recent actions</div>
              ) : (
                <List density="compact" hasDividers>
                  {recent.map(e => {
                    const EntryIcon = activityIcon(e)
                    const color = activityColor(e)
                    const ws = data.workspaces.find(w => w.id === e.workspaceId)
                    const clickable = !!(e.taskId && ws)
                    return (
                      <ListItem
                        key={e.id}
                        onClick={clickable ? () => jumpToTask(ws!.id, e.taskId!) : undefined}
                        startContent={
                          <span className="paicon" style={{ color }}>
                            <EntryIcon className="h-5 w-5" />
                          </span>
                        }
                        label={`${e.taskName}${ws ? ` · ${ws.name}` : ''}`}
                        description={
                          <ActivityMessage message={capitalize(e.message)} field={e.field ?? e.action} ws={ws} />
                        }
                        endContent={<span className="due">{timeAgo(e.createdAt)}</span>}
                      />
                    )
                  })}
                </List>
              )}
            </Card>
          )
        })}
      </div>
      {showAdd && <AddPersonDialog onClose={() => setShowAdd(false)} />}
    </div>
  )
}
