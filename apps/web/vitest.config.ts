import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror the `@/*` path alias from tsconfig.json.
    alias: { "@": appRoot },
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // next-auth imports extensionless `next/server`, which Node's ESM
        // resolver rejects; inlining lets Vite resolve it instead.
        inline: ["next-auth", "@auth/core"],
      },
    },
  },
});
