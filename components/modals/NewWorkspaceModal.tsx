'use client'
import { useState } from 'react'
import { FolderPlus, PlusIcon } from 'lucide-react'
import { usePlannerStore } from '@/store/plannerStore'
import { avColor } from '@/lib/utils'
import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select'
import { ColorPickerPopover } from '@/components/ui/color-picker'
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
import { WORKSPACE_ICONS, DEFAULT_WORKSPACE_ICON, getWorkspaceIcon } from '@/lib/workspace-icons'
import type { IconComponent } from '@/lib/icon-context'

interface Props {
  onClose: () => void
}

const PALETTE = ['#C63663', '#93328E', '#F8485E', '#6BA539', '#3B82F6', '#F59E0B', '#14B8A6', '#8B5CF6']

// Tints a lucide icon with a fixed color via `currentColor`, overriding the
// row's ambient text-foreground/text-muted-foreground so each option keeps
// its own color regardless of hover/checked state.
function coloredIcon(Icon: IconComponent, color: string): IconComponent {
  return ({ size, strokeWidth, className }) => (
    <span style={{ color, display: 'inline-flex' }}>
      <Icon size={size} strokeWidth={strokeWidth} className={className} />
    </span>
  )
}

export default function NewWorkspaceModal({ onClose }: Props) {
  const { createWorkspace } = usePlannerStore()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#C63663')
  const [icon, setIcon] = useState(DEFAULT_WORKSPACE_ICON)

  const handleCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    createWorkspace({ name: trimmed, color, icon })
    onClose()
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[16px] font-normal text-foreground">
            <FolderPlus size={16} strokeWidth={1.75} className="text-muted-foreground" />
            New workspace
          </DialogTitle>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="ws-name" className="text-[10.5px] font-medium text-muted-foreground">Name</FieldLabel>
          <Input
            id="ws-name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="e.g. Marketing"
            autoFocus
          />
        </Field>

        <div className="flex justify-between gap-2.5 items-end">
          <Field className="flex-1">
            <FieldLabel className="text-[10.5px] font-medium text-muted-foreground">Icon</FieldLabel>
            <Select value={icon} onValueChange={setIcon}>
              <SelectTrigger placeholder="Icon" icon={coloredIcon(getWorkspaceIcon(icon), avColor(icon))} className="min-w-0 w-full h-10" />
              <SelectContent>
                {WORKSPACE_ICONS.map((opt, idx) => (
                  <SelectItem key={opt.name} index={idx} value={opt.name} icon={coloredIcon(opt.Icon, avColor(opt.name))} className="h-11">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field className="w-auto">
            <FieldLabel className="text-[10.5px] font-medium text-muted-foreground">Colour</FieldLabel>
            <ColorPickerPopover value={color} onValueChange={setColor} swatches={PALETTE} />
          </Field>
        </div>

        <span className="text-[11px] text-[color:var(--muted)]">
          Workflow states, people and integrations can all be set later in workspace settings.
        </span>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button variant="outline" onClick={handleCreate} disabled={!name.trim()}>
            <PlusIcon data-icon="inline-start" strokeWidth={1.75} />
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
