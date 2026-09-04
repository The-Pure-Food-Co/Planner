'use client'
import { useRef, useState } from 'react'
import { usePlannerStore } from '@/store/plannerStore'
import { useMyRole } from '@/lib/permissions'
import { useAuthUser, useMe } from '@/lib/auth'
import { signOut } from '@/lib/supabase'
import type { PrimaryTab } from '@/lib/types'
import { Button } from '@astryxdesign/core/Button'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Kbd } from '@astryxdesign/core/Kbd'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import Avatar from '@/components/Avatar'
import NotificationsBell from '@/components/NotificationsBell'
import NotificationSettings from '@/components/modals/NotificationSettings'
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup'
import { LogOut, ListTodo, Camera, BellRing, Search, ArrowLeft, ChevronDown, LayoutGrid, type LucideIcon } from 'lucide-react'
import { taskAssignedTo } from '@/lib/utils'

interface Props {
  onSearch: () => void
}

// Tier 1: app-level pages, GitHub-style global links on the gradient bar.
// People and KPIs are hidden for now — see planner page.tsx / SearchPalette for the matching guards.
const GLOBAL_PAGES: Array<{ id: PrimaryTab; label: string; Icon: LucideIcon }> = [
  { id: 'mywork', label: 'My work', Icon: ListTodo },
]

const HUB_URL = process.env.NEXT_PUBLIC_AUTH_HUB_URL

export default function Header({ onSearch }: Props) {
  const { data, ui, setUi, saveUi, live, updateMyAvatar, openWs } = usePlannerStore()
  const onlineIds = usePlannerStore(s => s.onlineIds)
  const authUser = useAuthUser()
  const { meId, me, myName } = useMe()
  const photoInput = useRef<HTMLInputElement>(null)
  const [showNotifSettings, setShowNotifSettings] = useState(false)

  const curWs = data.workspaces.find(w => w.id === ui.ws) ?? data.workspaces[0]
  const myRole = useMyRole(curWs?.id ?? null)

  // Workspaces the user can actually navigate into: real membership in live
  // mode, everything in local/seed mode (no server to scope against — see
  // lib/permissions.ts's resolveRole, which grants full access the same way).
  const isAppAdmin = !live || !!data.members.find(m => m.id === meId)?.isAppAdmin
  const myWorkspaces = isAppAdmin
    ? data.workspaces
    : data.workspaces.filter(w => data.memberships.some(m => m.workspaceId === w.id && m.userId === meId))

  // Defaults to the most recently visited workspace (ui.ws, already persisted
  // by openWs) so the button target survives reloads, falling back to the
  // first workspace the user has access to.
  const jumpWs = (myWorkspaces.find(w => w.id === ui.ws) ?? myWorkspaces[0]) ?? null

  const roleLabel = live
    ? (me?.isAppAdmin ? 'App admin' : myRole === 'admin' ? 'Workspace admin' : myRole === 'member' ? 'Member' : 'Viewer')
    : 'Local mode'

  const myOpenCount = data.workspaces.reduce(
    (n, w) => n + w.tasks.filter(t => (t.pct || 0) < 100 && taskAssignedTo(t, data.members, meId, myName)).length,
    0,
  )

  const tab = ui.primaryTab ?? 'timeline'

  const setTab = (t: PrimaryTab) => { setUi({ primaryTab: t }); saveUi() }

  return (
    <>
      <header>
        <div className="hdr-top" data-astryx-theme="neutral">
          {HUB_URL && (
            <IconButton
              variant="ghost"
              className="hdr-back"
              label="Back to Pantry"
              icon={<ArrowLeft size={16} strokeWidth={1.75} />}
              onClick={() => { window.location.href = HUB_URL }}
            />
          )}
          <Button variant="ghost" className="hdr-home" label="All workspaces" onClick={() => setTab('teams')}>
            <span className="logo-block" style={{ width: 34, height: 34, borderRadius: 9, fontSize: 14 }}>P</span>
            <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap' }}>Pure Planner</span>
          </Button>

          <nav className="gnav">
            {GLOBAL_PAGES.map(({ id, label, Icon }) => (
              <Button
                key={id}
                variant="ghost"
                size="sm"
                className={`gnav-link${tab === id ? ' active' : ''}`}
                icon={<Icon size={14} strokeWidth={1.75} />}
                label={label}
                onClick={() => setTab(id)}
              />
            ))}
          </nav>

          {jumpWs && (
            <ButtonGroup label="Jump to workspace" className="gws">
              <Button
                variant="ghost"
                size="sm"
                className={`gnav-link gws-link${ui.page === 'ws' && ui.ws === jumpWs.id ? ' active' : ''}`}
                label={jumpWs.name}
                onClick={() => openWs(jumpWs.id)}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <IconButton
                      variant="ghost"
                      size="sm"
                      className="gnav-link gws-chevron"
                      label="Choose a workspace"
                      icon={<ChevronDown size={14} strokeWidth={1.75} />}
                    />
                  }
                />
                <DropdownMenuContent align="start" className="min-w-[200px]">
                  <DropdownMenuGroup>
                    {myWorkspaces.map(w => (
                      <DropdownMenuItem key={w.id} onClick={() => openWs(w.id)}>
                        {w.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setTab('teams')}>
                    <LayoutGrid size={14} strokeWidth={1.75} />
                    View all workspaces
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          )}

          {/* "Search anything" global search is hidden for now — re-enable by
              uncommenting this button. onSearch/SearchPalette wiring is untouched. */}
          {false && (
            <Button variant="ghost" className="gsearch" label="Search anything" onClick={onSearch}>
              <span className="gsearch-inner">
                <Search size={13} strokeWidth={2} />
                Search anything…
                <Kbd keys="mod+k" />
              </span>
            </Button>
          )}

          <div className="spacer" />

          <NotificationsBell />

          {authUser && (
            <>
              {/* Lives outside the menu: an item inside would unmount (menu closes) before the change event fires. */}
              <input
                ref={photoInput}
                type="file"
                accept="image/*"
                hidden
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) void updateMyAvatar(f)
                  e.target.value = ''
                }}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <IconButton
                      variant="ghost"
                      className="me-btn"
                      label={`Account menu — signed in as ${authUser.email}`}
                      icon={<Avatar name={myName} src={me?.avatarUrl ?? ''} size={28} online={!!meId && onlineIds.includes(meId)} />}
                    />
                  }
                />
                <DropdownMenuContent align="end" className="min-w-[230px]">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="flex items-center gap-2.5">
                      <Avatar name={myName} src={me?.avatarUrl ?? ''} size={38} online={!!meId && onlineIds.includes(meId)} />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[13px] font-medium truncate">{myName}</span>
                        <span className="text-[11px] font-normal text-muted-foreground truncate">{authUser.email}</span>
                        <span className="mt-1 self-start rounded-full bg-[#C63663]/10 px-1.5 py-px text-[10px] font-semibold text-[#C63663]">
                          {roleLabel}
                        </span>
                      </span>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setTab('mywork')}>
                    <ListTodo size={14} strokeWidth={1.75} />
                    My work
                    {myOpenCount > 0 && (
                      <span className="ml-auto text-[11px] font-semibold text-muted-foreground">{myOpenCount}</span>
                    )}
                  </DropdownMenuItem>
                  {live && me && (
                    <>
                      <DropdownMenuItem onClick={() => photoInput.current?.click()}>
                        <Camera size={14} strokeWidth={1.75} />
                        Change photo
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowNotifSettings(true)}>
                        <BellRing size={14} strokeWidth={1.75} />
                        Notification settings
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut}>
                    <LogOut size={14} strokeWidth={1.75} />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {showNotifSettings && <NotificationSettings onClose={() => setShowNotifSettings(false)} />}
            </>
          )}
        </div>
      </header>

    </>
  )
}
