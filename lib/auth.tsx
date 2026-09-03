'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { usePlannerStore } from '@/store/plannerStore';
import type { Member } from './types';

const AuthCtx = createContext<User | null>(null);
export const useAuthUser = () => useContext(AuthCtx);

/** Display name from OAuth metadata (Azure puts it in full_name/name), else email. */
export const authDisplayName = (u: User | null): string =>
  ((u?.user_metadata?.full_name || u?.user_metadata?.name || u?.email) ?? '') as string;

/**
 * The current user, resolved once for everyone: profile row (cloud), OAuth
 * metadata (signed in but not yet in the roster), or the legacy ui.me name
 * (local/seed mode). Use this instead of re-deriving the chain per component.
 */
export function useMe(): { meId: string | null; me: Member | undefined; myName: string } {
  const authUser = useAuthUser();
  const meId = usePlannerStore((s) => s.meId);
  const me = usePlannerStore((s) => s.data.members.find((m) => m.id === s.meId));
  const uiMe = usePlannerStore((s) => s.ui.me);
  const myName = me?.displayName || authDisplayName(authUser) || uiMe || 'Me';
  return { meId, me, myName };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => setUser(session?.user ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  return <AuthCtx.Provider value={user}>{children}</AuthCtx.Provider>;
}
