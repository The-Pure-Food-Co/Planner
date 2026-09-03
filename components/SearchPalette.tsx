'use client'
import { startTransition, useMemo } from 'react'
import { usePlannerStore } from '@/store/plannerStore'
import type { Task } from '@/lib/types'
import { fmtShort } from '@/lib/utils'
import { CommandPalette, CommandPaletteInput, useCommandPaletteContext } from '@astryxdesign/core/CommandPalette'
import { Text } from '@astryxdesign/core/Text'
import { createStaticSource, type SearchableItem } from '@astryxdesign/core/Typeahead'
import { CheckSquare, Diamond, Building2, type LucideIcon } from 'lucide-react'

type ItemType = 'task' | 'ms' | 'ws'

type PaletteItem = SearchableItem<{
  group: string
  sub: string
  owner?: string
  type: ItemType
}>

const TYPE_META: Record<ItemType, { Icon: LucideIcon; c: string; g: string }> = {
  task: { Icon: CheckSquare, c: 'var(--beetroot)', g: 'Tasks' },
  ms: { Icon: Diamond, c: 'var(--carrot)', g: 'Milestones' },
  ws: { Icon: Building2, c: 'var(--cabbage)', g: 'Teams & Projects' },
}

// Groups render in this order (auto-grouping follows first appearance in the
// item list, so items are pushed group-by-group).
const TYPE_ORDER: ItemType[] = ['task', 'ms', 'ws']

interface Props {
  onClose: () => void
}

/**
 * Controlled input that routes search updates through startTransition.
 * Upstream astryx calls its useOptimistic setter straight from the input's
 * onChange, which React 19 flags ("optimistic state update occurred outside
 * a transition"); wrapping ctx.setSearch here keeps it inside a transition.
 */
function PaletteInput() {
  const ctx = useCommandPaletteContext()
  return (
    <CommandPaletteInput
      placeholder="Search tasks, teams, milestones…"
      onValueChange={ctx ? (v) => startTransition(() => ctx.setSearch(v)) : undefined}
    />
  )
}

export default function SearchPalette({ onClose }: Props) {
  const { data, openWs, jumpToTask } = usePlannerStore()

  const { items, actions } = useMemo(() => {
    const raw: Array<{ type: ItemType; label: string; sub: string; owner?: string; act: () => void }> = []
    data.workspaces.forEach((w) => {
      raw.push({ type: 'ws', label: w.name, sub: 'workspace', act: () => openWs(w.id) })
      w.tasks.forEach((t: Task) => {
        const lane = w.lanes.find((l) => l.id === t.lane)
        raw.push({ type: 'task', label: t.name, sub: `${w.name} · ${lane?.label ?? '—'}`, owner: t.owner, act: () => jumpToTask(w.id, t.id) })
        ;(t.milestones || []).forEach((ms) =>
          raw.push({ type: 'ms', label: ms.label, sub: `${fmtShort(ms.date)} · ${w.name}`, act: () => jumpToTask(w.id, t.id) })
        )
      })
    })
    // People/KPIs primary tabs are hidden for now, so they're left out of search.

    const items: PaletteItem[] = []
    const actions = new Map<string, () => void>()
    TYPE_ORDER.forEach((type) => {
      raw.filter((r) => r.type === type).forEach((r, i) => {
        const id = `${type}-${i}`
        items.push({ id, label: r.label, auxiliaryData: { group: TYPE_META[type].g, sub: r.sub, owner: r.owner, type } })
        actions.set(id, r.act)
      })
    })
    return { items, actions }
  }, [data, openWs, jumpToTask])

  const source = useMemo(
    () =>
      createStaticSource(items, {
        keywords: (it) => [it.auxiliaryData?.sub ?? '', it.auxiliaryData?.owner ?? ''],
      }),
    [items]
  )

  return (
    <div data-astryx-theme="neutral">
      <CommandPalette
        isOpen
        onOpenChange={(open) => { if (!open) onClose() }}
        searchSource={source}
        label="Search"
        input={<PaletteInput />}
        emptySearchText="No matches."
        onValueChange={(id) => { actions.get(id)?.() }}
        renderItem={(item: PaletteItem) => {
          const meta = TYPE_META[item.auxiliaryData!.type]
          return (
            <>
              <span
                className="inline-flex size-5 shrink-0 items-center justify-center rounded text-white"
                style={{ background: meta.c }}
              >
                <meta.Icon size={12} strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <Text color="secondary" size="2xs">
                {item.auxiliaryData!.sub}
              </Text>
            </>
          )
        }}
      />
    </div>
  )
}
