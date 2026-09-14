-- Named personal checklists for the "My work" Checklist panel.
--
-- Before this, `todos` was one flat list per person. This adds named lists a
-- user switches between, with each todo belonging to exactly one list.
--
-- Apply this BEFORE deploying the app code that uses it: the column is
-- invisible to the current app (which never selects or writes list_id), so the
-- running version keeps working between the migration and the deploy. The
-- reverse order breaks the app, which would reference a column that isn't there.
--
-- Safe to re-run: every statement is guarded.

-- ── Schema ───────────────────────────────────────────────────────────────────

create table if not exists todo_lists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid        not null references profiles(id) on delete cascade,
  name        text        not null,
  sort_index  int         not null default 0,
  created_at  timestamptz not null default now()
);

-- Deleting a list takes its items with it, at the database level rather than
-- relying on the app to remember. (tasks.lane_id has no such FK, which is why
-- deleting a workstream used to strand its tasks as invisible orphan rows.)
alter table todos add column if not exists list_id uuid
  references todo_lists(id) on delete cascade;

create index if not exists todo_lists_owner_idx on todo_lists(owner_id);
create index if not exists todos_list_idx on todos(list_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Mirrors the todos policies exactly: owner-only, matched through
-- profiles.auth_id. A user's lists are as private as the todos inside them.

alter table todo_lists enable row level security;

drop policy if exists todo_lists_select on todo_lists;
create policy todo_lists_select on todo_lists for select to authenticated using (
  owner_id in (select id from profiles where auth_id = auth.uid())
);

drop policy if exists todo_lists_insert on todo_lists;
create policy todo_lists_insert on todo_lists for insert to authenticated with check (
  owner_id in (select id from profiles where auth_id = auth.uid())
);

drop policy if exists todo_lists_update on todo_lists;
create policy todo_lists_update on todo_lists for update to authenticated using (
  owner_id in (select id from profiles where auth_id = auth.uid())
) with check (
  owner_id in (select id from profiles where auth_id = auth.uid())
);

drop policy if exists todo_lists_delete on todo_lists;
create policy todo_lists_delete on todo_lists for delete to authenticated using (
  owner_id in (select id from profiles where auth_id = auth.uid())
);

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Everyone with existing todos gets one list named "Checklist" — what the panel
-- is already titled — holding everything they have now, so nobody opens the app
-- to find their items rearranged or missing.

insert into todo_lists (owner_id, name)
select distinct t.owner_id, 'Checklist'
from todos t
where not exists (
  select 1 from todo_lists l where l.owner_id = t.owner_id and l.name = 'Checklist'
);

update todos t
set list_id = l.id
from todo_lists l
where l.owner_id = t.owner_id
  and l.name = 'Checklist'
  and t.list_id is null;

-- Verify: this must return zero rows.
--   select count(*) from todos where list_id is null;
