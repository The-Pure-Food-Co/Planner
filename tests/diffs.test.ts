import { describe, it, expect } from 'vitest'
import { diffChecklistMsgs, diffMilestoneMsgs, diffAttachmentMsgs, diffLinkMsgs } from '@/lib/utils'

describe('diffChecklistMsgs', () => {
  const item = (id: string, text: string, done = false) => ({ id, text, done })

  it('reports adds, checks, renames, and removals', () => {
    const prev = [item('a', 'Order stock'), item('b', 'Call supplier'), item('c', 'Old item')]
    const next = [item('a', 'Order stock', true), item('b', 'Call the supplier'), item('d', 'New item')]
    expect(diffChecklistMsgs(prev, next)).toEqual([
      'checked off "Order stock"',
      'renamed checklist item "Call supplier" to "Call the supplier"',
      'added checklist item "New item"',
      'removed checklist item "Old item"',
    ])
  })

  it('reports unchecking', () => {
    expect(diffChecklistMsgs([item('a', 'X', true)], [item('a', 'X', false)])).toEqual(['unchecked "X"'])
  })

  it('is empty when nothing changed', () => {
    const list = [item('a', 'Same')]
    expect(diffChecklistMsgs(list, list)).toEqual([])
    expect(diffChecklistMsgs(undefined, undefined)).toEqual([])
  })
})

describe('diffMilestoneMsgs', () => {
  const ms = (id: string, label: string, date: string) => ({ id, label, date })

  it('reports adds, renames, moves, and removals', () => {
    const prev = [ms('a', 'Kickoff', '2026-07-01'), ms('b', 'Review', '2026-07-15'), ms('c', 'Gone', '2026-08-01')]
    const next = [ms('a', 'Project kickoff', '2026-07-01'), ms('b', 'Review', '2026-07-20'), ms('d', 'Launch', '2026-09-01')]
    expect(diffMilestoneMsgs(prev, next)).toEqual([
      'renamed milestone "Kickoff" to "Project kickoff"',
      'moved milestone "Review" to 2026-07-20',
      'added milestone "Launch" (2026-09-01)',
      'removed milestone "Gone"',
    ])
  })
})

describe('diffAttachmentMsgs', () => {
  it('reports attach and remove by id', () => {
    const prev = [{ id: 'a', name: 'spec.pdf', url: 'u' }]
    const next = [{ id: 'b', name: 'photo.png', url: 'u' }]
    expect(diffAttachmentMsgs(prev, next)).toEqual([
      'attached "photo.png"',
      'removed attachment "spec.pdf"',
    ])
  })
})

describe('diffLinkMsgs', () => {
  it('reports adds, updates, and removals, falling back to url when unlabelled', () => {
    const prev = [
      { id: 'a', label: 'Docs', url: 'https://old' },
      { id: 'b', label: '', url: 'https://gone' },
    ]
    const next = [
      { id: 'a', label: 'Docs', url: 'https://new' },
      { id: 'c', label: 'Board', url: 'https://board' },
    ]
    expect(diffLinkMsgs(prev, next)).toEqual([
      'updated link "Docs"',
      'added link "Board"',
      'removed link "https://gone"',
    ])
  })
})
