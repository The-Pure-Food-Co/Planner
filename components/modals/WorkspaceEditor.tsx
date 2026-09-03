'use client'
import { useMemo, useState } from 'react'
import { Settings, Save, Trash2, Plus, X, Shield, User, Eye, Ban, SlidersHorizontal, ListChecks, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Pagination } from '@astryxdesign/core/Pagination'
import { Badge } from '@astryxdesign/core/Badge'
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList'
import { usePlannerStore } from '@/store/plannerStore'
import { useCanAdmin, isNzTeamName, filterNzTeamMembers } from '@/lib/permissions'
import { uuid, wsStatuses, avatarByName } from '@/lib/utils'
import type { Workspace, Role, WorkflowState } from '@/lib/types'
import Avatar from '@/components/Avatar'
import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { ColorPickerPopover } from '@/components/ui/color-picker'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { WORKSPACE_ICONS, getWorkspaceIcon } from '@/lib/workspace-icons'

interface Props {
  ws: Workspace
  onClose: () => void
}

type TabId = 'general' | 'workflow' | 'people'

// Access levels shown in the per-member role picker, most → least privileged.
const ROLE_OPTIONS: { value: Role | 'none'; label: string; Icon: LucideIcon }[] = [
  { value: 'admin', label: 'Admin', Icon: Shield },
  { value: 'member', label: 'Member', Icon: User },
  { value: 'viewer', label: 'Viewer', Icon: Eye },
  { value: 'none', label: 'No access', Icon: Ban },
]
const ROLE_BADGE_VARIANT: Record<Role | 'none', 'purple' | 'blue' | 'teal' | 'neutral'> = {
  admin: 'purple',
  member: 'blue',
  viewer: 'teal',
  none: 'neutral',
}

const SECTION_LABEL = 'flex flex-col gap-[3px] text-xs font-medium text-muted-foreground w-full mb-1'
const PEOPLE_PAGE_SIZE = 6
const ADMIN_PAGE_SIZE = 8

export default function WorkspaceEditor({ ws: initial, onClose }: Props) {
  const { updateWorkspace, deleteWorkspace, data, setMembership, removeMembership, setAppAdmin } = usePlannerStore()
  const isAdmin = useCanAdmin(initial.id)
  const [tab, setTab] = useState<TabId>('general')
  const [ws, setWs] = useState<Workspace>({ ...initial, members: [...initial.members], statuses: wsStatuses(initial) })

  // People-tab changes are staged like everything else, so Save/Cancel applies
  // to the whole dialog uniformly (roles used to write through immediately
  // while the rest waited for Save — confusing half-committed state).
  const [roles, setRoles] = useState<Record<string, Role | 'none'>>(() =>
    Object.fromEntries(data.members.map(m => [
      m.id,
      data.memberships.find(x => x.workspaceId === initial.id && x.userId === m.id)?.role ?? 'none',
    ]))
  )
  const [appAdmins, setAppAdmins] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(data.members.map(m => [m.id, m.isAppAdmin]))
  )

  // One row per person: signed-in profiles plus roster-only names (added
  // manually before their first sign-in), matched up by display name.
  const people = useMemo(() => {
    const byName = new Map<string, { key: string; name: string; profileId?: string; email?: string }>()
    data.userList.forEach(n => byName.set(n, { key: `name-${n}`, name: n }))
    data.members.forEach(m => byName.set(m.displayName, { key: m.id, name: m.displayName, profileId: m.id, email: m.email }))
    return Array.from(byName.values())
      .filter(p => isNzTeamName(p.name, data.members))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data.userList, data.members])

  const [peopleQuery, setPeopleQuery] = useState('')
  const [peoplePage, setPeoplePage] = useState(1)
  const filteredPeople = useMemo(() => {
    const q = peopleQuery.trim().toLowerCase()
    const matched = q
      ? people.filter(p => p.name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q))
      : people
    return [...matched].sort((a, b) => Number(ws.members.includes(b.name)) - Number(ws.members.includes(a.name)))
  }, [people, peopleQuery, ws.members])
  const peoplePageCount = Math.max(1, Math.ceil(filteredPeople.length / PEOPLE_PAGE_SIZE))
  const peoplePageClamped = Math.min(peoplePage, peoplePageCount)
  const pagedPeople = filteredPeople.slice((peoplePageClamped - 1) * PEOPLE_PAGE_SIZE, peoplePageClamped * PEOPLE_PAGE_SIZE)

  const [adminQuery, setAdminQuery] = useState('')
  const [adminPage, setAdminPage] = useState(1)
  const filteredAdminMembers = useMemo(() => {
    const nzMembers = filterNzTeamMembers(data.members)
    const q = adminQuery.trim().toLowerCase()
    const matched = q ? nzMembers.filter(m => m.displayName.toLowerCase().includes(q)) : nzMembers
    return [...matched].sort((a, b) => Number(appAdmins[b.id] ?? false) - Number(appAdmins[a.id] ?? false))
  }, [data.members, adminQuery, appAdmins])
  const adminPageCount = Math.max(1, Math.ceil(filteredAdminMembers.length / ADMIN_PAGE_SIZE))
  const adminPageClamped = Math.min(adminPage, adminPageCount)
  const pagedAdminMembers = filteredAdminMembers.slice((adminPageClamped - 1) * ADMIN_PAGE_SIZE, adminPageClamped * ADMIN_PAGE_SIZE)

  const setStatuses = (statuses: WorkflowState[]) =>
    setWs(w => ({ ...w, statuses: statuses.map((s, i) => ({ ...s, order: i })) }))
  const addStatus = () =>
    setStatuses([...(ws.statuses ?? []), { id: uuid(), label: 'New state', color: '#93328e', order: (ws.statuses?.length ?? 0), isDone: false }])
  const updateStatus = (id: string, patch: Partial<WorkflowState>) =>
    setStatuses((ws.statuses ?? []).map(s => s.id === id ? { ...s, ...patch } : s))
  const removeStatus = (id: string) =>
    setStatuses((ws.statuses ?? []).filter(s => s.id !== id))
  const moveStatus = (id: string, dir: -1 | 1) => {
    const arr = [...(ws.statuses ?? [])]
    const i = arr.findIndex(s => s.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    setStatuses(arr)
  }

  const toggleMember = (name: string) =>
    setWs(w => ({
      ...w,
      members: w.members.includes(name) ? w.members.filter(m => m !== name) : [...w.members, name],
    }))

  const handleSave = () => {
    updateWorkspace({ ...ws, name: ws.name.trim() || initial.name })
    for (const m of data.members) {
      const before = data.memberships.find(x => x.workspaceId === initial.id && x.userId === m.id)?.role ?? 'none'
      const after = roles[m.id] ?? 'none'
      if (before === after) continue
      if (after === 'none') removeMembership(initial.id, m.id)
      else setMembership(initial.id, m.id, after)
    }
    for (const m of data.members) {
      const after = appAdmins[m.id] ?? false
      if (m.isAppAdmin !== after) setAppAdmin(m.id, after)
    }
    onClose()
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] gap-0 p-0 flex flex-col">
        <DialogHeader className="border-b border-border px-5 pt-4 pb-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-normal text-foreground">
            <Settings size={16} strokeWidth={1.75} className="text-muted-foreground" />
            {ws.name.trim() || 'Workspace'} — settings
          </DialogTitle>
          <div data-astryx-theme="neutral" className="mt-1">
            <TabList size="sm" value={tab} onChange={v => setTab(v as TabId)}>
              <Tab value="general" label="General" icon={<SlidersHorizontal size={14} strokeWidth={1.75} />} />
              <Tab value="workflow" label="Workflow" icon={<ListChecks size={14} strokeWidth={1.75} />} />
              <Tab value="people" label="People" icon={<Users size={14} strokeWidth={1.75} />} />
            </TabList>
          </div>
        </DialogHeader>

        <div data-astryx-theme="neutral" className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {tab === 'general' && (
            <>
              <div className="flex gap-2.5 flex-wrap mb-[11px]">
                <Field className="flex-1 min-w-[120px]">
                  <FieldLabel htmlFor="ws-edit-name" className="text-xs font-medium text-muted-foreground">Name</FieldLabel>
                  <Input
                    id="ws-edit-name"
                    value={ws.name}
                    onChange={e => setWs(w => ({ ...w, name: e.target.value }))}
                  />
                </Field>
                <Field className="w-auto">
                  <FieldLabel className="text-xs font-medium text-muted-foreground">Colour</FieldLabel>
                  <ColorPickerPopover value={ws.color} onValueChange={v => setWs(w => ({ ...w, color: v }))} />
                </Field>
              </div>

              <div className="flex gap-2.5 mb-[11px]">
                <div className={`${SECTION_LABEL.replace(' mb-1', '')} flex-1`}>
                  Icon
                  <Select value={ws.icon ?? ''} onValueChange={v => setWs(w => ({ ...w, icon: v }))}>
                    <SelectTrigger placeholder="Icon" icon={getWorkspaceIcon(ws.icon)} className="min-w-0 w-full h-10" />
                    <SelectContent>
                      {WORKSPACE_ICONS.map((opt, idx) => (
                        <SelectItem key={opt.name} index={idx} value={opt.name} icon={opt.Icon}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isAdmin && (
                <div className="mt-6 pt-3 border-t border-[color:var(--line)]">
                  <label className={SECTION_LABEL}>Danger zone</label>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-[color:var(--muted)]">
                      Deletes the workspace with all its workstreams and tasks. You get an Undo toast right after.
                    </span>
                    <Button variant="destructive" onClick={() => { onClose(); deleteWorkspace(ws.id) }}>
                      <Trash2 data-icon="inline-start" strokeWidth={1.75} />
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'workflow' && (
            <>
              <div>
                <label className={SECTION_LABEL}>Workflow states</label>
                <span className="block text-xs text-[color:var(--muted)] mb-2">
                  The columns tasks move through on the board. States marked &ldquo;done&rdquo; count as complete.
                </span>
                <div className="flex flex-col gap-1.5">
                  {(ws.statuses ?? []).map((s, i) => (
                    <div key={s.id} className="flex items-center gap-1.5">
                      <ColorPickerPopover value={s.color} onValueChange={v => updateStatus(s.id, { color: v })} />
                      <Input
                        value={s.label}
                        onChange={e => updateStatus(s.id, { label: e.target.value })}
                        className="flex-1 min-w-0"
                        disabled={!isAdmin}
                      />
                      <label className="flex items-center gap-1.5 text-xs text-[color:var(--muted)] shrink-0 cursor-pointer" title="Counts as complete">
                        <Checkbox checked={s.isDone} onCheckedChange={v => updateStatus(s.id, { isDone: !!v })} />
                        done
                      </label>
                      <button type="button" onClick={() => moveStatus(s.id, -1)} disabled={!isAdmin || i === 0} className="text-[color:var(--muted)] disabled:opacity-30 px-1" title="Move up">↑</button>
                      <button type="button" onClick={() => moveStatus(s.id, 1)} disabled={!isAdmin || i === (ws.statuses?.length ?? 0) - 1} className="text-[color:var(--muted)] disabled:opacity-30 px-1" title="Move down">↓</button>
                      <button type="button" onClick={() => removeStatus(s.id)} disabled={!isAdmin || (ws.statuses?.length ?? 0) <= 1} className="text-[color:var(--muted)] disabled:opacity-30 px-1" title="Remove"><X size={14} strokeWidth={1.75} /></button>
                    </div>
                  ))}
                  <Button variant="outline" className="self-start" onClick={addStatus} disabled={!isAdmin}>
                    <Plus size={16} strokeWidth={1.75} />
                    Add state
                  </Button>
                </div>
              </div>
            </>
          )}

          {tab === 'people' && (
            <>
              <label className={SECTION_LABEL}>People</label>
              <span className="block text-xs text-[color:var(--muted)] mb-2">
                Tick who belongs to this workspace (drives the person filter and People view).
                Roles control what signed-in accounts can do here; people appear with an account after their first sign-in.
              </span>
              {people.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  No people yet — they appear here after their first sign-in, or add names via the Users panel.
                </span>
              ) : (
                <>
                  <TextInput
                    label="Search people"
                    isLabelHidden
                    size="sm"
                    value={peopleQuery}
                    onChange={v => { setPeopleQuery(v); setPeoplePage(1) }}
                    placeholder="Search by name or email…"
                    startIcon="search"
                    hasClear
                    className="mb-2"
                  />
                  {pagedPeople.length === 0 ? (
                    <div className="border-[1.5px] border-[color:var(--line)] rounded-lg px-3 py-6 text-center text-sm text-[color:var(--muted)]">
                      No people match &ldquo;{peopleQuery}&rdquo;.
                    </div>
                  ) : (
                    <div className="border-[1.5px] border-[color:var(--line)] rounded-lg">
                      {pagedPeople.map(p => {
                        const role = p.profileId ? (roles[p.profileId] ?? 'none') : null
                        const cur = ROLE_OPTIONS.find(r => r.value === role) ?? ROLE_OPTIONS[3]
                        const CurIcon = cur.Icon
                        const isAppAdm = p.profileId ? (appAdmins[p.profileId] ?? false) : false
                        return (
                          <div key={p.key} className="flex items-center gap-2.5 px-3 py-1.5 border-b border-[color:var(--line)] last:border-b-0">
                            <span
                              onClick={() => isAdmin && toggleMember(p.name)}
                              className={`flex items-center gap-2.5 flex-1 min-w-0 select-none ${isAdmin ? 'cursor-pointer' : ''}`}
                            >
                              <Checkbox checked={ws.members.includes(p.name)} disabled={!isAdmin} className="pointer-events-none" />
                              <Avatar name={p.name} src={avatarByName(data.members, p.name)} size={24} />
                              <span className="flex flex-col min-w-0">
                                <span className="text-base truncate inline-flex items-center gap-1.5">
                                  {p.name}
                                  {isAppAdm && <Badge variant="purple" label="App admin" />}
                                </span>
                                <span className="text-xs text-[color:var(--muted)] truncate">
                                  {p.email ?? 'No account yet'}
                                </span>
                              </span>
                            </span>
                            {p.profileId && (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  disabled={!isAdmin}
                                  render={
                                    <button
                                      type="button"
                                      className="group inline-flex shrink-0 items-center gap-1.5 outline-none cursor-pointer disabled:opacity-50 disabled:cursor-default"
                                    >
                                      <Badge variant={ROLE_BADGE_VARIANT[cur.value]} label={cur.label} icon={<CurIcon size={12} strokeWidth={1.75} />} />
                                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-[color:var(--muted)] transition-colors duration-80 group-hover:text-[color:var(--ink)]"><path d="M6 9l6 6 6-6" /></svg>
                                    </button>
                                  }
                                />
                                <DropdownMenuContent align="end" className="min-w-[160px]">
                                  <DropdownMenuRadioGroup
                                    value={role ?? 'none'}
                                    onValueChange={v => {
                                      setRoles(r => ({ ...r, [p.profileId!]: v as Role | 'none' }))
                                      // Granting access implies membership — otherwise this person
                                      // has a real role on the workspace but never shows up in its
                                      // member avatar stack or person filter (the two were staged
                                      // independently and could silently drift apart).
                                      if (v !== 'none' && !ws.members.includes(p.name)) {
                                        setWs(w => ({ ...w, members: [...w.members, p.name] }))
                                      }
                                    }}
                                  >
                                    {ROLE_OPTIONS.map(r => {
                                      const RIcon = r.Icon
                                      return (
                                        <DropdownMenuRadioItem key={r.value} value={r.value} className="pl-2">
                                          <RIcon size={14} strokeWidth={1.75} />
                                          {r.label}
                                        </DropdownMenuRadioItem>
                                      )
                                    })}
                                  </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {filteredPeople.length > PEOPLE_PAGE_SIZE && (
                    <div className="mt-2 flex justify-center">
                      <Pagination
                        page={peoplePageClamped}
                        onChange={setPeoplePage}
                        totalItems={filteredPeople.length}
                        pageSize={PEOPLE_PAGE_SIZE}
                        variant="compact"
                        size="sm"
                      />
                    </div>
                  )}
                </>
              )}

              {isAdmin && data.members.length > 0 && (
                <div className="mt-5">
                  <label className={SECTION_LABEL}>App admins</label>
                  <span className="block text-xs text-[color:var(--muted)] mb-1.5">
                    App-wide, not just this workspace: app admins can manage every workspace and KPIs.
                  </span>
                  <TextInput
                    label="Search app admins"
                    isLabelHidden
                    size="sm"
                    value={adminQuery}
                    onChange={v => { setAdminQuery(v); setAdminPage(1) }}
                    placeholder="Search by name…"
                    startIcon="search"
                    hasClear
                    className="mb-2"
                  />
                  {pagedAdminMembers.length === 0 ? (
                    <div className="border-[1.5px] border-[color:var(--line)] rounded-lg px-3 py-6 text-center text-sm text-[color:var(--muted)]">
                      No one matches &ldquo;{adminQuery}&rdquo;.
                    </div>
                  ) : (
                    <CheckboxList
                      label="App admins"
                      isLabelHidden
                      hasDividers
                      density="compact"
                      value={pagedAdminMembers.filter(m => appAdmins[m.id]).map(m => m.id)}
                      onChange={vals => {
                        const shown = new Set(pagedAdminMembers.map(m => m.id))
                        setAppAdmins(a => {
                          const next = { ...a }
                          shown.forEach(id => { next[id] = vals.includes(id) })
                          return next
                        })
                      }}
                    >
                      {pagedAdminMembers.map(m => (
                        <CheckboxListItem key={m.id} value={m.id} label={m.displayName} description={m.email} />
                      ))}
                    </CheckboxList>
                  )}
                  {filteredAdminMembers.length > ADMIN_PAGE_SIZE && (
                    <div className="mt-2 flex justify-center">
                      <Pagination
                        page={adminPageClamped}
                        onChange={setAdminPage}
                        totalItems={filteredAdminMembers.length}
                        pageSize={ADMIN_PAGE_SIZE}
                        variant="compact"
                        size="sm"
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button variant="outline" disabled={!isAdmin} onClick={handleSave}>
            <Save data-icon="inline-start" strokeWidth={1.75} />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
