import { describe, it, expect } from 'vitest'
import { buildLaneCopies } from '@/lib/utils'
import { makeTask } from './fixtures'

// Sequential ids so assertions can name the copies directly.
const seqIds = () => {
  let n = 0
  return () => `copy${++n}`
}

describe('buildLaneCopies', () => {
  it('clones into the target lane with fresh ids, leaving sources untouched', () => {
    const src = [makeTask({ id: 'a', lane: 'lane1', name: 'Design' })]
    const [copy] = buildLaneCopies(src, 'lane2', 0, seqIds())

    expect(copy.id).toBe('copy1')
    expect(copy.lane).toBe('lane2')
    // Names are kept as-is: "(copy)" disambiguates same-lane siblings, and
    // these land in a different workstream.
    expect(copy.name).toBe('Design')
    expect(src[0]).toMatchObject({ id: 'a', lane: 'lane1' })
  })

  it('remaps dependencies that point within the copied set', () => {
    const src = [
      makeTask({ id: 'a', lane: 'lane1', sortIndex: 0 }),
      makeTask({ id: 'b', lane: 'lane1', sortIndex: 1, dependencies: ['a'] }),
    ]
    const copies = buildLaneCopies(src, 'lane2', 0, seqIds())

    // b's copy must depend on a's copy, not on the original a.
    expect(copies[1].dependencies).toEqual([copies[0].id])
    expect(copies[1].dependencies).not.toContain('a')
  })

  it('drops dependencies on tasks outside the copied set', () => {
    // 'outsider' is not being copied, so the copy must not point back at it —
    // that would leave a cross-lane dependency on the source workstream.
    const src = [makeTask({ id: 'b', lane: 'lane1', dependencies: ['outsider'] })]
    const [copy] = buildLaneCopies(src, 'lane2', 0, seqIds())

    expect(copy.dependencies).toEqual([])
  })

  it('appends after existing tasks in the target lane, in source order', () => {
    const src = [
      makeTask({ id: 'b', lane: 'lane1', sortIndex: 5 }),
      makeTask({ id: 'a', lane: 'lane1', sortIndex: 2 }),
    ]
    const copies = buildLaneCopies(src, 'lane2', 3, seqIds())

    // Sorted by source sortIndex, then indexed after the 3 already there.
    expect(copies.map((c) => c.sortIndex)).toEqual([3, 4])
    expect(copies[0].name).toBe(src[1].name)
  })

  it('resets per-task state that belongs to the original', () => {
    const src = [
      makeTask({
        id: 'a',
        lane: 'lane1',
        boardBucket: 'bucket-x',
        recurrence: { freq: 'weekly', count: 4 },
        recurrenceParentId: 'parent1',
        comments: [
          { id: 'c1', authorId: 'u1', authorName: 'Alice', text: 'hi', createdAt: '2026-01-01T00:00:00Z' },
        ],
      }),
    ]
    const [copy] = buildLaneCopies(src, 'lane2', 0, seqIds(), 'me')

    expect(copy.comments).toEqual([])
    expect(copy.reporterId).toBe('me')
    expect(copy.boardBucket).toBeNull()
    // Occurrences aren't copied, so the copy must claim neither role.
    expect(copy.recurrence).toBeUndefined()
    expect(copy.recurrenceParentId).toBeUndefined()
  })

  it('deep-copies nested fields so edits do not leak back to the source', () => {
    const src = [makeTask({ id: 'a', lane: 'lane1', checklist: [{ id: 'c1', text: 'step', done: false }] })]
    const [copy] = buildLaneCopies(src, 'lane2', 0, seqIds())

    copy.checklist[0].done = true
    expect(src[0].checklist[0].done).toBe(false)
  })

  it('returns nothing for an empty selection', () => {
    expect(buildLaneCopies([], 'lane2', 0, seqIds())).toEqual([])
  })
})
