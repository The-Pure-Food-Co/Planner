'use client';
import { useEffect, useState } from 'react';
import { usePlannerStore } from '@/store/plannerStore';
import type { PrimaryTab, Workspace, ZoomLevel } from '@/lib/types';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Selector } from '@astryxdesign/core/Selector';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Switch } from '@astryxdesign/core/Switch';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { GanttChartSquare, Kanban } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { getWorkspaceIcon } from '@/lib/workspace-icons';
import { filterNzTeamNames, useCanWrite } from '@/lib/permissions';
import { avatarByName } from '@/lib/utils';

interface Props {
  ws: Workspace | null;
  onAddTask?: () => void;
}

const SEARCH_DEBOUNCE_MS = 250;
const MAX_STACK_AVATARS = 3;

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  margin: '0 0 6px',
};

export default function Toolbar({ ws, onAddTask }: Props) {
  const { data, ui, setUi, saveUi } = usePlannerStore();
  const canWrite = useCanWrite(ws?.id ?? null);
  const tab = ui.primaryTab ?? 'timeline';

  // Local input state so typing stays instant; ui.search updates after a pause.
  const [q, setQ] = useState(ui.search ?? '');
  // Search within the "+N more people" overflow dropdown.
  const [peopleQ, setPeopleQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => {
      if (q !== ui.search) setUi({ search: q });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [q, ui.search, setUi]);

  // Month label under the Gantt's viewport anchor, reported on scroll.
  const [month, setMonth] = useState('');
  useEffect(() => {
    const onMonth = (e: Event) => setMonth((e as CustomEvent<string>).detail);
    window.addEventListener('gantt-month', onMonth);
    return () => window.removeEventListener('gantt-month', onMonth);
  }, []);

  // The toolbar never wraps; below this width the view tabs and Add task
  // collapse to icons so everything still fits on one row.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1440px)');
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (tab === 'kpis' || tab === 'teams' || tab === 'mywork') return null;

  const isTaskView = tab === 'timeline' || tab === 'board' || tab === 'calendar' || tab === 'table';
  const isTimeline = tab === 'timeline';

  const people = (() => {
    if (tab === 'people') {
      const set = new Set<string>();
      data.userList.forEach((u) => set.add(u));
      data.workspaces.forEach((w) => {
        (w.members || []).forEach((m) => set.add(m));
        w.tasks.forEach((t) => {
          if (t.owner) set.add(t.owner);
        });
      });
      return filterNzTeamNames([...set], data.members);
    }
    if (!ws) return filterNzTeamNames([...data.userList], data.members);
    const set = new Set(ws.members || []);
    ws.tasks.forEach((t) => {
      if (t.owner) set.add(t.owner);
    });
    return filterNzTeamNames([...set], data.members);
  })();

  const togglePerson = (name: string) => {
    setUi({ person: ui.person === name ? '' : name });
    saveUi();
  };

  // Keep the filtered person visible even when they'd overflow the stack.
  let ordered = people;
  if (ui.person && people.indexOf(ui.person) >= MAX_STACK_AVATARS) {
    ordered = [ui.person, ...people.filter((p) => p !== ui.person)];
  }
  const stack = ordered.slice(0, MAX_STACK_AVATARS);
  const overflow = ordered.slice(MAX_STACK_AVATARS);

  const popoverFilterActive = !!ui.stream || (ui.taskFilter ?? 'all') !== 'all' || ui.todayOnly;
  const anyFilterActive = popoverFilterActive || !!ui.person || !!(ui.search ?? '').trim();

  const clearFilters = () => {
    setQ('');
    setUi({ search: '', person: '', stream: '', todayOnly: false, taskFilter: 'all' });
    saveUi();
  };

  // Human-readable summary of what's currently being filtered, shown in a
  // banner beneath the toolbar so the active filter state is always visible
  // (not buried behind the funnel popover).
  const filterSummary: string[] = [];
  if ((ui.search ?? '').trim()) filterSummary.push(`matching “${(ui.search ?? '').trim()}”`);
  if (ui.person) filterSummary.push(`assigned to ${ui.person}`);
  if (ui.stream) {
    const laneLabel = ws?.lanes.find((l) => l.id === ui.stream)?.label;
    if (laneLabel) filterSummary.push(`in ${laneLabel}`);
  }
  if ((ui.taskFilter ?? 'all') !== 'all')
    filterSummary.push(ui.taskFilter === 'done' ? 'done only' : 'active only');
  if (ui.todayOnly) filterSummary.push("today's tasks");

  const setStream = (id: string) => {
    setUi({ stream: id });
    saveUi();
  };

  const streamRow = (id: string, label: string, color?: string) => {
    const active = (ui.stream || '') === id;
    return (
      <button
        key={id || 'all'}
        type="button"
        onClick={() => setStream(id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          borderRadius: 6,
          border: 'none',
          background: active ? 'var(--cauliflower)' : 'transparent',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 12.5,
          textAlign: 'left',
          color: 'var(--charcoal)',
        }}
      >
        {color && (
          <span
            style={{ width: 8, height: 8, borderRadius: '50%', background: color, flex: 'none' }}
          />
        )}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {active && <CheckIcon width={12} height={12} />}
      </button>
    );
  };

  const setWs = (id: string) => {
    setUi({ ws: id, stream: '' });
    saveUi();
  };
  const setTab = (t: PrimaryTab) => {
    setUi({ primaryTab: t });
    saveUi();
  };

  return (
    <>
    <div className="toolbar" data-astryx-theme="neutral">
      {isTaskView && ws && (
        <>
          {/* Fixed-width to match the Gantt sidebar head; stays as an empty
              placeholder on other views so the controls after it don't jump. */}
          <div className="tb-left">
            {isTimeline && (
              <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Button
                    label="Today"
                    size="sm"
                    onClick={() =>
                      (window as Window & { __scrollToday?: () => void }).__scrollToday?.()
                    }
                  />
                  <Selector
                    label="Zoom"
                    isLabelHidden
                    size="sm"
                    value={ui.zoom}
                    onChange={(v) => {
                      if (v) {
                        setUi({ zoom: v as ZoomLevel });
                        saveUi();
                      }
                    }}
                    options={[
                      { value: 'days', label: 'Days' },
                      { value: 'weeks', label: 'Weeks' },
                      { value: 'months', label: 'Months' },
                    ]}
                  />
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <IconButton
                    label="Previous month"
                    variant="ghost"
                    size="sm"
                    icon={<ChevronLeftIcon width={14} height={14} />}
                    onClick={() =>
                      (
                        window as Window & { __ganttPanMonth?: (dir: 1 | -1) => void }
                      ).__ganttPanMonth?.(-1)
                    }
                  />
                  {month && (
                    <span
                      style={{
                        fontSize: 16,
                        letterSpacing: '0.01em',
                        whiteSpace: 'nowrap',
                        margin: '0 2px',
                        color: 'var(--charcoal)',
                        // Fixed to the widest label ("September 2026") so the
                        // next-month chevron doesn't shift as months change.
                        width: 122,
                        textAlign: 'center',
                        flex: 'none',
                      }}
                    >
                      {month}
                    </span>
                  )}
                  <IconButton
                    label="Next month"
                    variant="ghost"
                    size="sm"
                    icon={<ChevronRightIcon width={14} height={14} />}
                    onClick={() =>
                      (
                        window as Window & { __ganttPanMonth?: (dir: 1 | -1) => void }
                      ).__ganttPanMonth?.(1)
                    }
                  />
                </span>
              </>
            )}
          </div>
          <span className="spacer" />
          <Select value={ws.id} onValueChange={(v) => setWs(v)}>
            <SelectTrigger
              placeholder="Select workspace…"
              icon={getWorkspaceIcon(ws.icon)}
              className="w-auto max-w-[220px] font-bold"
            />
            <SelectContent>
              {data.workspaces.map((w, i) => (
                <SelectItem key={w.id} index={i} value={w.id} icon={getWorkspaceIcon(w.icon)}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SegmentedControl
            label="Workspace view"
            size="sm"
            value={tab}
            onChange={(v) => setTab(v as PrimaryTab)}
          >
            <SegmentedControlItem
              value="timeline"
              label="Timeline"
              isLabelHidden={compact}
              icon={<GanttChartSquare size={13} strokeWidth={1.75} />}
            />
            <SegmentedControlItem
              value="board"
              label="Board"
              isLabelHidden={compact}
              icon={<Kanban size={13} strokeWidth={1.75} />}
            />
          </SegmentedControl>
        </>
      )}

      <span className="spacer" />

      <span style={{ display: 'inline-flex', alignItems: 'center', paddingLeft: 6 }}>
        {stack.map((p) => (
          <button
            key={p}
            type="button"
            title={ui.person === p ? `${p} — click to show everyone` : `Show only ${p}'s tasks`}
            onClick={() => togglePerson(p)}
            style={{
              marginLeft: -6,
              padding: 0,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              borderRadius: '50%',
              lineHeight: 0,
              boxShadow:
                ui.person === p
                  ? '0 0 0 2px #fff, 0 0 0 4px var(--beetroot)'
                  : '0 0 0 2px #fff',
            }}
          >
            <Avatar name={p} src={avatarByName(data.members, p)} size={26} />
          </button>
        ))}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`${overflow.length} more people`}
                  style={{
                    marginLeft: -6,
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    border: 'none',
                    background: 'var(--cauliflower)',
                    color: 'var(--muted)',
                    fontSize: 10,
                    cursor: 'pointer',
                    boxShadow: '0 0 0 2px #fff',
                  }}
                >
                  +{overflow.length}
                </button>
              }
            />
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto p-0">
              {overflow.length > 6 && (
                <div className="sticky top-0 z-10 bg-popover px-1.5 pt-1 pb-1.5 border-b border-line">
                  <input
                    autoFocus
                    value={peopleQ}
                    onChange={(e) => setPeopleQ(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Search people…"
                    style={{
                      width: '100%',
                      height: 28,
                      padding: '0 8px',
                      fontSize: 12,
                      borderRadius: 6,
                      border: '1px solid var(--line)',
                      background: 'transparent',
                      outline: 'none',
                    }}
                  />
                </div>
              )}
              <div style={{ padding: 4 }}>
                {(() => {
                  const query = peopleQ.trim().toLowerCase();
                  const list = query
                    ? overflow.filter((p) => p.toLowerCase().includes(query))
                    : overflow;
                  if (!list.length)
                    return (
                      <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--muted)' }}>
                        No matches
                      </div>
                    );
                  return list.map((p) => (
                    <DropdownMenuItem key={p} onClick={() => togglePerson(p)}>
                      <Avatar name={p} src={avatarByName(data.members, p)} size={18} />
                      {p}
                    </DropdownMenuItem>
                  ));
                })()}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </span>

      {isTaskView && (
        <div style={{ width: 210, minWidth: 130, flexShrink: 1 }}>
          <TextInput
            label="Search tasks"
            isLabelHidden
            size="sm"
            placeholder="Search tasks…"
            value={q}
            onChange={setQ}
            startIcon={MagnifyingGlassIcon}
            hasClear
          />
        </div>
      )}

      {isTaskView && ws && (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label="Filters"
                title="Filters"
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  background: '#fff',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  color: 'var(--charcoal)',
                  cursor: 'pointer',
                }}
              >
                <FunnelIcon width={14} height={14} />
                {popoverFilterActive && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -3,
                      right: -3,
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      background: 'var(--beetroot)',
                      border: '2px solid #fff',
                    }}
                  />
                )}
              </button>
            }
          />
          <PopoverContent align="end" sideOffset={6}>
            <div
              data-astryx-theme="neutral"
              className="filter-pop"
              style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 4 }}
            >
              <div>
                <p style={sectionLabel}>Workstream</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {streamRow('', 'All workstreams')}
                  {ws.lanes.map((l) => streamRow(l.id, l.label, l.color))}
                </div>
              </div>
              {isTimeline && (
                <div>
                  <p style={sectionLabel}>Status</p>
                  <SegmentedControl
                    label="Task filter"
                    size="sm"
                    layout="fill"
                    value={ui.taskFilter ?? 'all'}
                    onChange={(v) => {
                      setUi({ taskFilter: v as 'all' | 'active' | 'done' });
                      saveUi();
                    }}
                  >
                    <SegmentedControlItem value="all" label="All" />
                    <SegmentedControlItem value="active" label="Active" />
                    <SegmentedControlItem value="done" label="Done" />
                  </SegmentedControl>
                </div>
              )}
              <Switch
                label="Today's tasks only"
                value={ui.todayOnly}
                onChange={(checked) => {
                  setUi({ todayOnly: checked });
                  saveUi();
                }}
              />
              {anyFilterActive && (
                <Button label="Clear all filters" variant="ghost" size="sm" onClick={clearFilters} />
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {isTaskView && ws && canWrite && onAddTask && (
        compact ? (
          <IconButton
            label="Add task"
            tooltip="Add task"
            variant="primary"
            size="sm"
            icon={<PlusIcon width={14} height={14} />}
            onClick={onAddTask}
          />
        ) : (
          <Button
            label="Add task"
            variant="primary"
            size="sm"
            icon={<PlusIcon width={14} height={14} />}
            onClick={onAddTask}
          />
        )
      )}
    </div>
    {isTaskView && ws && anyFilterActive && filterSummary.length > 0 && (
      <div data-astryx-theme="neutral">
        <Banner
          container="section"
          status="info"
          title={`Showing tasks ${filterSummary.join(', ')}`}
          isDismissable
          onDismiss={clearFilters}
          endContent={
            <Button label="Clear filters" variant="ghost" size="sm" onClick={clearFilters} />
          }
        />
      </div>
    )}
    </>
  );
}
