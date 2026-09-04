'use client';
import Avatar from '@/components/Avatar';
import ActivityMessage from '@/components/ActivityMessage';
import { Dot } from '@/components/task-visuals';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '@/components/ui/attachment';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { List, ListItem } from '@astryxdesign/core/List';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
} from '@astryxdesign/core/Chat';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { DateInput } from '@astryxdesign/core/DateInput';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { DateRangePicker } from '@/components/base/date-picker/date-range-picker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuthUser } from '@/lib/auth';
import { activityColor, activityIcon } from '@/lib/activity';
import { detectMention, renderMentions } from '@/lib/mentions';
import { useCanWrite, filterNzTeamMembers, filterNzTeamNames } from '@/lib/permissions';
import { useIsCoarsePointer } from '@/lib/useMediaQuery';
import { db, supabase } from '@/lib/supabase';
import type {
  ActivityLogEntry,
  ChecklistItem,
  Lane,
  RecurrenceFreq,
  Task,
  TaskAttachment,
  TaskComment,
  TaskLink,
  TaskMilestone,
  Workspace,
} from '@/lib/types';
import {
  avatarById,
  cn,
  fd,
  RECUR_OPTIONS,
  todayD,
  uuid,
} from '@/lib/utils';
import { usePlannerStore } from '@/store/plannerStore';
import {
  Edit02Icon,
  Link01Icon,
  PlusSignIcon,
  Progress02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Asterisk,
  Check,
  CheckSquare,
  ChevronDown,
  ExternalLink,
  FileText,
  Flag,
  History,
  Link2,
  Paperclip,
  Pencil,
  Plus,
  Repeat,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { parseDate } from '@internationalized/date';
import { useMemo, useRef, useState } from 'react';

interface Props {
  ws: Workspace;
  task: Task;
  isNew?: boolean;
  onClose: () => void;
}

// Sticky search field for the top of a long dropdown menu. Stops keydown from
// bubbling so the menu's own type-ahead/arrow handling doesn't steal focus.
function MenuSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="sticky top-0 z-10 bg-popover px-1.5 pt-1 pb-1.5 border-b border-border">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder={placeholder}
        className="w-full h-7 px-2 text-[12px] rounded-md border border-border bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
    </div>
  );
}

// Linear-style property label: tiny, uppercase, muted — sits above a pill/control.
const labelClass = 'flex flex-col gap-1 text-[10.5px] text-muted-foreground';

const RECUR_LABEL = Object.fromEntries(
  RECUR_OPTIONS.map((o) => [o.freq, o.label])
) as Record<RecurrenceFreq, string>;

export default function TaskEditor({
  ws,
  task: initial,
  isNew,
  onClose,
}: Props) {
  const { updateTask, deleteTask, cancelNewTask, addLane, jumpToTask } =
    usePlannerStore();
  const canEdit = useCanWrite(ws.id);
  // On touch devices auto-focusing the title would pop the keyboard over the
  // form (and scroll a long title out of view) before the user has read it.
  const isTouch = useIsCoarsePointer();

  const [t, setT] = useState<Task>({
    ...initial,
  });
  const [check, setCheck] = useState<ChecklistItem[]>(
    JSON.parse(JSON.stringify(initial.checklist || []))
  );
  const [milestones, setMs] = useState<TaskMilestone[]>(
    JSON.parse(JSON.stringify(initial.milestones || []))
  );
  const [comments, setComments] = useState<TaskComment[]>(
    JSON.parse(JSON.stringify(initial.comments || []))
  );
  const [attachments, setAttachments] = useState<TaskAttachment[]>(
    JSON.parse(JSON.stringify(initial.attachments || []))
  );
  const [links, setLinks] = useState<TaskLink[]>(
    JSON.parse(JSON.stringify(initial.links || []))
  );
  // Link ids currently shown as editable inputs; anything else with a URL
  // renders as a finished hyperlink.
  const [editingLinks, setEditingLinks] = useState<Set<string>>(new Set());
  const [newComment, setNewComment] = useState('');
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [ownerError, setOwnerError] = useState(false);
  const [laneError, setLaneError] = useState(false);
  const [newLaneName, setNewLaneName] = useState<string | null>(null);
  // Single-select pickers are controlled so a choice closes the menu; the
  // multi-select pickers (assignees / labels / deps) stay open by default.
  const [laneOpen, setLaneOpen] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const notesBackdropRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const [mention, setMention] = useState<{
    query: string;
    start: number;
    end: number;
    activeIndex: number;
  } | null>(null);
  const [commentMention, setCommentMention] = useState<{
    query: string;
    start: number;
    end: number;
    activeIndex: number;
  } | null>(null);
  // Search text for the long pickers (assignees, workstream, dependencies).
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [laneQuery, setLaneQuery] = useState('');
  const [depQuery, setDepQuery] = useState('');
  // Basic view is Name/Assignee/Dates/Workstream/Progress; everything else
  // (dependencies, recurrence, notes, checklist/milestones/attachments/links,
  // comments) is opt-in via this toggle to keep new-task creation fast.
  // Defaults open when any of those already have content, so editing an
  // existing task with e.g. notes set doesn't hide them.
  const hasAdvancedContent =
    (initial.dependencies?.length ?? 0) > 0 ||
    !!initial.recurrence ||
    !!initial.notes.trim() ||
    (initial.checklist?.length ?? 0) > 0 ||
    (initial.milestones?.length ?? 0) > 0 ||
    (initial.attachments?.length ?? 0) > 0 ||
    (initial.links?.length ?? 0) > 0 ||
    (initial.comments?.length ?? 0) > 0;
  const [advancedOpen, setAdvancedOpen] = useState(hasAdvancedContent);

  // Dependency options: every other task in this workspace. A task cannot
  // depend on itself, nor on anything that (transitively) depends on it —
  // that would create a cycle.
  const depIds = t.dependencies ?? [];
  const taskById = (id: string) => ws.tasks.find((x) => x.id === id);
  const depNameOf = (id: string) => taskById(id)?.name ?? id;
  // Set of tasks that already depend on THIS task (its successors); picking any
  // of them as a predecessor would form a loop, so they're disabled. Memoised
  // so unrelated edits (typing the title/notes) don't re-run the BFS.
  const successorIds = useMemo(() => {
    const out = new Set<string>();
    const queue = [t.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const x of ws.tasks) {
        if (out.has(x.id)) continue;
        // A task's live dependencies come from the store, except for the task
        // being edited, whose in-progress `depIds` we use.
        const deps = x.id === t.id ? depIds : x.dependencies ?? [];
        if (deps.includes(cur)) {
          out.add(x.id);
          queue.push(x.id);
        }
      }
    }
    return out;
    // depIds identity changes only when dependencies change (patch replaces the array).
  }, [ws.tasks, t.id, depIds]);
  const depOptions = ws.tasks.filter((x) => x.id !== initial.id);
  const toggleDep = (id: string) =>
    patch({
      dependencies: depIds.includes(id)
        ? depIds.filter((x) => x !== id)
        : [...depIds, id],
    });
  // Select/deselect every (non-cyclic) task in a whole workstream at once.
  // If all selectable tasks in the group are already deps, clear them;
  // otherwise add the ones that are missing.
  const toggleDepGroup = (ids: string[]) => {
    const selectable = ids.filter((id) => !successorIds.has(id));
    if (!selectable.length) return;
    const allOn = selectable.every((id) => depIds.includes(id));
    patch({
      dependencies: allOn
        ? depIds.filter((id) => !selectable.includes(id))
        : [...new Set([...depIds, ...selectable])],
    });
  };

  // Tasks that list THIS one as a predecessor — i.e. tasks this one "blocks".
  // Read from the live store so it reflects saved edges even before this task's
  // own draft is saved.
  const successorTasks = ws.tasks.filter((x) =>
    (x.dependencies ?? []).includes(initial.id)
  );
  const laneColorOf = (laneId: string) =>
    ws.lanes.find((l) => l.id === laneId)?.color;

  const patch = (p: Partial<Task>) => setT((prev) => ({ ...prev, ...p }));

  // Linear-style property pill: compact, content-width, subtle border that
  // fills on hover/open. The icon + value carries the meaning, so no fixed width.
  const triggerBase =
    'group inline-flex items-center gap-1.5 h-7 px-2.5 outline-none cursor-pointer normal-case tracking-normal font-normal text-[12px] text-foreground border border-border rounded-md bg-transparent transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 data-[popup-open]:bg-accent';
  const chevron = (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground transition-colors duration-80 group-hover:text-foreground"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );

  // Assignee options: real profiles when available, else legacy name roster.
  // `allAssigneeOptions` resolves names/avatars for anyone already assigned
  // (even if they've since left the workspace); the picker itself only offers
  // `assigneeOptions`, scoped to this workspace's own People list (ws.members)
  // so a task can only be newly assigned to someone who belongs here.
  const members = usePlannerStore((s) => s.data.members);
  const userList = usePlannerStore((s) => s.data.userList);
  const allAssigneeOptions = members.length
    ? filterNzTeamMembers(members).map((m) => ({
        id: m.id,
        name: m.displayName,
        avatarUrl: m.avatarUrl,
      }))
    : filterNzTeamNames(userList, members).map((u) => ({ id: u, name: u, avatarUrl: '' })); // fallback: id === name
  const wsMemberNames = new Set(ws.members ?? []);
  const assigneeOptions = allAssigneeOptions.filter((o) => wsMemberNames.has(o.name));
  // Owner-name fallback upgrades to the matching profile id when one exists, so
  // quick-create flows that only set `owner` (e.g. People "+ Task") prefill the
  // picker — saving then diffs assignees and fires the 'assigned' notification.
  const selectedIds = t.assignees?.length
    ? t.assignees
    : t.owner
      ? [allAssigneeOptions.find((o) => o.name === t.owner)?.id ?? t.owner]
      : [];
  const nameOf = (id: string) =>
    allAssigneeOptions.find((o) => o.id === id)?.name ?? id;
  const avatarOf = (id: string) =>
    allAssigneeOptions.find((o) => o.id === id)?.avatarUrl ?? '';

  // Tagging someone (in notes or a comment) also assigns them to the task.
  const assignFromMention = (personId: string) => {
    if (selectedIds.includes(personId)) return;
    const next = [...selectedIds, personId];
    patch({ assignees: next, owner: nameOf(next[0]) });
    setOwnerError(false);
  };

  const mentionMatches = mention
    ? assigneeOptions
        .filter((o) =>
          o.name.toLowerCase().includes(mention.query.toLowerCase())
        )
        .slice(0, 6)
    : [];
  const insertMention = (person: { id: string; name: string }) => {
    if (!mention) return;
    const before = t.notes.slice(0, mention.start);
    const after = t.notes.slice(mention.end);
    const insertion = `@${person.name} `;
    patch({ notes: `${before}${insertion}${after}` });
    setMention(null);
    assignFromMention(person.id);
    requestAnimationFrame(() => {
      const el = notesRef.current;
      if (!el) return;
      el.focus();
      const pos = before.length + insertion.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const commentMentionMatches = commentMention
    ? assigneeOptions
        .filter((o) =>
          o.name.toLowerCase().includes(commentMention.query.toLowerCase())
        )
        .slice(0, 6)
    : [];
  const insertCommentMention = (person: { id: string; name: string }) => {
    if (!commentMention) return;
    const before = newComment.slice(0, commentMention.start);
    const after = newComment.slice(commentMention.end);
    const insertion = `@${person.name} `;
    setNewComment(`${before}${insertion}${after}`);
    setCommentMention(null);
    assignFromMention(person.id);
    requestAnimationFrame(() => {
      const el = commentInputRef.current;
      if (!el) return;
      el.focus();
      const pos = before.length + insertion.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const toggleAssignee = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    // Keep legacy `owner` pointed at the primary (first) assignee's display name.
    patch({ assignees: next, owner: next.length ? nameOf(next[0]) : '' });
    setOwnerError(false);
  };

  const addChecklistItem = () => {
    const id = uuid();
    setCheck((prev) => [...prev, { id, text: '', done: false }]);
    setLastAddedId(id);
  };

  const addMilestone = () => {
    const id = uuid();
    setMs((prev) => [...prev, { id, label: '', date: t.end }]);
    setLastAddedId(id);
  };

  const user = useAuthUser();
  const authorName =
    (user?.user_metadata?.full_name as string) ||
    (user?.user_metadata?.name as string) ||
    user?.email ||
    'You';
  // Comments post immediately (like chat), independent of the task's main
  // Save button — everything else in this modal is a local draft that only
  // commits on Save, but that meant a posted comment silently vanished if you
  // closed the modal any other way (Escape, backdrop click, the X). Patches
  // the live stored task (not the local draft `t`) so posting a comment can't
  // also save whatever other unsaved edits are sitting in the draft.
  const postComment = () => {
    const text = newComment.trim();
    if (!text) return;
    const comment: TaskComment = {
      id: uuid(),
      authorId: user?.id ?? '',
      authorName,
      text,
      createdAt: new Date().toISOString(),
    };
    setComments((prev) => [...prev, comment]);
    setNewComment('');
    const live = usePlannerStore
      .getState()
      .data.workspaces.find((w) => w.id === ws.id)
      ?.tasks.find((x) => x.id === t.id);
    if (live) {
      updateTask(ws.id, { ...live, comments: [...(live.comments ?? []), comment] });
    }
  };

  const deleteComment = (id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
    const live = usePlannerStore
      .getState()
      .data.workspaces.find((w) => w.id === ws.id)
      ?.tasks.find((x) => x.id === t.id);
    if (live) {
      updateTask(ws.id, { ...live, comments: (live.comments ?? []).filter((c) => c.id !== id) });
    }
  };

  // Activity log — swaps the dialog body/footer for a read-only history view,
  // fetched on demand (it isn't part of the eagerly-loaded planner store).
  const [showLog, setShowLog] = useState(false);
  const [logEntries, setLogEntries] = useState<ActivityLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  const openActivityLog = async () => {
    setShowLog(true);
    setLogLoading(true);
    const entries = await db.fetchTaskActivity(initial.id);
    setLogEntries(entries);
    setLogLoading(false);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const openFilePicker = () => fileInputRef.current?.click();

  const readFileAsDataURL = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const onPickFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1);
      try {
        const id = uuid();
        if (supabase) {
          const res = await db.uploadAttachment(t.id, id, file);
          if (!res) {
            alert(`Upload failed: ${file.name}`);
            continue;
          }
          setAttachments((prev) => [
            ...prev,
            {
              id,
              name: file.name,
              url: res.url,
              path: res.path,
              size: file.size,
              type: file.type,
            },
          ]);
        } else {
          // No backend configured — embed the file so it still works in local mode.
          const url = await readFileAsDataURL(file);
          setAttachments((prev) => [
            ...prev,
            { id, name: file.name, url, size: file.size, type: file.type },
          ]);
        }
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (i: number) => {
    const a = attachments[i];
    if (a?.path) db.deleteAttachment(a.path);
    setAttachments((prev) => prev.filter((_, j) => j !== i));
  };

  const fmtBytes = (n?: number) => {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  const addLink = () => {
    const id = uuid();
    setLinks((prev) => [...prev, { id, label: '', url: '' }]);
    setEditingLinks((prev) => new Set(prev).add(id));
    setLastAddedId(id);
  };

  const finishLink = (id: string) =>
    setEditingLinks((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  const editLink = (id: string) =>
    setEditingLinks((prev) => new Set(prev).add(id));

  // Prefer the MIME type, fall back to the file extension, to spot images.
  const isImage = (a: TaskAttachment) =>
    (a.type?.startsWith('image/') ?? false) ||
    /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(a.name);
  const hostOf = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  const commitNewLane = () => {
    const label = (newLaneName ?? '').trim();
    if (!label) return;
    const lane: Lane = {
      id: uuid(),
      label,
      color: ws.color ?? '#C63663',
    };
    addLane(ws.id, lane);
    patch({ lane: lane.id });
    setLaneError(false);
    setNewLaneName(null);
  };

  const currentLane = ws.lanes.find((l) => l.id === t.lane);

  const handleSave = () => {
    // Compulsory fields: a task must have a workstream and at least one assignee.
    const missingLane = !t.lane;
    const missingAssignee = selectedIds.length === 0;
    setLaneError(missingLane);
    setOwnerError(missingAssignee);
    if (missingLane || missingAssignee) return;
    const completingNoDate = t.noDate && t.pct >= 100;
    const today = fd(todayD());
    const updated: Task = {
      ...t,
      ...(completingNoDate ? { noDate: false, start: today, end: today } : {}),
      ...(!t.noDate && !completingNoDate
        ? { end: t.end < t.start ? t.start : t.end }
        : {}),
      checklist: check.filter((c) => c.text.trim()),
      milestones: milestones.filter((m) => m.label.trim() && m.date),
      comments: comments.filter((c) => c.text.trim()),
      attachments: attachments.filter((a) => a.url),
      links: links
        .filter((l) => l.url.trim())
        .map((l) => ({ ...l, label: l.label.trim() || l.url.trim() })),
    };
    // updateTask now owns recurrence sync (regenerates occurrences when the
    // rule changed), so the component no longer diffs it here.
    updateTask(ws.id, updated);
    onClose();
  };

  const handleDelete = () => {
    // Remove any uploaded files for this task from storage.
    attachments.forEach((a) => a.path && db.deleteAttachment(a.path));
    onClose();
    deleteTask(ws.id, t.id);
  };

  const handleCancel = () => {
    // Discarding: clean up files uploaded this session that were never saved.
    const savedPaths = new Set(
      (initial.attachments ?? []).map((a) => a.path).filter(Boolean)
    );
    attachments.forEach(
      (a) => a.path && !savedPaths.has(a.path) && db.deleteAttachment(a.path)
    );
    if (isNew) cancelNewTask(ws.id, t.id);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent
        data-astryx-theme="neutral"
        className="sm:max-w-4xl max-h-[92dvh] sm:max-h-[75vh] overflow-y-auto gap-0 p-0"
      >
        {/* Header */}
        <DialogHeader className="border-b border-border px-5 pt-4 pb-0">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-1.5 text-[16px] font-normal text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Dot color={ws.color} />
                {ws.name}
              </span>
              <span className="text-muted-foreground/40">›</span>
              <span className="flex flex-row gap-1 text-muted-foreground whitespace-nowrap">
                <HugeiconsIcon
                  icon={Edit02Icon}
                  className="size-4 text-muted-foreground pt-1"
                />
                {isNew ? 'New task' : 'Edit task'}
              </span>
            </DialogTitle>
          </div>
          {/* Existing tasks get a Details / Activity switch under the breadcrumb;
              new tasks have no history yet so the tab row is omitted. */}
          {!isNew ? (
            <div data-astryx-theme="neutral" className="mt-1">
              <TabList
                size="sm"
                value={showLog ? 'activity' : 'details'}
                onChange={(v) =>
                  v === 'activity' ? openActivityLog() : setShowLog(false)
                }
              >
                <Tab
                  value="details"
                  label="Details"
                  icon={<FileText size={14} strokeWidth={1.75} />}
                />
                <Tab
                  value="activity"
                  label="Activity"
                  icon={<History size={14} strokeWidth={1.75} />}
                />
              </TabList>
            </div>
          ) : (
            <div className="pb-3" />
          )}
        </DialogHeader>

        {showLog ? (
          <div data-astryx-theme="neutral" className="px-5 py-4">
            {logLoading ? (
              <div className="py-6 text-center">
                <Text color="secondary">Loading…</Text>
              </div>
            ) : logEntries.length === 0 ? (
              <EmptyState
                isCompact
                icon={<Icon icon="clock" size="lg" color="secondary" />}
                title="No activity recorded yet"
                description="Changes to this task will show up here."
              />
            ) : (
              <List density="compact" hasDividers>
                {logEntries.map((e) => {
                  const EntryIcon = activityIcon(e);
                  const color = activityColor(e);
                  return (
                    <ListItem
                      key={e.id}
                      label={e.actorName || 'Someone'}
                      description={<ActivityMessage message={e.message} field={e.field ?? e.action} ws={ws} />}
                      startContent={
                        <span className="relative inline-flex flex-none">
                          <Avatar name={e.actorName} src={avatarById(members, e.actorId)} size={42} />
                          <span
                            className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full"
                            style={{ background: 'var(--panel)', color, border: '1px solid var(--panel)' }}
                          >
                            <EntryIcon className="h-[18px] w-[18px]" />
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
        ) : (
          <>
            {/* Body */}
            <div className="flex flex-col gap-4 px-5 py-4">
              {/* Title */}
              <TextInput
                label="Task title"
                isLabelHidden
                hasAutoFocus={!isTouch}
                placeholder="Task title"
                value={t.name}
                onChange={(v) => patch({ name: v })}
                width="100%"
                className="task-title-input"
              />

              {/* Property pill row — every chip is an identical h-8 control that opens
            a menu/popover. Ordered by how often each is set. */}
              <div className="flex flex-wrap items-center gap-1.5">
                {/* Assignees */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className={cn(
                          triggerBase,
                          ' justify-between',
                          ownerError &&
                            'border-[color:var(--raspberry)] text-[color:var(--raspberry)]'
                        )}
                      >
                        <span className="inline-flex flex-wrap items-center gap-1 min-w-0">
                          {selectedIds.length === 0 ? (
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <Plus size={13} strokeWidth={2} />
                              Assignee
                              <Asterisk
                                size={14}
                                strokeWidth={3}
                                className="text-[color:var(--raspberry)]"
                                aria-label="Required"
                              />
                            </span>
                          ) : selectedIds.length === 1 ? (
                            selectedIds.map((id) => (
                              <span
                                key={id}
                                className="inline-flex items-center gap-1"
                              >
                                <Avatar
                                  name={nameOf(id)}
                                  src={avatarOf(id)}
                                  size={16}
                                />
                                {nameOf(id)}
                              </span>
                            ))
                          ) : (
                            // 2 or more: collapse to overlapping avatars + a count.
                            <span className="inline-flex items-center">
                              {selectedIds.map((id, i) => (
                                <span
                                  key={id}
                                  className={cn(
                                    'rounded-full ring-2 ring-background',
                                    i > 0 && '-ml-1.5'
                                  )}
                                  style={{ zIndex: selectedIds.length - i }}
                                >
                                  <Avatar
                                    name={nameOf(id)}
                                    src={avatarOf(id)}
                                    size={18}
                                  />
                                </span>
                              ))}
                              <span className="ml-1.5 text-muted-foreground">
                                {selectedIds.length}
                              </span>
                            </span>
                          )}
                        </span>
                        {chevron}
                      </button>
                    }
                  />
                  <DropdownMenuContent className="w-auto min-w-[13rem] max-h-72 overflow-y-auto p-0">
                    {assigneeOptions.length > 6 && (
                      <MenuSearch
                        value={assigneeQuery}
                        onChange={setAssigneeQuery}
                        placeholder="Search people…"
                      />
                    )}
                    <div className="p-1">
                      {assigneeOptions.length === 0 ? (
                        <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
                          No people yet
                        </div>
                      ) : (
                        (() => {
                          const q = assigneeQuery.trim().toLowerCase();
                          const filtered = q
                            ? assigneeOptions.filter((o) =>
                                o.name.toLowerCase().includes(q)
                              )
                            : assigneeOptions;
                          if (!filtered.length)
                            return (
                              <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
                                No matches
                              </div>
                            );
                          return filtered.map((o) => (
                            <DropdownMenuCheckboxItem
                              key={o.id}
                              checked={selectedIds.includes(o.id)}
                              onCheckedChange={() => toggleAssignee(o.id)}
                              closeOnClick={false}
                            >
                              <Avatar
                                name={o.name}
                                src={o.avatarUrl || undefined}
                                size={20}
                              />
                              <span className="truncate">{o.name}</span>
                            </DropdownMenuCheckboxItem>
                          ));
                        })()
                      )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Dates — BoardUI range picker with unrestricted future navigation. */}
                <DateRangePicker
                  aria-label="Task date range"
                  value={
                    t.noDate
                      ? null
                      : { start: parseDate(t.start), end: parseDate(t.end) }
                  }
                  placeholder="No fixed date"
                  clearLabel="No fixed date"
                  onChange={(range) =>
                    patch(
                      range
                        ? {
                            noDate: false,
                            start: range.start.toString(),
                            end: range.end.toString(),
                          }
                        : { noDate: true }
                    )
                  }
                />

                {/* Workstream — required to save, so it stays in the basic
                    view rather than behind Advanced options. */}
                {newLaneName !== null ? (
                  <span className="flex gap-1">
                    <TextInput
                      label="Workstream name"
                      isLabelHidden
                      hasAutoFocus
                      size="sm"
                      width={176}
                      placeholder="Workstream name"
                      value={newLaneName}
                      onChange={(v) => setNewLaneName(v)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitNewLane();
                        if (e.key === 'Escape') setNewLaneName(null);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={commitNewLane}
                      title="Add"
                    >
                      <Check size={14} strokeWidth={1.75} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setNewLaneName(null)}
                      title="Cancel"
                    >
                      <X size={14} strokeWidth={1.75} />
                    </Button>
                  </span>
                ) : (
                  <DropdownMenu open={laneOpen} onOpenChange={setLaneOpen}>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          className={cn(
                            triggerBase,
                            laneError &&
                              'border-[color:var(--raspberry)] text-[color:var(--raspberry)]'
                          )}
                        >
                          <span className="inline-flex items-center gap-1.5 truncate min-w-0">
                            {currentLane ? (
                              <>
                                <Dot color={currentLane.color} />
                                {currentLane.label}
                              </>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                Workstream
                                <Asterisk
                                  size={14}
                                  strokeWidth={3}
                                  className="text-[color:var(--raspberry)]"
                                  aria-label="Required"
                                />
                              </span>
                            )}
                          </span>
                          {chevron}
                        </button>
                      }
                    />
                    <DropdownMenuContent className="w-auto min-w-[13rem] max-h-72 overflow-y-auto p-0">
                      {ws.lanes.length > 6 && (
                        <MenuSearch
                          value={laneQuery}
                          onChange={setLaneQuery}
                          placeholder="Search workstreams…"
                        />
                      )}
                      <div className="p-1">
                        <DropdownMenuRadioGroup
                          value={t.lane ?? ''}
                          onValueChange={(v) => {
                            patch({ lane: v });
                            setLaneError(false);
                            setLaneOpen(false);
                          }}
                        >
                          {(() => {
                            const q = laneQuery.trim().toLowerCase();
                            const lanes = q
                              ? ws.lanes.filter((l) =>
                                  l.label.toLowerCase().includes(q)
                                )
                              : ws.lanes;
                            if (!lanes.length)
                              return (
                                <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
                                  No matches
                                </div>
                              );
                            return lanes.map((l) => (
                              <DropdownMenuRadioItem
                                key={l.id}
                                value={l.id}
                                className="pl-2"
                              >
                                <Dot color={l.color} />
                                {l.label}
                              </DropdownMenuRadioItem>
                            ));
                          })()}
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            setNewLaneName('');
                            setLaneOpen(false);
                          }}
                        >
                          <Plus size={14} strokeWidth={1.75} />
                          Add workstream…
                        </DropdownMenuItem>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

              </div>

              {(laneError || ownerError) && (
                <p className="text-[12px] text-[color:var(--raspberry)]">
                  {laneError && ownerError
                    ? 'Workstream and assignee are required.'
                    : laneError
                      ? 'Workstream is required.'
                      : 'Assignee is required.'}
                </p>
              )}

              {/* Advanced options — everything past the basic fields (dates,
                  workstream, status, assignee, progress): dependencies,
                  recurrence, notes, checklist/milestones/attachments/links.
                  Collapsed by default for a new task so creating one is just
                  name + the basics; auto-opens when editing a task that
                  already has any of that content set. */}
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="self-start inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown
                  size={14}
                  strokeWidth={1.75}
                  className={cn('transition-transform', !advancedOpen && '-rotate-90')}
                />
                Advanced options
              </button>

              {advancedOpen && (
                <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/20 px-3 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                {/* Repeat — Outlook-style recurrence. Only on dated TEMPLATE
                    tasks; a generated occurrence (recurrenceParentId set) can't
                    itself repeat, matching the Gantt row-menu guard. */}
                {!t.noDate && !t.recurrenceParentId && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button type="button" className={triggerBase}>
                          <span className="inline-flex items-center gap-1.5 truncate text-muted-foreground">
                            <Repeat size={13} strokeWidth={1.75} />
                            {t.recurrence
                              ? RECUR_LABEL[t.recurrence.freq]
                              : 'Does not repeat'}
                          </span>
                          {chevron}
                        </button>
                      }
                    />
                    <DropdownMenuContent className="w-auto min-w-[13rem]">
                      <DropdownMenuRadioGroup
                        value={t.recurrence?.freq ?? 'none'}
                        onValueChange={(v) =>
                          patch({
                            recurrence:
                              v === 'none'
                                ? undefined
                                : {
                                    freq: v as RecurrenceFreq,
                                    count: t.recurrence?.count ?? 6,
                                  },
                          })
                        }
                      >
                        <DropdownMenuRadioItem value="none" className="pl-2">
                          Does not repeat
                        </DropdownMenuRadioItem>
                        {RECUR_OPTIONS.map((o) => (
                          <DropdownMenuRadioItem
                            key={o.freq}
                            value={o.freq}
                            className="pl-2"
                          >
                            {o.label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      {t.recurrence && (
                        <>
                          <DropdownMenuSeparator />
                          <div className="flex items-center gap-2 px-2 py-1.5 text-[12px]">
                            <span className="text-muted-foreground">Occurrences</span>
                            <input
                              type="number"
                              min={2}
                              max={52}
                              value={t.recurrence.count}
                              onChange={(e) => {
                                const n = Math.max(
                                  2,
                                  Math.min(52, Number(e.target.value) || 2)
                                );
                                patch({
                                  recurrence: {
                                    freq: t.recurrence!.freq,
                                    count: n,
                                  },
                                });
                              }}
                              className="w-16 h-7 px-2 rounded-md border border-border bg-transparent outline-none"
                            />
                          </div>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Generated occurrence: read-only "part of a series" badge with
                    a jump back to the template. */}
                {t.recurrenceParentId && (
                  <button
                    type="button"
                    className={cn(triggerBase, 'text-muted-foreground')}
                    title="Open the recurring series template"
                    onClick={() => {
                      const parentId = t.recurrenceParentId!;
                      onClose();
                      jumpToTask(ws.id, parentId);
                    }}
                  >
                    <Repeat size={13} strokeWidth={1.75} />
                    Part of a series
                  </button>
                )}

                {/* Depends on — successors auto-shift when a predecessor moves */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button type="button" className={triggerBase}>
                        <span className="inline-flex items-center gap-1.5 truncate min-w-0 text-muted-foreground">
                          <Link2 size={13} strokeWidth={1.75} />
                          {depIds.length === 0
                            ? 'Depends on'
                            : depIds.length === 1
                              ? depNameOf(depIds[0])
                              : `${depIds.length} tasks`}
                        </span>
                        {chevron}
                      </button>
                    }
                  />
                  <DropdownMenuContent className="w-auto min-w-[15rem] max-h-72 overflow-y-auto p-0">
                    {depOptions.length > 6 && (
                      <MenuSearch
                        value={depQuery}
                        onChange={setDepQuery}
                        placeholder="Search tasks…"
                      />
                    )}
                    <div className="p-1">
                      {depOptions.length === 0 ? (
                        <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
                          No other tasks yet
                        </div>
                      ) : (
                        (() => {
                          const q = depQuery.trim().toLowerCase();
                          const filtered = q
                            ? depOptions.filter((o) =>
                                o.name.toLowerCase().includes(q)
                              )
                            : depOptions;
                          if (!filtered.length)
                            return (
                              <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
                                No matches
                              </div>
                            );
                          // Group tasks by their workstream (lane), following
                          // the lane order; tasks without a lane fall under
                          // "No workstream". Headers are omitted when only one
                          // group would show (keeps a single-lane list clean).
                          const groups = [
                            ...ws.lanes.map((l) => ({
                              id: l.id,
                              label: l.label,
                              color: l.color,
                            })),
                            { id: '', label: 'No workstream', color: undefined as string | undefined },
                          ]
                            .map((g) => ({
                              ...g,
                              items: filtered.filter((o) => (o.lane || '') === g.id),
                            }))
                            .filter((g) => g.items.length > 0);
                          const showHeaders = groups.length > 1;
                          const renderItem = (o: Task) => {
                            // Disable a task that already (transitively) depends
                            // on this one — selecting it would create a cycle.
                            const cyclic =
                              !depIds.includes(o.id) && successorIds.has(o.id);
                            return (
                              <DropdownMenuCheckboxItem
                                key={o.id}
                                checked={depIds.includes(o.id)}
                                disabled={cyclic}
                                onCheckedChange={() => toggleDep(o.id)}
                                closeOnClick={false}
                              >
                                <span className="truncate">{o.name}</span>
                                {cyclic && (
                                  <span className="ml-auto text-[10px] text-muted-foreground">
                                    would loop
                                  </span>
                                )}
                              </DropdownMenuCheckboxItem>
                            );
                          };
                          return groups.map((g) => {
                            const groupIds = g.items.map((o) => o.id);
                            const selectable = groupIds.filter(
                              (id) => !successorIds.has(id)
                            );
                            const allOn =
                              selectable.length > 0 &&
                              selectable.every((id) => depIds.includes(id));
                            return (
                              <DropdownMenuGroup key={g.id || 'none'}>
                                {showHeaders && (
                                  <DropdownMenuLabel className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-muted-foreground">
                                    {g.color && (
                                      <span
                                        className="inline-block w-2 h-2 rounded-full"
                                        style={{ background: g.color }}
                                      />
                                    )}
                                    <span className="truncate">{g.label}</span>
                                    {selectable.length > 0 && (
                                      <button
                                        type="button"
                                        className="ml-auto text-[10px] normal-case tracking-normal text-[color:var(--beetroot)] hover:underline"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          toggleDepGroup(groupIds);
                                        }}
                                      >
                                        {allOn ? 'Clear' : 'Select all'}
                                      </button>
                                    )}
                                  </DropdownMenuLabel>
                                )}
                                {g.items.map(renderItem)}
                              </DropdownMenuGroup>
                            );
                          });
                        })()
                      )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
                </div>

                {/* Relationships — the dependency graph around this task in both
                    directions. "Depends on" (predecessors, editable here) and
                    "Blocks" (successors that name this task; owned by those tasks
                    so shown read-only). When either bar moves, the whole chain
                    moves together on the timeline. */}
                {(depIds.length > 0 || successorTasks.length > 0) && (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  {depIds.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground pt-0.5 w-[74px]">
                        <Link2 size={12} strokeWidth={1.75} />
                        Depends on
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {depIds.map((id) => {
                          const dep = taskById(id);
                          return (
                            <span
                              key={id}
                              className="group/rel inline-flex items-center gap-1.5 h-6 pl-1.5 pr-1 rounded-md border border-border bg-background text-[12px]"
                            >
                              <Dot
                                color={
                                  (dep && laneColorOf(dep.lane)) ??
                                  'var(--muted)'
                                }
                              />
                              <button
                                type="button"
                                title="Open this task"
                                className="truncate max-w-[180px] hover:underline"
                                onClick={() => {
                                  onClose();
                                  jumpToTask(ws.id, id);
                                }}
                              >
                                {dep?.name ?? depNameOf(id)}
                              </button>
                              {canEdit && (
                                <button
                                  type="button"
                                  aria-label="Remove dependency"
                                  className="opacity-40 group-hover/rel:opacity-100 transition-opacity"
                                  onClick={() => toggleDep(id)}
                                >
                                  <X size={12} strokeWidth={2} />
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {successorTasks.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground pt-0.5 w-[74px]">
                        <Flag size={12} strokeWidth={1.75} />
                        Blocks
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {successorTasks.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            title="Depends on this task — click to open it"
                            className="inline-flex items-center gap-1.5 h-6 px-1.5 rounded-md border border-dashed border-border bg-background/60 text-[12px] text-muted-foreground hover:border-solid hover:text-foreground transition-colors"
                            onClick={() => {
                              onClose();
                              jumpToTask(ws.id, s.id);
                            }}
                          >
                            <Dot color={laneColorOf(s.lane) ?? 'var(--muted)'} />
                            <span className="truncate max-w-[180px]">
                              {s.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div className="relative flex flex-col gap-1.5">
                <label className="text-[12px] text-muted-foreground">
                  Notes
                </label>
                <div className="relative">
                  {/* Backdrop mirrors the textarea's text with @mentions colored — the
                textarea on top has transparent text so only its caret/selection
                render, letting the colored text underneath show through. */}
                  <div
                    ref={notesBackdropRef}
                    aria-hidden
                    className="pointer-events-none absolute inset-0 min-h-16 w-full whitespace-pre-wrap break-words overflow-y-auto text-foreground"
                    style={{
                      font: 'inherit',
                      padding: '5px 8px',
                      border: '1.5px solid transparent',
                      borderRadius: 8,
                      background:
                        'color-mix(in srgb, var(--cauliflower) 45%, #fff)',
                    }}
                  >
                    {renderMentions(
                      t.notes,
                      assigneeOptions.map((o) => o.name)
                    )}
                    {t.notes.endsWith('\n') ? '​' : null}
                  </div>
                  <TextArea
                    ref={notesRef}
                    label="Notes"
                    isLabelHidden
                    rows={3}
                    width="100%"
                    placeholder="Add a description… type @ to tag someone"
                    value={t.notes}
                    className="mention-input"
                    onScroll={(e: React.UIEvent<HTMLTextAreaElement>) => {
                      if (notesBackdropRef.current)
                        notesBackdropRef.current.scrollTop =
                          e.currentTarget.scrollTop;
                    }}
                    onChange={(value, e) => {
                      patch({ notes: value });
                      const cursor = e.target.selectionStart ?? value.length;
                      const m = detectMention(value, cursor);
                      setMention(m ? { ...m, activeIndex: 0 } : null);
                    }}
                    onKeyDown={(e) => {
                      if (!mention || mentionMatches.length === 0) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setMention(
                          (m) =>
                            m && {
                              ...m,
                              activeIndex:
                                (m.activeIndex + 1) % mentionMatches.length,
                            }
                        );
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setMention(
                          (m) =>
                            m && {
                              ...m,
                              activeIndex:
                                (m.activeIndex - 1 + mentionMatches.length) %
                                mentionMatches.length,
                            }
                        );
                      } else if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        insertMention(mentionMatches[mention.activeIndex]);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setMention(null);
                      }
                    }}
                    onBlur={() => setTimeout(() => setMention(null), 150)}
                  />
                </div>
                {mention && mentionMatches.length > 0 && (
                  <div className="absolute z-20 top-full left-0 mt-1 w-56 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1">
                    {mentionMatches.map((o, i) => (
                      <button
                        key={o.id}
                        type="button"
                        className={cn(
                          'w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[13px]',
                          i === mention.activeIndex
                            ? 'bg-accent'
                            : 'hover:bg-accent'
                        )}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insertMention(o)}
                      >
                        <Avatar name={o.name} src={o.avatarUrl} size={18} />
                        <span className="truncate">{o.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
                </div>
              )}

              {/* Progress — inline draggable slider */}
              <div className="flex items-center gap-3 border-border pt-2">
                <div className="flex flex-row gap-2 text-[12px] text-muted-foreground pb-2 shrink-0 cursor-default">
                  <HugeiconsIcon
                    icon={Progress02Icon}
                    className="size-4 text-[#C63663]"
                  />
                  <span>Progress</span>
                </div>

                <Slider
                  className="flex-1 min-w-0"
                  value={t.pct || 0}
                  onChange={(v) =>
                    patch({ pct: v as number, boardBucket: null })
                  }
                  min={0}
                  max={100}
                  step={5}
                  showValue
                  valuePosition="right"
                  formatValue={(v) => `${v}%`}
                  fillStyle={{ background: 'var(--beetroot)' }}
                />
              </div>

              {advancedOpen && (
              <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/20 px-3 py-3">
              {check.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  <div className={`${labelClass} w-full`}>
                    <div className="list-edit-head">
                      <span className="flex items-center gap-1.5">
                        <CheckSquare
                          size={14}
                          strokeWidth={1.75}
                          className="text-muted-foreground"
                        />
                        <span>Checklist</span>
                      </span>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={addChecklistItem}
                            >
                              <Plus size={14} strokeWidth={1.75} />
                              Add
                            </Button>
                          }
                        />
                        <TooltipContent>Add checklist item</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="list-edit">
                      {check.map((it, i) => (
                        <div key={it.id} className="li">
                          <Checkbox
                            className="cursor-pointer data-checked:bg-[#c63663] data-checked:border-[#c63663]"
                            checked={it.done}
                            onCheckedChange={(v) =>
                              setCheck((prev) =>
                                prev.map((c, j) =>
                                  j === i
                                    ? {
                                        ...c,
                                        done: !!v,
                                      }
                                    : c
                                )
                              )
                            }
                          />
                          <span className="flex-1 min-w-0">
                            <TextInput
                              label="Checklist item"
                              isLabelHidden
                              size="sm"
                              width="100%"
                              hasAutoFocus={it.id === lastAddedId}
                              value={it.text}
                              onChange={(v) =>
                                setCheck((prev) =>
                                  prev.map((c, j) =>
                                    j === i
                                      ? {
                                          ...c,
                                          text: v,
                                        }
                                      : c
                                  )
                                )
                              }
                            />
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="del"
                            onClick={() =>
                              setCheck((prev) => prev.filter((_, j) => j !== i))
                            }
                          >
                            <X size={14} strokeWidth={1.75} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {milestones.length > 0 && (
                <div className="flex gap-2.5 mb-[11px] flex-wrap">
                  <div className={`${labelClass} w-full`}>
                    <div className="list-edit-head">
                      <span className="flex items-center gap-1.5">
                        <Flag
                          size={14}
                          strokeWidth={1.75}
                          className="text-muted-foreground"
                        />
                        <span>Milestones</span>
                      </span>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={addMilestone}
                            >
                              <Plus size={14} strokeWidth={1.75} />
                              Add
                            </Button>
                          }
                        />
                        <TooltipContent>Add milestone</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="list-edit">
                      {milestones.map((m, i) => (
                        <div key={m.id} className="li">
                          <span
                            style={{
                              color: 'var(--cabbage)',
                            }}
                          >
                            ◆
                          </span>
                          <span className="flex-1 min-w-0">
                            <TextInput
                              label="Milestone label"
                              isLabelHidden
                              size="sm"
                              width="100%"
                              hasAutoFocus={m.id === lastAddedId}
                              value={m.label}
                              onChange={(v) =>
                                setMs((prev) =>
                                  prev.map((x, j) =>
                                    j === i
                                      ? {
                                          ...x,
                                          label: v,
                                        }
                                      : x
                                  )
                                )
                              }
                            />
                          </span>
                          <DateInput
                            label="Milestone date"
                            isLabelHidden
                            size="sm"
                            width={150}
                            value={
                              (m.date || undefined) as ISODateString | undefined
                            }
                            onChange={(v) =>
                              setMs((prev) =>
                                prev.map((x, j) =>
                                  j === i
                                    ? {
                                        ...x,
                                        date: v ?? '',
                                      }
                                    : x
                                )
                              )
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="del"
                            onClick={() =>
                              setMs((prev) => prev.filter((_, j) => j !== i))
                            }
                          >
                            <X size={14} strokeWidth={1.75} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {(attachments.length > 0 || uploading > 0) && (
                <div className="flex flex-col gap-1.5">
                  <div className="list-edit-head">
                    <span className="flex items-center gap-1.5">
                      <Paperclip
                        size={14}
                        strokeWidth={1.75}
                        className="text-muted-foreground"
                      />
                      <span className="text-[12px] text-muted-foreground">
                        Attachments
                      </span>
                    </span>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={openFilePicker}
                            disabled={!canEdit}
                          >
                            <Plus size={14} strokeWidth={1.75} />
                            Add file
                          </Button>
                        }
                      />
                      <TooltipContent>Attach a file</TooltipContent>
                    </Tooltip>
                  </div>
                  <AttachmentGroup>
                    {attachments.map((a, i) => (
                      <Attachment key={a.id} orientation="vertical">
                        <AttachmentTrigger
                          render={
                            <a
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={a.name}
                            />
                          }
                        />
                        {isImage(a) ? (
                          <AttachmentMedia variant="image">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.url} alt={a.name} />
                          </AttachmentMedia>
                        ) : (
                          <AttachmentMedia variant="icon">
                            <FileText />
                          </AttachmentMedia>
                        )}
                        <AttachmentContent>
                          <AttachmentTitle>{a.name}</AttachmentTitle>
                          {a.size ? (
                            <AttachmentDescription>
                              {fmtBytes(a.size)}
                            </AttachmentDescription>
                          ) : null}
                        </AttachmentContent>
                        {canEdit && (
                          <AttachmentActions>
                            <AttachmentAction
                              aria-label="Remove attachment"
                              onClick={(e) => {
                                e.preventDefault();
                                removeAttachment(i);
                              }}
                            >
                              <X />
                            </AttachmentAction>
                          </AttachmentActions>
                        )}
                      </Attachment>
                    ))}
                    {uploading > 0 && (
                      <Attachment orientation="vertical" state="uploading">
                        <AttachmentMedia variant="icon">
                          <Paperclip />
                        </AttachmentMedia>
                        <AttachmentContent>
                          <AttachmentTitle>
                            Uploading {uploading} file{uploading > 1 ? 's' : ''}
                            …
                          </AttachmentTitle>
                        </AttachmentContent>
                      </Attachment>
                    )}
                  </AttachmentGroup>
                </div>
              )}

              {links.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="list-edit-head">
                    <span className="flex items-center gap-1.5">
                      <HugeiconsIcon
                        icon={Link01Icon}
                        className="size-4 text-muted-foreground"
                      />
                      <span className="text-[12px] text-muted-foreground">
                        Links
                      </span>
                    </span>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={addLink}
                          >
                            <Plus size={14} strokeWidth={1.75} />
                            Add
                          </Button>
                        }
                      />
                      <TooltipContent>Add link</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex flex-col gap-1">
                    {links.map((l, i) => {
                      const editing = editingLinks.has(l.id) || !l.url.trim();
                      if (editing) {
                        return (
                          <div key={l.id} className="flex items-center gap-1.5">
                            <TextInput
                              label="Link label"
                              isLabelHidden
                              size="sm"
                              width={160}
                              hasAutoFocus={l.id === lastAddedId}
                              placeholder="Label (optional)"
                              value={l.label}
                              onChange={(v) =>
                                setLinks((prev) =>
                                  prev.map((x, j) =>
                                    j === i ? { ...x, label: v } : x
                                  )
                                )
                              }
                            />
                            <span className="flex-1 min-w-0">
                              <TextInput
                                label="Link URL"
                                isLabelHidden
                                size="sm"
                                width="100%"
                                placeholder="https://…"
                                value={l.url}
                                onChange={(v) =>
                                  setLinks((prev) =>
                                    prev.map((x, j) =>
                                      j === i ? { ...x, url: v } : x
                                    )
                                  )
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && l.url.trim())
                                    finishLink(l.id);
                                }}
                              />
                            </span>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              disabled={!l.url.trim()}
                              onClick={() => finishLink(l.id)}
                              title="Done"
                            >
                              <Check size={14} strokeWidth={1.75} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() =>
                                setLinks((prev) =>
                                  prev.filter((_, j) => j !== i)
                                )
                              }
                              title="Remove"
                            >
                              <X size={14} strokeWidth={1.75} />
                            </Button>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={l.id}
                          className="group/link flex items-center gap-2 rounded-md border border-border px-2.5 h-9 hover:bg-accent transition-colors"
                        >
                          <Link2
                            size={14}
                            strokeWidth={1.75}
                            className="text-muted-foreground shrink-0"
                          />
                          <a
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 min-w-0 inline-flex items-baseline gap-1.5"
                          >
                            <span className="truncate text-[13px] text-[color:var(--beetroot-dark)] hover:underline">
                              {l.label.trim() || hostOf(l.url)}
                            </span>
                            {l.label.trim() && (
                              <span className="truncate text-[11px] text-muted-foreground">
                                {hostOf(l.url)}
                              </span>
                            )}
                          </a>
                          <ExternalLink
                            size={12}
                            strokeWidth={1.75}
                            className="text-muted-foreground shrink-0"
                          />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="opacity-0 group-hover/link:opacity-100"
                            onClick={() => editLink(l.id)}
                            title="Edit"
                          >
                            <Pencil size={13} strokeWidth={1.75} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() =>
                              setLinks((prev) => prev.filter((_, j) => j !== i))
                            }
                            title="Remove"
                          >
                            <X size={14} strokeWidth={1.75} />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(check.length === 0 ||
                milestones.length === 0 ||
                (attachments.length === 0 && uploading === 0) ||
                links.length === 0) && (
                <div className="flex flex-wrap items-center gap-1 border-border py-2">
                  <HugeiconsIcon
                    icon={PlusSignIcon}
                    className="size-4 text-[#C63663]"
                  />
                  <span className="text-[12px] text-muted-foreground mr-0.5">
                    Add
                  </span>
                  {check.length === 0 && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            onClick={addChecklistItem}
                            aria-label="Add checklist"
                          >
                            <CheckSquare strokeWidth={1.75} />
                          </Button>
                        }
                      />
                      <TooltipContent>Add checklist</TooltipContent>
                    </Tooltip>
                  )}
                  {milestones.length === 0 && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            onClick={addMilestone}
                            aria-label="Add milestone"
                          >
                            <Flag strokeWidth={1.75} />
                          </Button>
                        }
                      />
                      <TooltipContent>Add milestone</TooltipContent>
                    </Tooltip>
                  )}
                  {attachments.length === 0 && uploading === 0 && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            onClick={openFilePicker}
                            disabled={!canEdit}
                            aria-label="Add attachment"
                          >
                            <Paperclip strokeWidth={1.75} />
                          </Button>
                        }
                      />
                      <TooltipContent>Add attachment</TooltipContent>
                    </Tooltip>
                  )}
                  {links.length === 0 && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            onClick={addLink}
                            aria-label="Add link"
                          >
                            <Link2 strokeWidth={1.75} />
                          </Button>
                        }
                      />
                      <TooltipContent>Add link</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
              </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => onPickFiles(e.target.files)}
              />

              {advancedOpen && (
              <div className="flex gap-2.5 mb-[11px] flex-wrap">
                <div className={`${labelClass} w-full`}>
                  <div className="list-edit-head">
                    <span>Comments</span>
                    {comments.length > 0 && (
                      <span className="text-[12px] font-normal text-muted-foreground">
                        {comments.length}
                      </span>
                    )}
                  </div>
                  {comments.length > 0 && (
                    <div data-astryx-theme="neutral" className="mt-1 mb-2">
                      <ChatMessageList density="compact" gap={3}>
                        {comments.map((c) => {
                          // The signed-in author's own comments align right
                          // (sender=user); everyone else's align left.
                          const mine = !!user?.id && c.authorId === user.id;
                          return (
                            <ChatMessage
                              key={c.id}
                              sender={mine ? 'user' : 'assistant'}
                              avatar={
                                <Avatar
                                  name={c.authorName}
                                  src={avatarById(members, c.authorId)}
                                  size={28}
                                />
                              }
                            >
                              <ChatMessageBubble
                                name={mine ? undefined : c.authorName || 'Someone'}
                                metadata={
                                  <ChatMessageMetadata
                                    timestamp={
                                      <Timestamp value={c.createdAt} format="relative" />
                                    }
                                    footer={
                                      canEdit ? (
                                        <button
                                          type="button"
                                          className="text-[11px] text-muted-foreground hover:text-[color:var(--raspberry)] transition-colors"
                                          onClick={() => deleteComment(c.id)}
                                        >
                                          Delete
                                        </button>
                                      ) : undefined
                                    }
                                  />
                                }
                              >
                                <span className="whitespace-pre-wrap break-words">
                                  {renderMentions(
                                    c.text,
                                    assigneeOptions.map((o) => o.name)
                                  )}
                                </span>
                              </ChatMessageBubble>
                            </ChatMessage>
                          );
                        })}
                      </ChatMessageList>
                    </div>
                  )}
                  {canEdit && (
                    <span className="flex gap-1">
                      <span className="relative flex-1 min-w-0">
                        {/* Same backdrop trick as Notes: colors @mentions behind the
                      transparent-text input so the caret still renders on top. */}
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-0 overflow-hidden whitespace-nowrap flex items-center text-foreground"
                          style={{
                            font: 'inherit',
                            padding: '5px 8px',
                            border: '1.5px solid transparent',
                            borderRadius: 8,
                          }}
                        >
                          {renderMentions(
                            newComment,
                            assigneeOptions.map((o) => o.name)
                          )}
                        </div>
                        <TextInput
                          ref={commentInputRef}
                          label="Write a comment"
                          isLabelHidden
                          size="sm"
                          width="100%"
                          placeholder="Write a comment… type @ to tag someone"
                          value={newComment}
                          className="mention-input relative"
                          onChange={(value, e) => {
                            setNewComment(value);
                            const cursor =
                              e.target.selectionStart ?? value.length;
                            const m = detectMention(value, cursor);
                            setCommentMention(
                              m ? { ...m, activeIndex: 0 } : null
                            );
                          }}
                          onKeyDown={(e) => {
                            if (
                              commentMention &&
                              commentMentionMatches.length > 0
                            ) {
                              if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setCommentMention(
                                  (m) =>
                                    m && {
                                      ...m,
                                      activeIndex:
                                        (m.activeIndex + 1) %
                                        commentMentionMatches.length,
                                    }
                                );
                                return;
                              }
                              if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setCommentMention(
                                  (m) =>
                                    m && {
                                      ...m,
                                      activeIndex:
                                        (m.activeIndex -
                                          1 +
                                          commentMentionMatches.length) %
                                        commentMentionMatches.length,
                                    }
                                );
                                return;
                              }
                              if (e.key === 'Enter' || e.key === 'Tab') {
                                e.preventDefault();
                                insertCommentMention(
                                  commentMentionMatches[
                                    commentMention.activeIndex
                                  ]
                                );
                                return;
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setCommentMention(null);
                                return;
                              }
                            }
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              postComment();
                            }
                          }}
                          onBlur={() =>
                            setTimeout(() => setCommentMention(null), 150)
                          }
                        />
                        {commentMention && commentMentionMatches.length > 0 && (
                          <div className="absolute z-20 bottom-full left-0 mb-1 w-56 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1">
                            {commentMentionMatches.map((o, i) => (
                              <button
                                key={o.id}
                                type="button"
                                className={cn(
                                  'w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[13px]',
                                  i === commentMention.activeIndex
                                    ? 'bg-accent'
                                    : 'hover:bg-accent'
                                )}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => insertCommentMention(o)}
                              >
                                <Avatar
                                  name={o.name}
                                  src={o.avatarUrl}
                                  size={18}
                                />
                                <span className="truncate">{o.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </span>
                      <Button
                        variant="default"
                        size="default"
                        onClick={postComment}
                        disabled={!newComment.trim()}
                      >
                        <Send size={14} strokeWidth={1.25} />
                        Post
                      </Button>
                    </span>
                  )}
                </div>
              </div>
              )}
            </div>

            {/* Footer */}
            <DialogFooter className="mx-0 mb-0 items-center border-t bg-muted/50 px-5 py-3 sm:justify-between">
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={!canEdit}
              >
                <Trash2 data-icon="inline-start" strokeWidth={1.75} />
                Delete
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="ghost" onClick={handleCancel}>
                  {canEdit ? 'Cancel' : 'Close'}
                </Button>
                <Button
                  variant="default"
                  onClick={handleSave}
                  disabled={!canEdit}
                >
                  <Save data-icon="inline-start" strokeWidth={1.75} />
                  {isNew ? 'Create task' : 'Save'}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
