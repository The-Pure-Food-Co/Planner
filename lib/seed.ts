import type { PlannerData } from './types'

// Empty seed. The planner is live on Supabase and the roster is provisioned
// just-in-time as people sign in (see plannerStore.init / db.linkOwnProfile),
// so there are no placeholder seed users or demo workspaces anymore. This still
// serves as the fallback shape when Supabase is unconfigured or returns empty.
export const SEED: PlannerData = {
  version: 2,
  exportedAt: null,
  userList: [],
  members: [],
  memberships: [],
  savedViews: [],
  kpiGroups: [],
  laneTemplates: [],
  workspaces: [],
}
