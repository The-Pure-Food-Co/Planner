import {
  ArrowRightCircleIcon,
  ArrowsRightLeftIcon,
  ArrowTrendingUpIcon,
  BookmarkIcon,
  CalendarDaysIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  LinkIcon,
  PaperClipIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UserPlusIcon,
} from '@heroicons/react/24/solid'
import type { ComponentType, SVGProps } from 'react'
import type { ActivityLogEntry } from './types'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

// One icon per activity field — lets an activity feed read at a glance
// without opening each entry. Keyed by ActivityLogEntry.field, falling back
// to the action ('created'/'deleted' entries have no field).
export const ACTIVITY_ICONS: Record<string, IconComponent> = {
  created: PlusIcon,
  deleted: TrashIcon,
  name: PencilIcon,
  lane: ArrowsRightLeftIcon,
  status: ArrowRightCircleIcon,
  dates: CalendarDaysIcon,
  pct: ArrowTrendingUpIcon,
  assignees: UserPlusIcon,
  estimate: ClockIcon,
  checklist: ClipboardDocumentCheckIcon,
  milestones: BookmarkIcon,
  attachments: PaperClipIcon,
  links: LinkIcon,
}
export const activityIcon = (e: Pick<ActivityLogEntry, 'field' | 'action'>): IconComponent =>
  ACTIVITY_ICONS[e.field ?? e.action] ?? PencilIcon

// One color per action/field, chosen to suit what it represents (green =
// created, red = deleted, etc.) — no badge background, this tints the
// heroicon itself via currentColor.
export const ACTIVITY_COLORS: Record<string, string> = {
  created: '#16A34A',
  deleted: '#DC2626',
  name: '#2563EB',
  lane: '#EA580C',
  status: '#D97706',
  dates: '#7C3AED',
  pct: '#0D9488',
  assignees: '#4F46E5',
  estimate: '#CA8A04',
  checklist: '#059669',
  milestones: '#C026D3',
  attachments: '#475569',
  links: '#0891B2',
}
export const activityColor = (e: Pick<ActivityLogEntry, 'field' | 'action'>): string =>
  ACTIVITY_COLORS[e.field ?? e.action] ?? '#57534E'
