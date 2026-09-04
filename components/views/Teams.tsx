'use client';
import { useMemo, useState } from 'react';
import { usePlannerStore } from '@/store/plannerStore';
import { getWorkspaceIcon } from '@/lib/workspace-icons';
import { avatarByName } from '@/lib/utils';
import Avatar from '../Avatar';
import { Tooltip } from '../tooltip';
import { Button } from '@/components/ui/button';
import WorkspaceActivityPanel from '@/components/WorkspaceActivityPanel';
import { useIsAppAdmin } from '@/lib/permissions';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { Layers, Settings2, Plus, ClipboardList, History } from 'lucide-react';
import type { Workspace } from '@/lib/types';

/** Overlapping avatar stack for a workspace's members, with a tooltip listing all of them. */
function MembersStack({ members }: { members: string[] }) {
  const roster = usePlannerStore((s) => s.data.members);
  if (members.length === 0)
    return <span className="text-xs text-muted-foreground">—</span>;
  const shown = members.slice(0, 3);
  const rest = members.length - shown.length;
  return (
    <Tooltip
      content={
        <div className="flex flex-col gap-1">
          {members.map((m) => (
            <div key={m} className="flex items-center gap-1.5">
              <Avatar name={m} src={avatarByName(roster, m)} size={18} />
              <span className="text-[12px]">{m}</span>
            </div>
          ))}
        </div>
      }
    >
      <div className="flex -space-x-2 cursor-default">
        {shown.map((m) => (
          <span
            key={m}
            className="ring-2 ring-container rounded-full inline-flex"
          >
            <Avatar name={m} src={avatarByName(roster, m)} size={24} />
          </span>
        ))}
        {rest > 0 && (
          <span className="size-6 rounded-full bg-muted ring-2 ring-container flex items-center justify-center text-[11px] text-muted-foreground">
            +{rest}
          </span>
        )}
      </div>
    </Tooltip>
  );
}

/** Workstream (lane) count for a workspace, with a tooltip listing each lane. */
function WorkstreamsCell({ ws }: { ws: Workspace }) {
  const lanes = ws.lanes ?? [];
  if (lanes.length === 0)
    return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Tooltip
      content={
        <div className="flex flex-col gap-1">
          {lanes.map((l) => (
            <div key={l.id} className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-full shrink-0"
                style={{ background: l.color }}
              />
              <span className="text-[12px]">{l.label}</span>
            </div>
          ))}
        </div>
      }
    >
      <div className="flex items-center gap-2 cursor-default text-muted-foreground">
        <Layers className="size-4" />
        <span>{lanes.length}</span>
      </div>
    </Tooltip>
  );
}

interface Props {
  /** Open the Workspace Editor (members + roles) for a team. */
  onManage?: (ws: Workspace) => void;
  /** Open the New Workspace dialog. */
  onNew?: () => void;
}

export default function Teams({ onManage, onNew }: Props) {
  const { data, openWs } = usePlannerStore();
  const isAppAdmin = useIsAppAdmin();
  const [activityWs, setActivityWs] = useState<Workspace | null>(null);

  const teams = useMemo(
    () => [...data.workspaces].sort((a, b) => a.name.localeCompare(b.name)),
    [data.workspaces]
  );

  // ws.members (a legacy name array, ticked separately in the People tab) can
  // drift from the real role grants in memberships — someone given a role
  // there never lands here unless they were also ticked. Union both so the
  // stack reflects everyone with actual access, not just who got checked.
  const effectiveMembers = useMemo(() => {
    const map = new Map<string, Set<string>>();
    data.workspaces.forEach((w) => map.set(w.id, new Set(w.members ?? [])));
    data.memberships.forEach((m) => {
      const name = data.members.find((p) => p.id === m.userId)?.displayName;
      if (name) map.get(m.workspaceId)?.add(name);
    });
    return map;
  }, [data.workspaces, data.memberships, data.members]);

  const list = (
    <>
      {isAppAdmin && onNew && (
        <div className="flex justify-end mb-2">
          <Button variant="outline" size="sm" onClick={onNew}>
            <Plus className="size-3.5" />
            New workspace
          </Button>
        </div>
      )}
      <div className="w-full rounded-lg overflow-hidden shadow-surface-2">
        {/* header row */}
        <div className="bg-container px-4 py-2 text-sm flex items-center gap-3 text-muted-foreground border-b sticky top-0 z-10">
          <div className="flex-1 min-w-0">Name</div>
          <div className="w-24 sm:w-32">Members</div>
          <div className="w-28 hidden sm:block">Workstreams</div>
          <div className="w-20 hidden sm:block">Tasks</div>
          <div className="w-20 sm:w-32 shrink-0" />
        </div>

        {teams.length === 0 && (
          <div className="bg-container px-4 py-10 text-center text-sm text-muted-foreground">
            No workspaces yet{isAppAdmin && onNew ? ' — create the first one.' : '.'}
          </div>
        )}

        {teams.map((ws) => {
          const Icon = getWorkspaceIcon(ws.icon);
          return (
            <div
              key={ws.id}
              onClick={() => openWs(ws.id)}
              className="group bg-container w-full flex items-center gap-3 py-3 px-4 border-b border-muted-foreground/5 text-sm hover:bg-hover cursor-pointer transition-colors"
            >
              <div className="flex-1 min-w-0 flex items-center gap-2.5">
                <span className="inline-flex size-7 items-center justify-center rounded-md shrink-0">
                  <Icon className="size-4" />
                </span>
                <span className="font-medium truncate">{ws.name}</span>
              </div>
              <div className="w-24 sm:w-32" onClick={(e) => e.stopPropagation()}>
                <MembersStack members={[...(effectiveMembers.get(ws.id) ?? [])]} />
              </div>
              <div
                className="w-28 hidden sm:flex"
                onClick={(e) => e.stopPropagation()}
              >
                <WorkstreamsCell ws={ws} />
              </div>
              <div className="w-20 hidden sm:flex items-center gap-2 text-muted-foreground">
                <ClipboardList className="size-4" />
                <span>{ws.tasks.length}</span>
              </div>
              <div
                className="w-20 sm:w-32 shrink-0 flex items-center justify-end gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setActivityWs(ws)}
                  title="Recent activity"
                >
                  <History className="size-3.5" />
                </Button>
                {onManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onManage(ws)}
                    title="Workspace settings"
                  >
                    <Settings2 className="size-3.5" />
                    <span className="hidden sm:inline">Manage</span>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Layout
        height="fill"
        content={<LayoutContent>{list}</LayoutContent>}
        end={activityWs ? <WorkspaceActivityPanel ws={activityWs} onClose={() => setActivityWs(null)} /> : undefined}
      />
    </div>
  );
}
