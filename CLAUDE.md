# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git workflow

Always create a new branch before committing or pushing to the remote — never commit or push directly to `master`.

## Commands

- `pnpm dev` (or `npm run dev`) — start Next.js dev server
- `pnpm build` — production build
- `pnpm start` — run production build
- `node scripts/setup-db.js` — applies `supabase/schema.sql` to the Postgres instance pointed to by `POSTGRES_URL_NON_POOLING` in `.env` (idempotent statement-by-statement runner). Only needed against a fresh/local Postgres instance — the shared org project already has this schema; do not run this against it casually.

Tests: `pnpm test` runs the vitest suite in `tests/` (pure logic only — diff helpers, notification fan-out, due-date bucketing, row mappers; no UI tests). No lint script is configured. Package manager is pnpm (`pnpm-lock.yaml`, `pnpm-workspace.yaml`).

Env vars live in `.env.local` (see `.env.example` for the full Supabase/Postgres var list). The app degrades gracefully with no env vars: `lib/supabase.ts` exports `supabase = null` when `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing, and the planner store falls back to local seed data (`lib/seed.ts`) with no persistence.

## Architecture

This is a Next.js 14 App Router app: Team Planner (Gantt/board/KPIs) for The Pure Food Co. It was extracted from a shared multi-tool "hub" app (`Gantt`) into its own standalone repo/deploy, but — matching the convention used by every other internal app (see `Planning-Private`/`OnHolds-Private`'s `AGENTS.md`/`README.md`) — it stays on the **same shared Supabase project** as the hub (`purefoods-planner`, ref `rzenewwvbtxadhhgzrnf`) for both auth and data. There is no per-app Supabase project; each app just owns its own tables/tenant (RLS-scoped) within that one database.

### Auth (shared Auth Hub SSO)

This app has no sign-in screen of its own. `proxy.ts` runs on every request (except `/auth/callback`), checks the Supabase session via `lib/supabase/middleware.ts`, and if there's no session, redirects to `NEXT_PUBLIC_AUTH_HUB_URL` (the Gantt hub) with `redirect_app`/`redirect_to` query params. The hub authenticates the user (Microsoft/Azure OAuth) and redirects back to `/auth/callback?next=<path>`, which reads the access/refresh tokens out of the URL fragment and calls `supabase.auth.setSession()`. `lib/auth.tsx`'s `AuthProvider`/`useAuthUser()` (used app-wide for display name/identity, not gating) reads the resulting session — see `lib/supabase/browser-singleton.ts` for the module-level client that degrades to `null` when env vars are missing (local/seed mode, no persistence).

For this app's own origin to be handed a session at all, it must be registered in the hub's `trusted_apps` table (Supabase Table Editor on the shared project — no in-app admin UI, see `PureHub-and-Planner/Gantt/lib/supabase.ts`'s `isTrustedRedirectApp` and `supabase/migrations/024_trusted_apps.sql` there).

Per-app authorization on top of the hub session: `components/AppAccessGate.tsx` (wrapping `app/page.tsx`, keyed `"planner"` — must match this app's `hub_apps.id` row) + `lib/useAppAccess.ts`/`lib/appAccess.ts` layer a second, independent restriction using the shared `app_access` table. A missing row means unrestricted; a row means only the listed `profiles` ids may open the app. Access grants are managed from the hub's own "Manage apps" modal, not from this repo.

### Planner data flow

Single source of truth is a Zustand store, `store/plannerStore.ts` (`usePlannerStore`), holding one `PlannerData` object (`lib/types.ts`): `workspaces[]` (each with `lanes[]` and `tasks[]`), `kpiGroups[]`, `userList`. UI-only state (current page/tab/zoom/filters) lives alongside it as `ui: UiState` and is persisted to `localStorage` (key `purefoods-planner-ui`) — separate from the actual planner data.

Persistence/sync model (`lib/supabase.ts`):
- On `init()`, the store loads everything from Supabase (`loadAll()` — parallel queries across `workspaces`, `lanes`, `tasks`, `kpi_groups`, `app_config`), falling back to `SEED` data if Supabase isn't configured or returns empty (and in the empty case, seeds the DB via `db.syncAll`).
- Every mutation (add/update/delete workspace, lane, task, KPI group, user list) follows the same **optimistic-write** pattern: apply the change to local state immediately, fire the corresponding Supabase upsert/delete, and roll back local state + toast an error if the DB call fails.
- Destructive actions (delete) go through `get().destructive(label, storeFn, dbFn)`, which snapshots the full `PlannerData` before applying the change and offers an "Undo" toast that restores the snapshot and re-syncs it via `db.syncAll`.
- Realtime: `subscribeToChanges()` opens one Supabase Realtime channel (`planner-live`) subscribed to postgres_changes on all five tables and merges incoming events into store state, so concurrent users' edits appear live. Only one subscription is kept at module scope (`unsubRealtime`).
- Row shape in Postgres differs from the in-app `Task`/`Lane`/`Workspace` shape (e.g. `lane_id` vs `lane`, snake_case columns); `rowToX`/`xToDb` mapper pairs in `lib/supabase.ts` are the only place that translation happens — extend both when adding a field.

Auth gating itself is `proxy.ts` (see "Auth" above), not a component — `lib/auth.tsx`'s `AuthProvider` wrapping `children` in the root layout (`app/layout.tsx`) only exposes the already-established session's identity via `useAuthUser`, available anywhere under the root layout. The user roster is provisioned just-in-time from each user's own OAuth identity: on `plannerStore.init()`, `db.linkOwnProfile` upserts the signed-in user's `profiles` row and their display name is mirrored into the legacy `userList` roster the pickers read. There is no Microsoft Graph directory sync — the roster is exactly the set of people who have signed in (plus any names added manually in the Users panel).

### Planner UI structure

`app/page.tsx` is the shell; it switches between a home view (workspace list, grouped by `HomeTab`: teams/projects/milestones/kpis/people) and a workspace view (`primaryTab`: timeline/board/people/kpis) based on `ui.page`/`ui.ws`. Within a workspace, `wsView` toggles between `components/gantt/Gantt.tsx` and `components/board/Board.tsx`, both rendering the same `Task[]`/`Lane[]` from the store but as different layouts. Modals (`components/modals/*`) are opened/closed via local component state, not the store, and call store mutation actions on save.

### Database schema

`supabase/schema.sql` documents Planner's tables/functions/policies/storage bucket/pg_cron job/realtime publication as they exist on the shared Supabase project — it does **not** need to be (and should not be) run against that project, since the tables already exist there. See its header comment for how to make schema changes safely against a database several other apps also depend on.

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
