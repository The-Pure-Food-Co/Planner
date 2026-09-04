'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlannerStore } from '@/store/plannerStore'
import { useMe } from '@/lib/auth'
import { useIsMobile } from '@/lib/useMediaQuery'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid, GridSpan } from '@astryxdesign/core/Grid'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Button } from '@astryxdesign/core/Button'
import { List, ListItem } from '@astryxdesign/core/List'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Stack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Badge } from '@astryxdesign/core/Badge'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { ProgressBar, type ProgressBarVariant } from '@astryxdesign/core/ProgressBar'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Calendar, type ISODateString } from '@astryxdesign/core/Calendar'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { Divider } from '@astryxdesign/core/Divider'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, arrayMove, useSortable, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import {
  ExclamationTriangleIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ClockIcon,
  MinusCircleIcon,
  RectangleGroupIcon,
  CheckCircleIcon,
  PlayCircleIcon,
  EllipsisHorizontalCircleIcon,
  FlagIcon,
  ListBulletIcon,
  ArrowsUpDownIcon,
} from '@heroicons/react/24/solid'
import { FlagIcon as FlagOutlineIcon } from '@heroicons/react/24/outline'
import { db } from '@/lib/supabase'
import { todayD, fmtDueRelative, taskAssignedTo, taskStatusId, wsStatuses, dueBucketOf, pd, mondayOf } from '@/lib/utils'
import type { Task, Todo, Workspace } from '@/lib/types'

interface Row { t: Task; w: Workspace }

interface Props {
  onOpenTask: (wsId: string, task: Task) => void
}

// Colours are the astryx design system's semantic icon/text tokens (scoped to
// [data-astryx-theme="neutral"]), not the brand food palette — keeps status
// colour consistent with Token/Badge elsewhere and adapts with the theme.
const SECTIONS = [
  { key: 'overdue', label: 'Overdue', icon: ExclamationTriangleIcon, iconColor: 'var(--color-icon-red)', textColor: 'var(--color-text-red)' },
  { key: 'today', label: 'Due today', icon: CalendarDaysIcon, iconColor: 'var(--color-icon-orange)', textColor: 'var(--color-text-orange)' },
  { key: 'week', label: 'This week', icon: CalendarIcon, iconColor: 'var(--color-icon-blue)', textColor: 'var(--color-text-blue)' },
  { key: 'later', label: 'Later', icon: ClockIcon, iconColor: 'var(--color-icon-purple)', textColor: 'var(--color-text-purple)' },
  { key: 'nodate', label: 'No date', icon: MinusCircleIcon, iconColor: 'var(--color-icon-gray)', textColor: 'var(--color-text-gray)' },
] as const

// Progress bar variant follows completion: further along reads greener, further behind reads redder.
const progressVariant = (pct: number): ProgressBarVariant =>
  pct >= 75 ? 'success' : pct >= 40 ? 'warning' : 'error'

// Personal scratch list, separate from workspace tasks: stored in the `todos`
// table (one row per item, RLS-scoped to its owner), so it survives across
// devices/sessions for the signed-in user.
type TodoFilter = 'all' | 'important' | 'completed'
type TodoSort = 'manual' | 'date'

// Placeholder rows shown while the to-do fetch is in flight, sized to match
// TodoRowBody's layout so real rows don't visibly jump in once loaded.
function TodoListSkeleton() {
  return (
    <Stack gap={3}>
      {[0, 1, 2, 3].map(i => (
        <Stack key={i} direction="horizontal" gap={2} align="center" justify="between">
          <Stack direction="horizontal" gap={1.5} align="center">
            <Skeleton width={14} height={14} radius="rounded" index={i} />
            <Skeleton width={14} height={14} radius="rounded" index={i} />
            <Skeleton width={140 + (i % 2) * 50} height={14} index={i} />
          </Stack>
          <Skeleton width={56} height={20} radius="rounded" index={i} />
        </Stack>
      ))}
    </Stack>
  )
}

interface TodoRowProps {
  t: Todo
  onToggleDone: (id: string, done: boolean) => void
  onToggleImportant: (id: string, important: boolean) => void
  onDelete: (id: string) => void
  onRename: (id: string, text: string) => void
  onSetDueDate: (id: string, dueDate: string | null) => void
  dragHandleProps?: Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>
  itemRef?: (node: HTMLElement | null) => void
  itemStyle?: React.CSSProperties
}

// Small badge shown under the task name once a due date is set — resting
// (non-edit) state only; edit mode shows the DatePickerField instead.
function DueDateBadge({ dueDate, today }: { dueDate: string; today: Date }) {
  const late = pd(dueDate) < today
  return (
    <Stack direction="horizontal" gap={1} align="center">
      <CalendarDaysIcon width={12} height={12} style={{ color: late ? 'var(--color-icon-red)' : 'var(--color-icon-gray)' }} />
      <Timestamp
        value={pd(dueDate).getTime()}
        format="date"
        hasTooltip={false}
        size="xsm"
        style={{ color: late ? 'var(--color-text-red)' : 'var(--color-text-gray)' }}
      />
    </Stack>
  )
}

// Minimal, borderless date field: a calendar icon + the picked date (or a
// placeholder), opening a plain month-grid Calendar popover — no bordered
// pill, no nested text field. Used in both the add-task row and row edit
// mode so the two look and behave identically.
function DatePickerField({
  value, onChange, placeholder = 'Add date', onOpenChange,
}: {
  value: string | null
  onChange: (v: string | null) => void
  placeholder?: string
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpenState] = useState(false)
  const setOpen = (o: boolean) => { setOpenState(o); onOpenChange?.(o) }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            style={{
              all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
              flexShrink: 0, color: value ? 'var(--color-text-gray)' : 'var(--color-icon-gray)',
              opacity: value ? 1 : 0.6,
            }}
          >
            <CalendarDaysIcon width={14} height={14} />
            <Text size="xsm" style={{ color: 'inherit' }}>
              {value ? new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short' }).format(pd(value)) : placeholder}
            </Text>
          </button>
        }
      />
      <PopoverContent align="end" className="w-auto p-2" onClick={(e) => e.stopPropagation()}>
        <div data-astryx-theme="neutral">
          <Stack gap={1.5}>
            {value && (
              <Stack direction="horizontal" gap={2} align="center" justify="between">
                <Text size="xsm" color="secondary">Due date</Text>
                <button
                  type="button"
                  onClick={() => { onChange(null); setOpen(false) }}
                  style={{ all: 'unset', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-purple, var(--beetroot))' }}
                >
                  Clear
                </button>
              </Stack>
            )}
            <Calendar
              value={(value || undefined) as ISODateString | undefined}
              onChange={(v) => { onChange((v as ISODateString | undefined) ?? null); setOpen(false) }}
            />
          </Stack>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Card-style row with two states. Resting: checkbox, name (+ due-date
// sub-line once set), and a far-right important star. Clicking the row body
// (not the checkbox, delete, or star) switches it into edit mode: the name
// becomes a focused text input and the due date becomes a DatePickerField
// sitting right next to it — both editable in place. Edit mode closes
// (committing the name) on blur/Enter/Escape.
function TodoRowBody({
  t, onToggleDone, onToggleImportant, onDelete, onRename, onSetDueDate, dragHandleProps, itemRef, itemStyle,
}: TodoRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(t.text)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const today = todayD()

  useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editing])

  const commitName = () => {
    const v = draft.trim()
    if (v && v !== t.text) onRename(t.id, v)
    else setDraft(t.text)
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 'var(--radius-element, 8px)',
    background: 'var(--color-background-2, #f4f4f5)',
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
  }

  if (editing) {
    return (
      <li ref={itemRef} style={{ listStyle: 'none', width: '100%', minWidth: 0, ...itemStyle }}>
        <div
          style={{ ...rowStyle, outline: '1px solid var(--color-border-focus, var(--beetroot))' }}
          onBlur={(e) => {
            // The date field's calendar popover renders in a portal outside
            // this container, so a DOM containment check can't see it as
            // "inside" — datePickerOpen tracks that case explicitly instead.
            // Otherwise, only exit edit mode once focus actually lands outside.
            if (datePickerOpen) return
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
            commitName()
            setEditing(false)
          }}
        >
          <span style={{ flexShrink: 0, display: 'flex' }}>
            <CheckboxInput
              label={`Mark "${t.text}" done`}
              isLabelHidden
              size="sm"
              value={t.done}
              onChange={(done) => onToggleDone(t.id, done)}
            />
          </span>
          <textarea
            ref={inputRef}
            aria-label="Task name"
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${e.target.scrollHeight}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitName(); setEditing(false) }
              else if (e.key === 'Escape') { setDraft(t.text); setEditing(false) }
            }}
            style={{
              font: 'inherit',
              fontSize: 13,
              color: 'var(--color-text-primary)',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: '2px 0',
              flex: 1,
              minWidth: 0,
              resize: 'none',
              overflow: 'hidden',
              wordBreak: 'break-word',
            }}
          />
          <span onClick={(e) => e.stopPropagation()}>
            <DatePickerField
              value={t.dueDate}
              onChange={(v) => onSetDueDate(t.id, v)}
              onOpenChange={setDatePickerOpen}
            />
          </span>
          <IconButton
            label="Delete to-do"
            icon={<Trash2 size={14} />}
            variant="ghost"
            size="sm"
            style={{ opacity: 0.4, flexShrink: 0 }}
            onClick={() => onDelete(t.id)}
          />
          <button
            type="button"
            aria-label="Toggle important"
            aria-pressed={t.important}
            onClick={() => onToggleImportant(t.id, !t.important)}
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexShrink: 0, padding: 4 }}
          >
            {t.important
              ? <FlagIcon width={16} height={16} style={{ color: 'var(--color-icon-red)' }} />
              : <FlagOutlineIcon width={16} height={16} style={{ color: 'var(--color-icon-gray)', opacity: 0.5 }} />}
          </button>
        </div>
      </li>
    )
  }

  return (
    <li ref={itemRef} style={{ listStyle: 'none', ...itemStyle }}>
      <div
        role="button"
        tabIndex={0}
        className="todo-row"
        style={{ ...rowStyle, cursor: 'pointer' }}
        onClick={() => { setDraft(t.text); setEditing(true) }}
      >
        <span
          {...(dragHandleProps?.attributes ?? {})}
          {...(dragHandleProps?.listeners ?? {})}
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            touchAction: 'none',
            cursor: dragHandleProps ? 'grab' : 'default',
            color: 'var(--color-icon-gray)',
            opacity: dragHandleProps ? 0.4 : 0,
            flexShrink: 0,
          }}
        >
          <GripVertical size={14} />
        </span>
        <span onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, display: 'flex' }}>
          <CheckboxInput
            label={`Mark "${t.text}" done`}
            isLabelHidden
            size="sm"
            value={t.done}
            onChange={(done) => onToggleDone(t.id, done)}
          />
        </span>

        <Stack gap={0.5} style={{ flex: 1, minWidth: 0 }}>
          <Text
            size="sm"
            color={t.done ? 'secondary' : 'primary'}
            hasStrikethrough={t.done}
            style={{
              transition: 'color var(--transition-fast)',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 3,
              overflow: 'hidden',
              wordBreak: 'break-word',
            }}
          >
            {t.text}
          </Text>
          {t.dueDate && <DueDateBadge dueDate={t.dueDate} today={today} />}
        </Stack>

        <span onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, display: 'flex' }}>
          <IconButton
            label="Delete to-do"
            icon={<Trash2 size={14} />}
            variant="ghost"
            size="sm"
            style={{ opacity: 0.4 }}
            onClick={() => onDelete(t.id)}
          />
        </span>
        <button
          type="button"
          aria-label="Toggle important"
          aria-pressed={t.important}
          onClick={(e) => { e.stopPropagation(); onToggleImportant(t.id, !t.important) }}
          style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexShrink: 0, padding: 4 }}
        >
          {t.important
            ? <FlagIcon width={16} height={16} style={{ color: 'var(--color-icon-red)' }} />
            : <FlagOutlineIcon width={16} height={16} style={{ color: 'var(--color-icon-gray)', opacity: 0.5 }} />}
        </button>
      </div>
    </li>
  )
}

// Draggable wrapper used only for the active list — useSortable must be
// called from a real component instance (one per row), never from inside
// a plain .map() callback.
function DraggableTodoRow(props: Omit<TodoRowProps, 'dragHandleProps' | 'itemRef' | 'itemStyle'> & { canDrag: boolean }) {
  const { canDrag, ...rest } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.t.id,
    disabled: !canDrag,
  })
  return (
    <TodoRowBody
      {...rest}
      dragHandleProps={canDrag ? { attributes, listeners } : undefined}
      itemRef={setNodeRef}
      itemStyle={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
    />
  )
}

// `compact` = phone layout: the panel grows with its content and the page
// scrolls, instead of the panel filling the viewport and scrolling internally.
function PersonalTodo({ meId, compact = false }: { meId: string | null; compact?: boolean }) {
  const [todos, setTodos] = useState<Todo[]>([])
  const [todosLoading, setTodosLoading] = useState(true)
  const [filter, setFilter] = useState<TodoFilter>('all')
  const [sort, setSort] = useState<TodoSort>('manual')
  const [newTaskText, setNewTaskText] = useState('')
  const [newTaskDate, setNewTaskDate] = useState<string | null>(null)
  const toast = usePlannerStore(s => s.toast)
  const today = todayD()

  useEffect(() => {
    if (!meId) { setTodos([]); setTodosLoading(false); return }
    setTodosLoading(true)
    db.fetchMyTodos(meId).then(t => {
      setTodos(t); setTodosLoading(false)
    })
  }, [meId])

  // Creates a task from the dialog with its due date and flag.
  const createTodo = async (
    text: string, dueDate: string | null, important: boolean,
  ) => {
    if (!meId) return
    const created = await db.addTodo(meId, text, todos.length, dueDate, important)
    if (created) setTodos(prev => [...prev, created])
    else toast('Save failed — could not add task')
  }

  const renameTodo = async (id: string, text: string) => {
    const prev = todos
    setTodos(p => p.map(t => (t.id === id ? { ...t, text } : t)))
    const result = await db.setTodoText(id, text)
    if (result?.error) {
      setTodos(prev)
      toast('Save failed — change reverted')
    }
  }

  const setDone = async (ids: string[], done: boolean) => {
    if (!ids.length) return
    const prev = todos
    const completedAt = done ? new Date().toISOString() : null
    setTodos(p => p.map(t => (ids.includes(t.id) ? { ...t, done, completedAt } : t)))
    const results = await Promise.all(ids.map(id => db.setTodoDone(id, done, completedAt)))
    if (results.some(r => r?.error)) {
      setTodos(prev)
      toast('Save failed — change reverted')
    }
  }

  const deleteOne = async (id: string) => {
    const prev = todos
    const deleted = todos.find(t => t.id === id)
    setTodos(p => p.filter(t => t.id !== id))
    const result = await db.deleteTodo(id)
    if (result?.error) {
      setTodos(prev)
      toast('Delete failed — change reverted')
      return
    }
    if (!deleted || !meId) return
    toast(`Deleted “${deleted.text}”`, {
      action: 'Undo',
      onAction: async () => {
        setTodos(p => [...p, deleted])
        const restoreResult = await db.restoreTodo(meId, deleted)
        if (restoreResult?.error) {
          setTodos(p => p.filter(t => t.id !== deleted.id))
          toast('Restore failed')
        }
      },
    })
  }

  const clearCompleted = async () => {
    if (!meId) return
    const prev = todos
    setTodos(p => p.filter(t => !t.done))
    const result = await db.clearCompletedTodos(meId)
    if (result?.error) {
      setTodos(prev)
      toast('Delete failed — change reverted')
    }
  }

  const setDueDate = async (id: string, dueDate: string | null) => {
    const prev = todos
    setTodos(p => p.map(t => (t.id === id ? { ...t, dueDate } : t)))
    const result = await db.setTodoDueDate(id, dueDate)
    if (result?.error) {
      setTodos(prev)
      toast('Save failed — change reverted')
    }
  }

  const toggleImportant = async (id: string, important: boolean) => {
    const prev = todos
    setTodos(p => p.map(t => (t.id === id ? { ...t, important } : t)))
    const result = await db.setTodoImportant(id, important)
    if (result?.error) {
      setTodos(prev)
      toast('Save failed — change reverted')
    }
  }

  // Reindexes the full list after a drag so sort_index stays contiguous
  // across both active and completed items, then persists only what moved.
  const persistOrder = async (merged: Todo[]) => {
    const prev = todos
    const reindexed = merged.map((t, i) => ({ ...t, sortIndex: i }))
    setTodos(reindexed)
    const changed = reindexed.filter(t => prev.find(p => p.id === t.id)?.sortIndex !== t.sortIndex)
    const results = await Promise.all(changed.map(t => db.setTodoSortIndex(t.id, t.sortIndex)))
    if (results.some(r => r?.error)) {
      setTodos(prev)
      toast('Save failed — change reverted')
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const allCompleted = todos.filter(t => t.done)

  const visible = todos
    .slice()
    .sort((a, b) => {
      if (sort !== 'date') return a.sortIndex - b.sortIndex
      if (!a.dueDate && !b.dueDate) return a.sortIndex - b.sortIndex
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate.localeCompare(b.dueDate)
    })
  // The three filters are mutually exclusive views, not layers: 'all' and
  // 'important' show only not-done tasks (never completed ones alongside
  // them); 'completed' shows only done tasks, most-recently-completed first,
  // grouped by the Monday-start week they were completed in.
  const active = filter === 'completed' ? [] : visible.filter(t => !t.done && (filter === 'all' || t.important))
  const completed = filter === 'completed'
    ? visible.filter(t => t.done).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    : []

  // Groups the completed list by the Monday-start week each task was
  // completed in, most recent week first. Undated (no completedAt) tasks —
  // done before this feature existed and never backfilled — land in one
  // trailing "Earlier" group.
  const completedGroups: Array<{ label: string; items: Todo[] }> = []
  completed.forEach(t => {
    const label = t.completedAt
      ? `Week of ${new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short' }).format(mondayOf(new Date(t.completedAt)))}`
      : 'Earlier'
    const group = completedGroups.find(g => g.label === label)
    if (group) group.items.push(t)
    else completedGroups.push({ label, items: [t] })
  })
  const isFiltering = filter !== 'all'
  // Manual order only means something when it isn't being overridden by a
  // date sort or masked by an active filter.
  const canDrag = sort === 'manual' && !isFiltering

  const onDragEnd = (e: DragEndEvent) => {
    const { active: dragged, over } = e
    if (!over || dragged.id === over.id) return
    const oldIndex = active.findIndex(t => t.id === dragged.id)
    const newIndex = active.findIndex(t => t.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    void persistOrder([...arrayMove(active, oldIndex, newIndex), ...completed])
  }

  const onToggleDone = (id: string, done: boolean) => setDone([id], done)

  // Sits directly under the active list (above Completed) so a newly added
  // task appears right where it was typed, next in line.
  const addTaskRow = (
    <Stack
      direction="horizontal"
      gap={2}
      align="center"
      style={{
        padding: '10px 14px',
        borderRadius: 'var(--radius-element, 8px)',
        background: 'var(--color-background-2, #f4f4f5)',
      }}
    >
      <Plus size={16} style={{ color: 'var(--color-icon-purple, var(--beetroot))', flexShrink: 0 }} />
      <input
        aria-label="New task"
        placeholder="Add a task…"
        disabled={!meId}
        value={newTaskText}
        onChange={(e) => setNewTaskText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          const v = newTaskText.trim()
          if (!v) return
          void createTodo(v, newTaskDate, false)
          setNewTaskText('')
          setNewTaskDate(null)
        }}
        style={{
          all: 'unset',
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          color: 'var(--color-text-primary)',
          padding: '2px 0',
        }}
      />
      {meId && <DatePickerField value={newTaskDate} onChange={setNewTaskDate} />}
    </Stack>
  )

  return (
    <Stack
      gap={0}
      className="bg-white"
      style={{ borderRadius: 'var(--radius-container)', boxShadow: 'var(--shadow-low)', minWidth: 0, height: compact ? 'auto' : '100%', minHeight: 0, overflow: compact ? 'visible' : 'hidden' }}
    >
      <Stack gap={4} style={{ flex: '0 0 auto', padding: compact ? '16px 16px 0' : '24px 24px 0' }}>
        <Stack direction="horizontal" gap={2} align="center" justify="between">
          <Heading level={1}>Checklist</Heading>
          {meId && !todosLoading && todos.length > 0 && (
            <Badge
              variant={allCompleted.length === todos.length ? 'success' : 'info'}
              label={`${allCompleted.length}/${todos.length}`}
            />
          )}
        </Stack>
        {!meId && (
          <Text color="secondary" size="xsm">Sign in to save your to-dos.</Text>
        )}
      </Stack>

      {!todosLoading && todos.length > 0 && (
        <Stack gap={3} style={{ flex: '0 0 auto', padding: compact ? '0 16px' : '0 24px' }}>
          <Divider />
          <Stack direction="horizontal" gap={2} wrap="wrap" align="center" justify="between">
            <SegmentedControl label="Filter to-dos" value={filter} onChange={(v) => setFilter(v as TodoFilter)} size="sm">
              <SegmentedControlItem value="all" label="All" icon={<ListBulletIcon width={14} height={14} />} />
              <SegmentedControlItem value="important" label="Important" icon={<FlagIcon width={14} height={14} />} />
              <SegmentedControlItem value="completed" label="Completed" icon={<CheckCircleIcon width={14} height={14} />} />
            </SegmentedControl>
            <DropdownMenu
              button={{
                label: 'Sort to-dos',
                icon: <ArrowsUpDownIcon width={16} height={16} />,
                isIconOnly: true,
                variant: 'ghost',
                size: 'sm',
              }}
              hasChevron={false}
              items={[
                { label: 'Manual order', icon: sort === 'manual' ? 'check' : undefined, onClick: () => setSort('manual') },
                { label: 'By due date', icon: sort === 'date' ? 'check' : undefined, onClick: () => setSort('date') },
              ]}
            />
          </Stack>
        </Stack>
      )}

      <Stack gap={3} style={{ flex: '1 1 auto', minHeight: 0, overflowY: compact ? 'visible' : 'auto', padding: compact ? 16 : 24 }}>
      {todosLoading ? (
        <TodoListSkeleton />
      ) : todos.length === 0 ? (
        <Stack gap={3}>
          <EmptyState
            className="pure-empty-state"
            isCompact
            icon={<Icon icon="success" size="lg" color="inherit" />}
            title="All clear"
            description="Add something you need to get done."
          />
          {addTaskRow}
        </Stack>
      ) : active.length === 0 && completed.length === 0 ? (
        <Stack gap={3}>
          <Text color="secondary" size="xsm">
            {filter === 'completed'
              ? 'No completed tasks yet.'
              : filter === 'important'
                ? 'No important tasks.'
                : 'No tasks yet.'}
          </Text>
          {addTaskRow}
        </Stack>
      ) : (
        <>
          {active.length > 0 && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={active.map(t => t.id)} strategy={verticalListSortingStrategy}>
                <Stack as="ul" gap={1.5} style={{ padding: 0, margin: 0, minWidth: 0 }}>
                  {active.map(t => (
                    <DraggableTodoRow
                      key={t.id}
                      t={t}
                      canDrag={canDrag}
                      onToggleDone={onToggleDone}
                      onToggleImportant={toggleImportant}
                      onDelete={deleteOne}
                      onRename={renameTodo}
                      onSetDueDate={setDueDate}
                    />
                  ))}
                </Stack>
              </SortableContext>
            </DndContext>
          )}

          {filter !== 'completed' && addTaskRow}

          {completed.length > 0 && (
            <Stack gap={3}>
              {completedGroups.map(group => (
                <Stack key={group.label} gap={1.5}>
                  <Text size="xsm" color="secondary" style={{ fontWeight: 600 }}>{group.label}</Text>
                  <Stack as="ul" gap={1.5} style={{ padding: 0, margin: 0, minWidth: 0 }}>
                    {group.items.map(t => (
                      <TodoRowBody
                        key={t.id}
                        t={t}
                        onToggleDone={onToggleDone}
                        onToggleImportant={toggleImportant}
                        onDelete={deleteOne}
                        onRename={renameTodo}
                        onSetDueDate={setDueDate}
                      />
                    ))}
                  </Stack>
                </Stack>
              ))}
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button label="Clear completed" variant="destructive" size="sm" />}
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear completed to-dos?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {`This permanently removes ${allCompleted.length} completed item${allCompleted.length === 1 ? '' : 's'} from your list. This can't be undone.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={clearCompleted}>
                      Clear completed
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </Stack>
          )}
        </>
      )}
      </Stack>
    </Stack>
  )
}

// Cross-workspace "what's on my plate": every open task assigned to the current
// user (by profile id, or legacy owner name), bucketed by due date.
// Tabs slice the same assigned-task list two ways. "Upcoming" is scheduled work
// from today onward (due today / this week / later); overdue and undated tasks
// only appear under "All".
type WorkTab = 'all' | 'upcoming' | 'overdue'
const UPCOMING_KEYS = ['today', 'week', 'later'] as const
const TAB_KEYS: Record<WorkTab, ReadonlyArray<(typeof SECTIONS)[number]['key']>> = {
  all: ['overdue', 'today', 'week', 'later', 'nodate'],
  upcoming: UPCOMING_KEYS,
  overdue: ['overdue'],
}

export default function MyWork({ onOpenTask }: Props) {
  const workspaces = usePlannerStore(s => s.data.workspaces)
  const members = usePlannerStore(s => s.data.members)
  const { meId, myName } = useMe()
  const [tab, setTab] = useState<WorkTab>('all')
  const [wsFilter, setWsFilter] = useState<string>('all') // workspace id, or 'all'
  // Desktop: two side-by-side panels, each scrolling internally. Phone: one
  // column, panels stack and the page itself scrolls.
  const isMobile = useIsMobile()

  const today = todayD()

  // Gather every open task assigned to me (unfiltered) so the workspace picker
  // can offer every workspace that actually has work for me, regardless of the
  // current filter.
  const { allRows, myWorkspaces } = useMemo(() => {
    const allRows: Row[] = []
    const wsIds = new Set<string>()
    workspaces.forEach(w => w.tasks.forEach(t => {
      if ((t.pct || 0) >= 100) return
      if (!taskAssignedTo(t, members, meId, myName)) return
      allRows.push({ t, w })
      wsIds.add(w.id)
    }))
    return { allRows, myWorkspaces: workspaces.filter(w => wsIds.has(w.id)) }
  }, [workspaces, members, meId, myName])

  const wsIds = useMemo(() => new Set(myWorkspaces.map(w => w.id)), [myWorkspaces])

  // Guard against a stale filter pointing at a workspace that no longer has work.
  const activeWs = wsFilter !== 'all' && wsIds.has(wsFilter) ? wsFilter : 'all'
  const activeWsName = workspaces.find(w => w.id === activeWs)?.name

  const rows = activeWs === 'all' ? allRows : allRows.filter(r => r.w.id === activeWs)

  const buckets = useMemo(() => {
    const b: Record<(typeof SECTIONS)[number]['key'], Row[]> = {
      overdue: [], today: [], week: [], later: [], nodate: [],
    }
    rows.forEach(({ t, w }) => b[dueBucketOf(t, today)].push({ t, w }))
    SECTIONS.forEach(s => b[s.key].sort((a, b) => a.t.end.localeCompare(b.t.end)))
    return b
  }, [rows, today])

  const total = rows.length
  const upcomingCount = UPCOMING_KEYS.reduce((n, k) => n + buckets[k].length, 0)

  const visibleSections = SECTIONS.filter(s => TAB_KEYS[tab].includes(s.key))
  const shownCount = TAB_KEYS[tab].reduce((n, k) => n + buckets[k].length, 0)

  const statusColor = (w: Workspace, t: Task): string =>
    wsStatuses(w).find(s => s.id === taskStatusId(t))?.color ?? 'var(--cauliflower-dark)'

  // Not started / in progress / done, as an icon rather than a bare colour dot.
  const statusIcon = (w: Workspace, t: Task) => {
    if (wsStatuses(w).find(s => s.id === taskStatusId(t))?.isDone) return CheckCircleIcon
    return (t.pct || 0) > 0 ? PlayCircleIcon : EllipsisHorizontalCircleIcon
  }

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack data-astryx-theme="neutral" gap={5} style={{ margin: '0 auto', width: '100%', flex: '1 1 auto', minHeight: 0 }}>
        <Grid columns={isMobile ? 1 : 2} gap={isMobile ? 4 : 6} style={{ flex: isMobile ? '0 0 auto' : 1, minHeight: 0 }}>
          <GridSpan
            columns={1}
            className="bg-white rounded-md shadow-sm"
            style={{ height: isMobile ? 'auto' : '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: isMobile ? 'visible' : 'hidden' }}
          >
            <Stack gap={5} style={{ flex: '1 1 auto', minHeight: 0, overflowY: isMobile ? 'visible' : 'auto', padding: isMobile ? 16 : 24 }}>
              <Stack gap={4}>
                <Heading level={1}>My work</Heading>
                {allRows.length === 0 ? (
                  <Text color="secondary" size="xsm">No work open assigned to you.</Text>
                ) : (
                  <TabList value={tab} onChange={(v) => setTab(v as WorkTab)} hasDivider>
                    {/* The active-tab underline reads --color-accent; scoping the
                        override to each tab keeps it matched to that tab's badge
                        without recolouring the sibling "info" badge. All keeps the
                        default accent (which its info badge already uses). */}
                    <Tab
                      value="all"
                      label="All"
                      icon={<ListBulletIcon width={16} height={16} />}
                      endContent={<Badge variant="info" label={total} />}
                    />
                    <Tab
                      value="upcoming"
                      
                      label="Upcoming"
                      icon={<CalendarDaysIcon width={16} height={16}/>}
                      style={{ '--color-accent': 'var(--color-text-purple)' } as React.CSSProperties}
                      endContent={<Badge variant="warning" label={upcomingCount} />}
                    />
                    <Tab
                      value="overdue"
                      label="Overdue"
                      icon={<ExclamationTriangleIcon width={16} height={16} />}
                      style={{ '--color-accent': 'var(--color-error)' } as React.CSSProperties}
                      endContent={<Badge variant="error" label={buckets.overdue.length} />}
                    />
                    <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center' }}>
                      <DropdownMenu
                        button={{
                          label: activeWs === 'all' ? 'All workspaces' : (activeWsName ?? 'Workspace'),
                          icon: <RectangleGroupIcon width={16} height={16} />,
                          variant: 'ghost',
                          size: 'sm',
                        }}
                        items={[
                          {
                            label: `All workspaces (${allRows.length})`,
                            icon: activeWs === 'all' ? 'check' : undefined,
                            onClick: () => setWsFilter('all'),
                          },
                          { type: 'divider' },
                          ...myWorkspaces.map(w => ({
                            label: `${w.name} (${allRows.filter(r => r.w.id === w.id).length})`,
                            icon: activeWs === w.id ? 'check' : undefined,
                            onClick: () => setWsFilter(w.id),
                          })),
                        ]}
                      />
                    </div>
                  </TabList>
                )}
              </Stack>

              {allRows.length === 0 ? (
                <EmptyState
                  className="green"
                  isCompact
                  icon={<Icon icon="success" size="lg" color="inherit" />}
                  title="All clear"
                  description="Tasks assigned to you will show up here."
                />
              ) : shownCount === 0 ? (
                <Text color="secondary" size="xsm">
                  {tab === 'upcoming'
                    ? 'Nothing scheduled coming up.'
                    : tab === 'overdue'
                      ? 'Nothing overdue — nice.'
                      : 'No open tasks in this workspace.'}
                </Text>
              ) : (
              visibleSections.map(({ key, label, icon: SectionIcon, iconColor, textColor }) => {
                const rows = buckets[key]
                if (!rows.length) return null
                return (
                  <List
                    key={key}
                    density="compact"
                    hasDividers
                    header={
                      <Stack direction="horizontal" gap={2} align="center">
                        <Heading level={2} style={{ color: textColor }}>
                          {label}
                        </Heading>
                      </Stack>
                    }
                  >
                    {rows.map(({ t, w }) => {
                      const lane = w.lanes.find(l => l.id === t.lane)
                      const late = key === 'overdue'
                      const StatusIcon = statusIcon(w, t)
                      return (
                        <ListItem
                          key={t.id}
                          label={t.name}
                          description={`${w.name} · ${lane?.label ?? 'No workstream'}`}
                          onClick={() => onOpenTask(w.id, t)}
                          startContent={
                            <StatusIcon width={16} height={16} style={{ color: statusColor(w, t), flexShrink: 0 }} />
                          }
                          endContent={
                            <Stack direction="horizontal" gap={2} align="center" style={{ whiteSpace: 'nowrap' }}>
                              {(t.pct || 0) > 0 && (
                                <div style={{ width: 72, flexShrink: 0 }}>
                                  <ProgressBar
                                    label={`${t.name} progress`}
                                    isLabelHidden
                                    
                                    value={t.pct}
                                    variant={progressVariant(t.pct)}
                                  />
                                </div>
                              )}
                              <Stack width={100}>
                              <Text
                                size="xsm"
                                color={late ? undefined : 'secondary'}
                                style={late ? { color: 'var(--color-text-red)' } : undefined}
                              >
                                {fmtDueRelative(t, today)}
                              </Text>
                              </Stack>
                            </Stack>
                          }
                        />
                      )
                    })}
                  </List>
                )
              })
              )}
            </Stack>
          </GridSpan>

          <GridSpan columns={1} style={{ height: isMobile ? 'auto' : '100%', minHeight: 0 }}>
            <PersonalTodo meId={meId} compact={isMobile} />
          </GridSpan>
        </Grid>
      </Stack>
    </div>
  )
}
