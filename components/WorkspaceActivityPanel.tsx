'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { LayoutPanel } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import Avatar from '@/components/Avatar';
import ActivityMessage from '@/components/ActivityMessage';
import { usePlannerStore } from '@/store/plannerStore';
import { db } from '@/lib/supabase';
import { activityColor, activityIcon } from '@/lib/activity';
import { avatarById } from '@/lib/utils';
import type { ActivityLogEntry, Workspace } from '@/lib/types';

interface Props {
  ws: Workspace;
  onClose: () => void;
}

/** Right-hand side panel: a workspace's most recent activity (max 10), fetched fresh per open. */
export default function WorkspaceActivityPanel({ ws, onClose }: Props) {
  const members = usePlannerStore((s) => s.data.members);
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    db.fetchWorkspaceActivity(ws.id, 10).then((data) => {
      if (!cancelled) { setEntries(data); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [ws.id]);

  return (
    <LayoutPanel width={340} hasDivider label="Workspace activity" isScrollable>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text type="label" color="secondary">Activity — {ws.name}</Text>
          <button onClick={onClose} aria-label="Close" style={{ display: 'flex', color: 'var(--muted)' }}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        {loading ? (
          <div className="py-6 text-center text-[13px] text-[color:var(--muted)]">Loading…</div>
        ) : entries.length === 0 ? (
          <EmptyState
            isCompact
            icon={<Icon icon="clock" size="lg" color="secondary" />}
            title="No activity yet"
            description="Changes to tasks in this workspace will show up here."
          />
        ) : (
          <List density="compact" hasDividers>
            {entries.map((e) => {
              const EntryIcon = activityIcon(e);
              const color = activityColor(e);
              return (
                <ListItem
                  key={e.id}
                  label={e.actorName || 'Someone'}
                  description={<ActivityMessage message={e.message} field={e.field ?? e.action} ws={ws} />}
                  startContent={
                    <span className="relative inline-flex flex-none">
                      <Avatar name={e.actorName} src={avatarById(members, e.actorId)} size={30} />
                      <span
                        className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full"
                        style={{ background: 'var(--panel)', color, border: '1px solid var(--panel)' }}
                      >
                        <EntryIcon className="h-3 w-3" />
                      </span>
                    </span>
                  }
                  endContent={<Timestamp value={e.createdAt} format="date_time" />}
                />
              );
            })}
          </List>
        )}
      </div>
    </LayoutPanel>
  );
}
