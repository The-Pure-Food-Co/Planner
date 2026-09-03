-- Reference schema for Planner's tables. These tables already exist and are
-- populated in the SHARED org Supabase project (purefoods-planner / Gantt,
-- ref rzenewwvbtxadhhgzrnf) — this app was extracted from that hub app but
-- deliberately kept on its shared Supabase project (auth AND data), matching
-- every other internal app's convention (see CLAUDE.md and the sibling repos'
-- AGENTS.md/README.md: one shared Supabase project, each app owns its own
-- tables/tenant within it).
--
-- Do NOT run this against the shared project — it already has this shape.
-- It exists so this repo has a record of Planner's own tables/policies/
-- functions independent of the Gantt repo's migration history, and so
-- `scripts/setup-db.js` can bootstrap a fresh LOCAL/dev Postgres instance
-- (via `create table if not exists`, safe to no-op against the real one too).
-- When changing the schema: verify the live shape first
-- (`information_schema.columns` on the shared project), then apply a
-- targeted additive change there directly (Supabase SQL Editor), and mirror
-- it here plus in `lib/types.ts` + the `rowToX`/`xToDb` mappers in
-- `lib/supabase.ts`.

create extension if not exists pg_cron;

-- ============================================================================
-- TABLES
-- ============================================================================

create table if not exists profiles (
  id                  uuid primary key default gen_random_uuid(),
  auth_id             uuid unique references auth.users(id) on delete set null,
  email               text unique not null,
  display_name        text,
  avatar_url          text,
  is_app_admin        boolean     not null default false,
  is_nz_team          boolean     not null default false,
  notification_prefs  jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create table if not exists workspaces (
  id             text primary key,
  name           text        not null,
  color          text        not null default '#C63663',
  members        jsonb       not null default '[]',
  custom_buckets jsonb       not null default '[]',
  sort_index     int         not null default 0,
  icon           text,
  statuses       jsonb,
  updated_at     timestamptz not null default now()
);

create table if not exists lanes (
  id           text primary key,
  workspace_id text        not null references workspaces(id) on delete cascade,
  label        text        not null,
  color        text        not null default '#4CAF50',
  sort_index   int         not null default 0,
  icon         text,
  icon_color   text,
  updated_at   timestamptz not null default now()
);

create table if not exists tasks (
  id                    text primary key,
  workspace_id          text        not null references workspaces(id) on delete cascade,
  lane_id               text        null,
  name                  text        not null,
  owner                 text        not null default '',
  start_date            text        not null,
  end_date              text        not null,
  pct                   int         not null default 0,
  notes                 text        not null default '',
  sort_index            int         not null default 0,
  board_bucket          text,
  dependencies          jsonb       not null default '[]',
  checklist             jsonb       not null default '[]',
  milestones            jsonb       not null default '[]',
  no_date               boolean     not null default false,
  assignee_ids          jsonb       not null default '[]',
  reporter_id           uuid,
  watcher_ids           jsonb       not null default '[]',
  estimate              numeric,
  comments              jsonb       not null default '[]',
  attachments           jsonb       not null default '[]',
  links                 jsonb       not null default '[]',
  icon                  text,
  icon_color            text,
  recurrence            jsonb,
  recurrence_parent_id  text,
  status_id             text,
  updated_at            timestamptz not null default now()
);

create table if not exists kpi_groups (
  id         text primary key,
  name       text        not null,
  kpis       jsonb       not null default '[]',
  sort_index int         not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists app_config (
  key   text primary key,
  value jsonb not null
);
insert into app_config (key, value) values ('userList', '[]') on conflict do nothing;

create table if not exists workspace_members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id      uuid not null references profiles(id)  on delete cascade,
  role         text not null default 'member' check (role in ('admin','member','viewer')),
  primary key (workspace_id, user_id)
);

create table if not exists views (
  id           text primary key,
  workspace_id text        not null references workspaces(id) on delete cascade,
  name         text        not null,
  config       jsonb       not null default '{}'::jsonb,
  owner_id     uuid        references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists activity_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text        not null,
  task_id      text,
  task_name    text        not null default '',
  actor_id     uuid        references profiles(id) on delete set null,
  actor_name   text        not null default '',
  action       text        not null,
  field        text,
  old_value    text,
  new_value    text,
  message      text        not null,
  created_at   timestamptz not null default now()
);
create index if not exists activity_log_actor_idx on activity_log (actor_id);

create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid        not null references profiles(id) on delete cascade,
  actor_id     uuid        references profiles(id) on delete set null,
  actor_name   text        not null default '',
  type         text        not null,
  workspace_id text,
  task_id      text,
  task_name    text        not null default '',
  message      text        not null,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists todos (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid        not null references profiles(id) on delete cascade,
  text          text        not null,
  done          boolean     not null default false,
  sort_index    int         not null default 0,
  due_date      date,
  important     boolean     not null default false,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists lane_templates (
  id          text primary key,
  label       text        not null,
  color       text        not null default '#C63663',
  description text        not null default '',
  tasks       jsonb       not null default '[]',
  created_by  text,
  sort_index  int         not null default 0,
  updated_at  timestamptz not null default now()
);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- SECURITY DEFINER so RLS policies can consult profiles without recursing
-- through profiles' own RLS.
create or replace function public.is_app_admin()
  returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_app_admin from profiles p where p.auth_id = auth.uid()), false);
$$;

create or replace function public.ws_role(ws text)
  returns text language sql stable security definer set search_path = public as $$
  select wm.role
  from workspace_members wm
  join profiles p on p.id = wm.user_id
  where wm.workspace_id = ws and p.auth_id = auth.uid();
$$;

create or replace function public.is_ws_member(ws text)
  returns boolean language sql stable security definer set search_path = public as $$
  select public.is_app_admin() or public.ws_role(ws) is not null;
$$;

create or replace function public.is_ws_writer(ws text)
  returns boolean language sql stable security definer set search_path = public as $$
  select public.is_app_admin() or coalesce(public.ws_role(ws) in ('admin','member'), false);
$$;

create or replace function public.is_ws_admin(ws text)
  returns boolean language sql stable security definer set search_path = public as $$
  select public.is_app_admin() or coalesce(public.ws_role(ws) = 'admin', false);
$$;

-- profiles_update's WITH CHECK only restricts which row a user may touch (their
-- own, by auth_id/email match) — it does not restrict which columns they may
-- change. Without this trigger, any signed-in user could set is_app_admin =
-- true on their own row via a direct Supabase update call. RLS can't express
-- column-level checks, so this is enforced in a trigger instead.
create or replace function public.lock_is_app_admin()
  returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.is_app_admin is distinct from old.is_app_admin
     and not public.is_app_admin() then
    new.is_app_admin := old.is_app_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_lock_is_app_admin on profiles;
create trigger profiles_lock_is_app_admin
  before update on profiles
  for each row execute function public.lock_is_app_admin();

-- Due-date reminders: a daily pg_cron job fans out 'due' notifications
-- server-side. Fires for each assignee of a not-done, dated task when, on the
-- New Zealand calendar day (HQ timezone):
--   - end_date = tomorrow  -> "due tomorrow"
--   - end_date = yesterday -> "was due yesterday" (once, the morning after)
-- SECURITY DEFINER because the cron job runs outside an authenticated session
-- and the notifications INSERT policy is `to authenticated`. The NOT EXISTS
-- guard (same task/recipient within 20h) makes same-day reruns idempotent.
-- Respects each recipient's mute preferences (notification_prefs).
create or replace function public.notify_due_tasks()
returns void
language sql security definer set search_path = public as $$
  with nz as (
    select (now() at time zone 'Pacific/Auckland')::date as today
  ),
  due as (
    select t.id, t.workspace_id, t.name, t.assignee_ids,
      case when t.end_date = to_char(nz.today - 1, 'YYYY-MM-DD')
        then 'task "' || t.name || '" was due yesterday and isn''t marked done'
        else 'task "' || t.name || '" is due tomorrow'
      end as msg
    from tasks t, nz
    where coalesce(t.no_date, false) = false
      and t.pct < 100
      and t.end_date in (
        to_char(nz.today + 1, 'YYYY-MM-DD'),
        to_char(nz.today - 1, 'YYYY-MM-DD')
      )
  )
  insert into notifications (recipient_id, actor_id, actor_name, type, workspace_id, task_id, task_name, message)
  select distinct p.id, null::uuid, 'Pure Planner', 'due', d.workspace_id, d.id, d.name, d.msg
  from due d
  join lateral jsonb_array_elements_text(d.assignee_ids) a(pid) on true
  join profiles p on p.id::text = a.pid
  where not coalesce(p.notification_prefs->'mutedTypes' ? 'due', false)
    and not coalesce(p.notification_prefs->'mutedWorkspaces' ? d.workspace_id::text, false)
    and not exists (
      select 1 from notifications n
      where n.recipient_id = p.id
        and n.task_id = d.id
        and n.type = 'due'
        and n.created_at > now() - interval '20 hours'
    );
$$;

-- 17:00 UTC = 5-6am next day in New Zealand.
do $$
begin
  perform cron.unschedule('planner-due-notifications');
exception when others then null;
end $$;
select cron.schedule('planner-due-notifications', '0 17 * * *', 'select public.notify_due_tasks()');

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table profiles           enable row level security;
alter table workspaces         enable row level security;
alter table lanes              enable row level security;
alter table tasks              enable row level security;
alter table kpi_groups         enable row level security;
alter table app_config         enable row level security;
alter table workspace_members  enable row level security;
alter table views              enable row level security;
alter table activity_log       enable row level security;
alter table notifications      enable row level security;
alter table todos              enable row level security;
alter table lane_templates     enable row level security;

-- profiles: everyone signed in reads the roster (pickers/avatars); you may
-- create/edit your own row (matched by auth_id or login email); app admins
-- may create/edit anyone's.
create policy profiles_read on profiles
  for select to authenticated using (true);
create policy profiles_insert on profiles
  for insert to authenticated
  with check ( email = auth.jwt()->>'email' or public.is_app_admin() );
create policy profiles_update on profiles
  for update to authenticated
  using ( auth_id = auth.uid() or email = auth.jwt()->>'email' or public.is_app_admin() )
  with check ( auth_id = auth.uid() or email = auth.jwt()->>'email' or public.is_app_admin() );

-- workspaces: members read, app admins create, workspace admins update/delete.
create policy ws_select on workspaces for select to authenticated using ( public.is_ws_member(id) );
create policy ws_insert on workspaces for insert to authenticated with check ( public.is_app_admin() );
create policy ws_update on workspaces for update to authenticated using ( public.is_ws_admin(id) ) with check ( public.is_ws_admin(id) );
create policy ws_delete on workspaces for delete to authenticated using ( public.is_ws_admin(id) );

-- lanes / tasks: members read, writers (member/admin role) write.
create policy lane_select on lanes for select to authenticated using ( public.is_ws_member(workspace_id) );
create policy lane_write  on lanes for all    to authenticated using ( public.is_ws_writer(workspace_id) ) with check ( public.is_ws_writer(workspace_id) );

create policy task_select on tasks for select to authenticated using ( public.is_ws_member(workspace_id) );
create policy task_write  on tasks for all    to authenticated using ( public.is_ws_writer(workspace_id) ) with check ( public.is_ws_writer(workspace_id) );

-- kpi_groups / app_config: app-wide, everyone reads, only app admins write.
create policy kpi_select on kpi_groups for select to authenticated using ( true );
create policy kpi_write  on kpi_groups for all    to authenticated using ( public.is_app_admin() ) with check ( public.is_app_admin() );

create policy cfg_select on app_config for select to authenticated using ( true );
create policy cfg_write  on app_config for all    to authenticated using ( public.is_app_admin() ) with check ( public.is_app_admin() );

-- workspace_members: visible to members, managed by workspace admins.
create policy wm_select on workspace_members for select to authenticated using ( public.is_ws_member(workspace_id) );
create policy wm_write  on workspace_members for all    to authenticated using ( public.is_ws_admin(workspace_id) ) with check ( public.is_ws_admin(workspace_id) );

-- views: workspace members read, writers create, owner or workspace admin deletes.
create policy views_select on views for select to authenticated using ( public.is_ws_member(workspace_id) );
create policy views_insert on views for insert to authenticated with check ( public.is_ws_writer(workspace_id) );
create policy views_delete on views for delete to authenticated using (
  public.is_ws_admin(workspace_id) or owner_id in (select id from profiles where auth_id = auth.uid())
);

-- notifications: recipient-only.
create policy notifications_select on notifications for select to authenticated using (
  recipient_id in (select id from profiles where auth_id = auth.uid())
);
create policy notifications_insert on notifications for insert to authenticated with check ( true );
create policy notifications_update on notifications for update to authenticated using (
  recipient_id in (select id from profiles where auth_id = auth.uid())
) with check (
  recipient_id in (select id from profiles where auth_id = auth.uid())
);
create policy notifications_delete on notifications for delete to authenticated using (
  recipient_id in (select id from profiles where auth_id = auth.uid())
);

-- todos: owner-only ("My work" personal checklist).
create policy todos_select on todos for select to authenticated using (
  owner_id in (select id from profiles where auth_id = auth.uid())
);
create policy todos_insert on todos for insert to authenticated with check (
  owner_id in (select id from profiles where auth_id = auth.uid())
);
create policy todos_update on todos for update to authenticated using (
  owner_id in (select id from profiles where auth_id = auth.uid())
) with check (
  owner_id in (select id from profiles where auth_id = auth.uid())
);
create policy todos_delete on todos for delete to authenticated using (
  owner_id in (select id from profiles where auth_id = auth.uid())
);

-- activity_log: readable by workspace members, inserted by the app on behalf
-- of the acting user (no direct-write restriction beyond being signed in).
create policy activity_select on activity_log for select to authenticated using ( public.is_ws_member(workspace_id) );
create policy activity_insert on activity_log for insert to authenticated with check ( public.is_ws_member(workspace_id) );

-- lane_templates: app-wide, everyone reads, everyone signed in can manage
-- (matches historical behavior — no per-template ownership check upstream).
create policy lane_templates_select on lane_templates for select to authenticated using ( true );
create policy lane_templates_write  on lane_templates for all    to authenticated using ( true ) with check ( true );

-- ============================================================================
-- STORAGE
-- ============================================================================

-- Public-read bucket for task attachments and profile avatar photos.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do nothing;

create policy "attachments read" on storage.objects
  for select using (bucket_id = 'attachments');
create policy "attachments insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments');
create policy "attachments update" on storage.objects
  for update to authenticated using (bucket_id = 'attachments');
create policy "attachments delete" on storage.objects
  for delete to authenticated using (bucket_id = 'attachments');

-- ============================================================================
-- REALTIME
-- ============================================================================

do $$
begin
  alter publication supabase_realtime add table workspaces;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table lanes;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table tasks;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table kpi_groups;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table app_config;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table profiles;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table workspace_members;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table views;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table activity_log;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table notifications;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table todos;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table lane_templates;
exception when duplicate_object then null; end $$;
