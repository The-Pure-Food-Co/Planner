import { describe, it, expect } from 'vitest'
import { dueBucketOf, taskAssignedTo, resolveAssignees, wsStatuses, taskStatusId, DEFAULT_STATUSES, mondayOf, fd, pd } from '@/lib/utils'
import { makeTask, makeMember, makeWorkspace } from './fixtures'

// Wednesday 8 July 2026: its week runs Mon 6 Jul – Sun 12 Jul.
const WED = new Date(2026, 6, 8)

describe('dueBucketOf', () => {
  it('buckets by due date relative to today', () => {
    expect(dueBucketOf(makeTask({ end: '2026-07-07' }), WED)).toBe('overdue')
    expect(dueBucketOf(makeTask({ end: '2026-07-08' }), WED)).toBe('today')
    expect(dueBucketOf(makeTask({ end: '2026-07-10' }), WED)).toBe('week')
    expect(dueBucketOf(makeTask({ end: '2026-07-12' }), WED)).toBe('week') // Sunday, last day of this week
    expect(dueBucketOf(makeTask({ end: '2026-07-13' }), WED)).toBe('later')
  })

  it('puts undated tasks in nodate regardless of stored dates', () => {
    expect(dueBucketOf(makeTask({ end: '2026-07-01', noDate: true }), WED)).toBe('nodate')
  })
})

describe('taskAssignedTo / resolveAssignees', () => {
  const alice = makeMember({ id: 'u1', displayName: 'Alice' })
  const bob = makeMember({ id: 'u2', displayName: 'Bob' })

  it('matches by profile id when assignees are set', () => {
    const t = makeTask({ assignees: ['u1'] })
    expect(taskAssignedTo(t, [alice, bob], 'u1', 'Alice')).toBe(true)
    expect(taskAssignedTo(t, [alice, bob], 'u2', 'Bob')).toBe(false)
  })

  it('falls back to the legacy owner name when there are no assignees', () => {
    const t = makeTask({ assignees: [], owner: 'Bob' })
    expect(taskAssignedTo(t, [alice, bob], 'u2', 'Bob')).toBe(true)
    expect(taskAssignedTo(t, [alice, bob], 'u1', 'Alice')).toBe(false)
  })

  it('never matches on empty identity', () => {
    const t = makeTask({ assignees: [], owner: '' })
    expect(taskAssignedTo(t, [alice], null, '')).toBe(false)
  })

  it('resolves unknown assignee ids to a placeholder, keeping the id', () => {
    expect(resolveAssignees(makeTask({ assignees: ['ghost'] }), [alice])).toEqual([
      { id: 'ghost', name: '—', avatarUrl: '' },
    ])
  })
})

describe('workflow status helpers', () => {
  it('falls back to the three default statuses', () => {
    expect(wsStatuses(makeWorkspace())).toEqual(DEFAULT_STATUSES)
  })

  it('derives status from pct when statusId is unset', () => {
    expect(taskStatusId(makeTask({ pct: 0 }))).toBe('notstarted')
    expect(taskStatusId(makeTask({ pct: 50 }))).toBe('inprog')
    expect(taskStatusId(makeTask({ pct: 100 }))).toBe('done')
    expect(taskStatusId(makeTask({ pct: 100, statusId: 'custom' }))).toBe('custom')
  })
})

describe('date helpers', () => {
  it('mondayOf returns the Monday of the week, including for Sundays', () => {
    expect(fd(mondayOf(new Date(2026, 6, 8)))).toBe('2026-07-06')  // Wed
    expect(fd(mondayOf(new Date(2026, 6, 12)))).toBe('2026-07-06') // Sun
    expect(fd(mondayOf(new Date(2026, 6, 6)))).toBe('2026-07-06')  // Mon itself
  })

  it('pd/fd round-trip', () => {
    expect(fd(pd('2026-01-05'))).toBe('2026-01-05')
  })
})
