import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

// Session-aware proxy (Next 16's rename of middleware). Instantiated from the
// adapter-free config: JWT sessions make the check a local cookie decode, no
// DB access. No route-gating rules yet — those land with the sign-in UI.
export const proxy = NextAuth(authConfig).auth;

export const config = {
  // Skip API routes (including /api/auth itself) and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
