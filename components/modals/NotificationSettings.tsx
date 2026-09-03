'use client'
import { usePlannerStore } from '@/store/plannerStore'
import { useMe } from '@/lib/auth'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Layout, LayoutContent, VStack } from '@astryxdesign/core/Layout'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import type { NotificationPrefs, NotificationType } from '@/lib/types'

const TYPES: Array<{ type: NotificationType; label: string; description: string }> = [
  { type: 'mention', label: 'Mentions', description: 'Someone @-mentions you in a comment or the notes' },
  { type: 'assigned', label: 'Assignments', description: 'You are assigned to a task' },
  { type: 'comment', label: 'Comments', description: 'New comments on tasks you are involved in' },
  { type: 'status', label: 'Status changes', description: 'A task you are involved in changes status or is flagged at risk' },
  { type: 'update', label: 'Task updates', description: 'Checklist, milestone, attachment, or link changes' },
  { type: 'due', label: 'Due-date reminders', description: 'Daily reminders for tasks due tomorrow or overdue' },
]

// Mute notifications by type and by workspace. Toggles apply immediately
// (optimistic write to profiles.notification_prefs). A muted workspace
// silences everything from it, including mentions.
export default function NotificationSettings({ onClose }: { onClose: () => void }) {
  const { data, updateMyNotificationPrefs } = usePlannerStore()
  const { me } = useMe()
  const prefs: NotificationPrefs = me?.notificationPrefs ?? {}
  const mutedTypes = prefs.mutedTypes ?? []
  const mutedWorkspaces = prefs.mutedWorkspaces ?? []

  const toggleType = (type: NotificationType, on: boolean) =>
    updateMyNotificationPrefs({
      ...prefs,
      mutedTypes: on ? mutedTypes.filter(t => t !== type) : [...mutedTypes, type],
    })

  const toggleWorkspace = (wsId: string, on: boolean) =>
    updateMyNotificationPrefs({
      ...prefs,
      mutedWorkspaces: on ? mutedWorkspaces.filter(id => id !== wsId) : [...mutedWorkspaces, wsId],
    })

  return (
    <div data-astryx-theme="neutral">
      <Dialog isOpen onOpenChange={o => !o && onClose()} purpose="form" width={480}>
        <Layout
          header={
            <DialogHeader
              title="Notification settings"
              subtitle="Changes apply immediately, everywhere you're signed in"
              onOpenChange={() => onClose()}
            />
          }
          content={
            <LayoutContent>
              <VStack gap={5}>
                <VStack gap={3}>
                  <Text type="label" size="sm">Notify me about</Text>
                  {TYPES.map(({ type, label, description }) => (
                    <Switch
                      key={type}
                      label={label}
                      description={description}
                      labelPosition="start"
                      labelSpacing="spread"
                      value={!mutedTypes.includes(type)}
                      onChange={on => toggleType(type, on)}
                    />
                  ))}
                </VStack>
                <VStack gap={3}>
                  <Text type="label" size="sm">Workspaces</Text>
                  <Text type="supporting" color="secondary">
                    Muting a workspace silences all its notifications, including mentions.
                  </Text>
                  {data.workspaces.map(w => (
                    <Switch
                      key={w.id}
                      label={w.name}
                      labelPosition="start"
                      labelSpacing="spread"
                      value={!mutedWorkspaces.includes(w.id)}
                      onChange={on => toggleWorkspace(w.id, on)}
                    />
                  ))}
                </VStack>
              </VStack>
            </LayoutContent>
          }
        />
      </Dialog>
    </div>
  )
}
