import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { RagStatus, Task, Workspace, WorkflowState, Member, ChecklistItem, TaskMilestone, TaskAttachment, TaskLink } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const capitalize = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

export const DAY = 86400000;

export const uuid = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2);

export const pd = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const fd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const mondayOf = (d: Date): Date => {
  const x = new Date(d);
  const w = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - w);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const daysBetween = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / DAY);

export const todayD = (): Date => {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
};

/** Compact relative timestamp for feeds: "just now", "5m", "3h", "2d", then a date. */
export const timeAgo = (iso: string): string => {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
  if (mins < 7 * 24 * 60) return `${Math.floor(mins / (24 * 60))}d`;
  return new Date(t).toLocaleDateString('en-NZ', { month: 'short', day: 'numeric' });
};

export const fmtShort = (s: string): string =>
  pd(s).toLocaleDateString('en-NZ');

export const isoWeek = (d: Date): string => {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return `${x.getUTCFullYear()}-W${String(Math.ceil(((x.getTime() - y0.getTime()) / DAY + 1) / 7)).padStart(2, '0')}`;
};

export const RAGS: RagStatus[] = ['none', 'green', 'amber', 'red'];

export const ragColor = (r: RagStatus): string =>
  (
    ({
      green: 'var(--pea)',
      amber: 'var(--carrot)',
      red: 'var(--raspberry)',
    }) as Record<string, string>
  )[r] ?? 'var(--cauliflower-dark)';

export const ragBadgeColor = (r: RagStatus): 'gray' | 'green' | 'amber' | 'red' =>
  r === 'green' || r === 'amber' || r === 'red' ? r : 'gray';

export const AV_COLORS = [
  '#C63663',
  '#93328E',
  '#FF7F32',
  '#6BA539',
  '#943152',
  '#E35223',
  '#4B7328',
  '#61215E',
  '#F8485E',
  '#D6A20B',
];

export const avColor = (n: string): string =>
  AV_COLORS[
    Array.from(String(n)).reduce((a, c) => a + c.charCodeAt(0), 0) %
      AV_COLORS.length
  ];


export const avgPct = (tasks: Task[]): number =>
  tasks.length
    ? Math.round(tasks.reduce((a, t) => a + (t.pct || 0), 0) / tasks.length)
    : 0;

export const statusOf = (t: Task): 'done' | 'inprog' | 'notstarted' =>
  (t.pct || 0) >= 100 ? 'done' : (t.pct || 0) > 0 ? 'inprog' : 'notstarted';

// Fixed status labels/colors, purely derived from progress — used where status
// is shown read-only (e.g. My Work, notifications) with no per-workspace
// customisation. Keyed by statusOf()'s return value.
export const STATUS_META: Record<'notstarted' | 'inprog' | 'done', { label: string; color: string }> = {
  notstarted: { label: 'Not Started', color: 'var(--cauliflower-dark)' },
  inprog:     { label: 'In Progress', color: 'var(--carrot)' },
  done:       { label: 'Done',        color: 'var(--pea)' },
};

// The three standard states, used when a workspace hasn't customised its own
// (Board columns). Their ids match statusOf() so old tasks (without statusId)
// fall through cleanly. Colors are literal hex (not the CSS vars STATUS_META
// uses) because these are editable WorkflowState records — the color picker
// needs a real parseable value, not a var() reference, to show a swatch.
export const DEFAULT_STATUSES: WorkflowState[] = [
  { id: 'notstarted', label: STATUS_META.notstarted.label, color: '#d4ccc9', order: 0, isDone: false },
  { id: 'inprog',     label: STATUS_META.inprog.label,     color: '#ff7f32', order: 1, isDone: false },
  { id: 'done',       label: STATUS_META.done.label,       color: '#6ba539', order: 2, isDone: true },
];

/** A workspace's ordered workflow states, falling back to the standard three. */
export const wsStatuses = (ws: Pick<Workspace, 'statuses'>): WorkflowState[] =>
  ws.statuses && ws.statuses.length
    ? [...ws.statuses].sort((a, b) => a.order - b.order)
    : DEFAULT_STATUSES;

/** The state id a task is in: explicit statusId, else derived from progress. */
export const taskStatusId = (t: Task): string => t.statusId ?? statusOf(t);

export interface ResolvedAssignee { id: string; name: string; avatarUrl: string }

/** Resolve a task's assignees to display info, falling back to the legacy owner name. */
export function resolveAssignees(t: Task, members: Member[]): ResolvedAssignee[] {
  const ids = t.assignees ?? [];
  if (ids.length) {
    return ids.map((id) => {
      const m = members.find((x) => x.id === id);
      return { id, name: m?.displayName ?? '—', avatarUrl: m?.avatarUrl ?? '' };
    });
  }
  return t.owner ? [{ id: t.owner, name: t.owner, avatarUrl: '' }] : [];
}

/** Case-insensitive toolbar search over a task's name, notes and assignee names. */
export function taskMatchesSearch(t: Task, query: string, members: Member[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (t.name.toLowerCase().includes(q)) return true;
  if ((t.notes || '').toLowerCase().includes(q)) return true;
  return resolveAssignees(t, members).some((a) => a.name.toLowerCase().includes(q));
}

/** Look up a member's avatar by display name (for legacy name-keyed views). */
export function avatarByName(members: Member[], name: string): string {
  return members.find((m) => m.displayName === name)?.avatarUrl ?? '';
}

/** Look up a member's avatar by profiles.id (for comment/activity authors). */
export function avatarById(members: Member[], id: string): string {
  return id ? (members.find((m) => m.id === id)?.avatarUrl ?? '') : '';
}

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'nodate';

/** Which due-date bucket a task falls in, relative to `today` (midnight-normalised). */
export function dueBucketOf(t: Task, today: Date): DueBucket {
  if (t.noDate) return 'nodate';
  const end = pd(t.end);
  if (end < today) return 'overdue';
  if (fd(end) === fd(today)) return 'today';
  if (end <= addDays(mondayOf(today), 6)) return 'week';
  return 'later';
}

/** Relative due-date label ("Due today", "Due in 5d", "3d overdue"), falling back to a short date beyond a month out. */
export function fmtDueRelative(t: Task, today: Date): string {
  if (t.noDate) return '—';
  const diff = daysBetween(today, pd(t.end));
  if (diff < 0) return `${-diff}d overdue`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff <= 1000) return `Due in ${diff}d`;
  return fmtShort(t.end);
}

/** Is a task assigned to this person — by profile id, or legacy owner/display name. */
export function taskAssignedTo(t: Task, members: Member[], meId: string | null, myName: string): boolean {
  return resolveAssignees(t, members).some(
    (a) => (!!meId && a.id === meId) || (!!myName && a.name === myName)
  );
}

/** Downscale an image file to fit within `max` px (JPEG); falls back to the original. */
export async function downscaleImage(file: File, max = 128): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

export const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] || c
  );

// ── Task sub-list diffs ─────────────────────────────────────────────────────
// Shared by the activity log (store/plannerStore.ts) and notifications
// (lib/notify.ts) so both stay in sync when diffing the same save.

export function diffChecklistMsgs(prev: ChecklistItem[] = [], next: ChecklistItem[] = []): string[] {
  const prevById = new Map(prev.map(c => [c.id, c]));
  const nextById = new Map(next.map(c => [c.id, c]));
  const msgs: string[] = [];
  for (const item of next) {
    const before = prevById.get(item.id);
    if (!before) { msgs.push(`added checklist item "${item.text}"`); continue; }
    if (before.done !== item.done) {
      msgs.push(item.done ? `checked off "${item.text}"` : `unchecked "${item.text}"`);
    }
    if (before.text !== item.text) {
      msgs.push(`renamed checklist item "${before.text}" to "${item.text}"`);
    }
  }
  for (const item of prev) {
    if (!nextById.has(item.id)) msgs.push(`removed checklist item "${item.text}"`);
  }
  return msgs;
}

export function diffMilestoneMsgs(prev: TaskMilestone[] = [], next: TaskMilestone[] = []): string[] {
  const prevById = new Map(prev.map(m => [m.id, m]));
  const nextById = new Map(next.map(m => [m.id, m]));
  const msgs: string[] = [];
  for (const item of next) {
    const before = prevById.get(item.id);
    if (!before) { msgs.push(`added milestone "${item.label}" (${item.date})`); continue; }
    if (before.label !== item.label) {
      msgs.push(`renamed milestone "${before.label}" to "${item.label}"`);
    }
    if (before.date !== item.date) {
      msgs.push(`moved milestone "${item.label}" to ${item.date}`);
    }
  }
  for (const item of prev) {
    if (!nextById.has(item.id)) msgs.push(`removed milestone "${item.label}"`);
  }
  return msgs;
}

export function diffAttachmentMsgs(prev: TaskAttachment[] = [], next: TaskAttachment[] = []): string[] {
  const prevIds = new Set(prev.map(a => a.id));
  const nextIds = new Set(next.map(a => a.id));
  const msgs: string[] = [];
  for (const item of next) {
    if (!prevIds.has(item.id)) msgs.push(`attached "${item.name}"`);
  }
  for (const item of prev) {
    if (!nextIds.has(item.id)) msgs.push(`removed attachment "${item.name}"`);
  }
  return msgs;
}

export function diffLinkMsgs(prev: TaskLink[] = [], next: TaskLink[] = []): string[] {
  const prevById = new Map(prev.map(l => [l.id, l]));
  const nextById = new Map(next.map(l => [l.id, l]));
  const msgs: string[] = [];
  for (const item of next) {
    const before = prevById.get(item.id);
    if (!before) { msgs.push(`added link "${item.label || item.url}"`); continue; }
    if (before.url !== item.url || before.label !== item.label) {
      msgs.push(`updated link "${item.label || item.url}"`);
    }
  }
  for (const item of prev) {
    if (!nextById.has(item.id)) msgs.push(`removed link "${item.label || item.url}"`);
  }
  return msgs;
}

// Given a task set and a task being moved by `deltaDays`, return the new
// {id,start,end} for that task and every task linked to it through
// dependencies. A dependency edge ("successor lists predecessor in
// `dependencies`") is walked in BOTH directions, so the whole connected
// dependency chain moves together and the gaps between linked tasks are
// preserved — dragging any task in the chain drags the rest, whether they are
// its predecessors or its successors. Cycles are handled by the visited set.
// No-date tasks are pinned to concrete dates (a 6-day span from today) so they
// visibly follow. Pure — used by the planner store and covered by tests.
// The set of task ids connected to `startId` through dependency edges, walked
// in BOTH directions (predecessors + successors), including `startId` itself.
// Cycles are handled by the visited set. Shared by the drop-time cascade and
// the live drag preview so both move exactly the same bars.
export function dependencyChainIds(tasks: Task[], startId: string): Set<string> {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const seen = new Set<string>();
  if (!byId.has(startId)) return seen;
  seen.add(startId);
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift()!;
    // Successors: tasks that list `cur` as a predecessor.
    for (const t of tasks) {
      if (seen.has(t.id)) continue;
      if ((t.dependencies ?? []).includes(cur)) {
        seen.add(t.id);
        queue.push(t.id);
      }
    }
    // Predecessors: the tasks `cur` itself depends on.
    for (const depId of byId.get(cur)?.dependencies ?? []) {
      if (!seen.has(depId) && byId.has(depId)) {
        seen.add(depId);
        queue.push(depId);
      }
    }
  }
  return seen;
}

export function cascadeTaskMove(
  tasks: Task[],
  movedId: string,
  deltaDays: number
): { id: string; start: string; end: string; noDate: false }[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  if (!byId.has(movedId) || !deltaDays) return [];
  const toShift = dependencyChainIds(tasks, movedId);
  const out: { id: string; start: string; end: string; noDate: false }[] = [];
  for (const id of toShift) {
    const t = byId.get(id);
    if (!t) continue;
    if (t.noDate) {
      const base = todayD();
      out.push({ id, start: fd(addDays(base, deltaDays)), end: fd(addDays(addDays(base, 6), deltaDays)), noDate: false });
    } else {
      out.push({ id, start: fd(addDays(pd(t.start), deltaDays)), end: fd(addDays(pd(t.end), deltaDays)), noDate: false });
    }
  }
  return out;
}

// Step a date forward by one recurrence interval. weekly=+7d, fortnightly=+14d,
// monthly=+1 calendar month (clamped to month length by the Date constructor).
export function stepRecurrence(d: Date, freq: 'weekly' | 'fortnightly' | 'monthly'): Date {
  if (freq === 'weekly') return addDays(d, 7);
  if (freq === 'fortnightly') return addDays(d, 14);
  // monthly: same day-of-month next month (JS clamps e.g. Jan 31 → Feb 28/29… via overflow, so guard)
  const day = d.getDate();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}

// Given a template task's start/end (ISO) and a rule, return the [start,end]
// pairs for every generated occurrence AFTER the template (count-1 of them).
// Each occurrence preserves the template's duration. Pure — covered by tests.
export function recurrenceOccurrences(
  start: string,
  end: string,
  freq: 'weekly' | 'fortnightly' | 'monthly',
  count: number
): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  const dur = daysBetween(pd(start), pd(end)); // span in days
  let s = pd(start);
  for (let i = 1; i < Math.max(1, count); i++) {
    s = stepRecurrence(s, freq);
    out.push({ start: fd(s), end: fd(addDays(s, dur)) });
  }
  return out;
}

// Recurrence frequency options — shared by the task editor's Repeat pill and
// the Gantt row-menu Repeat submenu so the labels stay in one place.
export const RECUR_OPTIONS: { freq: 'weekly' | 'fortnightly' | 'monthly'; label: string }[] = [
  { freq: 'weekly', label: 'Weekly' },
  { freq: 'fortnightly', label: 'Fortnightly' },
  { freq: 'monthly', label: 'Monthly' },
];
