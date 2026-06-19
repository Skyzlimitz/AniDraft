"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { signInWithProvider } from "@/components/auth/actions";
import {
  OAUTH_PROVIDERS,
  type OAuthProviderId,
} from "@/components/auth/providers";

/**
 * The two provider buttons on `/sign-in`. Each lives in its own `<form>` whose
 * action is `signInWithProvider` bound to a provider id, so a click POSTs to
 * the server action and is redirected into the OAuth flow — no client-side
 * fetch, and it works without JS. `useFormStatus` gives each button an
 * independent pending state (the spinner) while its own form is submitting.
 */

const PROVIDER_ICON: Record<OAuthProviderId, React.ReactNode> = {
  google: <GoogleIcon />,
  discord: <DiscordIcon />,
};

export function SignInButtons() {
  return (
    <div className="flex flex-col gap-3">
      {OAUTH_PROVIDERS.map((provider) => (
        <form
          key={provider.id}
          action={signInWithProvider.bind(null, provider.id)}
        >
          <ProviderButton label={provider.label} icon={PROVIDER_ICON[provider.id]} />
        </form>
      ))}
    </div>
  );
}

function ProviderButton({
  label,
  icon,
}: {
  label: string;
  icon: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="outline"
      size="lg"
      className="w-full"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? <Spinner /> : icon}
      {pending ? "Connecting…" : `Continue with ${label}`}
    </Button>
  );
}

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

/* Brand marks — lucide-react has no brand icons, so these are inlined. */

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="#5865F2">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.45 3a13.7 13.7 0 0 0-.62 1.27 18.3 18.3 0 0 0-5.66 0A13.6 13.6 0 0 0 8.55 3a19.7 19.7 0 0 0-4.88 1.37C.58 9 .12 13.51.35 17.97A19.9 19.9 0 0 0 6.36 21c.49-.66.92-1.36 1.29-2.1-.71-.27-1.39-.6-2.03-.99.17-.13.34-.26.5-.39a14.2 14.2 0 0 0 12.1 0c.16.14.33.27.5.4-.64.38-1.32.71-2.03.98.37.74.8 1.45 1.29 2.1a19.8 19.8 0 0 0 6.01-3.03c.27-5.17-.46-9.64-3.67-13.6zM8.4 15.23c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.22 0 2.19 1.1 2.17 2.42 0 1.34-.95 2.42-2.17 2.42zm7.2 0c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.22 0 2.19 1.1 2.17 2.42 0 1.34-.95 2.42-2.17 2.42z" />
    </svg>
  );
}
