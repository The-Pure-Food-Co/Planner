import { describe, it, expect } from 'vitest'
import { buildTaskNotifications } from '@/lib/notify'
import { makeTask, makeWorkspace, makeMember } from './fixtures'
import type { Member } from '@/lib/types'

const ws = makeWorkspace({ id: 'ws1' })
const alice = makeMember({ id: 'u1', displayName: 'Alice' })
const bob = makeMember({ id: 'u2', displayName: 'Bob' })
const cara = makeMember({ id: 'u3', displayName: 'Cara' })
const members: Member[] = [alice, bob, cara]

const notify = (prev: Parameters<typeof makeTask>[0], next: Parameters<typeof makeTask>[0], team: Member[] = members) =>
  buildTaskNotifications(ws, team, makeTask(prev), makeTask(next), 'u1', 'Alice')

describe('buildTaskNotifications', () => {
  it('notifies newly assigned people', () => {
    const out = notify({ assignees: [] }, { assignees: ['u2'] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ recipientId: 'u2', type: 'assigned', workspaceId: 'ws1' })
  })

  it('never notifies the actor about their own change', () => {
    expect(notify({ assignees: [] }, { assignees: ['u1'] })).toEqual([])
  })

  it('ignores recipients who are not on the roster', () => {
    expect(notify({ assignees: [] }, { assignees: ['ghost'] })).toEqual([])
  })

  it('collapses to the most specific event per recipient (mention beats comment)', () => {
    const comment = { id: 'c1', authorId: 'u1', authorName: 'Alice', text: 'ping @Bob please review', createdAt: '2026-07-08T00:00:00Z' }
    const out = notify(
      { assignees: ['u2'], comments: [] },
      { assignees: ['u2'], comments: [comment] },
    )
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('mention')
    expect(out[0].recipientId).toBe('u2')
  })

  it('notifies involved people on a status change', () => {
    const out = notify({ assignees: ['u2'], pct: 0 }, { assignees: ['u2'], pct: 50 })
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('status')
  })

  it('respects muted types', () => {
    const muted = makeMember({ id: 'u3', displayName: 'Cara', notificationPrefs: { mutedTypes: ['assigned'] } })
    const out = notify({ assignees: [] }, { assignees: ['u3'] }, [alice, bob, muted])
    expect(out).toEqual([])
  })

  it('respects muted workspaces, even for mentions', () => {
    const muted = makeMember({ id: 'u3', displayName: 'Cara', notificationPrefs: { mutedWorkspaces: ['ws1'] } })
    const out = notify(
      { notes: '' },
      { notes: 'cc @Cara' },
      [alice, bob, muted],
    )
    expect(out).toEqual([])
  })

  it('still delivers unmuted types to a partially muted recipient', () => {
    const muted = makeMember({ id: 'u3', displayName: 'Cara', notificationPrefs: { mutedTypes: ['comment', 'status'] } })
    const out = notify({ assignees: [] }, { assignees: ['u3'] }, [alice, bob, muted])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('assigned')
  })

  it('summarises checklist changes as a single update per recipient', () => {
    const out = notify(
      { assignees: ['u2'], checklist: [] },
      { assignees: ['u2'], checklist: [{ id: 'a', text: 'New step', done: false }] },
    )
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('update')
    expect(out[0].message).toContain('added checklist item "New step"')
  })
})
