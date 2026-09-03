import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Paths reachable without a session — the callback still needs to run
// unauthenticated so it can *establish* one.
const PUBLIC_PATHS = ["/auth/callback"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const { response, user } = await updateSession(request);

  if (!user) {
    const hubUrl = process.env.NEXT_PUBLIC_AUTH_HUB_URL!;
    const loginUrl = new URL("/", hubUrl);
    loginUrl.searchParams.set("redirect_app", request.nextUrl.origin);
    loginUrl.searchParams.set("redirect_to", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
