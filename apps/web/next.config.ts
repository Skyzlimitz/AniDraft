import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship raw TypeScript source (see their package.json
  // `exports`, which point at `./src/index.ts`). Next must transpile them.
  transpilePackages: ["@anidraft/db", "@anidraft/shared", "@anidraft/anilist"],
};

export default nextConfig;
