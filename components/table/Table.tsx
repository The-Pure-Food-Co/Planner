'use client'
import { useState } from 'react'
import { History } from 'lucide-react'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { Button } from '@/components/ui/button'
import WorkspaceActivityPanel from '@/components/WorkspaceActivityPanel'
import { usePlannerStore } from '@/store/plannerStore'
import { useCanWrite } from '@/lib/permissions'
import { fmtShort, pd, wsStatuses, taskStatusId, resolveAssignees, taskMatchesSearch } from '@/lib/utils'
import type { Workspace, Task } from '@/lib/types'

interface Props {
  ws: Workspace
  onOpenTask: (wsId: string, task: Task) => void
}

type SortKey = 'name' | 'status' | 'assignees' | 'start' | 'end' | 'estimate'

export default function Table({ ws, onOpenTask }: Props) {
  const { data, ui, updateTask } = usePlannerStore()
  const canEdit = useCanWrite(ws.id)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'end', dir: 1 })
  const [showActivity, setShowActivity] = useState(false)

  const statuses = wsStatuses(ws)
  const statusLabel = (t: Task) => statuses.find(s => s.id === taskStatusId(t))?.label ?? '—'
  const assigneeText = (t: Task) => resolveAssignees(t, data.members).map(a => a.name).join(', ') || '—'

  let rows = ws.tasks.slice()
  if (ui.person) rows = rows.filter(t => resolveAssignees(t, data.members).some(a => a.name === ui.person))
  if (ui.stream) rows = rows.filter(t => t.lane === ui.stream)
  if (ui.search?.trim()) rows = rows.filter(t => taskMatchesSearch(t, ui.search, data.members))

  const val = (t: Task, k: SortKey): string | number => {
    switch (k) {
      case 'name': return t.name.toLowerCase()
      case 'status': return statusLabel(t).toLowerCase()
      case 'assignees': return assigneeText(t).toLowerCase()
      case 'start': return t.noDate ? '￿' : t.start
      case 'end': return t.noDate ? '￿' : t.end
      case 'estimate': return t.estimate ?? -1
    }
  }
  rows.sort((a, b) => {
    const av = val(a, sort.key), bv = val(b, sort.key)
    return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir
  })

  const toggleSort = (key: SortKey) =>
    setSort(s => s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) } : { key, dir: 1 })

  const th = (key: SortKey, label: string) => (
    <th
      className="text-left text-[11px] text-[color:var(--muted)] px-2 py-2 cursor-pointer select-none whitespace-nowrap"
      onClick={() => toggleSort(key)}
    >
      {label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  )

  const cellCls = 'px-2 py-1.5 border-t border-[color:var(--line)] align-middle'

  const table = (
    <div className="overflow-x-auto border border-[color:var(--line)] rounded-lg">
      <table className="w-full text-[13px] border-collapse bg-white">
        <thead>
          <tr className="bg-[color:var(--cauliflower)]">
            {th('name', 'Task')}
            {th('status', 'Status')}
            {th('assignees', 'Assignees')}
            {th('start', 'Start')}
            {th('end', 'Due')}
            {th('estimate', 'Est.')}
          </tr>
        </thead>
        <tbody>
          {rows.map(t => (
            <tr key={t.id} className="hover:bg-[color:var(--hover,#faf7f6)]">
              <td className={cellCls}>
                {canEdit ? (
                  <input
                    value={t.name}
                    onChange={e => updateTask(ws.id, { ...t, name: e.target.value })}
                    className="w-full min-w-[160px] bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-[color:var(--line)] rounded px-1 py-0.5"
                  />
                ) : (
                  <button className="text-left hover:underline" onClick={() => onOpenTask(ws.id, t)}>{t.name}</button>
                )}
              </td>
              <td className={cellCls}>
                {canEdit ? (
                  <select
                    value={taskStatusId(t)}
                    onChange={e => {
                      const st = statuses.find(s => s.id === e.target.value)
                      updateTask(ws.id, { ...t, statusId: e.target.value, boardBucket: null, ...(st?.isDone ? { pct: 100 } : {}) })
                    }}
                    className="bg-transparent border border-[color:var(--line)] rounded px-1 py-0.5 text-[12px]"
                  >
                    {statuses.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                ) : statusLabel(t)}
              </td>
              <td className={`${cellCls} whitespace-nowrap`}>{assigneeText(t)}</td>
              <td className={`${cellCls} whitespace-nowrap`}>{t.noDate ? '—' : fmtShort(t.start)}</td>
              <td className={`${cellCls} whitespace-nowrap`} style={!t.noDate && pd(t.end) < pd(new Date().toISOString().slice(0, 10)) ? { color: 'var(--raspberry)' } : undefined}>
                {t.noDate ? '—' : fmtShort(t.end)}
              </td>
              <td className={cellCls}>
                {canEdit ? (
                  <input
                    type="number"
                    value={t.estimate ?? ''}
                    onChange={e => updateTask(ws.id, { ...t, estimate: e.target.value === '' ? null : Number(e.target.value) })}
                    className="w-[56px] bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-[color:var(--line)] rounded px-1 py-0.5"
                  />
                ) : (t.estimate ?? '—')}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-6 text-center text-[color:var(--muted)]">No tasks</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10, flex: '0 0 auto' }}>
        <Button variant="outline" size="sm" onClick={() => setShowActivity(v => !v)}>
          <History size={14} strokeWidth={1.75} /> Activity
        </Button>
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0 }}>
        <Layout
          height="fill"
          content={<LayoutContent padding={0}>{table}</LayoutContent>}
          end={showActivity ? <WorkspaceActivityPanel ws={ws} onClose={() => setShowActivity(false)} /> : undefined}
        />
      </div>
    </div>
  )
}
