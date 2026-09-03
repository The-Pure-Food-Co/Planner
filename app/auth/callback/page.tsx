"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HUB_LOGIN_URL = process.env.NEXT_PUBLIC_AUTH_HUB_URL
  ? new URL("/", process.env.NEXT_PUBLIC_AUTH_HUB_URL).toString()
  : "/";

// `next` is attacker-controllable (it's a URL param). A bare `next.startsWith("/")`
// check still lets "//evil.com" or "/\evil.com" through, which browsers treat as
// protocol-relative — resolving against window.location.origin and comparing the
// parsed origin closes that off.
function sanitizeNext(next: string): string {
  try {
    const parsed = new URL(next, window.location.origin);
    return parsed.origin === window.location.origin
      ? parsed.pathname + parsed.search + parsed.hash
      : "/";
  } catch {
    return "/";
  }
}

function Spinner() {
  return (
    <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
  );
}

function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ranRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Effects can double-fire in dev/StrictMode; setSession must run once.
    if (ranRef.current) return;
    ranRef.current = true;

    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const next = searchParams.get("next") ?? "/";

    // Scrub the tokens from the address bar and history before doing
    // anything else, so they don't linger anywhere the URL gets captured
    // (history, back/forward cache, screen-sharing, shoulder-surfing).
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );

    if (!accessToken || !refreshToken) {
      queueMicrotask(() => setError("Missing session tokens."));
      return;
    }

    createClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: setSessionError }) => {
        if (setSessionError) {
          setError(setSessionError.message);
          return;
        }
        router.replace(sanitizeNext(next));
      });
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Sign-in failed: {error}</p>
        <Link href={HUB_LOGIN_URL} className={cn(buttonVariants({ variant: "link" }))}>
          Return to login
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Spinner />
      <p className="text-sm text-muted-foreground">Signing you in...</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <div className="h-dvh">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <AuthCallback />
      </Suspense>
    </div>
  );
}
