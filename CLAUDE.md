# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git workflow

Always create a new branch before committing or pushing to the remote — never commit or push directly to `master`.

## Commands

- `pnpm dev` (or `npm run dev`) — start Next.js dev server
- `pnpm build` — production build
- `pnpm start` — run production build
- `node scripts/setup-db.js` — apply `supabase/schema.sql` to the Postgres instance pointed to by `POSTGRES_URL_NON_POOLING` in `.env` (idempotent statement-by-statement runner)

Tests: `pnpm test` runs the vitest suite in `tests/` (pure logic only — diff helpers, notification fan-out, due-date bucketing, row mappers; no UI tests). No lint script is configured. Package manager is pnpm (`pnpm-lock.yaml`, `pnpm-workspace.yaml`).

Env vars live in `.env.local` (see `.env.example` for the full Supabase/Postgres var list). The app degrades gracefully with no env vars: `lib/supabase.ts` exports `supabase = null` when `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing, and the planner store falls back to local seed data (`lib/seed.ts`) with no persistence.

## Architecture

This is a Next.js 14 App Router app: Team Planner (Gantt/board/KPIs) for The Pure Food Co. It was extracted from a shared multi-tool "hub" app (`Gantt`) into its own standalone app and Supabase project — the hub links to it as an external tile (cross-app SSO no longer applies; this app has its own independent Supabase Auth).

### Planner data flow

Single source of truth is a Zustand store, `store/plannerStore.ts` (`usePlannerStore`), holding one `PlannerData` object (`lib/types.ts`): `workspaces[]` (each with `lanes[]` and `tasks[]`), `kpiGroups[]`, `userList`. UI-only state (current page/tab/zoom/filters) lives alongside it as `ui: UiState` and is persisted to `localStorage` (key `purefoods-planner-ui`) — separate from the actual planner data.

Persistence/sync model (`lib/supabase.ts`):
- On `init()`, the store loads everything from Supabase (`loadAll()` — parallel queries across `workspaces`, `lanes`, `tasks`, `kpi_groups`, `app_config`), falling back to `SEED` data if Supabase isn't configured or returns empty (and in the empty case, seeds the DB via `db.syncAll`).
- Every mutation (add/update/delete workspace, lane, task, KPI group, user list) follows the same **optimistic-write** pattern: apply the change to local state immediately, fire the corresponding Supabase upsert/delete, and roll back local state + toast an error if the DB call fails.
- Destructive actions (delete) go through `get().destructive(label, storeFn, dbFn)`, which snapshots the full `PlannerData` before applying the change and offers an "Undo" toast that restores the snapshot and re-syncs it via `db.syncAll`.
- Realtime: `subscribeToChanges()` opens one Supabase Realtime channel (`planner-live`) subscribed to postgres_changes on all five tables and merges incoming events into store state, so concurrent users' edits appear live. Only one subscription is kept at module scope (`unsubRealtime`).
- Row shape in Postgres differs from the in-app `Task`/`Lane`/`Workspace` shape (e.g. `lane_id` vs `lane`, snake_case columns); `rowToX`/`xToDb` mapper pairs in `lib/supabase.ts` are the only place that translation happens — extend both when adding a field.

Auth: Microsoft/Azure OAuth via Supabase (`signInWithMicrosoft`), gated app-wide by `components/AuthGate.tsx`/`lib/auth.tsx`'s `AuthProvider` wrapping `children` in the root layout (`app/layout.tsx`) — so every route requires sign-in before rendering. `useAuthUser` is available anywhere under the root layout. The user roster is provisioned just-in-time from each user's own OAuth identity: on `plannerStore.init()`, `db.linkOwnProfile` upserts the signed-in user's `profiles` row and their display name is mirrored into the legacy `userList` roster the pickers read. There is no Microsoft Graph directory sync — the roster is exactly the set of people who have signed in (plus any names added manually in the Users panel).

### Planner UI structure

`app/page.tsx` is the shell; it switches between a home view (workspace list, grouped by `HomeTab`: teams/projects/milestones/kpis/people) and a workspace view (`primaryTab`: timeline/board/people/kpis) based on `ui.page`/`ui.ws`. Within a workspace, `wsView` toggles between `components/gantt/Gantt.tsx` and `components/board/Board.tsx`, both rendering the same `Task[]`/`Lane[]` from the store but as different layouts. Modals (`components/modals/*`) are opened/closed via local component state, not the store, and call store mutation actions on save.

### Database schema

`supabase/schema.sql` is the canonical, consolidated schema (tables, functions, RLS policies, storage bucket, pg_cron job, realtime publication) for this app's own standalone Supabase project — apply it fresh via `scripts/setup-db.js`. When changing the schema, edit this file directly and mirror the change in `lib/types.ts` + the `rowToX`/`xToDb` mappers in `lib/supabase.ts`.

### Styling

No CSS framework — components use inline `style` objects and CSS custom properties (`var(--pea)`, `var(--cauliflower-dark)`, etc., defined in `app/globals.css`) for RAG-status colors. Brand colors are hardcoded in places (e.g. `#C63663`, gradient `#93328E → #C63663 → #F8485E`) matching The Pure Food Co brand skill (Beetroot/Cauliflower palette, Montserrat font, loaded via Google Fonts in `app/layout.tsx`).

<!-- ASTRYX:START -->
Astryx v0.1.4 · 149 components
CLI: run every command as `pnpm exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing. Full page → AppShell; sidebar nav → SideNav.
- Frame first: pick the shell (AppShell / Layout+LayoutPanel) and budget regions in px BEFORE writing content (`astryx docs layout`).
- Dense data = rows (Table, List/Item) edge-to-edge — never Card-wrapped list items. Card = dashboard widgets, galleries, settings groups only.
- Status → StatusDot/Token; Badge only for counts and enumerated states, never decoration.
- Custom styling: component props first; else Tailwind utilities backed by tokens (bg-surface, text-primary, rounded-lg) via tailwind-theme.css. No raw hex/px.
- Tokens for every value (`astryx docs tokens`). Brand/accent via `astryx theme` — never override --color-* in :root.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   149 components by category
  template --list    page + block recipes
  docs <topic>       color, elevation, icons, illustrations, layout, migration, motion, principles, shape, spacing, styling, theme, tokens, typography
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any @astryxdesign/core bump
<!-- ASTRYX:END -->
