'use client';
import { useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, signInWithMicrosoft, signOut, isMemberOfGroup } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { VStack } from '@astryxdesign/core/Layout';
import { Center } from '@astryxdesign/core/Center';
import { Text } from '@astryxdesign/core/Text';
import { Button as AstryxButton } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';

// Microsoft's four-square brand mark.
function MicrosoftLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

const loginBgStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(120deg, #93328E 0%, #C63663 45%, #F8485E 100%)',
  padding: 'var(--spacing-6)',
};

// The planner is internal to The Pure Food Co — only org accounts may use it.
const ORG_DOMAIN = 'thepurefoodco.com';
const inOrg = (u: User | null | undefined) =>
  !!u?.email && u.email.toLowerCase().endsWith('@' + ORG_DOMAIN);

export default function AuthGate({ children }: { children: ReactNode }) {
  // undefined = still checking, null = not signed in, User = signed in
  const [user, setUser] = useState<User | null | undefined>(undefined);
  // NZ Team gate: undefined = still checking, then true/false once profiles.is_nz_team
  // is read. plannerStore.init() (downstream, inside children) is what actually sets
  // this flag via the Graph group check on fresh sign-in — here we only read it back.
  const [isNzTeam, setIsNzTeam] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!supabase) {
      setUser(null);
      return;
    }
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

  // Resolve NZ Team membership once signed in with an org account. On a fresh OAuth
  // redirect (provider_token present), re-check Graph and persist the verdict so it
  // survives later reloads; on a plain reload (session restored from storage, no
  // provider_token), fall back to the last persisted verdict in profiles.is_nz_team.
  useEffect(() => {
    if (!supabase || !user || !inOrg(user)) {
      setIsNzTeam(undefined);
      return;
    }
    let cancelled = false;
    const nzGroupId = process.env.NEXT_PUBLIC_NZ_TEAM_GROUP_ID;

    (async () => {
      const { data: { session } } = await supabase!.auth.getSession();
      const providerToken = session?.provider_token;

      let verdict: boolean;
      if (providerToken && nzGroupId) {
        verdict = await isMemberOfGroup(providerToken, nzGroupId);
        // upsert, not update — on a brand-new sign-in this runs before
        // plannerStore.init()'s linkOwnProfile has created the profiles row.
        await supabase!
          .from('profiles')
          .upsert({ email: user.email, is_nz_team: verdict }, { onConflict: 'email' });
      } else {
        const { data } = await supabase!
          .from('profiles')
          .select('is_nz_team')
          .eq('email', user.email)
          .maybeSingle();
        verdict = !!data?.is_nz_team;
      }
      if (!cancelled) setIsNzTeam(verdict);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Still checking session
  if (user === undefined) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--muted)',
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    );
  }

  // No Supabase configured (dev / local use)
  if (!supabase) return <>{children}</>;

  // Signed in with a non-org account — reject and offer to switch accounts.
  if (user && !inOrg(user)) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">P</div>
          <div className="auth-wordmark">Pure Food Co</div>
          <div className="auth-sub">Restricted</div>
          <p className="auth-hint" style={{ marginTop: 4 }}>
            This app is for Pure Food Co accounts only.<br />
            <strong>{user.email}</strong> isn’t part of the organisation.
          </p>
          <Button variant="outline" className="w-full justify-center mt-3" onClick={signOut}>
            Sign in with a different account
          </Button>
        </div>
      </div>
    );
  }

  // Signed in with an org account — still resolving NZ Team membership.
  if (user && isNzTeam === undefined) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--muted)',
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    );
  }

  // Signed in with an org account, but not a member of the NZ Team group.
  if (user && isNzTeam === false) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">P</div>
          <div className="auth-wordmark">Pure Food Co</div>
          <div className="auth-sub">Restricted</div>
          <p className="auth-hint" style={{ marginTop: 4 }}>
            This app is limited to the NZ Team for now.<br />
            <strong>{user.email}</strong> isn’t a member of that group.
          </p>
          <Button variant="outline" className="w-full justify-center mt-3" onClick={signOut}>
            Sign in with a different account
          </Button>
        </div>
      </div>
    );
  }

  // Signed in with an org account and NZ Team membership confirmed
  if (user) return <>{children}</>;

  // Not signed in
  return (
    <Center axis="both" style={loginBgStyle}>
      <Card padding={8} width="100%" maxWidth={400}>
        <VStack gap={4} hAlign="stretch">
          <VStack gap={2} hAlign="center">
            <Text type="display-3" as="h2">
              Welcome
            </Text>
            <Text type="body" color="secondary" size="sm">
              You will be redirected back after signing in.
            </Text>
          </VStack>

          <AstryxButton
            label="Continue with Microsoft"
            icon={<MicrosoftLogo />}
            variant="secondary"
            size="lg"
            onClick={signInWithMicrosoft}
          />

          <VStack hAlign="center">
            <Text type="supporting" color="secondary">
              Use your Pure Food Co Microsoft account
            </Text>
          </VStack>
        </VStack>
      </Card>
    </Center>
  );
}
