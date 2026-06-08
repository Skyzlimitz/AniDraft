import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <span className="rounded-full border border-border bg-card px-4 py-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        🚧 Under Construction
      </span>

      <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
        Ani<span className="text-primary">Draft</span> — coming soon
      </h1>

      <p className="max-w-md text-balance text-muted-foreground">
        Draft your favorite currently-airing anime and compete with friends in a
        fantasy league.
      </p>

      <Button disabled>Get notified</Button>
    </main>
  );
}
