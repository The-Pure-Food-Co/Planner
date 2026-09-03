'use client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCanWrite, filterNzTeamMembers, filterNzTeamNames } from '@/lib/permissions';
import type { Lane, Member, Task, Workspace } from '@/lib/types';
import {
  addDays,
  avgPct,
  daysBetween,
  dependencyChainIds,
  fd,
  fmtShort,
  mondayOf,
  pd,
  RECUR_OPTIONS,
  resolveAssignees,
  taskMatchesSearch,
  taskStatusId,
  todayD,
  wsStatuses,
} from '@/lib/utils';
import { usePlannerStore } from '@/store/plannerStore';
import {
  ChevronDown,
  ChevronRight,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  MoreHorizontal,
  Pencil,
  PlusIcon,
  Repeat,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LANE_PRESETS } from '@/lib/lanePresets';
import { uuid } from '@/lib/utils';
import Avatar from '../Avatar';
import { Tooltip } from '../tooltip';
import DateRangeTooltip from './DateRangeToolTip';
import TaskHoverDetails from './TaskHoverDetails';

// Bar lifecycle state that drives the little status pip on the task icon.
type BarStatus = 'done' | 'overdue' | 'active';

// Rich hover card is deliberately slow to appear so it never fires while
// scanning/dragging across the chart — only on an intentional dwell.
const HOVER_DETAILS_DELAY_MS = 800;

const ZOOM_DW: Record<string, number> = { days: 32, weeks: 14, months: 5 };

const fmtTooltipDate = (d: Date): string =>
  d.toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

function ganttRange(ws: Workspace): [Date, Date] {
  const today = todayD();
  let min = addDays(today, -365),
    max = addDays(today, 365);
  const see = (s: string) => {
    if (!s) return;
    const d = pd(s);
    if (d < min) min = d;
    if (d > max) max = d;
  };
  ws.tasks.forEach((t) => {
    see(t.start);
    see(t.end);
    (t.milestones || []).forEach((m) => see(m.date));
  });
  return [mondayOf(addDays(min, -7)), addDays(mondayOf(addDays(max, 13)), 6)];
}

type DragMode = 'move' | 'left' | 'right' | 'pct';

// A dependency connector edge: endpoint task ids + base pixel geometry.
// `conflict` = the predecessor's end runs past the successor's start (the
// successor is scheduled to begin before its prerequisite finishes).
interface DepEdge {
  key: string;
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  conflict?: boolean;
}

// Elbow route for a dependency connector: out from the predecessor's end,
// across, then into the dependent's start (arrowhead added via marker).
function depPathD(x1: number, y1: number, x2: number, y2: number): string {
  const midGap = 10;
  const sx = x1 + Math.min(midGap, Math.max(4, (x2 - x1) / 2));
  return `M ${x1} ${y1} L ${sx} ${y1} L ${sx} ${y2} L ${x2 - 2} ${y2}`;
}

interface GanttBarProps {
  task: Task;
  lane: Lane;
  ws: Workspace;
  members: Member[];
  dw: number;
  r0: Date;
  onOpenTask: () => void;
  onUpdate: (t: Task, undoToast?: string) => void;
  onMove: (deltaDays: number) => void;
  onToast: (msg: string) => void;
  status: BarStatus;
  disabled?: boolean;
  // Register this bar's element so the parent can translate it live while a
  // linked bar is being dragged.
  registerEl?: (id: string, el: HTMLDivElement | null) => void;
  // Called on every move frame with the live pixel delta so the parent can
  // shift the rest of this task's dependency chain in lock-step.
  onLiveMove?: (id: string, pxDelta: number) => void;
  onLiveMoveEnd?: () => void;
}

function GanttBar({
  task,
  lane,
  ws,
  members,
  dw,
  r0,
  onOpenTask,
  onUpdate,
  onMove,
  onToast,
  status,
  disabled,
  registerEl,
  onLiveMove,
  onLiveMoveEnd,
}: GanttBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [labelFits, setLabelFits] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(
    null
  );
  const [dragRange, setDragRange] = useState<{ start: Date; end: Date } | null>(
    null
  );
  const [dragPct, setDragPct] = useState<number | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{
    mode: DragMode | null;
    sx: number;
    moved: boolean;
    s0: Date;
    e0: Date;
    x0: number;
    dxDays: number;
    pct0: number;
    pctVal: number;
  }>({
    mode: null,
    sx: 0,
    moved: false,
    s0: new Date(),
    e0: new Date(),
    x0: 0,
    dxDays: 0,
    pct0: 0,
    pctVal: 0,
  });

  const effectiveStart = task.noDate ? todayD() : pd(task.start);
  const effectiveEnd = task.noDate ? addDays(todayD(), 6) : pd(task.end);
  const s = effectiveStart,
    e = effectiveEnd;
  const x = daysBetween(r0, s) * dw;
  const w = Math.max(dw, (daysBetween(s, e) + 1) * dw);
  // Hide the status pip on hair-thin bars where it can't fit.
  const showStatusPip = w >= 28;

  useLayoutEffect(() => {
    const labelWidth = labelRef.current?.scrollWidth ?? 0;
    if (labelWidth === 0) {
      setLabelFits(false);
      return;
    }
    const leftOffset = 10;
    const rightReserved = task.pct ? 34 : 10;
    const fitsWidth = leftOffset + labelWidth + rightReserved <= w;
    const fillPx = ((task.pct || 0) / 100) * w;
    const coveredByFill = leftOffset + labelWidth + 4 <= fillPx;
    setLabelFits(fitsWidth && coveredByFill);
  }, [w, task.name, task.pct]);

  const cancelHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);
  // Delay hiding so the pointer can travel from the bar onto the (interactive)
  // hover card without it closing; the card cancels this on mouse-enter.
  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimer.current = setTimeout(() => setHoverPoint(null), 160);
  }, [cancelHide]);

  const onPointerEnter = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      cancelHide();
      const { clientX, clientY } = ev;
      hoverTimer.current = setTimeout(() => {
        setHoverPoint({ x: clientX, y: clientY });
      }, HOVER_DETAILS_DELAY_MS);
    },
    [cancelHide]
  );
  const onPointerLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    scheduleHide();
  }, [scheduleHide]);

  const onPointerDown = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      if (ev.button !== 0) return;
      const d = drag.current;
      // Read-only: allow click-to-open (handled in onPointerUp when !moved) but no drag.
      if (disabled) {
        d.mode = null;
        d.moved = false;
        ev.currentTarget.setPointerCapture(ev.pointerId);
        return;
      }
      const target = ev.target as HTMLElement;
      d.mode = target.classList.contains('grip-left')
        ? 'left'
        : target.classList.contains('grip-right')
          ? 'right'
          : target.classList.contains('grip-pct')
            ? 'pct'
            : 'move';
      d.sx = ev.clientX;
      d.moved = false;
      d.dxDays = 0;
      d.s0 = task.noDate ? todayD() : pd(task.start);
      d.e0 = task.noDate ? addDays(todayD(), 6) : pd(task.end);
      d.x0 = x;
      d.pct0 = task.pct || 0;
      d.pctVal = d.pct0;
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      setHoverPoint(null);
      ev.currentTarget.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    },
    [task.start, task.end, task.noDate, task.pct, x, disabled]
  );

  const onPointerMove = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d.mode) return;
      const dxDays = Math.round((ev.clientX - d.sx) / dw);
      if (!d.moved && Math.abs(ev.clientX - d.sx) > 3) {
        d.moved = true;
        barRef.current?.classList.add('dragging');
      }
      if (!d.moved) return;
      d.dxDays = dxDays;
      const el = barRef.current;
      if (!el) return;
      if (d.mode === 'move') {
        const px = dxDays * dw;
        el.style.transform = `translateX(${px}px)`;
        // Move the rest of the dependency chain live, in lock-step.
        onLiveMove?.(task.id, px);
        const ns = addDays(d.s0, dxDays);
        const ne = addDays(d.e0, dxDays);
        setDragRange({ start: ns, end: ne });
      } else if (d.mode === 'right') {
        const days = Math.max(0, daysBetween(d.s0, d.e0) + dxDays);
        el.style.width = `${(days + 1) * dw}px`;
        const ne = addDays(d.s0, days);
        setDragRange({ start: d.s0, end: ne });
      } else if (d.mode === 'left') {
        const maxDx = daysBetween(d.s0, d.e0);
        const dxClamped = Math.min(dxDays, maxDx);
        const days = maxDx - dxClamped;
        el.style.width = `${(days + 1) * dw}px`;
        el.style.left = `${d.x0 + dxClamped * dw}px`;
        const ns = addDays(d.s0, dxClamped);
        setDragRange({ start: ns, end: d.e0 });
      } else {
        const newPct = Math.max(
          0,
          Math.min(100, Math.round(d.pct0 + ((ev.clientX - d.sx) / w) * 100))
        );
        d.pctVal = newPct;
        if (fillRef.current) fillRef.current.style.width = `${newPct}%`;
        setDragPct(newPct);
      }
    },
    [dw, w, onLiveMove, task.id]
  );

  const onPointerUp = useCallback(() => {
    const d = drag.current;
    const wasMode = d.mode;
    d.mode = null;
    const el = barRef.current;
    el?.classList.remove('dragging');
    el?.style.removeProperty('transform');
    // Clear any live transl/transform applied to linked chain bars.
    if (wasMode === 'move') onLiveMoveEnd?.();
    setDragRange(null);
    if (!d.moved) {
      onOpenTask();
      return;
    }
    if (wasMode === 'pct') {
      setDragPct(null);
      if (d.pctVal === d.pct0) return;
      onUpdate(
        { ...task, pct: d.pctVal },
        `Updated "${task.name}" progress → ${d.pctVal}%`
      );
      return;
    }
    if (d.dxDays === 0) return;
    if (wasMode === 'move') {
      // Cascade the shift onto dependents; the store applies the move to this
      // task too (and to any no-date dependents), so we don't call onUpdate.
      // The store shows the (undoable) reschedule toast.
      onMove(d.dxDays);
      return;
    }
    const updated = { ...task, noDate: false };
    if (wasMode === 'right') {
      const days = Math.max(0, daysBetween(d.s0, d.e0) + d.dxDays);
      updated.end = fd(addDays(d.s0, days));
      el?.style.removeProperty('width');
    } else {
      const maxDx = daysBetween(d.s0, d.e0);
      const dxClamped = Math.min(d.dxDays, maxDx);
      updated.start = fd(addDays(d.s0, dxClamped));
      el?.style.removeProperty('width');
      el?.style.removeProperty('left');
    }
    onUpdate(
      updated,
      `Rescheduled "${updated.name}" → ${fmtShort(updated.start)} – ${fmtShort(updated.end)}`
    );
  }, [task, onOpenTask, onUpdate, onMove, onToast, onLiveMoveEnd]);

  return (
    <div
      ref={(el) => {
        barRef.current = el;
        registerEl?.(task.id, el);
      }}
      className={`bar${task.noDate ? ' no-date' : ''}`}
      style={
        {
          left: x,
          width: w,
          '--lane': lane.color,
        } as React.CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div
        ref={fillRef}
        className="fill"
        style={{
          width: `${task.pct || 0}%`,
        }}
      >
        {(task.pct || dragPct !== null) && (
          <Tooltip
            content={dragPct !== null ? `${dragPct}%` : 'Drag to set progress'}
            open={dragPct !== null ? true : undefined}
          >
            <span className="grip grip-pct" />
          </Tooltip>
        )}
      </div>
      {showStatusPip && status !== 'done' && (
        <span
          className={`bstatus bstatus-${status}`}
          aria-label={status === 'overdue' ? 'Overdue' : 'Active'}
        >
          {status === 'overdue' && (
            <svg viewBox="0 0 12 12" width="5.5" height="5.5" aria-hidden>
              <line
                x1="3"
                y1="6"
                x2="9"
                y2="6"
                stroke="#fff"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          )}
        </span>
      )}
      <span ref={labelRef} className={`blabel${labelFits ? ' inside' : ''}`}>
        {(task.recurrence || task.recurrenceParentId) && (
          <span
            className="brepeat"
            title={
              task.recurrence
                ? `Repeats ${task.recurrence.freq}`
                : 'Recurring occurrence'
            }
            aria-hidden
          >
            ↻{' '}
          </span>
        )}
        {task.name}
      </span>
      {task.pct ? <span className="bpct">{task.pct}%</span> : null}
      {!task.noDate && (
        <>
          <span className="grip grip-left" />
          <span className="grip grip-right" />
        </>
      )}
      {dragRange && (
        <div className="bar-drag-tooltip">
          <DateRangeTooltip
            compact
            startDate={fmtTooltipDate(dragRange.start)}
            endDate={fmtTooltipDate(dragRange.end)}
          />
        </div>
      )}
      {hoverPoint && (
        <TaskHoverDetails
          task={task}
          ws={ws}
          lane={lane}
          members={members}
          anchor={hoverPoint}
          onUpdate={onUpdate}
          onMouseEnter={cancelHide}
          onMouseLeave={() => setHoverPoint(null)}
        />
      )}
    </div>
  );
}

interface OffscreenNudgeProps {
  x1: number;
  x2: number;
  labelW: number;
  wrapRef: React.RefObject<HTMLDivElement | null>;
}

function OffscreenNudge({ x1, x2, labelW, wrapRef }: OffscreenNudgeProps) {
  const [dir, setDir] = useState<'left' | 'right' | null>(null);

  useEffect(() => {
    const scrollEl = wrapRef.current;
    if (!scrollEl) return;
    const check = () => {
      const scrollLeft = scrollEl.scrollLeft;
      const viewW = scrollEl.clientWidth - labelW;
      if (x2 < scrollLeft) setDir('left');
      else if (x1 > scrollLeft + viewW) setDir('right');
      else setDir(null);
    };
    check();
    scrollEl.addEventListener('scroll', check, { passive: true });
    return () => scrollEl.removeEventListener('scroll', check);
  }, [x1, x2, labelW, wrapRef]);

  if (!dir) return null;
  return (
    <div className="bar-nudge-wrap">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="bar-nudge"
        style={{ left: labelW + 8 }}
        onClick={() => {
          const scrollEl = wrapRef.current;
          if (!scrollEl) return;
          const viewW = scrollEl.clientWidth - labelW;
          scrollEl.scrollTo({
            left: Math.max(0, x1 - viewW / 2),
            behavior: 'smooth',
          });
        }}
      >
        {dir === 'left' ? '‹' : '›'}
      </Button>
    </div>
  );
}

interface Props {
  ws: Workspace;
  onOpenTask: (wsId: string, task: Task) => void;
  onAddTask: (wsId: string, laneId: string, start?: string) => Task;
  onOpenLane: (wsId: string, lane: Lane) => void;
}

export default function Gantt({
  ws,
  onOpenTask,
  onAddTask,
  onOpenLane,
}: Props) {
  const {
    data,
    ui,
    setUi,
    saveUi,
    updateTask,
    moveTaskWithDependents,
    duplicateTask,
    deleteTask,
    applyRecurrence,
    reorderTasks,
    reorderLanes,
    addLane,
    duplicateLane,
    addLaneFromPreset,
    addLaneFromTemplate,
    toast,
    focusTaskId,
    clearFocusTask,
  } = usePlannerStore();
  // Shared, Supabase-persisted workstream templates (shown alongside the built-in
  // presets in the "From template" list). Selected separately so the list stays
  // reactive to realtime template inserts/deletes from other users.
  const laneTemplates = usePlannerStore((s) => s.data.laneTemplates);
  const canEdit = useCanWrite(ws.id);
  // Assignee options for the sidebar's click-to-multiselect avatar/name area —
  // scoped to this workspace's own People list, same as TaskEditor's picker.
  const wsMemberNames = useMemo(() => new Set(ws.members ?? []), [ws.members]);
  const assigneeOptions = useMemo(() => {
    const all = data.members.length
      ? filterNzTeamMembers(data.members).map((m) => ({ id: m.id, name: m.displayName, avatarUrl: m.avatarUrl }))
      : filterNzTeamNames(data.userList, data.members).map((u) => ({ id: u, name: u, avatarUrl: '' }));
    return all.filter((o) => wsMemberNames.has(o.name));
  }, [data.members, data.userList, wsMemberNames]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hdrPan = useRef<{
    x0: number;
    sl0: number;
  } | null>(null);
  const [hdrDragging, setHdrDragging] = useState(false);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  // Task selected in the sidebar (single-select). Enables the Ctrl/Cmd+D
  // duplicate shortcut and shows a selection highlight on the row.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Task whose name is being edited inline in the sidebar row — set right
  // after a Gantt-originated "add task" so the user can just type the name.
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const dragIndicatorRef = useRef<{
    id: string;
    pos: 'above' | 'below';
  } | null>(null);
  const [dragIndicator, setDragIndicatorState] = useState<{
    id: string;
    pos: 'above' | 'below';
  } | null>(null);
  const setDragIndicator = useCallback(
    (v: { id: string; pos: 'above' | 'below' } | null) => {
      const cur = dragIndicatorRef.current;
      if (cur?.id === v?.id && cur?.pos === v?.pos) return;
      dragIndicatorRef.current = v;
      setDragIndicatorState(v);
    },
    []
  );

  // Live dependency-chain drag: each bar registers its element here; while one
  // bar is dragged we translate every OTHER bar in its dependency chain by the
  // same pixel delta, so linked bars move together in real time (not just on
  // drop). Chain membership for the active drag is memoised on the first move.
  const barEls = useRef<Map<string, HTMLDivElement>>(new Map());
  // Current dependency edges (with endpoint ids + base geometry), refreshed
  // every render so the live-drag handler can recompute affected arrows.
  const depEdgesRef = useRef<DepEdge[]>([]);
  // The active drag, resolved ONCE on the first move frame: the "other" chain
  // bars to translate, and the affected arrows with their DOM node + geometry
  // pre-resolved so each frame is a cheap loop (no getElementById / full scan).
  const liveDrag = useRef<{
    id: string;
    bars: HTMLDivElement[];
    arrows: {
      el: Element;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      fromMoves: boolean;
      toMoves: boolean;
    }[];
  } | null>(null);
  const registerBarEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) barEls.current.set(id, el);
    else barEls.current.delete(id);
  }, []);
  // Draw the affected arrows for the current pxDelta (0 restores committed geometry).
  const drawLiveArrows = useCallback((pxDelta: number) => {
    const d = liveDrag.current;
    if (!d) return;
    for (const a of d.arrows) {
      const x1 = a.x1 + (a.fromMoves ? pxDelta : 0);
      const x2 = a.x2 + (a.toMoves ? pxDelta : 0);
      a.el.setAttribute('d', depPathD(x1, a.y1, x2, a.y2));
    }
  }, []);
  const onLiveMove = useCallback(
    (id: string, pxDelta: number) => {
      if (liveDrag.current?.id !== id) {
        // First move frame — compute the connected chain and resolve the bars
        // and arrows it touches once, so subsequent frames are cheap.
        const moving = dependencyChainIds(ws.tasks, id);
        const bars: HTMLDivElement[] = [];
        for (const otherId of moving) {
          if (otherId === id) continue;
          const el = barEls.current.get(otherId);
          if (el) bars.push(el);
        }
        const arrows: NonNullable<typeof liveDrag.current>['arrows'] = [];
        for (const e of depEdgesRef.current) {
          const fromMoves = moving.has(e.fromId);
          const toMoves = moving.has(e.toId);
          if (!fromMoves && !toMoves) continue;
          const el = document.getElementById(`dep-path-${e.key}`);
          if (el) arrows.push({ el, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, fromMoves, toMoves });
        }
        liveDrag.current = { id, bars, arrows };
      }
      for (const el of liveDrag.current.bars)
        el.style.transform = `translateX(${pxDelta}px)`;
      drawLiveArrows(pxDelta);
    },
    [ws.tasks, drawLiveArrows]
  );
  const onLiveMoveEnd = useCallback(() => {
    if (!liveDrag.current) return;
    for (const el of liveDrag.current.bars) el.style.removeProperty('transform');
    // Restore arrows to committed geometry; the next render draws final positions.
    drawLiveArrows(0);
    liveDrag.current = null;
  }, [drawLiveArrows]);

  const dw = ZOOM_DW[ui.zoom] || 14;
  const [r0, r1] = useMemo(() => ganttRange(ws), [ws]);
  const totalDays = daysBetween(r0, r1) + 1;
  const W = totalDays * dw;
  const labelW =
    typeof window !== 'undefined' && window.innerWidth <= 768 ? 220 : 430;
  const rowH = 44,
    hdrH = 48;
  const today = todayD();
  const collapsed = new Set(ui.collapsed || []);
  const todayOnly = ui.todayOnly;
  const taskFilter = ui.taskFilter ?? 'all';
  const allCollapsed =
    ws.lanes.length > 0 && ws.lanes.every((l) => collapsed.has(l.id));
  const toggleAllLanes = () => {
    const set = new Set(collapsed);
    if (allCollapsed) ws.lanes.forEach((l) => set.delete(l.id));
    else ws.lanes.forEach((l) => set.add(l.id));
    setUi({ collapsed: [...set] });
    saveUi();
  };
  const statusCols = wsStatuses(ws);
  const isTaskDone = useCallback(
    (t: Task) => {
      const st = statusCols.find((s) => s.id === taskStatusId(t));
      return !!st?.isDone || (t.pct || 0) >= 100;
    },
    [statusCols]
  );

  const onHdrPointerDown = useCallback((ev: React.PointerEvent) => {
    hdrPan.current = {
      x0: ev.clientX,
      sl0: wrapRef.current?.scrollLeft ?? 0,
    };
    ev.currentTarget.setPointerCapture(ev.pointerId);
    setHdrDragging(true);
  }, []);

  const onHdrPointerMove = useCallback((ev: React.PointerEvent) => {
    if (!hdrPan.current) return;
    if (wrapRef.current)
      wrapRef.current.scrollLeft =
        hdrPan.current.sl0 - (ev.clientX - hdrPan.current.x0);
  }, []);

  const onHdrPointerUp = useCallback(() => {
    hdrPan.current = null;
    setHdrDragging(false);
  }, []);

  const toggleLane = (id: string) => {
    const s = new Set(collapsed);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setUi({ collapsed: [...s] });
    saveUi();
  };

  // Scroll to today on mount
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (today >= r0 && today <= r1) {
      el.scrollLeft = Math.max(
        0,
        daysBetween(r0, today) * dw - (el.clientWidth - labelW) / 3
      );
    }
  }, [ws.id, ui.zoom]);

  // Ctrl/Cmd+D duplicates the selected sidebar task. Ignored while typing in a
  // field so it never hijacks the browser's bookmark shortcut inside inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D'))) return;
      if (!canEdit || !selectedTaskId) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return;
      if (!ws.tasks.some((t) => t.id === selectedTaskId)) return;
      e.preventDefault();
      const newId = duplicateTask(ws.id, selectedTaskId);
      if (newId) setSelectedTaskId(newId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, selectedTaskId, ws.id, ws.tasks, duplicateTask]);

  // expose scroll-to-today globally for toolbar button
  useEffect(() => {
    (
      window as Window & {
        __scrollToday?: () => void;
      }
    ).__scrollToday = () => {
      const el = wrapRef.current;
      if (!el) return;
      el.scrollTo({
        left: Math.max(
          0,
          daysBetween(r0, today) * dw - (el.clientWidth - labelW) / 3
        ),
        behavior: 'smooth',
      });
    };
  });

  // Report the month under the viewport anchor (1/3 into the chart, matching
  // the scroll-to-today anchor) so the toolbar's month label tracks scrolling,
  // and expose month-step panning for the toolbar chevrons.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const anchorPx = () => (el.clientWidth - labelW) / 3;
    const anchorDate = () =>
      addDays(
        r0,
        Math.max(
          0,
          Math.min(totalDays - 1, Math.round((el.scrollLeft + anchorPx()) / dw))
        )
      );
    let last = '';
    const report = () => {
      const label = anchorDate().toLocaleDateString('en-NZ', {
        month: 'long',
        year: 'numeric',
      });
      if (label === last) return;
      last = label;
      window.dispatchEvent(new CustomEvent('gantt-month', { detail: label }));
    };
    report();
    el.addEventListener('scroll', report, { passive: true });
    (
      window as Window & { __ganttPanMonth?: (dir: 1 | -1) => void }
    ).__ganttPanMonth = (dir) => {
      const d = anchorDate();
      const target = new Date(d.getFullYear(), d.getMonth() + dir, 1);
      el.scrollTo({
        left: Math.max(0, daysBetween(r0, target) * dw - anchorPx()),
        behavior: 'smooth',
      });
    };
    return () => el.removeEventListener('scroll', report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.id, ui.zoom, +r0, totalDays, dw, labelW]);

  // Scroll to and highlight a task jumped to from search
  useEffect(() => {
    if (!focusTaskId) return;
    const t = ws.tasks.find((x) => x.id === focusTaskId);
    if (!t) {
      clearFocusTask();
      return;
    }
    if ((ui.collapsed || []).includes(t.lane)) {
      setUi({
        collapsed: (ui.collapsed || []).filter((id) => id !== t.lane),
      });
      saveUi();
      return;
    }
    const elS = document.getElementById(`task-row-${focusTaskId}`);
    const elC = document.getElementById(`task-chart-row-${focusTaskId}`);
    if (!elS) return;
    elS.scrollIntoView({ behavior: 'smooth', block: 'center' });
    elS.classList.add('flash-focus');
    elC?.classList.add('flash-focus');
    const timer = setTimeout(() => {
      elS.classList.remove('flash-focus');
      elC?.classList.remove('flash-focus');
    }, 1600);
    clearFocusTask();
    return () => clearTimeout(timer);
  }, [focusTaskId, ui.collapsed, ws.tasks]);

  // --- build header ---
  const mRow: React.ReactNode[] = [];
  // Cumulative x of each month's right edge; used to draw the only vertical
  // separators kept in the chart body (month boundaries), matching the header.
  const monthBoundaries: number[] = [];
  let cur = new Date(r0);
  let monthAccX = 0;
  while (cur <= r1) {
    const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const seg = Math.min(daysBetween(cur, r1) + 1, daysBetween(cur, mEnd) + 1);
    const isCurrentMonth = today >= cur && today <= mEnd;
    monthAccX += seg * dw;
    monthBoundaries.push(monthAccX);
    mRow.push(
      <div
        key={cur.toISOString()}
        className="m-cell"
        style={{ width: seg * dw }}
      >
        {cur.toLocaleDateString('en-NZ', { month: 'long' }) +
          (cur.getMonth() === 0 || +cur === +r0 ? ' ' + cur.getFullYear() : '')}
        {isCurrentMonth && (
          <span className="current-badge  text-[8.5px] leading-none tracking-[0.04em]">
            This month
          </span>
        )}
      </div>
    );
    cur = addDays(mEnd, 1);
  }
  const wRow: React.ReactNode[] = [];
  for (let d = new Date(r0); d <= r1; d = addDays(d, 7)) {
    const isNow = today >= d && today < addDays(d, 7);
    wRow.push(
      <div
        key={d.toISOString()}
        className={`w-cell${isNow ? ' now' : ''}`}
        style={{
          width: Math.min(7, daysBetween(d, r1) + 1) * dw,
        }}
      >
        {dw >= 9
          ? d.toLocaleDateString('en-NZ', {
              month: 'short',
              day: 'numeric',
            })
          : d.getDate()}
      </div>
    );
  }

  // Create a task via onAddTask (defaults: this lane, current user, today→+7d)
  // and immediately drop the sidebar row into inline name-editing mode instead
  // of opening the full modal — "press add and type" per the desired flow.
  const startInlineAdd = useCallback(
    (laneId: string, start?: string) => {
      const t = onAddTask(ws.id, laneId, start);
      setSelectedTaskId(t.id);
      setEditingName(t.name === 'New task' ? '' : t.name);
      setEditingTaskId(t.id);
    },
    [onAddTask, ws.id]
  );

  const commitInlineEdit = useCallback(() => {
    if (!editingTaskId) return;
    const id = editingTaskId;
    const name = editingName.trim();
    setEditingTaskId(null);
    if (!name) {
      deleteTask(ws.id, id);
      return;
    }
    const t = ws.tasks.find((x) => x.id === id);
    if (t && t.name !== name) updateTask(ws.id, { ...t, name });
  }, [editingTaskId, editingName, ws.id, ws.tasks, deleteTask, updateTask]);

  const cancelInlineEdit = useCallback(() => {
    if (!editingTaskId) return;
    const id = editingTaskId;
    setEditingTaskId(null);
    const t = ws.tasks.find((x) => x.id === id);
    if (t && (t.name === 'New task' || !t.name.trim())) deleteTask(ws.id, id);
  }, [editingTaskId, ws.id, ws.tasks, deleteTask]);

  // --- build sidebar rows and chart rows ---
  const sidebarRows: React.ReactNode[] = [];
  const chartRows: React.ReactNode[] = [];
  // Bar geometry of every rendered (visible, expanded) task, keyed by id, used
  // to draw dependency connector arrows once all rows are laid out.
  const taskLayout = new Map<string, { x: number; w: number; row: number }>();
  let rowOrd = 0;
  let visibleTaskCount = 0;
  const personF = ui.person;
  const streamF = ui.stream;
  const searchF = ui.search ?? '';
  const anyFilter =
    !!personF || !!streamF || !!searchF.trim() || todayOnly || taskFilter !== 'all';

  ws.lanes.forEach((lane) => {
    if (streamF && lane.id !== streamF) return;
    let tasks = ws.tasks
      .filter((t) => t.lane === lane.id)
      .sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0));
    if (personF)
      tasks = tasks.filter((t) =>
        resolveAssignees(t, data.members).some((a) => a.name === personF)
      );
    if (searchF.trim())
      tasks = tasks.filter((t) => taskMatchesSearch(t, searchF, data.members));
    if (todayOnly)
      tasks = tasks.filter(
        (t) => t.noDate || (pd(t.start) <= today && pd(t.end) >= today)
      );
    if (taskFilter === 'active') tasks = tasks.filter((t) => !isTaskDone(t));
    if (taskFilter === 'done') tasks = tasks.filter((t) => isTaskDone(t));
    visibleTaskCount += tasks.length;
    if (anyFilter && !tasks.length) return;
    const isCol = collapsed.has(lane.id);
    const tint = lane.color + '1A';
    const rowId = `lane-${lane.id}`;
    const dropCls =
      dragIndicator?.id === rowId ? ` drop-${dragIndicator.pos}` : '';

    // Lane drop handlers
    const laneOnDragOver = (ev: React.DragEvent) => {
      const types = Array.from(ev.dataTransfer.types || []);
      if (!types.includes('app/lane')) return;
      ev.preventDefault();
      const el = ev.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      setDragIndicator({
        id: rowId,
        pos: ev.clientY < r.top + r.height / 2 ? 'above' : 'below',
      });
    };
    const laneOnDragLeave = () => setDragIndicator(null);
    const laneOnDrop = (ev: React.DragEvent) => {
      ev.preventDefault();
      const before = dragIndicatorRef.current?.pos === 'above';
      setDragIndicator(null);
      const id = ev.dataTransfer.getData('app/lane');
      if (!id || id === lane.id) return;
      const newLanes = [...ws.lanes];
      const from = newLanes.findIndex((l) => l.id === id);
      if (from < 0) return;
      const [moved] = newLanes.splice(from, 1);
      let to = newLanes.findIndex((l) => l.id === lane.id);
      if (!before) to += 1;
      newLanes.splice(to, 0, moved);
      reorderLanes(ws.id, newLanes);
    };

    sidebarRows.push(
      <div
        key={rowId}
        className={`gs-row lane-row${dropCls}`}
        style={{
          background: `linear-gradient(${tint},${tint}),#fff`,
        }}
        onClick={() => toggleLane(lane.id)}
        onDragOver={laneOnDragOver}
        onDragLeave={laneOnDragLeave}
        onDrop={laneOnDrop}
      >
        <span
          className="grip6"
          draggable={canEdit}
          onDragStart={(ev) => {
            ev.dataTransfer.setData('app/lane', lane.id);
            ev.dataTransfer.effectAllowed = 'move';
          }}
          onClick={(ev) => ev.stopPropagation()}
        >
          ⠿
        </span>
        <span className="chev" title={isCol ? 'Expand' : 'Collapse'}>
          {isCol ? (
            <ChevronRight className="w-4 h-4" strokeWidth={1.25} />
          ) : (
            <ChevronDown strokeWidth={1.25} className="w-4 h-4" />
          )}
        </span>
        <span
          className="lane-tag"
          title={canEdit ? 'Edit workstream' : undefined}
          onClick={(ev) => {
            ev.stopPropagation();
            if (canEdit) onOpenLane(ws.id, lane);
          }}
        >
          {lane.label}
        </span>
        <div className="flex items-center justify-end">
          {canEdit && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Edit workstream"
              onClick={(ev) => {
                ev.stopPropagation();
                onOpenLane(ws.id, lane);
              }}
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(ev) => {
                ev.stopPropagation();
                startInlineAdd(lane.id);
              }}
            >
              <PlusIcon className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    );

    chartRows.push(
      <div
        key={`${rowId}-c`}
        className={`gc-row lane-row${dropCls}`}
        style={{
          background: `linear-gradient(${tint},${tint})`,
        }}
        onDragOver={laneOnDragOver}
        onDragLeave={laneOnDragLeave}
        onDrop={laneOnDrop}
      >
        {tasks.length > 0 &&
          (() => {
            const todayStr = fd(today);
            const effS = (t: Task) => (t.noDate ? todayStr : t.start);
            const effE = (t: Task) => (t.noDate ? todayStr : t.end);
            const s = tasks.reduce(
              (a, t) => (a < effS(t) ? a : effS(t)),
              effS(tasks[0])
            );
            const e = tasks.reduce(
              (a, t) => (a > effE(t) ? a : effE(t)),
              effE(tasks[0])
            );
            const lx = daysBetween(r0, pd(s)) * dw;
            const lw = Math.max(dw, (daysBetween(pd(s), pd(e)) + 1) * dw);
            return (
              <div
                className=""
                style={{
                  left: lx,
                  width: lw,
                  background: lane.color + '40',
                }}
              >
                <span>
                  {fmtShort(s)} → {fmtShort(e)}
                </span>
                {(() => {
                  const est = tasks.reduce((a, t) => a + (t.estimate || 0), 0);
                  return est > 0 ? <span>{est} est</span> : null;
                })()}
                <span>{avgPct(tasks)}%</span>
              </div>
            );
          })()}
      </div>
    );
    rowOrd++;

    if (!isCol)
      tasks.forEach((t) => {
        const s = t.noDate ? today : pd(t.start),
          e = t.noDate ? addDays(today, 6) : pd(t.end);
        const x = daysBetween(r0, s) * dw;
        const w = Math.max(dw, (daysBetween(s, e) + 1) * dw);
        taskLayout.set(t.id, { x, w, row: rowOrd });
        const done = (t.checklist || []).filter((c) => c.done).length,
          tot = (t.checklist || []).length;
        // Icon status pip: overdue (past end, not done) → red; else in-flight → green.
        const barStatus: BarStatus = isTaskDone(t)
          ? 'done'
          : !t.noDate && pd(t.end) < today
            ? 'overdue'
            : 'active';
        const taskRowId = `task-${t.id}`;
        const taskDropCls =
          dragIndicator?.id === taskRowId ? ` drop-${dragIndicator.pos}` : '';
        const isHovered = hoveredRowId === taskRowId;

        const taskOnDragOver = (ev: React.DragEvent) => {
          if (!ev.dataTransfer.types.includes(`app/task-${lane.id}`)) return;
          ev.preventDefault();
          const el = ev.currentTarget as HTMLElement;
          const r = el.getBoundingClientRect();
          setDragIndicator({
            id: taskRowId,
            pos: ev.clientY < r.top + r.height / 2 ? 'above' : 'below',
          });
        };
        const taskOnDragLeave = () => setDragIndicator(null);
        const taskOnDrop = (ev: React.DragEvent) => {
          ev.preventDefault();
          const before = dragIndicatorRef.current?.pos === 'above';
          setDragIndicator(null);
          const draggedId = ev.dataTransfer.getData(`app/task-${lane.id}`);
          if (!draggedId || draggedId === t.id) return;
          const ordered = ws.tasks
            .filter((x) => x.lane === lane.id)
            .sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0))
            .map((x) => x.id)
            .filter((id) => id !== draggedId);
          let idx = ordered.indexOf(t.id);
          if (idx < 0) idx = ordered.length;
          if (!before) idx += 1;
          ordered.splice(idx, 0, draggedId);
          reorderTasks(ws.id, lane.id, ordered);
        };

        const isSelected = selectedTaskId === t.id;
        sidebarRows.push(
          <div
            key={taskRowId}
            id={`task-row-${t.id}`}
            className={`gs-row${isHovered ? ' hovered' : ''}${isSelected ? ' selected' : ''}${taskDropCls}`}
            onDragOver={taskOnDragOver}
            onDragLeave={taskOnDragLeave}
            onDrop={taskOnDrop}
            onMouseEnter={() => setHoveredRowId(taskRowId)}
            onMouseLeave={() => setHoveredRowId(null)}
            onClick={() => setSelectedTaskId(t.id)}
            title={canEdit ? 'Click to select · Ctrl/⌘+D to duplicate' : undefined}
          >
            <span
              className="grip6"
              draggable={canEdit}
              onDragStart={(ev) => {
                ev.dataTransfer.setData(`app/task-${lane.id}`, t.id);
                ev.dataTransfer.effectAllowed = 'move';
              }}
            >
              ⠿
            </span>
            <span
              className="tick"
              style={{
                background: lane.color,
              }}
            />
            {editingTaskId === t.id ? (
              <input
                className="t-name t-name-input"
                autoFocus
                value={editingName}
                placeholder="Task name…"
                onChange={(ev) => setEditingName(ev.target.value)}
                onFocus={(ev) => ev.currentTarget.select()}
                onClick={(ev) => ev.stopPropagation()}
                onBlur={commitInlineEdit}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') {
                    ev.preventDefault();
                    ev.currentTarget.blur();
                  } else if (ev.key === 'Escape') {
                    ev.preventDefault();
                    cancelInlineEdit();
                  }
                }}
              />
            ) : (
              <span
                className="t-name"
                title={
                  t.recurrence
                    ? `${t.name} · repeats ${t.recurrence.freq}`
                    : t.name
                }
                onClick={() => onOpenTask(ws.id, t)}
              >
                {(t.recurrence || t.recurrenceParentId) && (
                  <span className="t-repeat" aria-hidden>
                    ↻{' '}
                  </span>
                )}
                {t.name}
              </span>
            )}
            <span className="chk-col">
              {tot ? (
                <Badge
                  size="xs"
                  className="chk-badge whitespace-nowrap"
                  color="gray"
                >
                  ✓{done}/{tot}
                </Badge>
              ) : null}
            </span>
            <span className="ownercol">
              {(() => {
                const people = resolveAssignees(t, data.members);
                const selectedIds = t.assignees?.length
                  ? t.assignees
                  : t.owner
                    ? [assigneeOptions.find((o) => o.name === t.owner)?.id ?? t.owner]
                    : [];
                const nameOf = (id: string) => assigneeOptions.find((o) => o.id === id)?.name ?? id;
                const toggleAssignee = (id: string) => {
                  const next = selectedIds.includes(id)
                    ? selectedIds.filter((x) => x !== id)
                    : [...selectedIds, id];
                  updateTask(ws.id, { ...t, assignees: next, owner: next.length ? nameOf(next[0]) : '' });
                };
                const trigger = !people.length ? (
                  <span className="hint">—</span>
                ) : (
                  <>
                    <span className="flex items-center">
                      {people.slice(0, 3).map((a, i) => (
                        <span
                          key={a.id}
                          style={{
                            marginLeft: i ? -6 : 0,
                            borderRadius: '50%',
                            outline: '2px solid var(--card, #fff)',
                          }}
                        >
                          <Avatar name={a.name} src={a.avatarUrl} />
                        </span>
                      ))}
                    </span>
                    <span>
                      {people.length === 1
                        ? (people[0].name?.split(' ')[0] ?? '')
                        : `${people.length} people`}
                    </span>
                  </>
                );
                if (!canEdit) return trigger;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          className="flex items-center gap-1 hover:opacity-75 transition-opacity"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          {trigger}
                        </button>
                      }
                    />
                    <DropdownMenuContent
                      align="start"
                      className="w-auto min-w-[13rem] max-h-72 overflow-y-auto p-1"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      {assigneeOptions.length === 0 ? (
                        <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
                          No people yet
                        </div>
                      ) : (
                        assigneeOptions.map((o) => (
                          <DropdownMenuCheckboxItem
                            key={o.id}
                            checked={selectedIds.includes(o.id)}
                            onCheckedChange={() => toggleAssignee(o.id)}
                            closeOnClick={false}
                          >
                            <Avatar name={o.name} src={o.avatarUrl || undefined} size={20} />
                            <span className="truncate">{o.name}</span>
                          </DropdownMenuCheckboxItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })()}
            </span>
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="row-menu"
                      title="Task actions"
                      aria-label="Task actions"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSelectedTaskId(t.id);
                      }}
                    >
                      <MoreHorizontal className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                  }
                />
                <DropdownMenuContent
                  align="end"
                  className="w-52"
                  onClick={(ev) => ev.stopPropagation()}
                >
                  <DropdownMenuItem onClick={() => onOpenTask(ws.id, t)}>
                    <Pencil className="w-4 h-4" />
                    Edit…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      const newId = duplicateTask(ws.id, t.id);
                      if (newId) setSelectedTaskId(newId);
                    }}
                  >
                    <Copy className="w-4 h-4" />
                    Duplicate
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      Ctrl/⌘D
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      startInlineAdd(lane.id, t.noDate ? undefined : t.start)
                    }
                  >
                    <PlusIcon className="w-4 h-4" />
                    Add task below
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      updateTask(
                        ws.id,
                        isTaskDone(t)
                          ? { ...t, pct: 0, statusId: undefined, boardBucket: null }
                          : { ...t, pct: 100 },
                        isTaskDone(t)
                          ? `Reopened "${t.name}"`
                          : `Marked "${t.name}" done`
                      )
                    }
                  >
                    {isTaskDone(t) ? (
                      <>
                        <RotateCcw className="w-4 h-4" />
                        Reopen
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Mark done
                      </>
                    )}
                  </DropdownMenuItem>
                  {ws.lanes.length > 1 && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <ArrowRightLeft className="w-4 h-4" />
                        Move to workstream
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                        {ws.lanes
                          .filter((l) => l.id !== lane.id)
                          .map((l) => (
                            <DropdownMenuItem
                              key={l.id}
                              onClick={() =>
                                updateTask(
                                  ws.id,
                                  { ...t, lane: l.id },
                                  `Moved "${t.name}" to ${l.label}`
                                )
                              }
                            >
                              <span
                                className="inline-block w-2 h-2 rounded-full"
                                style={{ background: l.color }}
                              />
                              {l.label}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  {!t.noDate && !t.recurrenceParentId && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Repeat className="w-4 h-4" />
                        Repeat
                        {t.recurrence && (
                          <span className="ml-auto text-[10px] text-muted-foreground capitalize">
                            {t.recurrence.freq}
                          </span>
                        )}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem
                          onClick={() => applyRecurrence(ws.id, t.id, null)}
                        >
                          Does not repeat
                          {!t.recurrence && (
                            <Check className="ml-auto w-3.5 h-3.5" />
                          )}
                        </DropdownMenuItem>
                        {RECUR_OPTIONS.map((o) => (
                          <DropdownMenuItem
                            key={o.freq}
                            onClick={() =>
                              applyRecurrence(ws.id, t.id, {
                                freq: o.freq,
                                count: t.recurrence?.count ?? 6,
                              })
                            }
                          >
                            {o.label}
                            {t.recurrence?.freq === o.freq && (
                              <Check className="ml-auto w-3.5 h-3.5" />
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-[color:var(--raspberry)] focus:text-[color:var(--raspberry)]"
                    onClick={() => deleteTask(ws.id, t.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );

        chartRows.push(
          <div
            key={`${taskRowId}-c`}
            id={`task-chart-row-${t.id}`}
            className={`gc-row${isHovered ? ' hovered' : ''}${taskDropCls}`}
            onDragOver={taskOnDragOver}
            onDragLeave={taskOnDragLeave}
            onDrop={taskOnDrop}
            onMouseEnter={() => setHoveredRowId(taskRowId)}
            onMouseLeave={() => setHoveredRowId(null)}
            onDoubleClick={(ev) => {
              if (!canEdit) return;
              if ((ev.target as HTMLElement).classList.contains('gc-row'))
                startInlineAdd(
                  lane.id,
                  fd(addDays(r0, Math.floor(ev.nativeEvent.offsetX / dw)))
                );
            }}
          >
            <div className="row-tint" />
            <GanttBar
              task={t}
              lane={lane}
              ws={ws}
              members={data.members}
              dw={dw}
              r0={r0}
              onOpenTask={() => onOpenTask(ws.id, t)}
              onUpdate={(updated, undoToast) => updateTask(ws.id, updated, undoToast)}
              onMove={(delta) => moveTaskWithDependents(ws.id, t.id, delta)}
              onToast={toast}
              status={barStatus}
              disabled={!canEdit}
              registerEl={registerBarEl}
              onLiveMove={onLiveMove}
              onLiveMoveEnd={onLiveMoveEnd}
            />
            <OffscreenNudge
              x1={x}
              x2={x + w}
              labelW={labelW}
              wrapRef={wrapRef}
            />
            {(t.milestones || [])
              .filter((m) => m.date)
              .map((m) => (
                <div
                  key={m.id}
                  className="ms"
                  style={{
                    left: daysBetween(r0, pd(m.date)) * dw + dw / 2 - 6,
                  }}
                  title={`◆ ${m.label}\n${m.date}`}
                />
              ))}
          </div>
        );
        rowOrd++;
      });
  });

  const todayColX =
    today >= r0 && today <= r1 ? daysBetween(r0, today) * dw : null;
  const bodyH = rowOrd * rowH;

  // Dependency connectors: for each visible task, draw an arrow from each of its
  // visible predecessors' bar-end to this task's bar-start. Only edges where
  // both endpoints are currently rendered are drawn.
  const depEdges: DepEdge[] = [];
  ws.tasks.forEach((t) => {
    const to = taskLayout.get(t.id);
    if (!to) return;
    (t.dependencies || []).forEach((depId) => {
      const from = taskLayout.get(depId);
      if (!from) return;
      depEdges.push({
        key: `${depId}->${t.id}`,
        fromId: depId,
        toId: t.id,
        x1: from.x + from.w,
        y1: from.row * rowH + rowH / 2,
        x2: to.x,
        y2: to.row * rowH + rowH / 2,
        // Predecessor ends after the successor starts → scheduling conflict.
        conflict: from.x + from.w > to.x,
      });
    });
  });
  // Expose the current edges to the imperative live-drag handler.
  depEdgesRef.current = depEdges;

  return (
    <div ref={wrapRef} className="gantt">
      <div className="gantt-topright"></div>
      <div className="g-body">
        <div className="g-sidebar" style={{ width: labelW, minWidth: labelW }}>
          <div className="g-sidebar-head" style={{ height: hdrH }}>
            <div className="hdr-right-group">
              <Button
                type="button"
                variant="outline"
                size="xs"
                title={allCollapsed ? 'Expand all' : 'Collapse all'}
                onClick={toggleAllLanes}
              >
                {allCollapsed ? (
                  <ChevronsUpDown size={12} strokeWidth={1.75} />
                ) : (
                  <ChevronsDownUp size={12} strokeWidth={1.75} />
                )}
              </Button>
            </div>
          </div>
          {sidebarRows}
          {canEdit && (
            <div className="gs-row gs-add-lane">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button type="button" className="add-lane-btn">
                      <PlusIcon className="w-4 h-4" />
                      Add workstream
                    </button>
                  }
                />
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuItem
                    onClick={() =>
                      addLane(ws.id, {
                        id: uuid(),
                        label: 'New workstream',
                        color: ws.color ?? '#C63663',
                      })
                    }
                  >
                    <PlusIcon className="w-4 h-4" />
                    Blank workstream
                  </DropdownMenuItem>

                  {ws.lanes.length > 0 && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        Duplicate existing…
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                        {ws.lanes.map((l) => (
                          <DropdownMenuItem
                            key={l.id}
                            onClick={() => duplicateLane(ws.id, l.id)}
                          >
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ background: l.color }}
                            />
                            {l.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}

                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>From template</DropdownMenuLabel>
                    {/* User-defined templates (saved via "Save as template" on a
                        workstream) come first, then the built-in starter presets. */}
                    {laneTemplates.map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        onClick={() => addLaneFromTemplate(ws.id, t.id)}
                        className="flex-col items-start gap-0.5"
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ background: t.color }}
                          />
                          {t.label}
                        </span>
                        <span className="text-[11px] text-muted-foreground pl-3.5">
                          {t.description}
                        </span>
                      </DropdownMenuItem>
                    ))}
                    {LANE_PRESETS.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() => addLaneFromPreset(ws.id, p.id)}
                        className="flex-col items-start gap-0.5"
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ background: p.color }}
                          />
                          {p.label}
                        </span>
                        <span className="text-[11px] text-muted-foreground pl-3.5">
                          {p.description}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        <div className="g-chart" style={{ width: W }}>
          <div className="g-chart-head" style={{ height: hdrH }}>
            <div
              style={{
                cursor: hdrDragging ? 'grabbing' : 'grab',
                userSelect: 'none',
              }}
              onPointerDown={onHdrPointerDown}
              onPointerMove={onHdrPointerMove}
              onPointerUp={onHdrPointerUp}
            >
              <div className="g-head-row">{mRow}</div>
              <div className="g-head-row">{wRow}</div>
            </div>
            {todayColX !== null && (
              <div className="today-badge" style={{ left: todayColX + dw / 2 }}>
                {today.getDate()}
              </div>
            )}
          </div>
          <div className="g-chart-body" style={{ height: bodyH }}>
            {monthBoundaries.slice(0, -1).map((mx, i) => (
              <div
                key={`ml-${i}`}
                className="month-line"
                style={{ left: mx }}
              />
            ))}
            {todayColX !== null && (
              <div
                className="today-col"
                style={{ left: todayColX, width: dw }}
              />
            )}
            {todayColX !== null && (
              <div
                className="today-line"
                style={{ left: todayColX + dw / 2 - 1 }}
              />
            )}
            {chartRows}
            {depEdges.length > 0 && (
              <svg
                className="dep-layer"
                width={W}
                height={bodyH}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  pointerEvents: 'none',
                  overflow: 'visible',
                }}
              >
                <defs>
                  <marker
                    id="dep-arrow"
                    viewBox="0 0 8 8"
                    refX="6"
                    refY="4"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M0,0 L8,4 L0,8 z" fill="var(--beetroot, #C63663)" />
                  </marker>
                  <marker
                    id="dep-arrow-conflict"
                    viewBox="0 0 8 8"
                    refX="6"
                    refY="4"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M0,0 L8,4 L0,8 z" fill="var(--raspberry, #F8485E)" />
                  </marker>
                </defs>
                {depEdges.map((e) => (
                  <path
                    key={e.key}
                    id={`dep-path-${e.key}`}
                    d={depPathD(e.x1, e.y1, e.x2, e.y2)}
                    fill="none"
                    stroke={
                      e.conflict
                        ? 'var(--raspberry, #F8485E)'
                        : 'var(--beetroot, #C63663)'
                    }
                    strokeWidth={e.conflict ? 2 : 1.5}
                    strokeOpacity={e.conflict ? 0.85 : 0.55}
                    strokeDasharray={e.conflict ? '4 3' : undefined}
                    markerEnd={
                      e.conflict
                        ? 'url(#dep-arrow-conflict)'
                        : 'url(#dep-arrow)'
                    }
                  >
                    {e.conflict && (
                      <title>
                        Scheduling conflict: this task starts before its
                        prerequisite finishes
                      </title>
                    )}
                  </path>
                ))}
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
