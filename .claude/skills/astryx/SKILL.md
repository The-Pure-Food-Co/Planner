---
name: astryx
description: Astryx design system (149 React components) — use for ALL UI work in this repo. Wraps the astryx CLI discovery workflow (build/template/component/docs) plus this project's scoped-theme integration rules.
---

# Astryx design system

Astryx v0.1.4 · 149 components. Run every CLI command as `pnpm exec astryx <cmd>`.

**Already installed and integrated in this repo**: `@astryxdesign/core` + `@astryxdesign/theme-neutral` (deps) and `@astryxdesign/cli` (dev). `app/globals.css` imports `astryx.css` + the neutral `theme.css`. `components/board/Board.tsx` and `components/modals/TaskEditor.tsx` already use astryx components.

## This repo's integration rules (do not break these)

- **Scoped theme, not app-wide**: theme tokens apply only under `[data-astryx-theme="neutral"]` (currently the Kanban board container). To use astryx components in a new area, put that attribute on the area's container — do NOT wrap the app root.
- **`reset.css` is intentionally NOT imported** — the scoped theme carries its own reset. Never add `import '@astryxdesign/core/reset.css'` globally; it would restyle the whole planner/PO/hub.
- **Never overwrite the brand colour system**: the app's RAG/brand palette (`--pea`, `--carrot`, `--raspberry`, `--cauliflower-dark`, `#C63663`, gradient `#93328E → #C63663 → #F8485E` in `app/globals.css`) stays authoritative. Astryx tokens (`--color-*`) live in a separate namespace and must stay scoped.
- **Light-only app**: `:root { color-scheme: light }` is pinned (unlayered, beats astryx's layered rule) because astryx's `light-dark()` tokens would follow the OS theme. Keep it.
- **Don't import `tailwind-theme.css`**: the shadcn Tailwind theme already defines `text-primary`, `bg-popover`, etc. — astryx's Tailwind bridge would collide with those utility names.
- **Font pinning**: astryx Token labels are overridden to the brand font at weight 400 (see the `[data-astryx-theme] .astryx-token` rule in globals.css). Follow that pattern when an astryx component's type looks off-brand: unlayered CSS beats astryx's layered StyleX.

## When to use astryx vs the existing shadcn/inline-style components

Use astryx for any new or reworked UI. Swapping an existing shadcn/inline-style component for its astryx equivalent while you're already touching it is encouraged — but keep swaps scoped and consistent (whole widget/area, not one button inside a shadcn dialog), keep the brand colours, and don't rewrite untouched screens just to migrate them.

## Workflow — discover, don't guess

Before writing UI:

1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

## Upstream rules (adapted)

- Prefer astryx components over raw `<div>`s for layout/spacing inside astryx-themed areas.
- Frame first: pick the shell and budget regions before writing content (`astryx docs layout`).
- Dense data = rows (Table, List/Item) edge-to-edge — never Card-wrapped list items. Card = dashboard widgets, galleries, settings groups only.
- Status → StatusDot/Token; Badge only for counts and enumerated states, never decoration.
- Custom styling: component props first; then the `xstyle` prop with `stylex.create()` (pseudo-classes need the `@media (hover: hover)` guard); `className` for Tailwind/external CSS.
- In astryx-scoped areas use tokens, not raw hex/px — except the brand colours above, which are the point.

## More CLI

| Command | Purpose |
| --- | --- |
| `search "<query>"` | find any component / hook / doc / template / block |
| `component --list` | 149 components by category |
| `template --list` | page + block recipes |
| `docs <topic>` | color, elevation, icons, layout, motion, shape, spacing, styling, theme, tokens, typography, … |
| `swizzle <Name>` | eject component source for deep customization |
| `upgrade --apply` | run after any `@astryxdesign/core` bump |
| `doctor` | diagnose setup problems with fixes |
