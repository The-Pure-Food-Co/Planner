import { describe, it, expect } from 'vitest'
import { cascadeTaskMove } from '@/lib/utils'
import { makeTask } from './fixtures'

describe('cascadeTaskMove', () => {
  it('shifts the moved task and every transitive dependent by the same offset', () => {
    // a → b → c  (c depends on b, b depends on a)
    const a = makeTask({ id: 'a', start: '2026-07-01', end: '2026-07-05' })
    const b = makeTask({ id: 'b', start: '2026-07-06', end: '2026-07-10', dependencies: ['a'] })
    const c = makeTask({ id: 'c', start: '2026-07-11', end: '2026-07-15', dependencies: ['b'] })
    const moves = cascadeTaskMove([a, b, c], 'a', 3)
    const byId = Object.fromEntries(moves.map(m => [m.id, m]))
    expect(byId['a']).toMatchObject({ start: '2026-07-04', end: '2026-07-08' })
    expect(byId['b']).toMatchObject({ start: '2026-07-09', end: '2026-07-13' })
    expect(byId['c']).toMatchObject({ start: '2026-07-14', end: '2026-07-18' })
  })

  it('moves the whole chain when a middle/successor task is dragged (bidirectional)', () => {
    // a → b → c; dragging c should pull b and a along too.
    const a = makeTask({ id: 'a', start: '2026-07-01', end: '2026-07-05' })
    const b = makeTask({ id: 'b', start: '2026-07-06', end: '2026-07-10', dependencies: ['a'] })
    const c = makeTask({ id: 'c', start: '2026-07-11', end: '2026-07-15', dependencies: ['b'] })
    const moves = cascadeTaskMove([a, b, c], 'c', 2)
    const byId = Object.fromEntries(moves.map(m => [m.id, m]))
    expect(byId['a']).toMatchObject({ start: '2026-07-03', end: '2026-07-07' })
    expect(byId['b']).toMatchObject({ start: '2026-07-08', end: '2026-07-12' })
    expect(byId['c']).toMatchObject({ start: '2026-07-13', end: '2026-07-17' })
  })

  it('moves all predecessors when a task depends on multiple tasks', () => {
    // c depends on both a and b; dragging c moves a and b as well.
    const a = makeTask({ id: 'a', start: '2026-07-01', end: '2026-07-03' })
    const b = makeTask({ id: 'b', start: '2026-07-04', end: '2026-07-06' })
    const c = makeTask({ id: 'c', start: '2026-07-07', end: '2026-07-09', dependencies: ['a', 'b'] })
    const moves = cascadeTaskMove([a, b, c], 'c', 5)
    expect(moves.map(m => m.id).sort()).toEqual(['a', 'b', 'c'])
    const byId = Object.fromEntries(moves.map(m => [m.id, m]))
    expect(byId['a']).toMatchObject({ start: '2026-07-06' })
    expect(byId['b']).toMatchObject({ start: '2026-07-09' })
  })

  it('does not move independent tasks', () => {
    const a = makeTask({ id: 'a', start: '2026-07-01', end: '2026-07-05' })
    const other = makeTask({ id: 'x', start: '2026-07-01', end: '2026-07-05' })
    const moves = cascadeTaskMove([a, other], 'a', 5)
    expect(moves.map(m => m.id)).toEqual(['a'])
  })

  it('moves backwards on a negative offset', () => {
    const a = makeTask({ id: 'a', start: '2026-07-10', end: '2026-07-12' })
    const b = makeTask({ id: 'b', start: '2026-07-13', end: '2026-07-15', dependencies: ['a'] })
    const moves = cascadeTaskMove([a, b], 'a', -4)
    const byId = Object.fromEntries(moves.map(m => [m.id, m]))
    expect(byId['a']).toMatchObject({ start: '2026-07-06', end: '2026-07-08' })
    expect(byId['b']).toMatchObject({ start: '2026-07-09', end: '2026-07-11' })
  })

  it('terminates on a dependency cycle without looping forever', () => {
    // a ↔ b mutually depend (degenerate cycle); both should shift exactly once.
    const a = makeTask({ id: 'a', start: '2026-07-01', end: '2026-07-02', dependencies: ['b'] })
    const b = makeTask({ id: 'b', start: '2026-07-03', end: '2026-07-04', dependencies: ['a'] })
    const moves = cascadeTaskMove([a, b], 'a', 2)
    expect(moves.map(m => m.id).sort()).toEqual(['a', 'b'])
  })

  it('returns nothing for a zero offset', () => {
    const a = makeTask({ id: 'a' })
    expect(cascadeTaskMove([a], 'a', 0)).toEqual([])
  })

  it('pins a no-date dependent to concrete dates so it follows', () => {
    const a = makeTask({ id: 'a', start: '2026-07-01', end: '2026-07-05' })
    const b = makeTask({ id: 'b', noDate: true, dependencies: ['a'] })
    const moves = cascadeTaskMove([a, b], 'a', 2)
    const b2 = moves.find(m => m.id === 'b')!
    expect(b2.noDate).toBe(false)
    expect(b2.start).toBeTruthy()
    expect(b2.end).toBeTruthy()
  })
})
