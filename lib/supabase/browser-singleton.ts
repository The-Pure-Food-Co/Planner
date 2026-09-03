'use client';
import { createClient } from './client';

// lib/supabase/client.ts's createClient() (the SSR helper used by proxy.ts's
// session check) assumes NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are always set and
// instantiates a fresh client per call. The planner data layer (lib/supabase.ts,
// lib/appAccess.ts) predates that helper and was written against a single
// module-level client that degrades to `null` when env vars are missing (so
// local dev without Supabase configured doesn't crash, it just no-ops
// reads/writes) — preserve that shape here rather than rewriting every call
// site's `supabase?.from(...)` chains.
let cached: ReturnType<typeof createClient> | null | undefined;

export function getSupabaseBrowserClient(): ReturnType<typeof createClient> | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  cached = url && key ? createClient() : null;
  return cached;
}
