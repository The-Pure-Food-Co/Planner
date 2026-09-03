import type { TemplateTask, LaneTemplate } from '@/lib/types'

// Built-in workstream starter templates. Each preset seeds a lane plus a small
// set of tasks laid out relative to "today" (dayOffset = start, durDays = span).
// Tasks reference each other by `key` for dependencies; the store maps those to
// freshly-generated task ids when instantiating a preset. These share the same
// shape (LaneTemplate / TemplateTask, lib/types.ts) as the user-defined templates
// saved via "Save as template" and persisted in Supabase — the "From template"
// list shows both.
export type PresetTask = TemplateTask
export type LanePreset = LaneTemplate

export const LANE_PRESETS: LanePreset[] = [
  {
    id: 'product-launch',
    label: 'Product Launch',
    color: '#C63663',
    description: 'End-to-end launch from brief to go-live.',
    tasks: [
      { key: 'brief', name: 'Launch brief & scope', dayOffset: 0, durDays: 3 },
      { key: 'design', name: 'Creative & packaging design', dayOffset: 4, durDays: 10, dependsOn: ['brief'] },
      { key: 'build', name: 'Production build', dayOffset: 15, durDays: 14, dependsOn: ['design'] },
      { key: 'qa', name: 'QA & sign-off', dayOffset: 30, durDays: 5, dependsOn: ['build'] },
      { key: 'golive', name: 'Go-live', dayOffset: 36, durDays: 1, dependsOn: ['qa'] },
    ],
  },
  {
    id: 'npd',
    label: 'New Product Development',
    color: '#93328E',
    description: 'Concept through to first production run.',
    tasks: [
      { key: 'concept', name: 'Concept & feasibility', dayOffset: 0, durDays: 7 },
      { key: 'recipe', name: 'Recipe development', dayOffset: 8, durDays: 14, dependsOn: ['concept'] },
      { key: 'trials', name: 'Kitchen trials', dayOffset: 23, durDays: 10, dependsOn: ['recipe'] },
      { key: 'nutrition', name: 'Nutrition & clinical review', dayOffset: 34, durDays: 7, dependsOn: ['trials'] },
      { key: 'scaleup', name: 'Scale-up & first run', dayOffset: 42, durDays: 10, dependsOn: ['nutrition'] },
    ],
  },
  {
    id: 'onboarding',
    label: 'Customer Onboarding',
    color: '#3C8C5A',
    description: 'Standard steps to onboard a new facility.',
    tasks: [
      { key: 'kickoff', name: 'Kick-off & requirements', dayOffset: 0, durDays: 2 },
      { key: 'menu', name: 'Menu configuration', dayOffset: 3, durDays: 7, dependsOn: ['kickoff'] },
      { key: 'training', name: 'Staff training', dayOffset: 11, durDays: 5, dependsOn: ['menu'] },
      { key: 'firstorder', name: 'First order & review', dayOffset: 17, durDays: 3, dependsOn: ['training'] },
    ],
  },
  {
    id: 'blank',
    label: 'Blank workstream',
    color: '#7A8899',
    description: 'An empty lane with no tasks.',
    tasks: [],
  },
]
