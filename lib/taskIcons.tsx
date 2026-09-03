'use client';
import * as Phosphor from '@phosphor-icons/react';
import type { Icon, IconWeight } from '@phosphor-icons/react';
import type { Task } from './types';

// Brand palette offered in the picker AND used as the per-task fallback colour,
// so an icon-less task gets an actual (varied) colour rather than a flat grey.
export const ICON_COLOR_PALETTE = [
  'var(--beetroot)',
  'var(--cabbage)',
  'var(--raspberry)',
  'var(--carrot)',
  'var(--pea)',
  'var(--pea-dark)',
  'var(--beetroot-dark)',
];

// The full Phosphor set, resolved from the namespace export at module load so the
// picker can offer everything without us enumerating ~1500 names by hand. We drop
// the non-glyph exports (base component, context, SSR namespace).
const NON_ICON_EXPORTS = new Set(['IconBase', 'IconContext', 'SSR']);

export const ALL_ICONS: { id: string; Comp: Icon }[] = Object.entries(
  Phosphor as Record<string, unknown>
)
  .filter(
    ([name, v]) =>
      /^[A-Z]/.test(name) &&
      !NON_ICON_EXPORTS.has(name) &&
      v != null &&
      (typeof v === 'object' || typeof v === 'function')
  )
  .map(([id, Comp]) => ({ id, Comp: Comp as Icon }))
  .sort((a, b) => a.id.localeCompare(b.id));

export const TASK_ICON_MAP: Record<string, Icon> = Object.fromEntries(
  ALL_ICONS.map((i) => [i.id, i.Comp])
);

// A hand-picked, work-relevant subset used ONLY as the fallback pool for tasks
// with no chosen icon — so pre-existing tasks get a recognisable glyph (not some
// obscure one) and keep it stably across reloads.
const FALLBACK_POOL = [
  'Rocket', 'Target', 'Flag', 'Lightning', 'Star', 'ChartBar', 'ChartLineUp',
  'ClipboardText', 'FileText', 'CalendarBlank', 'Megaphone', 'ChatCircle',
  'Handshake', 'ShoppingCart', 'Truck', 'Package', 'Cube', 'Flask', 'Bug',
  'Code', 'Wrench', 'Gear', 'PuzzlePiece', 'Lightbulb', 'Palette', 'PaintBrush',
  'Leaf', 'Coffee', 'Fire', 'Heart', 'Trophy',
].filter((id) => TASK_ICON_MAP[id]);

// Small, stable string hash (djb2-ish) so the fallback pick is deterministic per
// task id — no Math.random (which would flicker / mismatch on hydration).
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** The task's chosen icon id if set & known, else a deterministic fallback. */
export function resolveTaskIconId(task: Pick<Task, 'id' | 'icon'>): string {
  if (task.icon && TASK_ICON_MAP[task.icon]) return task.icon;
  return FALLBACK_POOL[hashStr(task.id) % FALLBACK_POOL.length];
}

/** The task's chosen colour if set, else a deterministic (varied) brand colour.
 *  Salted hash so colour varies independently of the fallback glyph. */
export function resolveTaskIconColor(
  task: Pick<Task, 'id' | 'iconColor'>
): string {
  if (task.iconColor) return task.iconColor;
  return ICON_COLOR_PALETTE[hashStr('c:' + task.id) % ICON_COLOR_PALETTE.length];
}

interface TaskIconProps {
  task?: Pick<Task, 'id' | 'icon'>;
  iconId?: string;
  size?: number;
  color?: string;
  weight?: IconWeight;
}

/** Renders a task's Phosphor glyph (solid by default). Pass `task` to use its
 *  chosen/fallback icon, or `iconId` to force a specific one (e.g. picker cells). */
export function TaskIcon({
  task,
  iconId,
  size = 15,
  color = 'currentColor',
  weight = 'fill',
}: TaskIconProps) {
  const id = iconId ?? (task ? resolveTaskIconId(task) : FALLBACK_POOL[0]);
  const Comp = TASK_ICON_MAP[id];
  if (!Comp) return null;
  return <Comp size={size} color={color} weight={weight} />;
}
