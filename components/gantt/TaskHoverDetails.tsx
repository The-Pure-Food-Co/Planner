'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, CalendarOff, Link2, Paperclip } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Dot } from '@/components/task-visuals';
import {
  fmtShort,
  fmtDueRelative,
  todayD,
  resolveAssignees,
  wsStatuses,
  taskStatusId,
  avatarById,
} from '@/lib/utils';
import { renderMentions } from '@/lib/mentions';
import type { Lane, Member, Task, Workspace } from '@/lib/types';

interface Props {
  task: Task;
  ws: Workspace;
  lane: Lane;
  members: Member[];
  anchor: { x: number; y: number };
  onUpdate: (t: Task) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const pill =
  'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md border border-border bg-white text-[12px] text-foreground';

const sectionLabel = 'text-[10.5px] text-muted-foreground';

const fmtBytes = (n?: number) => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export default function TaskHoverDetails({
  task,
  ws,
  lane,
  members,
  anchor,
  onUpdate,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    left: anchor.x,
    top: anchor.y,
    visibility: 'hidden',
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 12;
    // Prefer top-right of the cursor; fall back to bottom-right if that
    // would push the card off the top of the viewport.
    let top = anchor.y - h - gap;
    if (top < 16) top = anchor.y + gap;
    let left = anchor.x + gap;
    left = Math.min(left, window.innerWidth - w - 16);
    left = Math.max(16, left);
    top = Math.min(top, window.innerHeight - h - 16);
    top = Math.max(16, top);
    setStyle({ position: 'fixed', left, top, visibility: 'visible' });
  }, [anchor.x, anchor.y]);

  const people = resolveAssignees(task, members);
  const statusCols = wsStatuses(ws);
  const currentStatus = statusCols.find((s) => s.id === taskStatusId(task));
  const checklist = task.checklist || [];
  const doneCount = checklist.filter((c) => c.done).length;
  const toggleChecklistItem = (id: string) =>
    onUpdate({
      ...task,
      checklist: checklist.map((c) =>
        c.id === id ? { ...c, done: !c.done } : c
      ),
    });
  const milestones = (task.milestones || []).filter((m) => m.date);
  const attachments = task.attachments || [];
  const links = task.links || [];
  const comments = task.comments || [];
  const memberNames = members.map((m) => m.displayName);

  return createPortal(
    <div
      ref={ref}
      className="w-[min(550px,calc(100vw-24px))] max-h-[45vh] overflow-y-auto flex flex-col gap-3 rounded-xl bg-[#faf7f4] p-4 text-sm text-popover-foreground ring-1 ring-[var(--line)] cursor-default transition-opacity duration-200"
      style={{
        ...style,
        zIndex: 60,
        boxShadow: '0 24px 80px rgba(44, 44, 44, 0.32)',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      // The card is portaled but still bubbles React events to the Gantt bar
      // it belongs to; isolate pointer/clicks so interacting here doesn't
      // trigger the bar's drag / open-task handlers.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 text-[14px] text-muted-foreground">
        <Dot color={ws.color} />
        <span className="truncate">{ws.name}</span>
        <span className="text-muted-foreground/20 text-[26px]">›</span>
        <Dot color={lane.color} />
        <span className="truncate">{lane.label}</span>
      </div>

      <div className="flex flex-col gap-0.5">
        <div className="text-[24px] leading-snug">{task.name}</div>
        {task.notes && (
          <div className="text-[12.5px] text-muted-foreground whitespace-pre-wrap line-clamp-4">
            {renderMentions(task.notes, memberNames)}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {currentStatus && (
          <span className={pill}>
            <Dot color={currentStatus.color} />
            {currentStatus.label}
          </span>
        )}
        <span className={pill}>
          {task.noDate ? (
            <>
              <CalendarOff size={13} strokeWidth={1.75} />
              No date
            </>
          ) : (
            <>
              <CalendarDays size={13} strokeWidth={1.75} />
              {fmtDueRelative(task, todayD())}
            </>
          )}
        </span>
        <span className={pill}>
          <span
            className="inline-block rounded-full shrink-0"
            style={{
              width: 14,
              height: 14,
              background: `conic-gradient(var(--beetroot) ${task.pct || 0}%, var(--line) 0)`,
            }}
          />
          {task.pct || 0}%
        </span>
      </div>

      {people.length > 0 && (
        <div className="flex flex-row gap-2.5 items-start">
          <span className="text-[13px] text-[#C63663] ">Assignees</span>
          <div className="flex flex-wrap items-center gap-2.5 max-w-[400px]">
            {people.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 text-[12.5px]"
              >
                <Avatar
                  name={p.name.split(' ')[0] ?? ''}
                  src={p.avatarUrl}
                  size={18}
                />
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {checklist.length > 0 && (
        <div className="flex flex-col gap-1.5 border p-2 bg-white rounded-md border-border">
          <span className="text-[13px] text-[#C63663]">
            Checklist {doneCount}/{checklist.length}
          </span>
          <div className="flex flex-col gap-1">
            {checklist.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleChecklistItem(c.id)}
                className={`text-left text-[12.5px] flex items-center gap-2 rounded px-1 py-0.5 -mx-1 hover:bg-muted/60 cursor-pointer ${c.done ? 'text-muted-foreground line-through' : ''}`}
              >
                <Checkbox
                  checked={c.done}
                  className="pointer-events-none shrink-0 data-checked:bg-[#c63663] data-checked:border-[#c63663]"
                />
                <span>{renderMentions(c.text, memberNames)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {milestones.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={sectionLabel}>Milestones</span>
          <div className="flex flex-col gap-1">
            {milestones.map((m) => (
              <span
                key={m.id}
                className="text-[12.5px] flex items-center gap-2"
              >
                <span style={{ color: 'var(--cabbage)' }}>◆</span>
                {m.label}
                <span className="text-muted-foreground">
                  {fmtShort(m.date)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {(attachments.length > 0 || links.length > 0) && (
        <div className="flex flex-col gap-2">
          {attachments.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className={sectionLabel}>Attachments</span>
              <div className="flex flex-col gap-1">
                {attachments.map((a) => (
                  <span
                    key={a.id}
                    className="text-[12.5px] flex items-center gap-2"
                  >
                    <Paperclip
                      size={13}
                      strokeWidth={1.75}
                      className="text-[#C63663] shrink-0"
                    />
                    <span className="truncate">{a.name}</span>
                    {a.size ? (
                      <span className="text-muted-foreground">
                        {fmtBytes(a.size)}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
          )}
          {links.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className={sectionLabel}>Links</span>
              <div className="flex flex-col gap-1">
                {links.map((l) => (
                  <span
                    key={l.id}
                    className="text-[12.5px] flex items-center gap-2"
                  >
                    <Link2
                      size={13}
                      strokeWidth={1.75}
                      className="text-muted-foreground shrink-0"
                    />
                    <span className="truncate text-[color:var(--beetroot-dark)]">
                      {l.label || l.url}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {comments.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={sectionLabel}>Comments {comments.length}</span>
          <div className="flex flex-col gap-2">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-2 items-start">
                <Avatar name={c.authorName} src={avatarById(members, c.authorId)} size={18} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11.5px]">
                    {c.authorName || 'Someone'}
                  </div>
                  <div className="text-[12.5px] whitespace-pre-wrap break-words">
                    {renderMentions(c.text, memberNames)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
