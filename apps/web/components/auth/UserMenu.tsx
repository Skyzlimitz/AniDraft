import Image from "next/image";
import Link from "next/link";

import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/components/auth/actions";
import { displayName, userInitials } from "@/components/auth/user-display";

/**
 * Global header widget. As an async server component it reads the session
 * directly via `auth()`:
 *
 * - Signed out → a "Sign in" link to `/sign-in`.
 * - Signed in  → the user's avatar (or initials fallback), their name, and a
 *   sign-out button wired to the `signOutAction` server action.
 *
 * Avatar hosts (Google / Discord CDNs) are allow-listed in `next.config.ts`
 * `images.remotePatterns` so `next/image` will optimize them.
 */
export async function UserMenu() {
  const session = await auth();
  const user = session?.user;

  if (!user) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    );
  }

  const name = displayName(user.name, user.email);

  return (
    <div className="flex items-center gap-3">
      <span
        className="flex size-8 items-center justify-center overflow-hidden rounded-full border border-border bg-secondary text-xs font-medium text-secondary-foreground"
        aria-hidden={user.image ? "true" : undefined}
      >
        {user.image ? (
          <Image
            src={user.image}
            alt={name}
            width={32}
            height={32}
            className="size-full object-cover"
          />
        ) : (
          userInitials(user.name, user.email)
        )}
      </span>

      <span className="hidden text-sm font-medium sm:inline">{name}</span>

      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
    </div>
  );
}
