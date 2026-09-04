'use client'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Video, Coffee, TrendingUp, ShoppingBag, Mic } from 'lucide-react'
import { usePlannerStore } from '@/store/plannerStore'
import { useCanWrite } from '@/lib/permissions'
import { useIsMobile } from '@/lib/useMediaQuery'
import Avatar from '../Avatar'
import {
  pd, fd, addDays, mondayOf, todayD, fmtShort,
  resolveAssignees, wsStatuses, taskStatusId, taskMatchesSearch,
} from '@/lib/utils'
import type { Workspace, Task } from '@/lib/types'

interface Props {
  ws: Workspace
  onOpenTask: (wsId: string, task: Task) => void
  onAddTask: (wsId: string, laneId: string, start?: string) => void
}

// Neutral + blue palette lifted from the design preview (intentionally distinct
// from the beetroot brand tokens used elsewhere in the planner).
const C = {
  bg: '#fbfbfc', ink: '#1a1d23', ink2: '#3c3f45',
  muted: '#8a8f98', muted2: '#a7abb3', line: '#ececef',
  accent: '#3d6cf5', chipBorder: '#c7cad1', brand: '#C63663',
}

const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CARD_ICONS = [Video, Coffee, TrendingUp, ShoppingBag, Mic]

type SectionKey = 'week' | 'month' | 'unscheduled'

function Check({ checked, onClick }: { checked: boolean; onClick?: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        width: 16, height: 16, borderRadius: 4, flexShrink: 0, cursor: onClick ? 'pointer' : 'default',
        border: checked ? 'none' : `1.5px solid ${C.chipBorder}`,
        background: checked ? C.accent : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

export default function Calendar({ ws, onOpenTask, onAddTask }: Props) {
  const { data, ui, updateTask } = usePlannerStore()
  const canEdit = useCanWrite(ws.id)
  // Phone: to-do list stacks above the week grid, which scrolls sideways.
  const isMobile = useIsMobile()
  const today = todayD()
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayD()))
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(new Set())

  const laneOf = (id: string) => ws.lanes.find(l => l.id === id)
  const laneIcon = (id: string) => {
    const i = Math.max(0, ws.lanes.findIndex(l => l.id === id))
    return CARD_ICONS[i % CARD_ICONS.length]
  }

  // Workflow-state ids used to toggle a task done/undone.
  const states = wsStatuses(ws)
  const doneId = states.find(s => s.isDone)?.id ?? 'done'
  const openId = states.find(s => !s.isDone)?.id ?? 'notstarted'
  const isDone = (t: Task) => taskStatusId(t) === doneId || (t.pct || 0) >= 100
  const toggleDone = (t: Task) => {
    if (!canEdit) return
    const done = isDone(t)
    updateTask(ws.id, { ...t, pct: done ? 0 : 100, statusId: done ? openId : doneId })
  }

  let tasks = ws.tasks
  if (ui.person) tasks = tasks.filter(t => t.owner === ui.person)
  if (ui.stream) tasks = tasks.filter(t => t.lane === ui.stream)
  if (ui.search?.trim()) tasks = tasks.filter(t => taskMatchesSearch(t, ui.search, data.members))

  // ── Grid: seven all-day columns for the visible week ────────────────────────
  const days: Date[] = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekEnd = addDays(weekStart, 6)
  // A task appears only on its finish (end) day, not across its whole range.
  const dayTasks = (day: Date) =>
    tasks
      .filter(t => !t.noDate && t.end === fd(day))
      .sort((a, b) => a.sortIndex - b.sortIndex)

  const moveTo = (t: Task, day: Date) => {
    if (!canEdit) return
    // Cards sit on their finish day, so dropping sets the end date to that day
    // (start shifts back to preserve the task's duration).
    const span = t.noDate ? 0 : Math.max(0, Math.round((pd(t.end).getTime() - pd(t.start).getTime()) / 86400000))
    updateTask(ws.id, { ...t, start: fd(addDays(day, -span)), end: fd(day), noDate: false })
  }

  // ── Sidebar buckets (relative to today, independent of grid navigation) ─────
  const tWeekEnd = addDays(mondayOf(today), 6)
  const scheduled = tasks.filter(t => !t.noDate)
  const bySoonest = (a: Task, b: Task) => (a.end < b.end ? -1 : a.end > b.end ? 1 : a.name.localeCompare(b.name))
  const buckets: { key: SectionKey; label: string; items: Task[]; addStart?: string }[] = [
    { key: 'week', label: 'This week', items: scheduled.filter(t => pd(t.end) <= tWeekEnd).sort(bySoonest), addStart: fd(today) },
    { key: 'month', label: 'This month', items: scheduled.filter(t => pd(t.end) > tWeekEnd).sort(bySoonest), addStart: fd(addDays(tWeekEnd, 1)) },
    { key: 'unscheduled', label: 'Unscheduled', items: tasks.filter(t => t.noDate).sort((a, b) => a.name.localeCompare(b.name)) },
  ]
  const toggleSection = (k: SectionKey) =>
    setCollapsed(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })

  const weekLabel = weekStart.getMonth() === weekEnd.getMonth()
    ? `${MON[weekStart.getMonth()]} ${weekStart.getDate()} – ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
    : `${MON[weekStart.getMonth()]} ${weekStart.getDate()} – ${MON[weekEnd.getMonth()]} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`

  const roundBtn: React.CSSProperties = {
    width: 36, height: 36, borderRadius: '50%', border: `1px solid ${C.line}`, background: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: C.ink2,
  }

  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: '100%', margin: isMobile ? '-12px' : '-16px', padding: isMobile ? '14px 12px 16px' : '18px 24px 24px' }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 24 : 30, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>Calendar</h1>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{weekLabel}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setWeekStart(mondayOf(todayD()))}
            style={{ height: 36, padding: '0 16px', borderRadius: 18, border: `1px solid ${C.line}`, background: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', color: C.ink }}
          >Today</button>
          <button style={roundBtn} onClick={() => setWeekStart(w => addDays(w, -7))} title="Previous week"><ChevronLeft size={16} /></button>
          <button style={roundBtn} onClick={() => setWeekStart(w => addDays(w, 7))} title="Next week"><ChevronRight size={16} /></button>
          {canEdit && (
            <button
              onClick={() => onAddTask(ws.id, ui.stream || '', fd(weekStart))}
              style={{ ...roundBtn, border: 'none', background: C.brand, color: '#fff' }}
              title="Add task"
            ><Plus size={16} /></button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 24, alignItems: isMobile ? 'stretch' : 'flex-start' }}>
        {/* ── To-do sidebar ─────────────────────────────────────────────── */}
        <div style={{ width: isMobile ? '100%' : 260, flexShrink: 0 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 12px' }}>To-do list</h2>
          {buckets.map(b => {
            const open = !collapsed.has(b.key)
            return (
              <div key={b.key} style={{ marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 4px 6px', fontSize: 13, fontWeight: 700 }}>
                  <span onClick={() => toggleSection(b.key)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <ChevronRight size={13} color={C.muted} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                    {b.label}
                    <span style={{ fontSize: 12, fontWeight: 400, color: C.muted2 }}>{b.items.length}</span>
                  </span>
                  {canEdit && (
                    <Plus size={14} color={C.muted} style={{ cursor: 'pointer' }} onClick={() => onAddTask(ws.id, ui.stream || '', b.addStart)} />
                  )}
                </div>
                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {b.items.length === 0 && (
                      <div style={{ fontSize: 12.5, color: C.muted2, padding: '4px 6px 4px 22px' }}>Nothing here</div>
                    )}
                    {b.items.map(t => {
                      const done = isDone(t)
                      return (
                        <div
                          key={t.id}
                          draggable={canEdit}
                          onDragStart={e => e.dataTransfer.setData('text/plain', t.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 6px 22px', fontSize: 13.5, lineHeight: 1.35, cursor: 'pointer', color: done ? C.muted2 : C.ink2 }}
                        >
                          <Check checked={done} onClick={canEdit ? () => toggleDone(t) : undefined} />
                          <span onClick={() => onOpenTask(ws.id, t)} style={{ flex: 1, textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>{t.name}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Week grid ─────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, border: `1px solid ${C.line}`, borderRadius: 14, background: '#fff', overflow: 'hidden', overflowX: 'auto' }}>
         {/* Seven day columns need ~100px each to stay readable; on phones the
             grid keeps that width and scrolls sideways inside the card. */}
         <div style={{ minWidth: isMobile ? 700 : 0 }}>
          {/* Day header row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${C.line}` }}>
            {days.map((day, i) => {
              const isToday = fd(day) === fd(today)
              return (
                <div key={i} style={{ textAlign: 'center', padding: '10px 0', borderLeft: i ? `1px solid ${C.line}` : 'none', position: 'relative', background: isToday ? '#f6f8ff' : '#fff' }}>
                  <div style={{ fontSize: 24, fontWeight: isToday ? 700 : 400, color: isToday ? C.accent : C.ink2 }}>{day.getDate()}</div>
                  <div style={{ fontSize: 11, color: C.muted2, fontWeight: 400 }}>{DOW[i]}</div>
                  {isToday && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: C.accent }} />}
                </div>
              )
            })}
          </div>

          {/* All-day columns */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', minHeight: isMobile ? 300 : 420, maxHeight: isMobile ? 'none' : 'calc(100vh - 230px)' }}>
            {days.map((day, i) => {
              const items = dayTasks(day)
              return (
                <div
                  key={i}
                  style={{ borderLeft: i ? `1px solid ${C.line}` : 'none', padding: 6, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}
                  onDragOver={canEdit ? (e => e.preventDefault()) : undefined}
                  onDrop={canEdit ? (e => {
                    e.preventDefault()
                    const t = ws.tasks.find(x => x.id === e.dataTransfer.getData('text/plain'))
                    if (t) moveTo(t, day)
                  }) : undefined}
                >
                  {items.map(t => {
                    const lc = laneOf(t.lane)?.color ?? '#94a3b8'
                    const people = resolveAssignees(t, data.members)
                    const done = isDone(t)
                    const Icon = laneIcon(t.lane)
                    return (
                      <div
                        key={t.id}
                        draggable={canEdit}
                        onDragStart={e => e.dataTransfer.setData('text/plain', t.id)}
                        onClick={() => onOpenTask(ws.id, t)}
                        style={{
                          background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10,
                          boxShadow: '0 1px 2px rgba(16,24,40,0.04)', padding: '10px 12px', cursor: 'pointer',
                          opacity: done ? 0.6 : 1,
                        }}
                        title={t.name}
                      >
                        <div style={{ width: 22, height: 22, borderRadius: 6, background: lc + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                          <Icon size={12} color={lc} />
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3, textDecoration: done ? 'line-through' : 'none' }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: C.muted2, marginTop: 4 }}>
                          {laneOf(t.lane)?.label ?? 'General'} · Due {fmtShort(t.end)}
                        </div>
                        {(t.pct || 0) > 0 && (t.pct || 0) < 100 && (
                          <div style={{ height: 3, borderRadius: 3, background: C.line, overflow: 'hidden', marginTop: 8 }}>
                            <div style={{ width: `${t.pct}%`, height: '100%', background: lc }} />
                          </div>
                        )}
                        {people.length > 0 && (
                          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center' }}>
                            {people.slice(0, 3).map((a, j) => (
                              <span key={a.id} style={{ marginLeft: j ? -6 : 0, borderRadius: '50%', outline: '2px solid #fff' }}>
                                <Avatar name={a.name} src={a.avatarUrl} size={22} />
                              </span>
                            ))}
                            {people.length > 3 && (
                              <span style={{ marginLeft: 4, fontSize: 11, color: C.muted, fontWeight: 400 }}>+{people.length - 3}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
         </div>
        </div>
      </div>
    </div>
  )
}
