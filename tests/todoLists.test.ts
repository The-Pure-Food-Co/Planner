import { describe, it, expect } from 'vitest'
import { rowToTodo, rowToTodoList } from '@/lib/supabase'
import type { Todo } from '@/lib/types'

describe('todo list mappers', () => {
  it('maps list_id onto listId', () => {
    const t = rowToTodo({ id: 'a', list_id: 'list1', text: 'Do it', sort_index: 2 })
    expect(t.listId).toBe('list1')
  })

  it('treats a missing list_id as unfiled rather than undefined', () => {
    // Rows written before the lists migration have no list_id. They must come
    // back as null so `(t.listId ?? null) === activeListId` matches the
    // "Unfiled" bucket instead of silently never matching anything.
    const t = rowToTodo({ id: 'a', text: 'Legacy item' })
    expect(t.listId).toBeNull()
  })

  it('maps a todo_lists row', () => {
    const l = rowToTodoList({ id: 'list1', name: 'FG Freezer', color: '#3B82F6', sort_index: 3 })
    expect(l).toEqual({ id: 'list1', name: 'FG Freezer', color: '#3B82F6', sortIndex: 3 })
  })

  it('defaults sort_index and colour when absent', () => {
    const l = rowToTodoList({ id: 'l', name: 'X' })
    expect(l.sortIndex).toBe(0)
    // Beetroot — the app's primary brand colour, matching the column default.
    expect(l.color).toBe('#C63663')
  })
})

// The panel shows exactly one list at a time. These cover the scoping rule
// every derived value in MyWork depends on.
describe('list scoping', () => {
  const todo = (id: string, listId: string | null, done = false): Todo => ({
    id, listId, text: id, done, sortIndex: 0,
    dueDate: null, important: false, completedAt: null,
  })
  const all = [
    todo('a', 'list1'),
    todo('b', 'list1', true),
    todo('c', 'list2'),
    todo('legacy', null),
  ]
  const inList = (listId: string | null) => all.filter(t => (t.listId ?? null) === listId)

  it('shows only the open list', () => {
    expect(inList('list1').map(t => t.id)).toEqual(['a', 'b'])
    expect(inList('list2').map(t => t.id)).toEqual(['c'])
  })

  it('keeps pre-migration items in their own bucket', () => {
    expect(inList(null).map(t => t.id)).toEqual(['legacy'])
  })

  it('counts completion within the open list only', () => {
    const items = inList('list1')
    expect(`${items.filter(t => t.done).length}/${items.length}`).toBe('1/2')
  })

  it('clearing completed leaves other lists untouched', () => {
    const activeListId = 'list1'
    const remaining = all.filter(t => !(t.done && (t.listId ?? null) === activeListId))
    expect(remaining.map(t => t.id)).toEqual(['a', 'c', 'legacy'])
  })

  it('merges a reorder back over the full set instead of replacing it', () => {
    // persistOrder reindexes only the open list; merging by id must preserve
    // every other list's rows.
    const reindexed = inList('list1').map((t, i) => ({ ...t, sortIndex: i + 10 }))
    const byId = new Map(reindexed.map(t => [t.id, t]))
    const merged = all.map(t => byId.get(t.id) ?? t)

    expect(merged.map(t => t.id)).toEqual(['a', 'b', 'c', 'legacy'])
    expect(merged.find(t => t.id === 'a')?.sortIndex).toBe(10)
    expect(merged.find(t => t.id === 'c')?.sortIndex).toBe(0)
  })
})
