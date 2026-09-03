import { describe, it, expect } from 'vitest'
import { taskToDb, rowToTask, rowToMember } from '@/lib/supabase'
import { makeTask } from './fixtures'

describe('task mapper round-trip', () => {
  it('taskToDb → rowToTask preserves every field', () => {
    const task = makeTask({
      id: 't9',
      name: 'Round trip',
      lane: 'lane7',
      owner: 'Alice',
      assignees: ['u1', 'u2'],
      reporterId: 'u1',
      watchers: ['u3'],
      start: '2026-07-01',
      end: '2026-07-20',
      noDate: false,
      pct: 40,
      notes: 'some notes',
      sortIndex: 3,
      boardBucket: 'bucket-x',
      statusId: 'inprog',
      icon: 'carrot',
      iconColor: '#ffffff',
      estimate: 5,
      checklist: [{ id: 'c1', text: 'step', done: true }],
      milestones: [{ id: 'm1', label: 'mid', date: '2026-07-10' }],
      comments: [{ id: 'cm1', authorId: 'u1', authorName: 'Alice', text: 'hi', createdAt: '2026-07-08T00:00:00Z' }],
      attachments: [{ id: 'a1', name: 'f.pdf', url: 'https://x', path: 'p', size: 1, type: 'application/pdf' }],
      links: [{ id: 'lk1', label: 'Docs', url: 'https://docs' }],
    })
    const row = taskToDb('ws1', task)
    const back = rowToTask(row)
    const { workspaceId, ...roundTripped } = back
    expect(workspaceId).toBe('ws1')
    expect(roundTripped).toEqual(task)
  })

  it('a task lacking a lane round-trips through the nullable lane_id column', () => {
    const row = taskToDb('ws1', makeTask({ lane: '' }))
    expect(row.lane_id).toBeNull()
    expect(rowToTask(row).lane).toBe('')
  })
})

describe('rowToMember', () => {
  it('maps profile rows including notification prefs', () => {
    const m = rowToMember({
      id: 'u1',
      email: 'a@thepurefoodco.com',
      display_name: 'Alice',
      avatar_url: 'https://pic',
      is_app_admin: true,
      notification_prefs: { mutedTypes: ['due'], mutedWorkspaces: ['ws1'] },
    })
    expect(m).toEqual({
      id: 'u1',
      email: 'a@thepurefoodco.com',
      displayName: 'Alice',
      avatarUrl: 'https://pic',
      isAppAdmin: true,
      isNzTeam: false,
      notificationPrefs: { mutedTypes: ['due'], mutedWorkspaces: ['ws1'] },
    })
  })

  it('defaults display name to email and prefs to undefined', () => {
    const m = rowToMember({ id: 'u2', email: 'b@thepurefoodco.com' })
    expect(m.displayName).toBe('b@thepurefoodco.com')
    expect(m.notificationPrefs).toBeUndefined()
    expect(m.isAppAdmin).toBe(false)
  })
})
