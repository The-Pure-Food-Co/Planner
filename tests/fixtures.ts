import type { Task, Workspace, Member } from '@/lib/types'

export function makeTask(partial: Partial<Task> = {}): Task {
  return {
    id: 't1',
    name: 'Test task',
    lane: 'lane1',
    owner: '',
    assignees: [],
    watchers: [],
    start: '2026-07-01',
    end: '2026-07-10',
    pct: 0,
    notes: '',
    sortIndex: 0,
    boardBucket: null,
    dependencies: [],
    checklist: [],
    milestones: [],
    comments: [],
    attachments: [],
    links: [],
    ...partial,
  }
}

export function makeWorkspace(partial: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws1',
    name: 'Test workspace',
    color: '#C63663',
    members: [],
    customBuckets: [],
    lanes: [],
    tasks: [],
    ...partial,
  }
}

export function makeMember(partial: Partial<Member> = {}): Member {
  return {
    id: 'u1',
    email: 'u1@thepurefoodco.com',
    displayName: 'User One',
    avatarUrl: '',
    isAppAdmin: false,
    isNzTeam: false,
    ...partial,
  }
}
