import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship raw TypeScript source (see their package.json
  // `exports`, which point at `./src/index.ts`). Next must transpile them.
  transpilePackages: ["@anidraft/db", "@anidraft/shared", "@anidraft/anilist"],
  images: {
    // Avatar hosts for the OAuth providers (see `@/auth-providers`): Google
    // serves from lh3.googleusercontent.com, Discord from its CDN. Allow-listed
    // so `next/image` in `UserMenu` will optimize remote avatars.
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "cdn.discordapp.com" },
      // AniList cover art (the pool editor's show thumbnails, issue #36).
      { protocol: "https", hostname: "s4.anilist.co" },
    ],
  },
};

export default nextConfig;
