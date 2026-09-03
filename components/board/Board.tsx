'use client'
import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDroppable, closestCorners,
  type DragStartEvent, type DragOverEvent, type DragEndEvent, type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon, MoreHorizontalIcon,
  CheckmarkCircle02Icon,
} from '@hugeicons/core-free-icons'
import { Trash2 } from 'lucide-react'
import { usePlannerStore } from '@/store/plannerStore'
import { useCanWrite, useCanAdmin } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ColorPickerPopover } from '@/components/ui/color-picker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, pd, uuid, wsStatuses, taskStatusId, taskMatchesSearch } from '@/lib/utils'
import type { Workspace, Task, WorkflowState } from '@/lib/types'

interface Props {
  ws: Workspace
  onOpenTask: (wsId: string, task: Task) => void
  onAddTask?: (wsId: string, laneId: string, start?: string) => void
}

type Columns = Record<string, string[]>

// Small status glyph mirroring the template's circular status icons, tinted by
// the workflow-state colour (a check when the state is a "done" state).
function StatusRing({ color, done }: { color: string; done: boolean }) {
  if (done)
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="2" />
        <path d="M4.5 7L6.5 9L9.5 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="2" strokeDasharray="3.14 0" strokeDashoffset="-0.7" />
      <circle cx="7" cy="7" r="2" fill="none" stroke={color} strokeWidth="4" strokeDasharray="3.5 100" transform="rotate(-90 7 7)" />
    </svg>
  )
}

export default function Board({ ws, onOpenTask, onAddTask }: Props) {
  const { data, ui, updateWorkspace, moveToBoardStatus } = usePlannerStore()
  const canEdit = useCanWrite(ws.id)
  const canAdmin = useCanAdmin(ws.id)
  const cols = wsStatuses(ws)

  const today = new Date(); today.setHours(0, 0, 0, 0)

  const addState = () => {
    const label = prompt('New state name:')?.trim()
    if (!label) return
    updateWorkspace({ ...ws, statuses: [...cols, { id: uuid(), label, color: '#93328e', order: cols.length, isDone: false }] })
  }
  const updateState = (id: string, patch: Partial<WorkflowState>) =>
    updateWorkspace({ ...ws, statuses: cols.map(s => s.id === id ? { ...s, ...patch } : s) })
  const removeState = (sc: WorkflowState) => {
    if (cols.length <= 1) return
    const taskCount = ws.tasks.filter(t => taskStatusId(t) === sc.id).length
    if (taskCount && !confirm(`"${sc.label}" has ${taskCount} task(s) in it — they'll fall out of view until moved to another column. Delete anyway?`)) return
    updateWorkspace({ ...ws, statuses: cols.filter(s => s.id !== sc.id) })
  }

  const tasks = useMemo(() => {
    let t = ws.tasks
    if (ui.person) t = t.filter(x => x.owner === ui.person)
    if (ui.stream) t = t.filter(x => x.lane === ui.stream)
    if (ui.todayOnly) t = t.filter(x => pd(x.start) <= today && pd(x.end) >= today)
    if (ui.search?.trim()) t = t.filter(x => taskMatchesSearch(x, ui.search, data.members))
    return t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.tasks, ui.person, ui.stream, ui.todayOnly, ui.search])

  const taskMap = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])

  // Canonical column → ordered card-ids, derived from the store and always
  // sorted by end date (no-date tasks sort last) — date order wins over manual
  // drag position, so dropping a card within its own column is a no-op.
  const baseColumns = useMemo<Columns>(() => {
    const map: Columns = {}
    for (const c of cols) {
      map[c.id] = tasks
        .filter(t => taskStatusId(t) === c.id)
        .sort((a, b) => {
          if (a.noDate && b.noDate) return 0
          if (a.noDate) return 1
          if (b.noDate) return -1
          return a.end < b.end ? -1 : a.end > b.end ? 1 : 0
        })
        .map(t => t.id)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, cols.map(c => c.id).join()])

  // While a drag crosses columns we hold a live arrangement here so cards animate
  // between columns; it's reconciled back to the store on drop and then cleared.
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [override, setOverride] = useState<Columns | null>(null)
  const view = override ?? baseColumns

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findColumn = (map: Columns, id: UniqueIdentifier | null): string | null => {
    if (id == null) return null
    const key = String(id)
    if (map[key]) return key // id is a column id
    return Object.keys(map).find(k => map[k].includes(key)) ?? null
  }

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(e.active.id)
    setOverride(baseColumns)
  }

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e
    if (!over) return
    setOverride(prev => {
      const base = prev ?? baseColumns
      const from = findColumn(base, active.id)
      const to = findColumn(base, over.id)
      if (!from || !to || from === to) return base
      const fromArr = base[from]
      const toArr = base[to]
      const activeKey = String(active.id)
      const overIsColumn = !!base[String(over.id)]
      let newIndex: number
      if (overIsColumn) {
        newIndex = toArr.length
      } else {
        const overIndex = toArr.indexOf(String(over.id))
        const translatedTop = active.rect.current.translated?.top
        const below = translatedTop != null && translatedTop > over.rect.top + over.rect.height / 2
        newIndex = overIndex >= 0 ? overIndex + (below ? 1 : 0) : toArr.length
      }
      return {
        ...base,
        [from]: fromArr.filter(id => id !== activeKey),
        [to]: [...toArr.slice(0, newIndex), activeKey, ...toArr.slice(newIndex)],
      }
    })
  }

  const reset = () => { setActiveId(null); setOverride(null) }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    const target = findColumn(override ?? baseColumns, over?.id ?? null)
    const startCol = findColumn(baseColumns, active.id)
    if (!over || !target) { reset(); return }

    // Columns are always date-sorted, so only a cross-column drop (a status
    // change) matters — reordering within a column is a no-op.
    if (startCol !== target) {
      const status = cols.find(c => c.id === target)
      moveToBoardStatus(ws.id, target, String(active.id), status?.isDone)
    }
    reset()
  }

  // Presentational card body, shared by the sortable card and the drag overlay.
  const CardBody = ({ task, column }: { task: Task; column: WorkflowState | undefined }) => {
    const isCompleted = !!column?.isDone || (task.pct || 0) >= 100

    return (
      <div
        className="w-full rounded-md overflow-hidden border border-border px-2.5 py-2"
        style={{ background: column?.color ? `color-mix(in srgb, ${column.color} 12%, var(--background))` : 'var(--background)' }}
      >
        <div className="flex items-start gap-1.5">
          <p className="!text-sm leading-snug tracking-tight text-foreground flex-1">
            {(task.recurrence || task.recurrenceParentId) && (
              <span
                className="text-muted-foreground mr-1 text-xs"
                title={
                  task.recurrence
                    ? `Repeats ${task.recurrence.freq}`
                    : 'Recurring occurrence'
                }
                aria-hidden
              >
                ↻
              </span>
            )}
            {task.name}
          </p>
          {isCompleted && (
            <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5 shrink-0 text-green-500" />
          )}
        </div>
      </div>
    )
  }

  // Sortable wrapper: drag listeners live here; a click that doesn't move opens the task.
  const SortableCard = ({ task, column }: { task: Task; column: WorkflowState }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: task.id,
      disabled: !canEdit,
    })
    const style = { transform: CSS.Transform.toString(transform), transition }
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={() => onOpenTask(ws.id, task)}
        className={cn(
          'w-full outline-none',
          canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          isDragging && 'opacity-40',
        )}
      >
        <CardBody task={task} column={column} />
      </div>
    )
  }

  const Column = ({ status }: { status: WorkflowState }) => {
    const ids = view[status.id] ?? []
    const { setNodeRef, isOver } = useDroppable({ id: status.id })
    const [menuOpen, setMenuOpen] = useState(false)
    const [label, setLabel] = useState(status.label)
    return (
      <div className="shrink-0 w-[300px] lg:w-[360px] flex flex-col h-full">
        <div
          className={cn(
            'rounded-lg border p-3 flex flex-col max-h-full transition-all',
            isOver ? 'border-primary ring-3 ring-primary/20' : 'border-border',
          )}
          style={{ background: `color-mix(in srgb, ${status.color} 7%, var(--background))` }}
        >
          <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-border">
            <div className="flex items-center gap-2 min-w-0">
              <div className="size-4 flex items-center justify-center shrink-0">
                <StatusRing color={status.color} done={status.isDone} />
              </div>
              <span className="text-base leading-none truncate">{status.label}</span>
              <span className="text-xs text-muted-foreground leading-none min-w-5 text-center shrink-0">{ids.length}</span>
            </div>
            <div className="flex items-center gap-1 justify-center shrink-0">
              {canEdit && onAddTask && (
                <Button variant="ghost" size="icon-xs" onClick={() => onAddTask(ws.id, ui.stream || '')} aria-label="Add task">
                  <HugeiconsIcon icon={Add01Icon} className="size-4" />
                </Button>
              )}
              {canAdmin && (
                <DropdownMenu
                  open={menuOpen}
                  onOpenChange={(open) => {
                    setMenuOpen(open)
                    if (open) setLabel(status.label)
                  }}
                >
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon-xs" aria-label="State options">
                        <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-56 p-2">
                    <div className="flex items-center gap-1.5 mb-2">
                      <ColorPickerPopover
                        value={status.color}
                        onValueChange={(v) => updateState(status.id, { color: v })}
                      />
                      <Input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        onBlur={() => {
                          const trimmed = label.trim()
                          if (trimmed && trimmed !== status.label) updateState(status.id, { label: trimmed })
                          else setLabel(status.label)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') { setLabel(status.label); e.currentTarget.blur() }
                        }}
                        className="flex-1 min-w-0 h-8"
                      />
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={cols.length <= 1}
                      className="text-[color:var(--raspberry)] focus:text-[color:var(--raspberry)]"
                      onClick={() => { setMenuOpen(false); removeState(status) }}
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                      Delete state
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div ref={setNodeRef} className="flex flex-col gap-1.5 overflow-y-auto h-full w-full pr-1.5 min-h-[40px]">
              {ids.map(id => {
                const task = taskMap.get(id)
                return task ? <SortableCard key={id} task={task} column={status} /> : null
              })}

              {canEdit && onAddTask && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onAddTask(ws.id, ui.stream || '')}
                  className="gap-2 text-xs h-auto py-1 px-0 self-start hover:bg-background"
                >
                  <HugeiconsIcon icon={Add01Icon} className="size-4" />
                  <span>Add task</span>
                </Button>
              )}
            </div>
          </SortableContext>
        </div>
      </div>
    )
  }

  const activeTask = activeId ? taskMap.get(String(activeId)) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
    >
      <div data-astryx-theme="neutral" className="flex h-full gap-3 px-3 pt-4 pb-2 overflow-x-auto bg-[var(--cauliflower)]">
        {cols.map(status => <Column key={status.id} status={status} />)}
        {canAdmin && (
          <button
            onClick={addState}
            className="shrink-0 w-[260px] h-fit flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <HugeiconsIcon icon={Add01Icon} className="size-4" />
            Add state
          </button>
        )}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="w-[300px] lg:w-[360px] shadow-xl cursor-grabbing">
            <CardBody
              task={activeTask}
              column={cols.find(c => c.id === (findColumn(view, activeId) ?? taskStatusId(activeTask)))}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
