import { describe, it, expect } from 'vitest'
import { recurrenceOccurrences, stepRecurrence } from '@/lib/utils'
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
