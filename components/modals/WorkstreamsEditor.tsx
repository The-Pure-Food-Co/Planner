'use client';
import { useState } from 'react';
import { Layers, Plus, X, Save } from 'lucide-react';
import { usePlannerStore } from '@/store/plannerStore';
import { useCanWrite } from '@/lib/permissions';
import { uuid } from '@/lib/utils';
import type { Workspace, Lane } from '@/lib/types';
import { ColorPickerPopover } from '@/components/ui/color-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const PALETTE = [
  '#C63663',
  '#93328E',
  '#FF7F32',
  '#6BA539',
  '#F2CD00',
  '#F8485E',
  '#943152',
  '#61215E',
  '#E35223',
  '#4B7328',
];

interface Props {
  ws: Workspace;
  onClose: () => void;
}

export default function WorkstreamsEditor({ ws, onClose }: Props) {
  const { updateWorkspace } = usePlannerStore();
  const canEdit = useCanWrite(ws.id);
  const [lanes, setLanes] = useState<Lane[]>(
    JSON.parse(JSON.stringify(ws.lanes))
  );
  const [newName, setNewName] = useState('');

  const addLane = () => {
    if (!canEdit) return;
    const n = newName.trim();
    if (!n) return;
    setLanes((prev) => [
      ...prev,
      {
        id: uuid(),
        label: n,
        color: PALETTE[prev.length % PALETTE.length],
      },
    ]);
    setNewName('');
  };

  const save = () => {
    if (!canEdit) return;
    onClose();
    const keep = new Set(lanes.map((l) => l.id));
    updateWorkspace({
      ...ws,
      lanes: lanes.filter((l) => l.label.trim()),
      tasks: ws.tasks.filter((t) => keep.has(t.lane)),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[16px] font-normal text-foreground">
            <Layers size={16} strokeWidth={1.75} className="text-muted-foreground" />
            Workstreams
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{ws.name}</p>
        </DialogHeader>
        <div className="list-edit" style={{ maxHeight: 500 }}>
          {lanes.map((l, i) => (
            <div key={l.id} className="li">
              <ColorPickerPopover
                value={l.color}
                triggerShowValue={false}
                triggerClassName="px-1.5"
                onValueChange={(v) => {
                  if (!canEdit) return;
                  setLanes((prev) =>
                    prev.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            color: v,
                          }
                        : x
                    )
                  );
                }}
              />
              <Input
                className="flex-1 min-w-0"
                value={l.label}
                disabled={!canEdit}
                onChange={(e) =>
                  setLanes((prev) =>
                    prev.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            label: e.target.value,
                          }
                        : x
                    )
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={!canEdit}
                onClick={() => {
                  if (!canEdit) return;
                  const taskCount = ws.tasks.filter(
                    (t) => t.lane === l.id
                  ).length;
                  if (
                    taskCount &&
                    !confirm(
                      `"${l.label}" has ${taskCount} task(s) — they will be deleted on save. Continue?`
                    )
                  )
                    return;
                  setLanes((prev) => prev.filter((_, j) => j !== i));
                }}
              >
                <X size={14} strokeWidth={1.75} />
              </Button>
            </div>
          ))}
        </div>
        <Field>
          <FieldLabel htmlFor="new-workstream" className="text-[10.5px] font-medium text-muted-foreground">Add workstream</FieldLabel>
          <div className="flex gap-1.5">
            <Input
              id="new-workstream"
              className="flex-1"
              value={newName}
              placeholder="Workstream name"
              disabled={!canEdit}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addLane()}
            />
            <Button variant="outline" disabled={!canEdit} onClick={addLane}>
              <Plus data-icon="inline-start" strokeWidth={1.75} />
              Add
            </Button>
          </div>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button variant="outline" disabled={!canEdit} onClick={save}>
            <Save data-icon="inline-start" strokeWidth={1.75} />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
