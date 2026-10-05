import { describe, it, expect } from 'vitest'
import { recurrenceOccurrences, stepRecurrence, groupRecurrenceSeries, pickSeriesRepresentative, endFromLength, lengthFromRange } from '@/lib/utils'
import type { Task } from '@/lib/types'
import { pd, fd } from '@/lib/utils'

describe('stepRecurrence', () => {
  it('weekly adds 7 days', () => {
    expect(fd(stepRecurrence(pd('2026-07-01'), 'weekly'))).toBe('2026-07-08')
  })
  it('fortnightly adds 14 days', () => {
    expect(fd(stepRecurrence(pd('2026-07-01'), 'fortnightly'))).toBe('2026-07-15')
  })
  it('monthly keeps the day-of-month', () => {
    expect(fd(stepRecurrence(pd('2026-07-10'), 'monthly'))).toBe('2026-08-10')
  })
  it('monthly clamps to the last day of a shorter month', () => {
    // Jan 31 → Feb 28 (2026 is not a leap year)
    expect(fd(stepRecurrence(pd('2026-01-31'), 'monthly'))).toBe('2026-02-28')
  })
})

describe('recurrenceOccurrences', () => {
  it('generates count-1 occurrences, preserving duration', () => {
    // 4-day task (Mon–Thu), weekly, 3 total → 2 further occurrences
    const occ = recurrenceOccurrences('2026-07-06', '2026-07-09', 'weekly', 3)
    expect(occ).toEqual([
      { start: '2026-07-13', end: '2026-07-16' },
      { start: '2026-07-20', end: '2026-07-23' },
    ])
  })

  it('returns nothing when count is 1', () => {
    expect(recurrenceOccurrences('2026-07-01', '2026-07-02', 'weekly', 1)).toEqual([])
  })

  it('monthly steps by calendar month', () => {
    const occ = recurrenceOccurrences('2026-01-15', '2026-01-16', 'monthly', 3)
    expect(occ.map((o) => o.start)).toEqual(['2026-02-15', '2026-03-15'])
  })
})

describe('recurrence series grouping', () => {
  const mk = (id: string, start: string, parent?: string) =>
    ({ id, name: id, start, end: start, lane: 'l', recurrenceParentId: parent }) as unknown as Task
  const head = mk('h', '2026-07-01')
  const o1 = mk('o1', '2026-07-08', 'h')
  const o2 = mk('o2', '2026-07-15', 'h')
  const other = mk('x', '2026-07-02')
  const all = [head, o1, o2, other]

  it('collapses a series into one row owned by the template', () => {
    const g = groupRecurrenceSeries(all, all)
    expect(g.map((x) => x.head.id)).toEqual(['h', 'x'])
    expect(g[0].extras.map((t) => t.id)).toEqual(['o1', 'o2'])
  })

  it('keeps the template as the row owner when a filter hides it', () => {
    const g = groupRecurrenceSeries([o1, o2], all)
    expect(g).toHaveLength(1)
    expect(g[0].head.id).toBe('h')
    expect(g[0].extras.map((t) => t.id)).toEqual(['o1', 'o2'])
  })

  it('treats an orphaned occurrence as its own series', () => {
    const orphan = mk('o', '2026-07-08', 'gone')
    expect(groupRecurrenceSeries([orphan], [orphan]).map((x) => x.head.id)).toEqual(['o'])
  })

  it('represents a series by its earliest open occurrence, else the last', () => {
    const members = [o2, head, o1]
    expect(pickSeriesRepresentative(members, (t) => t.id === 'h').id).toBe('o1')
    expect(pickSeriesRepresentative(members, () => true).id).toBe('o2')
  })
})

describe('task length', () => {
  it('is inclusive of the start day', () => {
    expect(endFromLength('2026-10-06', 5, 'days')).toBe('2026-10-10')
    expect(endFromLength('2026-10-06', 1, 'weeks')).toBe('2026-10-12')
    expect(endFromLength('2026-10-06', 2, 'weeks')).toBe('2026-10-19')
  })
  it('months end the day before the same date next month', () => {
    expect(endFromLength('2026-10-06', 1, 'months')).toBe('2026-11-05')
    expect(endFromLength('2026-01-31', 1, 'months')).toBe('2026-02-27')
  })
  it('reads whole weeks as weeks, else days', () => {
    expect(lengthFromRange('2026-10-06', '2026-10-19')).toEqual({ n: 2, unit: 'weeks' })
    expect(lengthFromRange('2026-10-06', '2026-10-10')).toEqual({ n: 5, unit: 'days' })
  })
})
