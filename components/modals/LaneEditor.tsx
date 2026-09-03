'use client';
import { useState } from 'react';
import { Pencil, Save, Trash2, BookmarkPlus } from 'lucide-react';
import { usePlannerStore } from '@/store/plannerStore';
import { useCanWrite } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { Lane } from '@/lib/types';
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

interface Props {
  wsId: string;
  lane: Lane;
  onClose: () => void;
}

export default function LaneEditor({ wsId, lane: initial, onClose }: Props) {
  const { updateLane, deleteLane, saveLaneAsTemplate } = usePlannerStore();
  const [lane, setLane] = useState<Lane>({ ...initial });
  const canEdit = useCanWrite(wsId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[16px] font-normal text-foreground">
            <Pencil size={16} strokeWidth={1.75} className="text-muted-foreground" />
            Edit workstream
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-2.5 flex-wrap">
          <Field className="flex-1 min-w-[120px]">
            <FieldLabel htmlFor="lane-label" className="text-[10.5px] font-medium text-muted-foreground">Label</FieldLabel>
            <Input
              id="lane-label"
              value={lane.label}
              disabled={!canEdit}
              onChange={(e) =>
                setLane((l) => ({
                  ...l,
                  label: e.target.value,
                }))
              }
            />
          </Field>
          <Field className="w-auto">
            <FieldLabel className="text-[10.5px] font-medium text-muted-foreground">Colour</FieldLabel>
            <ColorPickerPopover
              value={lane.color}
              onValueChange={(v) =>
                setLane((l) => ({
                  ...l,
                  color: v,
                }))
              }
            />
          </Field>
        </div>
        <DialogFooter className="flex-wrap gap-y-2 sm:justify-between">
          <Button
            variant="destructive"
            disabled={!canEdit}
            onClick={() => {
              onClose();
              deleteLane(wsId, lane.id);
            }}
          >
            <Trash2 data-icon="inline-start" strokeWidth={1.75} />
            Delete workstream
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button
              variant="ghost"
              disabled={!canEdit}
              title="Save this workstream (label, colour and tasks) as a shared template available to everyone"
              onClick={() => {
                saveLaneAsTemplate(wsId, lane.id, { label: lane.label.trim() || initial.label });
                onClose();
              }}
            >
              <BookmarkPlus data-icon="inline-start" strokeWidth={1.75} />
              Save as template
            </Button>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button
              variant="outline"
              disabled={!canEdit}
              onClick={() => {
                updateLane(wsId, {
                  ...lane,
                  label: lane.label.trim() || initial.label,
                });
                onClose();
              }}
            >
              <Save data-icon="inline-start" strokeWidth={1.75} />
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
