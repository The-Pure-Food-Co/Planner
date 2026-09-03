'use client'
import { useEffect, useState, useCallback } from 'react'
import { getSupabaseBrowserClient } from './supabase/browser-singleton'
import { useAuthUser } from './auth'
import { appAccessDb, loadAppAccess, subscribeToAppAccess, rowToAccessRule, groupAccessKey, type AccessRule, type Member } from './appAccess'

const supabase = getSupabaseBrowserClient()

export type AppAccessState = {
  loading: boolean
  isAdmin: boolean
  members: Member[]
  rules: AccessRule[]
  // A key is visible to the current user if there's no rule for it (open to
  // everyone) or the current user's profile id is in the rule's list.
  // Admins see everything while adminViewOn is true (default); flipping it
  // off previews the app exactly as a restricted, non-admin member of the
  // roster would see it, without losing admin powers.
  canSee: (appKey: string) => boolean
  canSeeGroup: (groupKey: string) => boolean
  // Admin-only "see everything" toggle, defaults on for admins. Has no
  // effect for non-admins (who never get the control to change it).
  adminViewOn: boolean
  setAdminViewOn: (on: boolean) => void
  // Optimistically set (or clear, with an empty list) the restriction for a
  // key. Admin-only server-side via the app_access RLS write policy.
  setAccess: (appKey: string, profileIds: string[]) => void
}

export function useAppAccess(): AppAccessState {
  const user = useAuthUser()
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<Member[]>([])
  const [rules, setRules] = useState<AccessRule[]>([])
  const [selfProfileId, setSelfProfileId] = useState<string | null>(null)
  const [adminViewOn, setAdminViewOn] = useState(true)

  useEffect(() => {
    loadAppAccess().then(({ members, rules }) => {
      setMembers(members)
      setRules(rules)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!supabase || !user?.email) { setSelfProfileId(null); return }
    supabase.from('profiles').select('id').eq('email', user.email).maybeSingle()
      .then(({ data }) => setSelfProfileId(data?.id ?? null))
  }, [user?.email])

  useEffect(() => subscribeToAppAccess((event, row) => {
    const rule = rowToAccessRule(row)
    setRules(cur => {
      const next = cur.filter(r => r.appKey !== rule.appKey)
      return event === 'DELETE' ? next : [...next, rule]
    })
  }), [])

  const self = members.find(m => m.id === selfProfileId)
  const isAdmin = self?.isAppAdmin ?? false

  const canSee = useCallback((appKey: string) => {
    if (isAdmin && adminViewOn) return true
    const rule = rules.find(r => r.appKey === appKey)
    if (!rule) return true
    return !!selfProfileId && rule.profileIds.includes(selfProfileId)
  }, [isAdmin, adminViewOn, rules, selfProfileId])

  const canSeeGroup = useCallback(
    (groupKey: string) => canSee(groupAccessKey(groupKey)),
    [canSee]
  )

  const setAccess = useCallback((appKey: string, profileIds: string[]) => {
    let prior: AccessRule | undefined
    setRules(cur => {
      prior = cur.find(r => r.appKey === appKey)
      const next = cur.filter(r => r.appKey !== appKey)
      return profileIds.length === 0 ? next : [...next, { appKey, profileIds }]
    })
    appAccessDb.setAccess(appKey, profileIds).then(({ error }) => {
      if (!error) return
      setRules(cur => {
        const next = cur.filter(r => r.appKey !== appKey)
        return prior ? [...next, prior] : next
      })
    })
  }, [])

  return { loading, isAdmin, members, rules, canSee, canSeeGroup, adminViewOn, setAdminViewOn, setAccess }
}
