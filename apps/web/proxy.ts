import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/auth.config";

/**
 * Public routes reachable without a session. This is an **allowlist**
 * (deny-by-default): any matched path not listed here requires authentication,
 * so a newly added route is protected automatically rather than leaking until
 * someone remembers to gate it.
 *
 * The OAuth callback (`/api/auth/*`) is also public, but it never reaches this
 * logic — `config.matcher` below excludes every `/api` path from the proxy, so
 * Auth.js's own endpoints are untouched. API-route auth is a separate concern
 * (see the `proxy` doc comment).
 */
export const PUBLIC_ROUTES = ["/", "/sign-in"] as const;

export function isPublicRoute(pathname: string): boolean {
  return (PUBLIC_ROUTES as readonly string[]).includes(pathname);
}

export type ProxyDecision =
  | { type: "next" }
  | { type: "redirect"; location: string };

/**
 * Pure routing decision, split out from the Auth.js wrapper so it is unit
 * testable without constructing a request: let the request through, or send an
 * unauthenticated visitor to `/sign-in` with a `callbackUrl` pointing back to
 * where they were headed (e.g. `/leagues` → `/sign-in?callbackUrl=/leagues`).
 *
 * `callbackUrl` is the bare pathname. A pathname is a valid URL query value
 * unencoded (RFC 3986 permits `/` in the query component) and contains none of
 * the characters that would need escaping, so the result stays readable and
 * matches the path verbatim.
 */
export function decideProxyAction(
  pathname: string,
  isLoggedIn: boolean,
): ProxyDecision {
  if (isLoggedIn || isPublicRoute(pathname)) {
    return { type: "next" };
  }
  return { type: "redirect", location: `/sign-in?callbackUrl=${pathname}` };
}

const { auth } = NextAuth(authConfig);

/**
 * Session-aware proxy (Next 16's rename of middleware; this file replaces the
 * `middleware.ts` named in the issue). Built from the adapter-free config so the
 * session check is a local JWT cookie decode — no DB round-trip per request.
 *
 * Gates every matched route: an unauthenticated user may only reach the public
 * allowlist; anything else redirects to `/sign-in`. Visiting `/sign-in` itself
 * is public, so there is no redirect loop.
 *
 * API routes are deliberately NOT covered here — `config.matcher` excludes
 * `/api`, so the proxy never runs on them. Each API route handler is
 * responsible for its own `auth()` check; that is a separate concern, deferred
 * until API routes exist.
 */
export const proxy = auth((req) => {
  const decision = decideProxyAction(req.nextUrl.pathname, !!req.auth);
  if (decision.type === "redirect") {
    return NextResponse.redirect(new URL(decision.location, req.nextUrl.origin));
  }
  return NextResponse.next();
});

export const config = {
  // Skip API routes (including /api/auth itself) and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
