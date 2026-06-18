import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SignInButtons } from "@/components/auth/SignInButtons";
import { authErrorMessage } from "@/components/auth/providers";

export const metadata: Metadata = {
  title: "Sign in · AniDraft",
  description: "Sign in to AniDraft with Google or Discord.",
};

/**
 * `/sign-in` — the single entry point for authentication. Renders the provider
 * buttons (`SignInButtons`) inside a centered card and surfaces any Auth.js
 * `?error=` code as a friendly alert. Already-signed-in users are bounced
 * straight to `/leagues` so the page never shows a redundant login form.
 *
 * `searchParams` is a Promise in this Next version (App Router), hence the
 * `await`.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    redirect("/leagues");
  }

  const { error } = await searchParams;
  const errorMessage = authErrorMessage(error);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <Link href="/" className="text-2xl font-bold tracking-tight">
        Ani<span className="text-primary">Draft</span>
      </Link>

      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-lg">
        <div className="mb-6 space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Choose a provider to draft your league.
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-6 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground"
          >
            {errorMessage}
          </div>
        )}

        <SignInButtons />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          We only use your provider account to identify you. No posts, no spam.
        </p>
      </div>
    </main>
  );
}
