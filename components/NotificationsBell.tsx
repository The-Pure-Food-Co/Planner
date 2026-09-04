'use client';
import { useState, type ComponentType, type SVGProps } from 'react';
import { usePlannerStore } from '@/store/plannerStore';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { timeAgo, avColor } from '@/lib/utils';
import type { AppNotification, NotificationType } from '@/lib/types';
import {
  BellIcon,
  AtSymbolIcon,
  UserPlusIcon,
  ChatBubbleLeftIcon,
  ArrowRightCircleIcon,
  CalendarDaysIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/solid';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const TYPE_ICONS: Record<NotificationType, IconComponent> = {
  mention: AtSymbolIcon,
  assigned: UserPlusIcon,
  comment: ChatBubbleLeftIcon,
  status: ArrowRightCircleIcon,
  due: CalendarDaysIcon,
  update: ClipboardDocumentCheckIcon,
};

// Reminders are time-based nudges (task due). Everything else is activity —
// things other people did (mentions, assignments, comments, status changes).
const isReminder = (n: AppNotification) => n.type === 'due';

export default function NotificationsBell() {
  const {
    notifications,
    notificationsExhausted,
    loadMoreNotifications,
    meId,
    jumpToTask,
    markNotificationRead,
    markAllNotificationsRead,
  } = usePlannerStore();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'activity' | 'reminders'>('activity');

  const reminders = notifications.filter(isReminder);
  const activity = notifications.filter((n) => !isReminder(n));
  const unreadReminders = reminders.filter((n) => !n.readAt).length;
  const unreadActivity = activity.filter((n) => !n.readAt).length;
  const unread = unreadReminders + unreadActivity;

  const openNotification = (n: AppNotification) => {
    markNotificationRead(n.id);
    setOpen(false);
    if (n.workspaceId && n.taskId) jumpToTask(n.workspaceId, n.taskId);
  };

  const renderList = (
    items: AppNotification[],
    empty: { title: string; description: string },
  ) => {
    if (!meId) {
      // Local/seed mode (no Supabase session) — notifications need a signed-in profile.
      return (
        <EmptyState
          isCompact
          icon={<Icon icon={BellIcon} size="lg" color="secondary" />}
          title="Not signed in"
          description="Notifications arrive here once you're signed in on the cloud version."
        />
      );
    }
    if (items.length === 0) {
      return (
        <EmptyState
          isCompact
          icon={<Icon icon={BellIcon} size="lg" color="secondary" />}
          title={empty.title}
          description={empty.description}
        />
      );
    }
    return (
      <>
        <List density="compact" hasDividers>
          {items.map((n) => {
            const TypeIcon = TYPE_ICONS[n.type] ?? BellIcon;
            return (
              <ListItem
                key={n.id}
                onClick={() => openNotification(n)}
                startContent={
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                    <Icon icon={TypeIcon} size="sm" color="secondary" />
                  </span>
                }
                label={n.actorName || 'Someone'}
                description={
                  <span className="line-clamp-2">{n.message}</span>
                }
                endContent={
                  <span className="flex flex-col items-end gap-1">
                    <Text color="secondary" size="2xs">
                      {timeAgo(n.createdAt)}
                    </Text>
                    {!n.readAt && (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: '#C63663' }}
                      />
                    )}
                  </span>
                }
              />
            );
          })}
        </List>
        {!notificationsExhausted && (
          <div className="flex justify-center py-1.5">
            <Button
              label="Show older"
              variant="ghost"
              size="sm"
              onClick={() => loadMoreNotifications()}
            />
          </div>
        )}
      </>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" className="bell-btn" label="Notifications">
            <BellIcon className="h-[19px] w-[19px]" />
            {unread > 0 && (
              <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>
            )}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <div data-astryx-theme="neutral">
          <div className="flex items-center justify-between px-3 py-2 border-b border-foreground/10">
            <Text type="label" weight="semibold" color="accent">
              Notifications
            </Text>
            {unread > 0 && (
              <Button
                label="Mark all read"
                variant="ghost"
                size="sm"
                onClick={() => markAllNotificationsRead()}
              />
            )}
          </div>

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as 'activity' | 'reminders')}
          >
            <div className="px-3 pt-2">
              <TabsList className="w-full">
                <TabsTrigger value="activity">
                  Activity
                  {unreadActivity > 0 && (
                    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C63663] px-1 text-[10px] leading-none text-white">
                      {unreadActivity > 9 ? '9+' : unreadActivity}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="reminders">
                  Reminders
                  {unreadReminders > 0 && (
                    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C63663] px-1 text-[10px] leading-none text-white">
                      {unreadReminders > 9 ? '9+' : unreadReminders}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Fixed height so the dropdown doesn't jump around with content. */}
            <div className="h-[min(380px,60dvh)] overflow-y-auto">
              <TabsContent value="activity">
                {renderList(activity, {
                  title: 'No activity yet',
                  description:
                    "You'll see it here when someone tags, assigns, or comments.",
                })}
              </TabsContent>
              <TabsContent value="reminders">
                {renderList(reminders, {
                  title: 'No reminders',
                  description:
                    "Due-date reminders for your tasks will show up here.",
                })}
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </PopoverContent>
    </Popover>
  );
}
